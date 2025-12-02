
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class ProfileComponent {
  userName = signal('Alex Walker');
  joinDate = signal('Joined March 2023');

  stats = signal([
    { label: 'Total Steps', value: '1.2M' },
    { label: 'Total Distance', value: '950 km' },
    { label: 'Walks Logged', value: '184' }
  ]);

  achievements = signal([
    { name: 'First 10k Steps', icon: 'award', unlocked: true },
    { name: '7-Day Streak', icon: 'flame', unlocked: true },
    { name: 'Marathon Walk', icon: 'mountain', unlocked: false },
    { name: 'Early Bird', icon: 'sunrise', unlocked: true },
    { name: 'Night Owl', icon: 'moon', unlocked: false },
  ]);
}
