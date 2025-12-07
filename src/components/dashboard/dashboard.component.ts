
import { Component, ChangeDetectionStrategy, signal, computed, inject, AfterViewInit, OnDestroy, effect, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LocationService } from '../../services/location.service';
import { ProgressService } from '../../services/progress.service';
import { GeminiService } from '../../services/gemini.service';
import { LogService } from '../../services/log.service';

// Declare Leaflet to avoid TypeScript errors, as it's loaded from a CDN.
declare var L: any;

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule]
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  private locationService = inject(LocationService);
  private progressService = inject(ProgressService);
  private geminiService = inject(GeminiService);
  private logService = inject(LogService);
  private cdr = inject(ChangeDetectorRef);

  // Stats
  distance = computed(() => parseFloat((this.progressService.totalDistance() / 1000).toFixed(2)));
  discoveredTiles = this.progressService.discoveredTilesCount;
  locationStatus = this.locationService.status;
  
  greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  });

  // Map
  private map: any;
  private isMapInitialized = signal(false);
  private userMarker: any;
  private pathPolyline: any;
  
  // Fog of War
  private fogGridLayer: any;
  private readonly TILE_SIZE_DEGREES_LAT = 0.0005;
  
  // Log Entry Modal State
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  capturedImage = signal<string | null>(null);
  aiDescription = signal<string | null>(null);
  isGeneratingDescription = signal(false);
  userNotes = signal('');
  logError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const pos = this.locationService.position();
      if (pos && this.isMapInitialized()) {
        this.progressService.updatePosition(pos);
        const newPoint: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        if (this.userMarker) {
          this.userMarker.setLatLng(newPoint);
        } else {
           this.map.setView(newPoint, 17);
           this.userMarker = L.marker(newPoint).addTo(this.map).bindPopup('You are here!');
        }
      }
    });

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
    
    effect(() => {
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
    this.map = L.map('map', { zoomControl: false }).setView([40.7128, -74.0060], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);
    this.fogGridLayer = L.layerGroup().addTo(this.map);
    this.map.on('moveend', () => this.updateFogGrid());
    this.locationService.startWatching();
    this.isMapInitialized.set(true);
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
    if (!this.map || this.map.getZoom() < 15) {
      this.fogGridLayer.clearLayers();
      return;
    }

    const bounds = this.map.getBounds();
    const visitedTiles = this.progressService.visitedTiles();
    
    this.fogGridLayer.clearLayers();

    const latRad = this.map.getCenter().lat * Math.PI / 180;
    const tileSizeLng = this.TILE_SIZE_DEGREES_LAT / Math.cos(latRad);

    for (let lat = bounds.getSouth(); lat < bounds.getNorth() + this.TILE_SIZE_DEGREES_LAT; lat += this.TILE_SIZE_DEGREES_LAT) {
      for (let lng = bounds.getWest(); lng < bounds.getEast() + tileSizeLng; lng += tileSizeLng) {
        const tileId = this.getTileIdForLatLng(lat, lng);
        if (!visitedTiles.has(tileId)) {
          const tileBounds = [[lat, lng], [lat + this.TILE_SIZE_DEGREES_LAT, lng + tileSizeLng]];
          L.rectangle(tileBounds, {
            color: '#111827',
            weight: 0,
            fillOpacity: 0.6,
            interactive: false
          }).addTo(this.fogGridLayer);
        }
      }
    }
  }

  recenterMap(): void {
    const pos = this.locationService.position();
    if (pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    }
  }

  // --- Log Entry Methods ---

  openCamera(): void {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = async (e: any) => {
      const base64String = e.target.result.split(',')[1];
      this.capturedImage.set(e.target.result);
      this.isGeneratingDescription.set(true);
      this.logError.set(null);
      this.aiDescription.set(null);
      this.cdr.detectChanges();

      try {
        const description = await this.geminiService.generateImageDescription(base64String);
        this.aiDescription.set(description);
      } catch (error) {
        console.error(error);
        this.logError.set('Could not generate a description. Please try again.');
      } finally {
        this.isGeneratingDescription.set(false);
        this.cdr.detectChanges();
      }
    };
    reader.readAsDataURL(file);
  }

  saveLogEntry(): void {
    const image = this.capturedImage();
    const description = this.aiDescription();
    const position = this.locationService.position();

    if (!image || !description || !position) {
      this.logError.set('Missing data to save the log entry.');
      return;
    }
    
    this.logService.addLogEntry({
      imageDataUrl: image,
      aiDescription: description,
      userNotes: this.userNotes(),
      location: {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      }
    });

    this.resetLogModal();
  }
  
  cancelLogEntry(): void {
    this.resetLogModal();
  }

  private resetLogModal(): void {
    this.capturedImage.set(null);
    this.aiDescription.set(null);
    this.isGeneratingDescription.set(false);
    this.userNotes.set('');
    this.logError.set(null);
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }
}
