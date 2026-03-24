import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { SplashComponent } from './components/splash/splash.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, BottomNavComponent, SplashComponent],
})
export class AppComponent {
  private authService = inject(AuthService);

  isLoggedIn = this.authService.isLoggedIn;

  /** false = splash visible; true = splash fading out */
  splashHiding = signal(false);
  /** removed from DOM after fade-out completes */
  splashDone = signal(false);

  constructor() {
    // Show splash for at least 1.5s so the animation plays once,
    // but wait for auth if it takes longer
    const minDelay = new Promise<void>(r => setTimeout(r, 1500));
    Promise.all([this.authService.waitForAuth(), minDelay]).then(() => {
      this.splashHiding.set(true);
      // Remove from DOM after CSS fade-out transition (500ms)
      setTimeout(() => this.splashDone.set(true), 500);
    });
  }
}
