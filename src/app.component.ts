import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { SplashComponent } from './components/splash/splash.component';
import { OnboardingComponent, hasSeenOnboarding } from './components/onboarding/onboarding.component';
import { AuthService } from './services/auth.service';
import { LocationService } from './services/location.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, BottomNavComponent, SplashComponent, OnboardingComponent],
})
export class AppComponent {
  private authService = inject(AuthService);
  private locationService = inject(LocationService);

  isLoggedIn = this.authService.isLoggedIn;

  splashHiding = signal(false);
  splashDone = signal(false);
  showOnboarding = signal(false);

  constructor() {
    // Show splash for at least 1.5s so the animation plays once,
    // but wait for auth if it takes longer.
    // If logged in — also start GPS and wait for first fix before hiding,
    // so the map opens already centered on the user's location.
    const minDelay = new Promise<void>(r => setTimeout(r, 1500));
    Promise.all([this.authService.waitForAuth(), minDelay]).then(async () => {
      if (this.authService.isLoggedIn()) {
        this.locationService.startWatching();
        await this.locationService.waitForFirstFix(10_000);
      }
      this.splashHiding.set(true);
      setTimeout(() => {
        this.splashDone.set(true);
        if (this.authService.isLoggedIn() && !hasSeenOnboarding()) {
          this.showOnboarding.set(true);
        }
      }, 500);
    });
  }
}
