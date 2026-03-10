import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProgressService } from '../../services/progress.service';
import { AchievementService } from '../../services/achievement.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

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
  joinDate = computed(() => {
    const user = this.authService.currentUser();
    if (user?.metadata?.creationTime) {
      const date = new Date(user.metadata.creationTime);
      return `Joined ${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    }
    return 'Walker Member';
  });

  stats = computed(() => [
    { label: 'Tiles Explored', value: this.progressService.discoveredTilesCount().toLocaleString() }
  ]);

  achievements = this.achievementService.achievements;

  async logout(): Promise<void> {
    try {
      await this.authService.logout();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Failed to log out:', error);
    }
  }
}