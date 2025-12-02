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
  calories = signal(0);

  // Map-related properties
  private map: any;
  private userMarker: any;
  private pathPolyline: any;
  private exploredPath: [number, number][] = [];
  private fogLayer: any;

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
           this.map.setView(newPoint, 16); // Zoom in on first location fix
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

        // "Clear" the fog of war
        L.circle(newPoint, {
          radius: 30, // meters
          color: 'rgba(45, 212, 191, 0.1)',
          fillColor: 'rgba(45, 212, 191, 0.2)',
          fillOpacity: 1,
          weight: 0,
        }).addTo(this.fogLayer);

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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    this.fogLayer = L.layerGroup().addTo(this.map);
  }

  private updateStats(): void {
    // Mock calculation for demo purposes
    const newDistance = (this.pathPolyline ? this.pathPolyline.getLatLngs().length * 0.015 : 0).toFixed(2);
    this.distance.set(parseFloat(newDistance));
    this.calories.set(Math.floor(this.distance() * 50));
  }

  recenterMap(): void {
    const pos = this.locationService.position();
    if(pos) {
      this.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
    }
  }
}