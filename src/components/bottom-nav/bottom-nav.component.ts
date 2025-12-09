
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, RouterLinkActive]
})
export class BottomNavComponent {
  navItems = [
    { path: '/dashboard', icon: 'home', label: 'Home' },
    { path: '/log', icon: 'journal', label: 'Log' },
    { path: '/planner', icon: 'sparkles', label: 'AI Plan' },
    { path: '/profile', icon: 'user', label: 'Profile' }
  ];
}