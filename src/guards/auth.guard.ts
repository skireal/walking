import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait until the initial authentication state is resolved
  await authService.waitForAuth();

  if (authService.isLoggedIn()) {
    return true;
  } else {
    // Redirect to the login page if not authenticated
    return router.createUrlTree(['/login']);
  }
};
