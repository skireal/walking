import { Component, ChangeDetectionStrategy, signal, computed, inject, AfterViewInit, OnDestroy, effect, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocationService } from '../../services/location.service';
import { ProgressService } from '../../services/progress.service';

// Declare Leaflet to avoid TypeScript errors, as it's loaded from a CDN.
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
  private cdr = inject(ChangeDetectorRef);

  // Read stats directly from the progress service
  distance = computed(() => parseFloat((this.progressService.totalDistance() / 1000).toFixed(2)));
  discoveredTiles = this.progressService.discoveredTilesCount;
  
  // Map-related properties
  private map: any;
  private isMapInitialized = signal(false);
  private userMarker: any;
  private pathPolyline: any;
  
  // Fog of War properties
  private fogGridLayer: any;
  private readonly TILE_SIZE_DEGREES_LAT = 0.0005;

  // Location status
  locationStatus = this.locationService.status;
  
  greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  });

  constructor() {
    // Effect for user's real-time location tracking
    effect(() => {
      const pos = this.locationService.position();
      if (pos && this.isMapInitialized()) {
        // Send position to the central service to handle all logic
        this.progressService.updatePosition(pos);

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const newPoint: [number, number] = [lat, lng];
        
        // Update map view and marker
        if (this.userMarker) {
          this.userMarker.setLatLng(newPoint);
        } else {
           this.map.setView(newPoint, 17); // Zoom in on first location fix
           this.userMarker = L.marker(newPoint).addTo(this.map)
             .bindPopup('You are here!')
             .openPopup();
        }
      }
    });

    // Effect to update the visual path on the map
    effect(() => {
        const exploredPath = this.progressService.exploredPath();
        if (this.isMapInitialized()) {
            if (this.pathPolyline) {
                this.pathPolyline.setLatLngs(exploredPath);
            } else if (exploredPath.length > 0) {
                this.pathPolyline = L.polyline(exploredPath, { color: '#2dd4bf', weight: 5 }).addTo(this.map);
            }
            this.cdr.detectChanges();
        }
    });
    
    // Effect to update the fog grid when tiles change or map moves
    effect(() => {
        // Triggered by visitedTiles changing or map movement (via map.on('moveend'))
        this.progressService.visitedTiles(); // establish dependency
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
    }).setView([40.7128, -74.0060], 13); // Default to NYC

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    this.fogGridLayer = L.layerGroup().addTo(this.map);
    
    // Update the fog grid whenever the map is panned or zoomed
    this.map.on('moveend', () => this.updateFogGrid());

    this.locationService.startWatching();
    
    this.isMapInitialized.set(true);

    // Initial draw of path and fog
    const exploredPath = this.progressService.exploredPath();
    if (exploredPath.length > 0) {
        this.pathPolyline = L.polyline(exploredPath, { color: '#2dd4bf', weight: 5 }).addTo(this.map);
    }
    this.updateFogGrid();
  }
  
  private getTileIdForLatLng(lat: number, lng: number): string {
    const latRad = lat * Math.PI / 180;
    const tileSizeLng = this.TILE_SIZE_DEGREES_LAT / Math.cos(latRad);
    
    const tileX = Math.floor(lng / tileSizeLng);
    const tileY = Math.floor(lat / this.TILE_SIZE_DEGREES_LAT);
    return `${tileX},${tileY}`;
  }

  private updateFogGrid(): void {
    if (!this.map) return;
    
    if (this.map.getZoom() < 15) {
      this.fogGridLayer.clearLayers();
      return;
    }

    this.fogGridLayer.clearLayers();
    const bounds = this.map.getBounds();
    const center = this.map.getCenter();
    const visitedTiles = this.progressService.visitedTiles();

    const centerLatRad = center.lat * Math.PI / 180;
    const tileSizeLng = this.TILE_SIZE_DEGREES_LAT / Math.cos(centerLatRad);

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();

    const startX = Math.floor(southWest.lng / tileSizeLng) - 1;
    const endX = Math.floor(northEast.lng / tileSizeLng) + 1;
    const startY = Math.floor(southWest.lat / this.TILE_SIZE_DEGREES_LAT) - 1;
    const endY = Math.floor(northEast.lat / this.TILE_SIZE_DEGREES_LAT) + 1;
    
    for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
            const representativeLat = (y + 0.5) * this.TILE_SIZE_DEGREES_LAT;
            const tileId = this.getTileIdForLatLng(representativeLat, (x + 0.5) * tileSizeLng);

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
  }
  
  recenterMap(): void {
    const pos = this.locationService.position();
    if(pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }
}
