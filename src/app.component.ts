import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { SplashComponent } from './components/splash/splash.component';
import { OnboardingComponent, hasSeenOnboarding } from './components/onboarding/onboarding.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, BottomNavComponent, SplashComponent, OnboardingComponent],
})
export class AppComponent {
  private authService = inject(AuthService);

  isLoggedIn = this.authService.isLoggedIn;

  splashHiding = signal(false);
  splashDone = signal(false);
  showOnboarding = signal(false);

  constructor() {
    // Show splash for at least 1.5s so the animation plays once,
    // but wait for auth if it takes longer
    const minDelay = new Promise<void>(r => setTimeout(r, 1500));
    Promise.all([this.authService.waitForAuth(), minDelay]).then(() => {
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
