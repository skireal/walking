import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { parseFirebaseError } from '../../utils/firebase-errors';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink]
})
export class LoginComponent {
  private authService = inject(AuthService);
  // FIX: Explicitly provide the generic type to `inject` to fix a type inference issue where the router was being inferred as `unknown`.
  private router = inject<Router>(Router);

  email = signal('');
  password = signal('');
  error = signal<string | null>(null);
  isLoading = signal(false);

  async loginWithGoogle(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      await this.authService.loginWithGoogle();
      this.router.navigate(['/dashboard']);
    } catch (e: unknown) {
      this.error.set(parseFirebaseError(e));
    } finally {
      this.isLoading.set(false);
    }
  }

  async login(): Promise<void> {
    if (!this.email().trim() || !this.password()) {
      this.error.set('Please enter both email and password.');
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);
    try {
      await this.authService.login(this.email(), this.password());
      this.router.navigate(['/dashboard']);
    } catch (e: unknown) {
      this.error.set(parseFirebaseError(e));
    } finally {
      this.isLoading.set(false);
    }
  }
}
