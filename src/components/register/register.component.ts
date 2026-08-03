import { Component, ChangeDetectionStrategy, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { parseFirebaseError } from '../../utils/firebase-errors';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink]
})
export class RegisterComponent {
  private authService = inject(AuthService);
  // FIX: Explicitly provide the generic type to `inject` to fix a type inference issue where the router was being inferred as `unknown`.
  private router = inject<Router>(Router);

  email = signal('');
  password = signal('');
  confirmPassword = signal('');
  error = signal<string | null>(null);
  isLoading = signal(false);

  constructor() {
    // Same "way back" as LoginComponent: if the auth guard's timeout sent an
    // already-authenticated user here, bounce to the dashboard once auth resolves.
    effect(() => {
      if (this.authService.isLoggedIn()) {
        this.router.navigate(['/dashboard']);
      }
    });
  }

  async register(): Promise<void> {
    // Client-side checks before hitting Firebase (Angular's FormsModule disables
    // native HTML validation, so the template's required/minlength don't run).
    const email = this.email().trim();
    if (!email) {
      this.error.set('Please enter your email address.');
      return;
    }
    if (this.password().length < 6) {
      this.error.set('Password must be at least 6 characters.');
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.error.set('Passwords do not match.');
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Trimmed email — see LoginComponent.login for why.
      await this.authService.register(email, this.password());
      this.router.navigate(['/dashboard']);
    } catch (e: any) {
      this.error.set(parseFirebaseError(e));
    } finally {
      this.isLoading.set(false);
    }
  }
}