import { Component, ChangeDetectionStrategy, signal, computed, inject, AfterViewInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocationService } from '../../services/location.service';
import { ProgressService } from '../../services/progress.service';
import { AuthService } from '../../services/auth.service';

declare var L: any;

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  private locationService = inject(LocationService);
  private progressService = inject(ProgressService);
  private authService = inject(AuthService);

  discoveredTiles = this.progressService.discoveredTilesCount;
  dailyDistance = this.progressService.dailyDistance;
  dailyTiles = this.progressService.dailyTilesCount;

  private map: any;
  private isMapInitialized = signal(false);
  private userMarker: any;
  private fogLayer: any;
  private pathLine: any;
  private shouldRecenterOnNextPosition = false;

  locationStatus = this.locationService.status;

  userName = computed(() => {
    const email = this.authService.currentUser()?.email;
    if (!email) return '';
    const namePart = email.split('@')[0];
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  });

  greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  });

  constructor() {
    effect(() => {
      const pos = this.locationService.position();
      if (pos && this.isMapInitialized()) {
        const newPoint: [number, number] = [pos.coords.latitude, pos.coords.longitude];

        if (this.userMarker) {
          this.userMarker.setLatLng(newPoint);
          if (this.shouldRecenterOnNextPosition) {
            this.shouldRecenterOnNextPosition = false;
            this.map.setView(newPoint, 17);
          }
        } else {
          this.map.setView(newPoint, 17);
          this.userMarker = L.marker(newPoint).addTo(this.map);
        }

        if (this.locationService.hasGoodAccuracy()) {
          this.progressService.updatePosition(pos);
          this.pathLine?.addLatLng([pos.coords.latitude, pos.coords.longitude]);
        } else {
          // Log accuracy drop visible to dashboard effect (live positions only).
          this.progressService.logEvent('DASH_SKIP_ACC', pos.coords.accuracy.toFixed(0));
        }
      } else if (pos && !this.isMapInitialized()) {
        // Position arrived before map was ready — dropped silently otherwise.
        this.progressService.logEvent('DASH_SKIP_MAP');
      }
    });

    effect(() => {
      this.progressService.visitedTiles();
      if (this.isMapInitialized()) {
        this.fogLayer?.redraw();
      }
    });
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // Recenter immediately with the last known position (handles the case where
      // the user hasn't moved and the buffer is empty — no new position will arrive).
      this.recenterMap();
      // Also set a flag so the effect recenters again on the first fresh position
      // update from the buffer flush (if the user walked while backgrounded).
      this.shouldRecenterOnNextPosition = true;
    }
  };

  ngAfterViewInit(): void {
    this.initMap();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    this.locationService.stopWatching();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private initMap(): void {
    // If GPS already fired during splash, start centered on the user.
    // Otherwise fall back to London as a placeholder until first fix arrives.
    const existingPos = this.locationService.position();
    const initialCenter: [number, number] = existingPos
      ? [existingPos.coords.latitude, existingPos.coords.longitude]
      : [51.5074, -0.1278];
    const initialZoom = existingPos ? 17 : 13;

    this.map = L.map('map', {
      zoomControl: false,
      minZoom: 3,
    }).setView(initialCenter, initialZoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(this.map);

    this.fogLayer = this.createFogLayer();
    this.fogLayer.addTo(this.map);

    // Path line — shows walked route; gaps reveal where tracking broke off.
    this.pathLine = L.polyline([], {
      color: '#f97316',  // orange-500 — stands out against the teal fog
      weight: 3,
      opacity: 0.85,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(this.map);

    // GPS may already be watching (started from AppComponent during splash).
    // Only call startWatching() if it hasn't been started yet.
    if (!this.locationService.isWatching()) {
      this.locationService.startWatching();
    }
    this.isMapInitialized.set(true);
  }

  private createFogLayer(): any {
    const ps = this.progressService;
    let rowIndex = new Map<number, number[]>();

    function rebuildIndex(visited: Set<string>): void {
      const idx = new Map<number, number[]>();
      for (const id of visited) {
        const comma = id.indexOf(',');
        const wx = parseInt(id.slice(0, comma));
        const wy = parseInt(id.slice(comma + 1));
        if (!idx.has(wy)) idx.set(wy, []);
        idx.get(wy)!.push(wx);
      }
      rowIndex = idx;
    }

    rebuildIndex(ps.visitedTiles());

    const TILE_LAT = ps.TILE_SIZE_DEGREES_LAT;

    const FogLayer = (L.GridLayer as any).extend({
      redraw() {
        rebuildIndex(ps.visitedTiles());
        return (L.GridLayer as any).prototype.redraw.call(this);
      },

      createTile(coords: { x: number; y: number; z: number }): HTMLCanvasElement {
        const SIZE = 256;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;

        const tileToLng = (tx: number, z: number) => (tx / 2 ** z) * 360 - 180;
        const tileToLat = (ty: number, z: number) => {
          const n = Math.PI - (2 * Math.PI * ty) / 2 ** z;
          return (180 / Math.PI) * Math.atan(Math.sinh(n));
        };
        const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

        const west  = tileToLng(coords.x,     coords.z);
        const east  = tileToLng(coords.x + 1, coords.z);
        const north = tileToLat(coords.y,     coords.z);
        const south = tileToLat(coords.y + 1, coords.z);

        const mNorth = mercY(north);
        const mRange = mercY(south) - mNorth;
        const lngRange = east - west;

        const lngToPx = (lng: number) => ((lng - west) / lngRange) * SIZE;
        const latToPy = (lat: number) => ((mercY(lat) - mNorth) / mRange) * SIZE;

        ctx.fillStyle = 'rgba(17,24,39,0.75)';
        ctx.fillRect(0, 0, SIZE, SIZE);

        ctx.globalCompositeOperation = 'destination-out';

        const startWY = Math.floor(south / TILE_LAT) - 1;
        const endWY   = Math.ceil(north  / TILE_LAT) + 1;

        for (let wy = startWY; wy <= endWY; wy++) {
          const wxList = rowIndex.get(wy);
          if (!wxList) continue;

          const rowLat = (wy + 0.5) * TILE_LAT;
          const tLng   = ps.getTileLngSizeAtLat(rowLat);
          const startWX = Math.floor(west / tLng) - 1;
          const endWX   = Math.ceil(east  / tLng) + 1;

          for (const wx of wxList) {
            if (wx < startWX || wx > endWX) continue;

            const px1 = Math.floor(lngToPx(wx       * tLng));
            const px2 = Math.ceil( lngToPx((wx + 1) * tLng));
            const py1 = Math.floor(latToPy((wy + 1) * TILE_LAT));
            const py2 = Math.ceil( latToPy(wy       * TILE_LAT));

            ctx.fillRect(px1, py1, Math.max(px2 - px1, 1), Math.max(py2 - py1, 1));
          }
        }

        return canvas;
      },
    });

    return new FogLayer({ zIndex: 400, opacity: 1, updateWhenZooming: false, keepBuffer: 2 });
  }

  recenterMap(): void {
    const pos = this.locationService.position();
    if (pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }
}
