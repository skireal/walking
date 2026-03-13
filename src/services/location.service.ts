import { Injectable, signal, effect, inject, DestroyRef } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { BackgroundGeolocationPlugin, Location, CallbackError } from '@capacitor-community/background-geolocation';
import { LocationBuffer, type BufferedLocation } from '../plugins/location-buffer.plugin';

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
  // LocationBuffer пишет координаты в SharedPreferences пока WebView на паузе.
  // При открытии приложения буфер считывается и применяется к туману.

  private startNativeWatching(): void {
    this.status.set('initializing');

    // Запускаем буферизацию координат на нативной стороне
    LocationBuffer.startBuffering().catch((err: unknown) => {
      console.warn('⚠️ LocationBuffer.startBuffering failed:', err);
    });

    // Подписываемся на resume — читаем накопленный буфер
    App.addListener('resume', () => {
      this.flushLocationBuffer();
    });

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
          this.applyLocation(
            location.latitude,
            location.longitude,
            location.accuracy,
            location.time,
            location.bearing ?? null,
            location.speed ?? null,
            location.altitude ?? null,
          );
        }
      }
    ).then((id: string) => {
      this.nativeWatcherId = id;
    }).catch((err: unknown) => {
      console.error('❌ Failed to start background geolocation:', err);
      this.status.set('error');
    });
  }

  // Читает буфер накопленных координат и применяет их по одной
  private async flushLocationBuffer(): Promise<void> {
    try {
      const { locations } = await LocationBuffer.getAndClearBuffer();
      const parsed: BufferedLocation[] = JSON.parse(locations);
      if (parsed.length === 0) return;

      console.log(`📦 Flushing ${parsed.length} buffered locations`);
      for (const loc of parsed) {
        this.applyLocation(
          loc.latitude,
          loc.longitude,
          loc.accuracy,
          loc.time,
          loc.bearing ?? null,
          loc.speed ?? null,
          loc.altitude ?? null,
        );
      }
    } catch (err) {
      console.warn('⚠️ Failed to flush location buffer:', err);
    }
  }

  // Общий метод — применяет одну координату к сигналу позиции
  private applyLocation(
    latitude: number,
    longitude: number,
    accuracy: number,
    time: number,
    heading: number | null,
    speed: number | null,
    altitude: number | null,
  ): void {
    const pos = {
      coords: {
        latitude,
        longitude,
        accuracy,
        altitude,
        altitudeAccuracy: null,
        heading,
        speed,
      },
      timestamp: time,
    } as GeolocationPosition;

    this.position.set(pos);

    if (accuracy <= this.accuracyThreshold) {
      if (this.status() !== 'tracking') {
        this.status.set('tracking');
        console.log(`✅ GPS acquired! Accuracy: ${Math.round(accuracy)}m`);
      }
    } else {
      if (this.status() !== 'low-accuracy') {
        this.status.set('low-accuracy');
      }
    }
  }

  // ── Web (браузер) ──────────────────────────────────────────────────────────

  private startWebWatching(): void {
    if (!navigator.geolocation) {
      this.status.set('error');
      console.error('❌ Geolocation is not supported by this browser.');
      return;
    }

    this.status.set('initializing');

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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        console.log(
          `📍 Position update - Accuracy: ${Math.round(pos.coords.accuracy)}m, ` +
            `Lat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)}`
        );
        this.position.set(pos);
        if (pos.coords.accuracy <= this.accuracyThreshold) {
          if (this.status() !== 'tracking') this.status.set('tracking');
        } else {
          if (this.status() !== 'low-accuracy') this.status.set('low-accuracy');
        }
      },
      (err) => {
        console.error(`❌ Watch error (${err.code}):`, err.message);
        this.handleLocationError(err);
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
  }

  // ── Общее ──────────────────────────────────────────────────────────────────

  stopWatching(): void {
    if (Capacitor.isNativePlatform()) {
      if (this.nativeWatcherId) {
        BackgroundGeolocation.removeWatcher({ id: this.nativeWatcherId });
        this.nativeWatcherId = null;
      }
      LocationBuffer.stopBuffering().catch(() => {});
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
      case 1:
        console.error('❌ User denied geolocation permission');
        this.status.set('denied');
        break;
      case 2:
        console.error('❌ GPS is unavailable - check if GPS is enabled on your device');
        this.status.set('error');
        break;
      case 3:
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
