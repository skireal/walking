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

  // Zoom performance tracking
  private zoomStartTime = 0;
  private zoomStartLevel = 0;
  private zoomTileCount = 0;
  private zoomTileMs = 0;
  private zoomLogged = false; // prevent double-log from Leaflet's two zoomstart/zoomend pairs

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
      minZoom: 3,
    }).setView([51.5074, -0.1278], 13); // Default to London

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    this.map.on('zoomstart', () => {
      if (!this.zoomLogged) {
        this.zoomStartTime = performance.now();
        this.zoomStartLevel = this.map.getZoom();
        this.zoomTileCount = 0;
        this.zoomTileMs = 0;
        this.zoomLogged = true;
        console.log(`🔍 [Zoom] start z=${this.zoomStartLevel} visited=${this.progressService.visitedTiles().size}`);
      }
    });

    this.map.on('zoomend', () => {
      if (this.zoomLogged) {
        this.zoomLogged = false;
        const animMs = Math.round(performance.now() - this.zoomStartTime);
        const newZ = this.map.getZoom();
        console.log(`🔍 [Zoom] end z=${this.zoomStartLevel}→${newZ} | total=${animMs}ms tiles=${this.zoomTileCount} render=${Math.round(this.zoomTileMs)}ms avg=${this.zoomTileCount ? Math.round(this.zoomTileMs / this.zoomTileCount) : 0}ms/tile`);
      }
    });

    this.fogLayer = this.createFogLayer().addTo(this.map);

    this.locationService.startWatching();
    this.isMapInitialized.set(true);
  }

  private createFogLayer(): any {
    const ps = this.progressService;
    const self = this;

    // Row index: wy → wx[] rebuilt once per redraw for O(visited) rendering
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

    // Single persistent canvas — never removed, just redrawn after each
    // zoom/pan. Eliminates the tile-replacement flicker of GridLayer.
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:400';

    const FogLayer = (L.Layer as any).extend({
      onAdd(map: any) {
        map.getPanes().overlayPane.appendChild(canvas);
        map.on('moveend zoomend viewreset resize', this._draw, this);
        this._draw();
      },

      onRemove(map: any) {
        map.getPanes().overlayPane.removeChild(canvas);
        map.off('moveend zoomend viewreset resize', this._draw, this);
      },

      redraw() {
        rebuildIndex(ps.visitedTiles());
        this._draw();
        return this;
      },

      _draw() {
        const map = self.map;
        if (!map) return;

        const t0 = performance.now();
        const size = map.getSize();
        canvas.width  = size.x;
        canvas.height = size.y;

        // Align canvas with the overlay pane's current transform origin
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(canvas, topLeft);

        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(17,24,39,0.75)';
        ctx.fillRect(0, 0, size.x, size.y);

        ctx.globalCompositeOperation = 'destination-out';

        const TLAT = ps.TILE_SIZE_DEGREES_LAT;
        const bounds = map.getBounds();
        const south = bounds.getSouth();
        const north = bounds.getNorth();
        const west  = bounds.getWest();
        const east  = bounds.getEast();

        const startWY = Math.floor(south / TLAT) - 1;
        const endWY   = Math.ceil(north / TLAT)  + 1;

        let tilesDrawn = 0;
        for (let wy = startWY; wy <= endWY; wy++) {
          const wxList = rowIndex.get(wy);
          if (!wxList) continue;

          const rowLat = (wy + 0.5) * TLAT;
          const tLng   = ps.getTileLngSizeAtLat(rowLat);
          const startWX = Math.floor(west  / tLng) - 1;
          const endWX   = Math.ceil(east   / tLng) + 1;

          for (const wx of wxList) {
            if (wx < startWX || wx > endWX) continue;

            const sw = map.latLngToContainerPoint(L.latLng(wy * TLAT,       wx * tLng));
            const ne = map.latLngToContainerPoint(L.latLng((wy + 1) * TLAT, (wx + 1) * tLng));

            const x = Math.min(sw.x, ne.x);
            const y = Math.min(sw.y, ne.y);
            const w = Math.max(Math.abs(ne.x - sw.x), 1);
            const h = Math.max(Math.abs(ne.y - sw.y), 1);

            ctx.fillRect(x, y, w, h);
            tilesDrawn++;
          }
        }

        const drawMs = Math.round(performance.now() - t0);
        self.zoomTileCount = tilesDrawn;
        self.zoomTileMs    = drawMs;
      },
    });

    return new FogLayer();
  }
  
  recenterMap(): void {
    const pos = this.locationService.position();
    if(pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }
}