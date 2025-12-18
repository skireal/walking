import { Injectable, signal, effect } from '@angular/core';

export type LocationStatus = 'idle' | 'tracking' | 'denied' | 'error' | 'initializing' | 'low-accuracy';

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  position = signal<GeolocationPosition | null>(null);
  status = signal<LocationStatus>('idle');
  private watchId: number | null = null;
  private accuracyThreshold = 50; // ✅ Минимальная точность: 50 метров

  constructor() {
    // ✅ Следим за точностью позиции
    effect(() => {
      const pos = this.position();
      if (pos && pos.coords.accuracy > this.accuracyThreshold) {
        if (this.status() !== 'low-accuracy') {
          this.status.set('low-accuracy');
          console.warn(`⚠️ Low accuracy (${Math.round(pos.coords.accuracy)}m) - waiting for GPS...`);
        }
      }
    });
  }

  startWatching(): void {
    if (!navigator.geolocation) {
      this.status.set('error');
      console.error('❌ Geolocation is not supported by this browser.');
      return;
    }

    this.status.set('initializing');

    // ✅ Получи первую позицию БЫСТРО (может быть неточная)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (pos.coords.accuracy <= this.accuracyThreshold) {
          // ✅ Хорошая точность с первого раза
          this.position.set(pos);
          this.status.set('tracking');
          console.log(`✅ Good accuracy (${Math.round(pos.coords.accuracy)}m) on first try:`, pos.coords);
        } else {
          // ⚠️ Плохая точность - используем как временную и ждём улучшения
          console.warn(`⚠️ Initial position has low accuracy (${Math.round(pos.coords.accuracy)}m), waiting for GPS...`);
          this.position.set(pos);
          this.status.set('low-accuracy');
        }
      },
      (err) => {
        console.error(`❌ getCurrentPosition error (${err.code}):`, err.message);
        this.handleLocationError(err);
        // ✅ Продолжаем с watchPosition даже если getCurrentPosition не сработал
      },
      {
        enableHighAccuracy: true, // ✅ Требуем высокую точность
        timeout: 10000, // 10 секунд на первую позицию
        maximumAge: 0, // Не используем кеш
      }
    );

    // ✅ watchPosition для получения лучшей точности со временем
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        console.log(
          `📍 Position update - Accuracy: ${Math.round(pos.coords.accuracy)}m, ` +
            `Lat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)}`
        );

        this.position.set(pos);

        // ✅ Обновляем статус когда точность улучшается
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
        enableHighAccuracy: true, // ✅ Требуем GPS
        timeout: 30000, // 30 секунд для каждого обновления
        maximumAge: 5000, // Можем использовать позицию до 5 сек старую
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

  // ✅ Проверка точности позиции
  hasGoodAccuracy(): boolean {
    const pos = this.position();
    return pos !== null && pos.coords.accuracy <= this.accuracyThreshold;
  }

  // ✅ Получить текущую точность в метрах
  getCurrentAccuracy(): number | null {
    const pos = this.position();
    return pos?.coords.accuracy ?? null;
  }
}