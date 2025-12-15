import { Injectable, signal, computed, inject, effect, untracked } from '@angular/core';
import { AuthService } from './auth.service';
import { getFirestore, doc, setDoc, onSnapshot, Firestore, Unsubscribe } from 'firebase/firestore';

declare var L: any;

const STORAGE_KEY = 'walker_progress_data';

interface ProgressData {
  totalDistance: number;
  visitedTiles: string[];
  exploredPath: string; // ← Сохраняем как одну строку
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
  private db: Firestore | null = null;
  private progressUnsubscribe: Unsubscribe | null = null;
  private isSyncing = signal(false);
  private saveTimeout: any = null;

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      const isFirebaseReady = this.authService.isFirebaseReady();

      if (!isFirebaseReady) {
        return;
      }

      if (this.db === null) {
        try {
          this.db = getFirestore();
        } catch (e) {
          console.error('Failed to initialize Firestore', e);
          return;
        }
      }

      if (this.progressUnsubscribe) {
        this.progressUnsubscribe();
        this.progressUnsubscribe = null;
      }

      if (user) {
        // User is logged in
        this.resetProgress(true);

        const progressDocRef = doc(this.db, 'users', user.uid, 'progress', 'main');
        this.progressUnsubscribe = onSnapshot(
          progressDocRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data() as ProgressData;
              untracked(() => {
                this.totalDistance.set(data.totalDistance || 0);
                this.visitedTiles.set(new Set(data.visitedTiles || []));

                // ✅ Десериализуем путь из строки
                const pathString = data.exploredPath || '[]';
                try {
                  this.exploredPath.set(JSON.parse(pathString));
                } catch {
                  this.exploredPath.set([]);
                }

                this.unlockedAchievements.set(new Set(data.unlockedAchievements || []));
              });
            }
          },
          (error) => {
            console.error('Error listening to progress document:', error);
          }
        );
      } else {
        // User is logged out
        this.resetProgress(false);
        this.loadFromLocalStorage();
      }
    });
  }

  updatePosition(pos: GeolocationPosition): void {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newPoint: [number, number] = [lat, lng];

    this.exploredPath.update((path) => {
      if (path.length > 0) {
        const lastPoint = L.latLng(path[path.length - 1]);
        const newLatLng = L.latLng(newPoint);
        const distanceIncrement = lastPoint.distanceTo(newLatLng);
        this.totalDistance.update((d) => d + distanceIncrement);
      }
      return [...path, newPoint];
    });

    const currentTileId = this.getTileIdForLatLng(lat, lng);
    if (!this.visitedTiles().has(currentTileId)) {
      this.visitedTiles.update((tiles) => {
        tiles.add(currentTileId);
        return new Set(tiles);
      });
    }

    this.saveProgress();
  }

  unlockAchievement(achievementId: string): void {
    if (!this.unlockedAchievements().has(achievementId)) {
      this.unlockedAchievements.update((achievements) => {
        achievements.add(achievementId);
        return new Set(achievements);
      });
      this.saveProgress();
    }
  }

  public getTileLngSizeAtLat(lat: number): number {
    const latRad = (lat * Math.PI) / 180;
    if (Math.abs(lat) >= 85) {
      return this.TILE_SIZE_DEGREES_LAT / Math.cos((85 * Math.PI) / 180);
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
        const data = JSON.parse(savedData);
        this.totalDistance.set(data.totalDistance || 0);
        this.visitedTiles.set(new Set(data.visitedTiles || []));
        this.exploredPath.set(data.exploredPath || []);
        this.unlockedAchievements.set(new Set(data.unlockedAchievements || []));
      }
    } catch (e) {
      console.error('Error loading progress from localStorage', e);
    }
  }

  private saveToLocalStorage(): void {
    try {
      const data = {
        totalDistance: this.totalDistance(),
        visitedTiles: Array.from(this.visitedTiles()),
        exploredPath: this.exploredPath(),
        unlockedAchievements: Array.from(this.unlockedAchievements()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Error saving progress to localStorage', e);
    }
  }

  public resetProgress(clearStorage: boolean = true): void {
    this.totalDistance.set(0);
    this.visitedTiles.set(new Set());
    this.exploredPath.set([]);
    this.unlockedAchievements.set(new Set());
    if (clearStorage) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.error('Error clearing progress from localStorage', e);
      }
    }
  }

  private saveProgress(): void {
    this.isSyncing.set(true);

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      if (this.authService.isLoggedIn()) {
        this.saveToFirestore().finally(() => this.isSyncing.set(false));
      } else {
        this.saveToLocalStorage();
        this.isSyncing.set(false);
      }
      this.saveTimeout = null;
    }, 2000);
  }

  private async saveToFirestore(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user || !this.db) {
      return;
    }

    try {
      const data: ProgressData = {
        totalDistance: this.totalDistance(),
        visitedTiles: Array.from(this.visitedTiles()),
        exploredPath: JSON.stringify(this.exploredPath()), // ✅ Сериализуем в строку
        unlockedAchievements: Array.from(this.unlockedAchievements()),
      };
      const progressDocRef = doc(this.db, 'users', user.uid, 'progress', 'main');
      await setDoc(progressDocRef, data, { merge: true });
    } catch (e) {
      console.error('Error saving progress to Firestore', e);
    }
  }

  isSyncingNow(): boolean {
    return this.isSyncing();
  }
}
