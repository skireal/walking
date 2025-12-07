
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogService } from '../../services/log.service';

@Component({
  selector: 'app-log',
  templateUrl: './log.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class LogComponent {
  private logService = inject(LogService);
  logEntries = this.logService.logEntries;
}
