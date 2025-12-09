import { Injectable, signal, inject, effect } from '@angular/core';
import { AuthService } from './auth.service';

export interface LogEntry {
  id: string;
  date: string;
  imageDataUrl: string;
  aiDescription: string;
  userNotes: string;
  location: { lat: number; lng: number };
}

@Injectable({
  providedIn: 'root',
})
export class LogService {
  logEntries = signal<LogEntry[]>([]);

  private authService = inject(AuthService);
  private readonly STORAGE_KEY = 'walker_log_entries';
  
  constructor() {
    effect(() => {
      if (!this.authService.isFirebaseReady()) {
        return;
      }

      if (this.authService.isLoggedIn()) {
        // User is logged in. Clear local log entries.
        this.resetLog();
      } else {
        // User is logged out or anonymous.
        this.resetLog();
        this.loadFromLocalStorage();
      }
    });
  }

  private loadFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const entries = JSON.parse(stored) as LogEntry[];
        this.logEntries.set(entries);
      }
    } catch (error) {
      console.error('❌ Failed to load log entries from localStorage:', error);
    }
  }

  private saveToLocalStorage(): void {
    try {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(this.logEntries())
      );
    } catch (error) {
      console.error('❌ Failed to save log entries to localStorage:', error);
    }
  }

  addLogEntry(entry: Omit<LogEntry, 'id' | 'date'>): void {
    const newEntry: LogEntry = {
      ...entry,
      id: self.crypto.randomUUID(),
      date: new Date().toISOString(),
    };

    this.logEntries.update(entries => [newEntry, ...entries]);

    if (!this.authService.isLoggedIn()) {
      this.saveToLocalStorage();
    }
  }

  async deleteLogEntry(id: string): Promise<void> {
    this.logEntries.update(entries => entries.filter(e => e.id !== id));
    if (!this.authService.isLoggedIn()) {
      this.saveToLocalStorage();
    }
  }

  resetLog(): void {
    this.logEntries.set([]);
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('❌ Failed to clear localStorage:', error);
    }
  }

  isSyncingNow(): boolean {
    return false;
  }
}