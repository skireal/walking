import { Injectable, signal, effect, computed } from '@angular/core';

const TILES_KEY = 'strut_visitedTiles_v2';
const PATH_KEY = 'strut_exploredPath_v2';
const DISTANCE_KEY = 'strut_totalDistance_v2';
const ACHIEVEMENTS_KEY = 'strut_unlockedAchievements_v2';

/**
 * Calculates the distance between two points on Earth using the Haversine formula.
 * @returns The distance in meters.
 */
function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in metres
  const φ1 = (lat1 * Math.PI) / 180; // φ, λ in radians
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}


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
  discoveredTilesCount = computed(() => this.visitedTiles().size);
  
  // Tile size constants
  public readonly TILE_SIZE_DEGREES_LAT = 0.0005;

  constructor() {
    this.loadProgress();

    // Effect to save progress whenever it changes
    effect(() => {
      this.saveProgress();
    });
  }

  updatePosition(pos: GeolocationPosition): void {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newPoint: [number, number] = [lat, lng];
    
    // Update path and distance
    this.exploredPath.update(path => {
        if (path.length > 0) {
            const lastPoint = path[path.length - 1];
            const distanceIncrement = getDistanceInMeters(
                lastPoint[0], 
                lastPoint[1], 
                newPoint[0], 
                newPoint[1]
            );
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

  public getTileIdForLatLng(lat: number, lng: number): string {
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