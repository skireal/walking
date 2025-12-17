import { Injectable, signal, computed, inject, effect } from '@angular/core';
// Fix: Use namespace import for firebase/app to work around potential module resolution issues.
import * as firebaseApp from 'firebase/app';
import {
  getAuth,
  type Auth,
  onAuthStateChanged,
  type User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';

import { firebaseConfig } from '../env';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private app: firebaseApp.FirebaseApp | undefined;
  private auth: Auth | undefined;

  public currentUser = signal<User | null>(null);
  public isLoggedIn = computed(() => !!this.currentUser());

  public authStateChanged = signal<{ user: User | null; isLoggedIn: boolean }>({
    user: null,
    isLoggedIn: false,
  });

  private isFirebaseReadySignal = signal(false);

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    try {
      if (!firebaseConfig || !firebaseConfig.apiKey) {
        console.warn('Firebase config not found (env vars missing). App running in offline mode.');
        return;
      }

      if (firebaseApp.getApps().length === 0) {
        this.app = firebaseApp.initializeApp(firebaseConfig as any);
      } else {
        this.app = firebaseApp.getApp();
      }

      this.auth = getAuth(this.app);

      this.setupAuthStateObserver();
      this.isFirebaseReadySignal.set(true);
    } catch (error) {
      console.error('Firebase initialization error:', error);
      this.isFirebaseReadySignal.set(false);
    }
  }

  private async setupAuthStateObserver(): Promise<void> {
    if (!this.auth) return;

    try {
      await setPersistence(this.auth, browserLocalPersistence);
    } catch (error) {
      console.error('Failed to set auth persistence:', error);
    }

    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this.currentUser.set(user);
      } else {
        this.currentUser.set(null);
      }

      this.authStateChanged.set({ user, isLoggedIn: !!user });
    });
  }

  async register(email: string, password: string): Promise<User> {
    if (!this.auth) throw new Error('Auth service not initialized.');
    const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
    return userCredential.user;
  }

  async login(email: string, password: string): Promise<User> {
    if (!this.auth) throw new Error('Auth service not initialized.');
    const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
    return userCredential.user;
  }

  async logout(): Promise<void> {
    if (!this.auth) throw new Error('Auth service not initialized.');
    await signOut(this.auth);
  }

  public isFirebaseReady(): boolean {
    return this.isFirebaseReadySignal();
  }
}
