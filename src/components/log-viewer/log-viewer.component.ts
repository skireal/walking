import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogService } from '../../services/log.service';

@Component({
  selector: 'app-log-viewer',
  templateUrl: './log-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class LogViewerComponent {
  logService = inject(LogService);
  visible = false;

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      // Scroll to bottom after render
      setTimeout(() => {
        const el = document.getElementById('log-scroll');
        if (el) el.scrollTop = el.scrollHeight;
      }, 50);
    }
  }

  levelClass(level: string): string {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn':  return 'text-yellow-400';
      case 'info':  return 'text-blue-400';
      default:      return 'text-gray-300';
    }
  }

  copy(): void {
    this.logService.copyAll();
  }

  clear(): void {
    this.logService.clear();
  }
}
