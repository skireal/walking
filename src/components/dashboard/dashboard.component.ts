import { Component, ChangeDetectionStrategy, signal, computed, inject, AfterViewInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocationService } from '../../services/location.service';
import { ProgressService } from '../../services/progress.service';
import { AuthService } from '../../services/auth.service';
import { LogService } from '../../services/log.service';
import { LogViewerComponent } from '../log-viewer/log-viewer.component';

// Leaflet is loaded globally via CDN
declare var L: any;

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LogViewerComponent]
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  private locationService = inject(LocationService);
  private progressService = inject(ProgressService);
  private authService = inject(AuthService);
  readonly logService = inject(LogService); // инициализирует перехват console сразу

  discoveredTiles = this.progressService.discoveredTilesCount;
  
  private map: any;
  private isMapInitialized = signal(false);
  private userMarker: any;

  private fogLayer: any;
  private fogOverlay: HTMLDivElement | null = null;

  // Zoom performance tracking
  private zoomStartTime = 0;
  private zoomStartLevel = 0;
  private zoomTileCount = 0;
  private zoomTileMs = 0;

  locationStatus = this.locationService.status;
  locationUpdateCount = signal(0);
  lastUpdateTime = signal<string>('—');
  lastAccuracy = signal<number | null>(null);
  
  userName = computed(() => {
    const email = this.authService.currentUser()?.email;
    if (!email) return '';
    // Extract name part from email (before @)
    const namePart = email.split('@')[0];
    // Capitalize first letter
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
      if (pos) {
        this.locationUpdateCount.update(n => n + 1);
        const d = new Date(pos.timestamp);
        this.lastUpdateTime.set(`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`);
        this.lastAccuracy.set(Math.round(pos.coords.accuracy));
      }
      if (pos && this.isMapInitialized()) {
        const newPoint: [number, number] = [pos.coords.latitude, pos.coords.longitude];
    
        // Always update the map marker for immediate user feedback
        if (this.userMarker) {
          this.userMarker.setLatLng(newPoint);
        } else {
          this.map.setView(newPoint, 17);
          this.userMarker = L.marker(newPoint).addTo(this.map)
        }
        
        // Only update progress and path if the location accuracy is good
        if (this.locationService.hasGoodAccuracy()) {
          this.progressService.updatePosition(pos);
        }
      }
    });
    
    effect(() => {
        const tiles = this.progressService.visitedTiles();
        console.log(`🗺️ [Dashboard] visitedTiles changed → ${tiles.size} tiles, map ready: ${this.isMapInitialized()}`);
        if (this.isMapInitialized()) {
            this.fogLayer?.redraw();
        }
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.locationService.stopWatching();
  }

  private initMap(): void {
    this.map = L.map('map', {
      zoomControl: false,
    }).setView([51.5074, -0.1278], 13); // Default to London

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Fog overlay: covers map during zoom tile replacement to prevent flicker
    this.fogOverlay = document.createElement('div');
    this.fogOverlay.style.cssText = [
      'position:absolute', 'inset:0', 'z-index:401',
      'background:rgba(17,24,39,0.75)', 'pointer-events:none',
      'opacity:0', 'transition:opacity 0.1s'
    ].join(';');
    document.getElementById('map')!.appendChild(this.fogOverlay);

    this.map.on('zoomstart', () => {
      this.zoomStartTime = performance.now();
      this.zoomStartLevel = this.map.getZoom();
      this.zoomTileCount = 0;
      this.zoomTileMs = 0;
      this.fogOverlay!.style.opacity = '1';
      console.log(`🔍 [Zoom] start z=${this.zoomStartLevel} tiles=${this.progressService.visitedTiles().size}`);
    });

    this.map.on('zoomend', () => {
      const animMs = Math.round(performance.now() - this.zoomStartTime);
      const newZ = this.map.getZoom();
      // Hide overlay after tiles are painted (one rAF is enough since createTile is sync)
      requestAnimationFrame(() => {
        this.fogOverlay!.style.opacity = '0';
        console.log(`🔍 [Zoom] end z=${this.zoomStartLevel}→${newZ} | anim=${animMs}ms tiles_rendered=${this.zoomTileCount} render_total=${this.zoomTileMs}ms avg=${this.zoomTileCount ? Math.round(this.zoomTileMs / this.zoomTileCount) : 0}ms/tile`);
      });
    });

    this.fogLayer = this.createFogLayer().addTo(this.map);

    this.locationService.startWatching();
    this.isMapInitialized.set(true);
  }

  private createFogLayer(): any {
    const ps = this.progressService;
    const self = this; // for access to zoomTileCount/zoomTileMs inside FogLayer

    // Row index: wy → wx[] — rebuilt once per redraw, used by all createTile calls.
    // Avoids iterating millions of empty positions at low zoom levels.
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

    const FogLayer = (L.GridLayer as any).extend({
      redraw() {
        rebuildIndex(ps.visitedTiles());
        return (L.GridLayer as any).prototype.redraw.call(this);
      },

      createTile(coords: { x: number; y: number; z: number }): HTMLCanvasElement {
        const t0 = performance.now();
        const SIZE = 256;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;

        // Tile coords → geographic bounds (Web Mercator)
        const tileToLng = (tx: number, z: number) => (tx / 2 ** z) * 360 - 180;
        const tileToLat = (ty: number, z: number) => {
          const n = Math.PI - (2 * Math.PI * ty) / 2 ** z;
          return (180 / Math.PI) * Math.atan(Math.sinh(n));
        };
        const mercY = (lat: number) =>
          Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

        const west  = tileToLng(coords.x,     coords.z);
        const east  = tileToLng(coords.x + 1, coords.z);
        const north = tileToLat(coords.y,     coords.z);
        const south = tileToLat(coords.y + 1, coords.z);

        const mNorth = mercY(north);
        const mRange = mercY(south) - mNorth; // negative
        const lngRange = east - west;

        const lngToPx = (lng: number) => ((lng - west) / lngRange) * SIZE;
        const latToPy = (lat: number) => ((mercY(lat) - mNorth) / mRange) * SIZE;

        // Fill entire tile with fog
        ctx.fillStyle = 'rgba(17, 24, 39, 0.75)';
        ctx.fillRect(0, 0, SIZE, SIZE);

        // Punch holes for visited walker tiles using row index —
        // only iterates rows that actually contain visited tiles.
        ctx.globalCompositeOperation = 'destination-out';
        const TLAT = ps.TILE_SIZE_DEGREES_LAT;

        const startWY = Math.floor(south / TLAT) - 1;
        const endWY   = Math.ceil(north / TLAT)  + 1;

        for (let wy = startWY; wy <= endWY; wy++) {
          const wxList = rowIndex.get(wy);
          if (!wxList) continue; // no visited tiles in this row — skip

          const rowLat = (wy + 0.5) * TLAT;
          const tLng   = ps.getTileLngSizeAtLat(rowLat);
          const startWX = Math.floor(west / tLng) - 1;
          const endWX   = Math.ceil(east / tLng)  + 1;

          for (const wx of wxList) {
            if (wx < startWX || wx > endWX) continue;

            const px1 = Math.floor(lngToPx(wx * tLng));
            const px2 = Math.ceil(lngToPx((wx + 1) * tLng));
            const py1 = Math.floor(latToPy((wy + 1) * TLAT));
            const py2 = Math.ceil(latToPy(wy * TLAT));

            ctx.fillRect(px1, py1, Math.max(px2 - px1, 1), Math.max(py2 - py1, 1));
          }
        }

        // Accumulate tile render stats for zoom summary log
        const renderMs = performance.now() - t0;
        self.zoomTileCount++;
        self.zoomTileMs += renderMs;

        return canvas;
      },
    });

    return new FogLayer({ zIndex: 400, opacity: 1, updateWhenZooming: false });
  }
  
  recenterMap(): void {
    const pos = this.locationService.position();
    if(pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }
}