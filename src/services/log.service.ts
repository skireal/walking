import { Injectable, signal } from '@angular/core';

export interface LogEntry {
  time: string;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class LogService {
  private readonly MAX_ENTRIES = 2000;
  logs = signal<LogEntry[]>([]);

  constructor() {
    this.interceptConsole();
  }

  private interceptConsole(): void {
    const self = this;
    const originalLog   = console.log.bind(console);
    const originalWarn  = console.warn.bind(console);
    const originalError = console.error.bind(console);
    const originalInfo  = console.info.bind(console);

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      self.push('log', args);
    };
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      self.push('warn', args);
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      self.push('error', args);
    };
    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      self.push('info', args);
    };
  }

  private push(level: LogEntry['level'], args: unknown[]): void {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
    const message = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');

    this.logs.update(entries => {
      const next = [...entries, { time, level, message }];
      return next.length > this.MAX_ENTRIES ? next.slice(-this.MAX_ENTRIES) : next;
    });
  }

  copyAll(): void {
    const text = this.logs()
      .map(e => `[${e.time}] [${e.level.toUpperCase()}] ${e.message}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      console.info('✅ Logs copied to clipboard');
    });
  }

  clear(): void {
    this.logs.set([]);
  }
}
