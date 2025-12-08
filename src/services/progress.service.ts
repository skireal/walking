import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { AuthService } from './auth.service';

declare var L: any;

const STORAGE_KEY = 'walker_progress_data';

interface ProgressData {
  totalDistance: number;
  visitedTiles: string[];
  exploredPath: [number, number][];
  unlockedAchievements: string[];
}

@Injectable({
  providedIn: 'root',
})
export class ProgressService {
  totalDistance = signal<number>(0);
  visitedTiles = signal<Set<string>>(new Set());
  exploredPath = signal<[number, number][]>([]);
  unlockedAchievements = signal<Set<string>>(new Set());

  discoveredTilesCount = computed(() => this.visitedTiles().size);

  public readonly TILE_SIZE_DEGREES_LAT = 0.0005;

  private authService = inject(AuthService);

  constructor() {
    effect(() => {
      if (!this.authService.isFirebaseReady()) {
        return;
      }
      
      if (this.authService.isLoggedIn()) {
        // User is logged in. Clear any anonymous data.
        this.resetProgress();
      } else {
        // User is logged out or anonymous.
        this.resetProgress(); // Ensure clean state before loading
        this.loadFromLocalStorage();
      }
    });
  }

  updatePosition(pos: GeolocationPosition): void {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newPoint: [number, number] = [lat, lng];

    this.exploredPath.update(path => {
      if (path.length > 0) {
        const lastPoint = L.latLng(path[path.length - 1]);
        const newLatLng = L.latLng(newPoint);
        const distanceIncrement = lastPoint.distanceTo(newLatLng);
        this.totalDistance.update(d => d + distanceIncrement);
      }
      return [...path, newPoint];
    });

    const currentTileId = this.getTileIdForLatLng(lat, lng);
    if (!this.visitedTiles().has(currentTileId)) {
      this.visitedTiles.update(tiles => {
        tiles.add(currentTileId);
        return new Set(tiles);
      });
    }

    // Only save progress for anonymous users
    if (!this.authService.isLoggedIn()) {
        this.saveToLocalStorage();
    }
  }

  unlockAchievement(achievementId: string): void {
    if (!this.unlockedAchievements().has(achievementId)) {
      this.unlockedAchievements.update(achievements => {
        achievements.add(achievementId);
        return new Set(achievements);
      });
      // Only save progress for anonymous users
      if (!this.authService.isLoggedIn()) {
        this.saveToLocalStorage();
      }
    }
  }

  public getTileLngSizeAtLat(lat: number): number {
    const latRad = lat * Math.PI / 180;
    if (Math.abs(lat) >= 85) {
      return this.TILE_SIZE_DEGREES_LAT / Math.cos(85 * Math.PI / 180);
    }
    return this.TILE_SIZE_DEGREES_LAT / Math.cos(latRad);
  }

  public getTileIdForLatLng(lat: number, lng: number): string {
    const tileY = Math.floor(lat / this.TILE_SIZE_DEGREES_LAT);
    const representativeLat = (tileY + 0.5) * this.TILE_SIZE_DEGREES_LAT;
    const tileSizeLng = this.getTileLngSizeAtLat(representativeLat);
    const tileX = Math.floor(lng / tileSizeLng);
    return `${tileX},${tileY}`;
  }

  private loadFromLocalStorage(): void {
    try {
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        const data: ProgressData = JSON.parse(savedData);
        this.totalDistance.set(data.totalDistance || 0);
        this.visitedTiles.set(new Set(data.visitedTiles || []));
        this.exploredPath.set(data.exploredPath || []);
        this.unlockedAchievements.set(new Set(data.unlockedAchievements || []));
      }
    } catch (e) {
      console.error('❌ Error loading progress from localStorage', e);
    }
  }

  private saveToLocalStorage(): void {
    try {
      const data: ProgressData = {
        totalDistance: this.totalDistance(),
        visitedTiles: Array.from(this.visitedTiles()),
        exploredPath: this.exploredPath(),
        unlockedAchievements: Array.from(this.unlockedAchievements()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('❌ Error saving progress to localStorage', e);
    }
  }

  public resetProgress(): void {
    this.totalDistance.set(0);
    this.visitedTiles.set(new Set());
    this.exploredPath.set([]);
    this.unlockedAchievements.set(new Set());
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('❌ Error clearing progress', e);
    }
  }

  isSyncingNow(): boolean {
    return false;
  }
}