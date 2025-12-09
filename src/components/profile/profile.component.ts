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
  private router = inject(Router);

  currentUser = this.authService.currentUser;
  joinDate = signal('Joined March 2023'); // This will be dynamic later

  stats = computed(() => [
    { label: 'Tiles Explored', value: this.progressService.discoveredTilesCount().toLocaleString() },
    { label: 'Total Distance', value: `${(this.progressService.totalDistance() / 1000).toFixed(1)} km` },
    { label: 'Walks Logged', value: 'N/A' } // Placeholder for now
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
