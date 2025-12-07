
import { Routes } from '@angular/router';

export const APP_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'log',
    loadComponent: () => import('./components/log/log.component').then(m => m.LogComponent)
  },
  {
    path: 'planner',
    loadComponent: () => import('./components/ai-route-planner/ai-route-planner.component').then(m => m.AiRoutePlannerComponent)
  },
  {
    path: 'profile',
    loadComponent: () => import('./components/profile/profile.component').then(m => m.ProfileComponent)
  },
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];