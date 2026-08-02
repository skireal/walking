import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProgressService } from '../../services/progress.service';
import { AchievementService } from '../../services/achievement.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { generateAvatarDataUrl } from '../../utils/avatar';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class ProfileComponent {
  private progressService = inject(ProgressService);
  private achievementService = inject(AchievementService);
  private authService = inject(AuthService);
  // FIX: Explicitly provide the generic type to `inject` to fix a type inference issue where the router was being inferred as `unknown`.
  private router = inject<Router>(Router);

  currentUser = this.authService.currentUser;

  // Real account creation date from Firebase (metadata.creationTime is an
  // RFC-1123 string). Falls back to empty so we never show a fabricated date.
  joinDate = computed(() => {
    const created = this.currentUser()?.metadata?.creationTime;
    if (!created) return '';
    const d = new Date(created);
    if (isNaN(d.getTime())) return '';
    return `Joined ${d.toLocaleString('en-US', { month: 'long', year: 'numeric' })}`;
  });

  displayName = computed(() => {
    const user = this.currentUser();
    if (!user) return '';
    if (user.displayName) return user.displayName;
    const namePart = user.email?.split('@')[0] ?? '';
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  });

  avatarUrl = computed(() => {
    const user = this.currentUser();
    return generateAvatarDataUrl(user?.email ?? user?.uid ?? 'walker');
  });

  stats = computed(() => [
    { label: 'Tiles Explored', value: this.progressService.discoveredTilesCount().toLocaleString() }
  ]);

  achievements = this.achievementService.achievements;

  // Non-null while cloud sync is failing — shown as a banner so a broken sync
  // isn't invisible. Progress is always safe locally regardless.
  syncError = this.progressService.syncError;

  logCopied = signal(false);
  logCleared = signal(false);
  // Whether the log has anything to copy/clear — drives the button active state.
  // Read once on entry; updated locally after clear (copy does not empty it).
  hasLog = signal(this.progressService.hasPosLog());

  clearLog(): void {
    this.progressService.clearPosLog();
    this.hasLog.set(false);
    this.logCleared.set(true);
    setTimeout(() => this.logCleared.set(false), 2000);
  }

  async copyLog(): Promise<void> {
    const log = this.progressService.getPosLog();
    try {
      await navigator.clipboard.writeText(log);
      this.logCopied.set(true);
      setTimeout(() => this.logCopied.set(false), 2000);
    } catch {
      // Fallback: show in alert so user can copy manually
      alert(log.slice(0, 3000) + (log.length > 3000 ? '\n...(truncated)' : ''));
    }
  }

  async logout(): Promise<void> {
    try {
      await this.authService.logout();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Failed to log out:', error);
    }
  }
}