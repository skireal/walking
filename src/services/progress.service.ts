import { Injectable, signal, computed, inject, effect, untracked, DestroyRef } from '@angular/core';
import { AuthService } from './auth.service';
import { getFirestore, doc, setDoc, onSnapshot, Firestore, Unsubscribe } from 'firebase/firestore';

interface LeafletLatLng {
  distanceTo(other: LeafletLatLng): number;
}

interface LeafletStatic {
  latLng(coords: [number, number]): LeafletLatLng;
}

declare var L: LeafletStatic | undefined;

const STORAGE_KEY = 'walker_progress_data_v2'; // Bump version to avoid conflicts
const MIN_DISTANCE_THRESHOLD_METERS = 3; // Minimum distance in meters to record a new point

interface ProgressData {
  visitedTiles: string[];
  unlockedAchievements: string[];
}

@Injectable({
  providedIn: 'root',
})
export class ProgressService {
  visitedTiles = signal<Set<string>>(new Set());
  unlockedAchievements = signal<Set<string>>(new Set());

  discoveredTilesCount = computed(() => this.visitedTiles().size);

  public readonly TILE_SIZE_DEGREES_LAT = 0.0005;

  private authService = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private db: Firestore | null = null;
  private progressUnsubscribe: Unsubscribe | null = null;
  private isSyncing = signal(false);
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPosition: GeolocationPosition | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      if (this.progressUnsubscribe) {
        this.progressUnsubscribe();
        this.progressUnsubscribe = null;
      }
    });

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
                // Merge incoming tiles with local ones — never overwrite local data.
                // This prevents a race where Firestore reconnects after app resume
                // and overwrites tiles that were just flushed from the location buffer.
                this.visitedTiles.update(existing => {
                  const merged = new Set(existing);
                  (data.visitedTiles || []).forEach((t: string) => merged.add(t));
                  console.log(`☁️ [Progress] Firestore snapshot: ${data.visitedTiles?.length ?? 0} cloud tiles merged → total ${merged.size}`);
                  return merged;
                });
                this.unlockedAchievements.update(existing => {
                  const merged = new Set(existing);
                  (data.unlockedAchievements || []).forEach((a: string) => merged.add(a));
                  return merged;
                });
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
    
    // If there's a previous point, check the distance to avoid rapid updates on static location
    if (this.lastPosition && typeof L !== 'undefined') {
      try {
        const lastLatLng = L.latLng([this.lastPosition.coords.latitude, this.lastPosition.coords.longitude]);
        const newLatLng = L.latLng(newPoint);
        const distanceChange = lastLatLng.distanceTo(newLatLng);

        // If movement is insignificant, do nothing.
        if (distanceChange < MIN_DISTANCE_THRESHOLD_METERS) {
            return; // logged in bulk by caller if needed
        }
      } catch (e) {
        console.error('🗺️ [Progress] distance calc error:', e);
      }
    } else if (!this.lastPosition) {
      console.log(`🗺️ [Progress] first position received, L available: ${typeof L !== 'undefined'}`);
    }

    this.lastPosition = pos;

    // Update the discovered tile if it's a new one
    const currentTileId = this.getTileIdForLatLng(lat, lng);
    if (!this.visitedTiles().has(currentTileId)) {
      this.visitedTiles.update((tiles) => {
        const newTiles = new Set(tiles);
        newTiles.add(currentTileId);
        return newTiles;
      });
      console.log(`🟩 [Progress] new tile: ${currentTileId} (total: ${this.visitedTiles().size})`);
      // Save only when tiles actually change — no point saving stale data
      this.saveProgress();
    }
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
    // FIX: Corrected a typo using the defined `tileY` variable instead of an undefined `y`.
    return `${tileX},${tileY}`;
  }

  private loadFromLocalStorage(): void {
    try {
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        const data = JSON.parse(savedData);
        this.visitedTiles.set(new Set(data.visitedTiles || []));
        this.unlockedAchievements.set(new Set(data.unlockedAchievements || []));
      }
    } catch (e) {
      console.error('Error loading progress from localStorage', e);
    }
  }

  private saveToLocalStorage(): void {
    try {
      const data: ProgressData = {
        visitedTiles: Array.from(this.visitedTiles()),
        unlockedAchievements: Array.from(this.unlockedAchievements()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Error saving progress to localStorage', e);
    }
  }

  public resetProgress(clearStorage: boolean = true): void {
    this.visitedTiles.set(new Set());
    this.unlockedAchievements.set(new Set());
    this.lastPosition = null;
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
      console.warn(`💾 [Progress] saveToFirestore skipped — user: ${!!user}, db: ${!!this.db}`);
      return;
    }

    // Snapshot tiles NOW — before any async gap where new tiles might be added
    const tilesToSave = Array.from(this.visitedTiles());
    const tileCount = tilesToSave.length;
    console.log(`💾 [Progress] saving ${tileCount} tiles to Firestore...`);
    try {
      const data: ProgressData = {
        visitedTiles: tilesToSave,
        unlockedAchievements: Array.from(this.unlockedAchievements()),
      };
      const progressDocRef = doc(this.db, 'users', user.uid, 'progress', 'main');
      await setDoc(progressDocRef, data, { merge: true });
      console.log(`✅ [Progress] saved ${tileCount} tiles to Firestore`);
      // If tiles were added while save was in-flight, schedule another save
      if (this.visitedTiles().size > tileCount) {
        console.log(`🔄 [Progress] ${this.visitedTiles().size - tileCount} new tiles added during save → re-saving`);
        this.saveProgress();
      }
    } catch (e) {
      console.error('❌ [Progress] Firestore save FAILED:', e);
    }
  }

  isSyncingNow(): boolean {
    return this.isSyncing();
  }
}