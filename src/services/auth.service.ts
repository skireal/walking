import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
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
  private app: FirebaseApp | undefined;
  private auth: Auth | undefined;

  public currentUser = signal<User | null>(null);
  public isLoggedIn = computed(() => !!this.currentUser());

  public authStateChanged = signal<{ user: User | null; isLoggedIn: boolean }>({
    user: null,
    isLoggedIn: false,
  });

  private isFirebaseReadySignal = signal(false);

  private resolveAuthState!: () => void;
  private readonly authStateResolved: Promise<void>;

  constructor() {
    this.authStateResolved = new Promise<void>((resolve) => {
      this.resolveAuthState = resolve;
    });
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    try {
      if (!firebaseConfig || !firebaseConfig.apiKey) {
        console.warn('Firebase config not found (env vars missing). App running in offline mode.');
        this.resolveAuthState(); // Resolve auth state if Firebase is not configured
        return;
      }

      if (getApps().length === 0) {
        this.app = initializeApp(firebaseConfig as any);
      } else {
        this.app = getApp();
      }

      this.auth = getAuth(this.app);

      this.setupAuthStateObserver();
      this.isFirebaseReadySignal.set(true);
    } catch (error) {
      console.error('Firebase initialization error:', error);
      this.isFirebaseReadySignal.set(false);
      this.resolveAuthState(); // Resolve auth state on initialization error
    }
  }

  private async setupAuthStateObserver(): Promise<void> {
    if (!this.auth) {
      this.resolveAuthState(); // Resolve auth state if auth service is not available
      return;
    }

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
      this.resolveAuthState(); // This resolves the promise on the first auth state check
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

  public waitForAuth(): Promise<void> {
    return this.authStateResolved;
  }
}
