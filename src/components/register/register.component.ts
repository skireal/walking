import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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

  async register(): Promise<void> {
    if (!this.email().trim() || !this.password()) {
      this.error.set('Please enter both email and password.');
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
      await this.authService.register(this.email(), this.password());
      this.router.navigate(['/dashboard']);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to register.');
    } finally {
      this.isLoading.set(false);
    }
  }
}