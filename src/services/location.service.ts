import { Injectable, signal, effect, inject, DestroyRef } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location, CallbackError } from '@capacitor-community/background-geolocation';
import { LocationBuffer, type BufferedLocation } from '../plugins/location-buffer.plugin';
import { ProgressService } from './progress.service';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export type LocationStatus = 'idle' | 'tracking' | 'denied' | 'error' | 'initializing' | 'low-accuracy';

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  position = signal<GeolocationPosition | null>(null);
  status = signal<LocationStatus>('idle');
  private watching = false;
  private watchId: number | null = null;
  private nativeWatcherId: string | null = null;
  private accuracyThreshold = 50;
  private lastGpsAcquiredLog = 0;
  private appResumeListener: PluginListenerHandle | null = null;
  private destroyRef = inject(DestroyRef);
  private progressService = inject(ProgressService);

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

  isWatching(): boolean {
    return this.watching;
  }

  /**
   * Resolves when GPS reaches a usable state (tracking or low-accuracy),
   * or when permission is denied/errored, or after timeoutMs.
   * Safe to call before startWatching() — polls the status signal.
   */
  waitForFirstFix(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        const s = this.status();
        if (s === 'tracking' || s === 'low-accuracy' || s === 'denied' || s === 'error') {
          done();
        }
      };
      check(); // resolve immediately if already in a final state
      const interval = setInterval(check, 150);
      const timer = setTimeout(done, timeoutMs);
    });
  }

  startWatching(): void {
    if (this.watching) return;
    this.watching = true;
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
    console.log('🚀 [LocationService] Starting native location buffer...');
    LocationBuffer.startBuffering()
      .then(() => console.log('✅ [LocationBuffer] startBuffering OK'))
      .catch((err: unknown) => console.warn('⚠️ [LocationBuffer] startBuffering FAILED:', err));

    // Сбрасываем буфер сразу — на случай если приложение открылось после прогулки (холодный старт)
    this.flushLocationBuffer();

    // Подписываемся на resume — но только один раз. Удаляем старый слушатель перед регистрацией нового.
    if (this.appResumeListener) {
      this.appResumeListener.remove();
      this.appResumeListener = null;
    }
    App.addListener('resume', () => {
      console.log('📱 [App] resumed — flushing location buffer...');
      this.flushLocationBuffer();
    }).then(handle => {
      this.appResumeListener = handle;
    });

    console.log('🛰️ [BackgroundGeolocation] Adding watcher...');
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
          console.error('❌ [BackgroundGeolocation] error:', JSON.stringify(error));
          this.status.set(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'error');
          return;
        }
        if (location) {
          this.applyLocation(
            location.latitude,
            location.longitude,
            location.accuracy,
            location.time ?? Date.now(),
            location.bearing ?? null,
            location.speed ?? null,
            location.altitude ?? null,
          );
        }
      }
    ).then((id: string) => {
      this.nativeWatcherId = id;
      console.log(`✅ [BackgroundGeolocation] watcher started, id=${id}`);
    }).catch((err: unknown) => {
      console.error('❌ [BackgroundGeolocation] Failed to start:', err);
      this.status.set('error');
    });
  }

  // Читает буфер накопленных координат и применяет их по одной.
  // Важно: progressService.updatePosition() вызывается напрямую для каждой точки,
  // минуя сигнал position — иначе Angular батчит 196 set() в один effect-вызов
  // и записывается только последний тайл.
  private async flushLocationBuffer(): Promise<void> {
    try {
      const { locations } = await LocationBuffer.getAndClearBuffer();
      const parsed: BufferedLocation[] = JSON.parse(locations);
      console.log(`📦 [LocationBuffer] flushing ${parsed.length} buffered locations`);
      if (parsed.length === 0) return;

      let newTiles = 0;
      let skippedAccuracy = 0;
      const tilesBefore = this.progressService.visitedTiles().size;

      for (const loc of parsed) {
        const pos = this.buildPosition(loc.latitude, loc.longitude, loc.accuracy, loc.time, loc.bearing ?? null, loc.speed ?? null, loc.altitude ?? null);
        if (loc.accuracy <= this.accuracyThreshold) {
          const before = this.progressService.visitedTiles().size;
          this.progressService.updatePosition(pos, false);
          if (this.progressService.visitedTiles().size > before) newTiles++;
        } else {
          skippedAccuracy++;
        }
      }

      const tilesAfter = this.progressService.visitedTiles().size;

      // Обновляем сигнал позиции последней точкой — для маркера на карте
      const last = parsed[parsed.length - 1];
      this.applyLocation(last.latitude, last.longitude, last.accuracy, last.time, last.bearing ?? null, last.speed ?? null, last.altitude ?? null);

      console.log(
        `✅ [LocationBuffer] flush complete — total: ${parsed.length} | ` +
        `low-accuracy skipped: ${skippedAccuracy} | ` +
        `sent to progress: ${parsed.length - skippedAccuracy} | ` +
        `new tiles: ${newTiles} | tiles: ${tilesBefore} → ${tilesAfter}`
      );
    } catch (err) {
      console.warn('⚠️ [LocationBuffer] flush failed:', err);
    }
  }

  // Строит объект GeolocationPosition из сырых значений
  private buildPosition(
    latitude: number, longitude: number, accuracy: number, time: number,
    heading: number | null, speed: number | null, altitude: number | null,
  ): GeolocationPosition {
    return {
      coords: { latitude, longitude, accuracy, altitude, altitudeAccuracy: null, heading, speed },
      timestamp: time,
    } as GeolocationPosition;
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
    const pos = this.buildPosition(latitude, longitude, accuracy, time, heading, speed, altitude);

    this.position.set(pos);

    if (accuracy <= this.accuracyThreshold) {
      if (this.status() !== 'tracking') {
        this.status.set('tracking');
        const now = Date.now();
        if (now - this.lastGpsAcquiredLog > 5000) {
          this.lastGpsAcquiredLog = now;
          console.log(`✅ GPS acquired! Accuracy: ${Math.round(accuracy)}m`);
        }
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
    this.watching = false;
    if (Capacitor.isNativePlatform()) {
      if (this.nativeWatcherId) {
        BackgroundGeolocation.removeWatcher({ id: this.nativeWatcherId });
        this.nativeWatcherId = null;
      }
      if (this.appResumeListener) {
        this.appResumeListener.remove();
        this.appResumeListener = null;
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
