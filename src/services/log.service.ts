
import { Injectable, signal, effect } from '@angular/core';

export interface LogEntry {
  id: string;
  date: string;
  imageDataUrl: string;
  aiDescription: string;
  userNotes: string;
  location: { lat: number; lng: number };
}

const LOG_KEY = 'walker_discovery_log_v1';

@Injectable({
  providedIn: 'root',
})
export class LogService {
  logEntries = signal<LogEntry[]>([]);

  constructor() {
    this.loadLog();

    effect(() => {
      this.saveLog();
    });
  }

  addLogEntry(entry: Omit<LogEntry, 'id' | 'date'>): void {
    const newEntry: LogEntry = {
      ...entry,
      id: self.crypto.randomUUID(),
      date: new Date().toISOString(),
    };
    this.logEntries.update(entries => [newEntry, ...entries]);
  }

  private loadLog(): void {
    try {
      const savedLog = localStorage.getItem(LOG_KEY);
      if (savedLog) {
        this.logEntries.set(JSON.parse(savedLog));
      }
    } catch (e) {
      console.error('Error loading discovery log from localStorage', e);
      localStorage.removeItem(LOG_KEY);
    }
  }

  private saveLog(): void {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(this.logEntries()));
    } catch (e) {
      console.error('Error saving discovery log to localStorage', e);
    }
  }
}
