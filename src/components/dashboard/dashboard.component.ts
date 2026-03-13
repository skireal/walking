import { Component, ChangeDetectionStrategy, signal, computed, inject, AfterViewInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocationService } from '../../services/location.service';
import { ProgressService } from '../../services/progress.service';
import { AuthService } from '../../services/auth.service';

// Leaflet is loaded globally via CDN
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
  
  private map: any;
  private isMapInitialized = signal(false);
  private userMarker: any;
  
  private fogGridLayer: any;
  private readonly TILE_SIZE_DEGREES_LAT = this.progressService.TILE_SIZE_DEGREES_LAT;

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
        // Rerun when visitedTiles changes
        this.progressService.visitedTiles(); 
        if (this.isMapInitialized()) {
            this.updateFogGrid();
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

    this.fogGridLayer = L.layerGroup().addTo(this.map);
    this.map.on('moveend', () => this.updateFogGrid());

    this.locationService.startWatching();
    this.isMapInitialized.set(true);

    this.updateFogGrid();
  }

  private updateFogGrid(): void {
    if (!this.map) return;

    try {
      if (this.map.getZoom() < 16) {
        this.fogGridLayer.clearLayers();
        return;
      }

      this.fogGridLayer.clearLayers();
      const bounds = this.map.getBounds();
      const visitedTiles = this.progressService.visitedTiles();

      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();

      const startY = Math.floor(southWest.lat / this.TILE_SIZE_DEGREES_LAT) - 1;
      const endY = Math.floor(northEast.lat / this.TILE_SIZE_DEGREES_LAT) + 1;

      for (let y = startY; y <= endY; y++) {
          const rowLat = (y + 0.5) * this.TILE_SIZE_DEGREES_LAT;
          const tileSizeLng = this.progressService.getTileLngSizeAtLat(rowLat);

          const startX = Math.floor(southWest.lng / tileSizeLng) - 1;
          const endX = Math.floor(northEast.lng / tileSizeLng) + 1;

          for (let x = startX; x <= endX; x++) {
              const tileId = `${x},${y}`;

              if (!visitedTiles.has(tileId)) {
                  const tileBounds = [
                      [y * this.TILE_SIZE_DEGREES_LAT, x * tileSizeLng],
                      [(y + 1) * this.TILE_SIZE_DEGREES_LAT, (x + 1) * tileSizeLng]
                  ];

                  L.rectangle(tileBounds, {
                      color: '#374151',
                      weight: 0.5,
                      fillColor: '#111827',
                      fillOpacity: 0.7,
                      interactive: false,
                  }).addTo(this.fogGridLayer);
              }
          }
      }
    } catch (e) {
      console.error('Error updating fog grid:', e);
    }
  }
  
  recenterMap(): void {
    const pos = this.locationService.position();
    if(pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }
}