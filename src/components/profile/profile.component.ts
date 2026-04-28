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
  joinDate = signal('Joined March 2023');

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

  logCopied = signal(false);

  startLog(): void {
    this.progressService.clearPosLog();
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