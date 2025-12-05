import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProgressService } from '../../services/progress.service';
import { AchievementService } from '../../services/achievement.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class ProfileComponent {
  private progressService = inject(ProgressService);
  private achievementService = inject(AchievementService);

  userName = signal('Alex Walker');
  joinDate = signal('Joined March 2023');

  // Stats are now computed from the ProgressService
  stats = computed(() => [
    { label: 'Tiles Explored', value: this.progressService.discoveredTilesCount().toLocaleString() },
    { label: 'Total Distance', value: `${(this.progressService.totalDistance() / 1000).toFixed(1)} km` },
    { label: 'Walks Logged', value: 'N/A' } // Placeholder for now
  ]);

  // Achievements are read directly from the AchievementService
  achievements = this.achievementService.achievements;
}
