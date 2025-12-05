import { Injectable, signal, effect } from '@angular/core';

// Declare Leaflet to use its types without direct import
declare var L: any;

const TILES_KEY = 'strut_visitedTiles_v2';
const PATH_KEY = 'strut_exploredPath_v2';
const DISTANCE_KEY = 'strut_totalDistance_v2';
const ACHIEVEMENTS_KEY = 'strut_unlockedAchievements_v2';


@Injectable({
  providedIn: 'root',
})
export class ProgressService {
  // State Signals
  totalDistance = signal<number>(0); // in meters
  visitedTiles = signal<Set<string>>(new Set());
  exploredPath = signal<[number, number][]>([]);
  unlockedAchievements = signal<Set<string>>(new Set());

  // Derived Signals
  discoveredTilesCount = signal<number>(0);
  
  // Tile size constants
  private readonly TILE_SIZE_DEGREES_LAT = 0.0005;

  constructor() {
    this.loadProgress();

    // Effect to save progress whenever it changes
    effect(() => {
      this.saveProgress();
    });
    
    // Effect to keep tile count in sync
    effect(() => {
        this.discoveredTilesCount.set(this.visitedTiles().size);
    });
  }

  updatePosition(pos: GeolocationPosition): void {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newPoint: [number, number] = [lat, lng];
    
    // Update path and distance
    this.exploredPath.update(path => {
        if (path.length > 0) {
            const lastPoint = L.latLng(path[path.length - 1]);
            const newLatLng = L.latLng(newPoint);
            const distanceIncrement = lastPoint.distanceTo(newLatLng); // in meters
            this.totalDistance.update(d => d + distanceIncrement);
        }
        return [...path, newPoint];
    });

    // Check for new tile discovery
    const currentTileId = this.getTileIdForLatLng(lat, lng);
    if (!this.visitedTiles().has(currentTileId)) {
        this.visitedTiles.update(tiles => {
            tiles.add(currentTileId);
            return new Set(tiles);
        });
    }
  }
  
  unlockAchievement(achievementId: string) {
      if (!this.unlockedAchievements().has(achievementId)) {
          this.unlockedAchievements.update(achievements => {
              achievements.add(achievementId);
              return new Set(achievements);
          });
      }
  }

  private getTileIdForLatLng(lat: number, lng: number): string {
    const latRad = lat * Math.PI / 180;
    const tileSizeLng = this.TILE_SIZE_DEGREES_LAT / Math.cos(latRad);
    
    const tileX = Math.floor(lng / tileSizeLng);
    const tileY = Math.floor(lat / this.TILE_SIZE_DEGREES_LAT);
    return `${tileX},${tileY}`;
  }

  private loadProgress(): void {
    try {
      const savedTiles = localStorage.getItem(TILES_KEY);
      if (savedTiles) this.visitedTiles.set(new Set(JSON.parse(savedTiles)));

      const savedPath = localStorage.getItem(PATH_KEY);
      if (savedPath) this.exploredPath.set(JSON.parse(savedPath));

      const savedDistance = localStorage.getItem(DISTANCE_KEY);
      if (savedDistance) this.totalDistance.set(parseFloat(savedDistance));
      
      const savedAchievements = localStorage.getItem(ACHIEVEMENTS_KEY);
      if (savedAchievements) this.unlockedAchievements.set(new Set(JSON.parse(savedAchievements)));

    } catch (e) {
      console.error('Error loading progress from localStorage', e);
      // Clear potentially corrupted data
      localStorage.removeItem(TILES_KEY);
      localStorage.removeItem(PATH_KEY);
      localStorage.removeItem(DISTANCE_KEY);
      localStorage.removeItem(ACHIEVEMENTS_KEY);
    }
  }

  private saveProgress(): void {
    try {
      localStorage.setItem(TILES_KEY, JSON.stringify(Array.from(this.visitedTiles())));
      localStorage.setItem(PATH_KEY, JSON.stringify(this.exploredPath()));
      localStorage.setItem(DISTANCE_KEY, this.totalDistance().toString());
      localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(Array.from(this.unlockedAchievements())));
    } catch (e) {
      console.error('Error saving progress to localStorage', e);
    }
  }
}