import { Injectable, signal, effect, inject, DestroyRef } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location, CallbackError } from '@capacitor-community/background-geolocation';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export type LocationStatus = 'idle' | 'tracking' | 'denied' | 'error' | 'initializing' | 'low-accuracy';

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  position = signal<GeolocationPosition | null>(null);
  status = signal<LocationStatus>('idle');
  private watchId: number | null = null;
  private nativeWatcherId: string | null = null;
  private accuracyThreshold = 50; // Минимальная точность: 50 метров
  private destroyRef = inject(DestroyRef);

  constructor() {
    // Следим за точностью позиции
    effect(() => {
      const pos = this.position();
      if (pos && pos.coords.accuracy > this.accuracyThreshold) {
        if (this.status() !== 'low-accuracy') {
          this.status.set('low-accuracy');
          console.warn(`⚠️ Low accuracy (${Math.round(pos.coords.accuracy)}m) - waiting for GPS...`);
        }
      }
    });

    this.destroyRef.onDestroy(() => this.stopWatching());
  }

  startWatching(): void {
    if (Capacitor.isNativePlatform()) {
      this.startNativeWatching();
    } else {
      this.startWebWatching();
    }
  }

  // ── Native (Android/iOS) ───────────────────────────────────────────────────
  // Запускает Foreground Service — геолокация работает даже когда экран выключен.

  private startNativeWatching(): void {
    this.status.set('initializing');

    BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Walker отслеживает ваш маршрут',
        backgroundTitle: 'Walker активен',
        requestPermissions: true,
        stale: false,
        distanceFilter: 3, // метров — минимальный сдвиг для нового колбэка
      },
      (location: Location | undefined, error: CallbackError | undefined) => {
        if (error) {
          console.error('❌ Background geolocation error:', error);
          this.status.set(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'error');
          return;
        }
        if (location) {
          // Приводим к типу GeolocationPosition для совместимости с остальным кодом
          const pos = {
            coords: {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              altitude: location.altitude ?? null,
              altitudeAccuracy: null,
              heading: location.bearing ?? null,
              speed: location.speed ?? null,
            },
            timestamp: location.time,
          } as GeolocationPosition;

          this.position.set(pos);

          if (location.accuracy <= this.accuracyThreshold) {
            if (this.status() !== 'tracking') {
              this.status.set('tracking');
              console.log(`✅ GPS acquired! Accuracy: ${Math.round(location.accuracy)}m`);
            }
          } else {
            if (this.status() !== 'low-accuracy') {
              this.status.set('low-accuracy');
            }
          }
        }
      }
    ).then((id: string) => {
      this.nativeWatcherId = id;
    }).catch((err: unknown) => {
      console.error('❌ Failed to start background geolocation:', err);
      this.status.set('error');
    });
  }

  // ── Web (браузер) ──────────────────────────────────────────────────────────

  private startWebWatching(): void {
    if (!navigator.geolocation) {
      this.status.set('error');
      console.error('❌ Geolocation is not supported by this browser.');
      return;
    }

    this.status.set('initializing');

    // Получи первую позицию БЫСТРО (может быть неточная)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (pos.coords.accuracy <= this.accuracyThreshold) {
          this.position.set(pos);
          this.status.set('tracking');
          console.log(`✅ Good accuracy (${Math.round(pos.coords.accuracy)}m) on first try:`, pos.coords);
        } else {
          console.warn(`⚠️ Initial position has low accuracy (${Math.round(pos.coords.accuracy)}m), waiting for GPS...`);
          this.position.set(pos);
          this.status.set('low-accuracy');
        }
      },
      (err) => {
        console.error(`❌ getCurrentPosition error (${err.code}):`, err.message);
        this.handleLocationError(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    // watchPosition для получения лучшей точности со временем
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        console.log(
          `📍 Position update - Accuracy: ${Math.round(pos.coords.accuracy)}m, ` +
            `Lat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)}`
        );

        this.position.set(pos);

        if (pos.coords.accuracy <= this.accuracyThreshold) {
          if (this.status() !== 'tracking') {
            this.status.set('tracking');
            console.log(`✅ GPS acquired! Accuracy now ${Math.round(pos.coords.accuracy)}m`);
          }
        } else {
          if (this.status() !== 'low-accuracy') {
            this.status.set('low-accuracy');
          }
        }
      },
      (err) => {
        console.error(`❌ Watch error (${err.code}):`, err.message);
        this.handleLocationError(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 5000,
      }
    );
  }

  // ── Общее ──────────────────────────────────────────────────────────────────

  stopWatching(): void {
    if (Capacitor.isNativePlatform()) {
      if (this.nativeWatcherId) {
        BackgroundGeolocation.removeWatcher({ id: this.nativeWatcherId });
        this.nativeWatcherId = null;
      }
    } else {
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    }
    this.status.set('idle');
  }

  private handleLocationError(err: GeolocationPositionError): void {
    switch (err.code) {
      case 1: // PERMISSION_DENIED
        console.error('❌ User denied geolocation permission');
        this.status.set('denied');
        break;
      case 2: // POSITION_UNAVAILABLE
        console.error('❌ GPS is unavailable - check if GPS is enabled on your device');
        this.status.set('error');
        break;
      case 3: // TIMEOUT
        console.error('❌ Geolocation timeout - check GPS signal or move outside');
        this.status.set('error');
        break;
      default:
        console.error('❌ Unknown geolocation error');
        this.status.set('error');
    }
  }

  hasGoodAccuracy(): boolean {
    const pos = this.position();
    return pos !== null && pos.coords.accuracy <= this.accuracyThreshold;
  }

  getCurrentAccuracy(): number | null {
    const pos = this.position();
    return pos?.coords.accuracy ?? null;
  }
}
