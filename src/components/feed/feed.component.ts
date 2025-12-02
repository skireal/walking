
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface FeedItem {
  id: number;
  userName: string;
  userAvatar: string;
  activity: string;
  details: string;
  timeAgo: string;
}

@Component({
  selector: 'app-feed',
  templateUrl: './feed.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class FeedComponent {
  feedItems = signal<FeedItem[]>([
    { id: 1, userName: 'Jane Doe', userAvatar: 'https://picsum.photos/id/1027/100/100', activity: 'Morning Run', details: '5.2 km in 30 mins', timeAgo: '15m ago' },
    { id: 2, userName: 'John Smith', userAvatar: 'https://picsum.photos/id/1005/100/100', activity: 'Evening Stroll', details: '3.1 km in 45 mins', timeAgo: '2h ago' },
    { id: 3, userName: 'Emily White', userAvatar: 'https://picsum.photos/id/1011/100/100', activity: 'Hit 10,000 steps!', details: 'Goal achieved', timeAgo: '4h ago' },
    { id: 4, userName: 'Michael B.', userAvatar: 'https://picsum.photos/id/1012/100/100', activity: 'Park Walk', details: '2.5 km in 28 mins', timeAgo: 'Yesterday' },
  ]);
}
