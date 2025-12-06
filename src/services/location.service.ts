import { Injectable, signal } from '@angular/core';

export type LocationStatus = 'idle' | 'tracking' | 'denied' | 'error';

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  position = signal<GeolocationPosition | null>(null);
  status = signal<LocationStatus>('idle');
  private watchId: number | null = null;

  constructor() {}

  startWatching(): void {
    if (!navigator.geolocation) {
      this.status.set('error');
      console.error('Geolocation is not supported by this browser.');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.position.set(pos);
        if (this.status() !== 'tracking') {
            this.status.set('tracking');
        }
      },
      (err: GeolocationPositionError) => {
        console.error(`Geolocation error (Code: ${err.code}): ${err.message}`);
        if (err.code === err.PERMISSION_DENIED) {
          this.status.set('denied');
        } else {
          this.status.set('error');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 30000, // Increased from 20s to 30s
        maximumAge: 10000, // Allow using a cached position up to 10s old
      }
    );
  }

  stopWatching(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.status.set('idle');
    }
  }
}