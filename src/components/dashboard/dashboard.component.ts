import { Component, ChangeDetectionStrategy, signal, computed, inject, AfterViewInit, OnDestroy, effect, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocationService } from '../../services/location.service';

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
  private cdr = inject(ChangeDetectorRef);

  // Stats signals
  distance = signal(0); // in km
  discoveredTiles = signal(0);

  // Map-related properties
  private map: any;
  private userMarker: any;
  private pathPolyline: any;
  private exploredPath: [number, number][] = [];
  
  // Fog of War properties
  private fogGridLayer: any;
  private visitedTiles = new Set<string>();
  // Define tile size in degrees for latitude. This is an approximation but works well for local city scales.
  // 0.0005 degrees is roughly 55 meters.
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
    effect(() => {
      const pos = this.locationService.position();
      if (pos && this.map) {
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

        // Update explored path
        this.exploredPath.push(newPoint);
        if (this.pathPolyline) {
          this.pathPolyline.addLatLng(newPoint);
        } else {
          this.pathPolyline = L.polyline(this.exploredPath, { color: '#2dd4bf', weight: 5 }).addTo(this.map);
        }

        // Check if the user has entered a new tile
        const currentTileId = this.getTileIdForLatLng(lat, lng);
        if (!this.visitedTiles.has(currentTileId)) {
          this.visitedTiles.add(currentTileId);
          this.discoveredTiles.set(this.visitedTiles.size);
          // A new tile has been discovered, update the fog
          this.updateFogGrid();
        }

        this.updateStats();
        this.cdr.detectChanges();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.locationService.startWatching();
  }

  ngOnDestroy(): void {
    this.locationService.stopWatching();
  }

  private initMap(): void {
    this.map = L.map('map', {
      zoomControl: false,
    }).setView([40.7128, -74.0060], 13); // Default to NYC

    // Using a lighter, more standard map theme for better contrast with the fog
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    this.fogGridLayer = L.layerGroup().addTo(this.map);

    // Update the fog grid whenever the map is panned or zoomed
    this.map.on('moveend', () => this.updateFogGrid());
  }
  
  private getTileIdForLatLng(lat: number, lng: number): string {
    // To make the grid consistent, we calculate the longitude tile size based on the user's current latitude.
    const latRad = lat * Math.PI / 180;
    const tileSizeLng = this.TILE_SIZE_DEGREES_LAT / Math.cos(latRad);
    
    const tileX = Math.floor(lng / tileSizeLng);
    const tileY = Math.floor(lat / this.TILE_SIZE_DEGREES_LAT);
    return `${tileX},${tileY}`;
  }

  private updateFogGrid(): void {
    if (!this.map) return;

    this.fogGridLayer.clearLayers();
    const bounds = this.map.getBounds();
    const center = this.map.getCenter();

    // Calculate longitude tile size based on the map's center latitude to keep the grid visually consistent across the viewport.
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
            // We need to generate the ID using a representative latitude for this row of tiles to be accurate.
            const representativeLat = (y + 0.5) * this.TILE_SIZE_DEGREES_LAT;
            const tileId = this.getTileIdForLatLng(representativeLat, (x + 0.5) * tileSizeLng);

            if (!this.visitedTiles.has(tileId)) {
                const tileBounds = [
                    [y * this.TILE_SIZE_DEGREES_LAT, x * tileSizeLng],
                    [(y + 1) * this.TILE_SIZE_DEGREES_LAT, (x + 1) * tileSizeLng]
                ];

                L.rectangle(tileBounds, {
                    color: '#374151',      // gray-700 for subtle grid lines
                    weight: 0.5,
                    fillColor: '#111827',  // gray-900 for dark fog
                    fillOpacity: 0.7,
                    interactive: false,     // Make sure fog doesn't capture clicks
                }).addTo(this.fogGridLayer);
            }
        }
    }
  }


  private updateStats(): void {
    // Mock calculation for demo purposes
    const newDistance = (this.pathPolyline ? this.pathPolyline.getLatLngs().length * 0.015 : 0).toFixed(2);
    this.distance.set(parseFloat(newDistance));
  }

  recenterMap(): void {
    const pos = this.locationService.position();
    if(pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }
}