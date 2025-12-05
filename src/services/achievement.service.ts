import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { ProgressService } from './progress.service';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  condition: (progress: ProgressService) => boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AchievementService {
  private progressService = inject(ProgressService);

  // Define all possible achievements
  private allAchievements = signal<Omit<Achievement, 'unlocked'>[]>([
    { id: 'TILES_10', name: 'Explorer', description: 'Explore your first 10 tiles.', icon: 'award', condition: p => p.discoveredTilesCount() >= 10 },
    { id: 'TILES_100', name: 'Cartographer', description: 'Explore 100 tiles.', icon: 'map', condition: p => p.discoveredTilesCount() >= 100 },
    { id: 'TILES_1000', name: 'World Wanderer', description: 'Explore 1,000 tiles.', icon: 'globe', condition: p => p.discoveredTilesCount() >= 1000 },
    { id: 'DISTANCE_5', name: 'Stroller', description: 'Walk a total of 5 km.', icon: 'flame', condition: p => (p.totalDistance() / 1000) >= 5 },
    { id: 'DISTANCE_42', name: 'Marathoner', description: 'Walk a total of 42 km.', icon: 'mountain', condition: p => (p.totalDistance() / 1000) >= 42 },
  ]);

  // Dynamic signal that combines achievement definitions with unlock status
  achievements = computed<Achievement[]>(() => {
    const unlockedIds = this.progressService.unlockedAchievements();
    return this.allAchievements().map(ach => ({
      ...ach,
      unlocked: unlockedIds.has(ach.id),
    }));
  });

  constructor() {
    // Effect to check for new achievements whenever progress changes
    effect(() => {
        // This effect runs when any signal read inside it changes.
        // We read signals from ProgressService via the condition function.
        const unlockedIds = this.progressService.unlockedAchievements();
        this.allAchievements().forEach(ach => {
            if (!unlockedIds.has(ach.id) && ach.condition(this.progressService)) {
                this.progressService.unlockAchievement(ach.id);
            }
        });
    }, { allowSignalWrites: true }); // Necessary because we're updating a signal (unlocking) inside an effect
  }
}
