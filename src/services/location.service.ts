import { Injectable, signal } from '@angular/core';

export type LocationStatus = 'idle' | 'tracking' | 'denied' | 'error' | 'initializing';

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
      console.error('❌ Geolocation is not supported by this browser.');
      return;
    }

    this.status.set('initializing');

    // Use only watchPosition with high accuracy to avoid the initial "jump"
    // from a low-accuracy position. This provides a more reliable start.
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const isFirstUpdate = this.position() === null;
        this.position.set(pos);
        if (this.status() !== 'tracking') {
          this.status.set('tracking');
        }
        
        if(isFirstUpdate) {
            console.log('📍 Initial high-accuracy position acquired:', pos.coords);
        }
      },
      (err) => {
        console.error(`❌ Geolocation error (${err.code}): ${err.message}`);
        this.handleLocationError(err);
      },
      {
        enableHighAccuracy: true, // Always request high accuracy
        timeout: 200000,           // Give more time for the first fix (20 seconds)
        maximumAge: 0,            // Do not use a cached position
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

  private handleLocationError(err: GeolocationPositionError): void {
    switch (err.code) {
      case err.PERMISSION_DENIED:
        console.error('❌ Geolocation permission denied by user');
        this.status.set('denied');
        break;
      case err.TIMEOUT:
        console.error('❌ Geolocation request timed out');
        this.status.set('error');
        break;
      case err.POSITION_UNAVAILABLE:
        console.error('❌ Position information is unavailable');
        this.status.set('error');
        break;
      default:
        console.error('❌ Unknown geolocation error');
        this.status.set('error');
    }
  }
}
