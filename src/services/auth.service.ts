import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  type Auth,
  onAuthStateChanged,
  type User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

import { firebaseConfig } from '../env';

interface FirebaseAppConfig {
  apiKey: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  [key: string]: string | undefined;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private app: FirebaseApp | undefined;
  private auth: Auth | undefined;
  private authUnsubscribe: (() => void) | null = null;
  private destroyRef = inject(DestroyRef);

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

    this.destroyRef.onDestroy(() => {
      if (this.authUnsubscribe) {
        this.authUnsubscribe();
        this.authUnsubscribe = null;
      }
    });
  }

  private initializeFirebase(): void {
    try {
      if (!firebaseConfig || !firebaseConfig.apiKey) {
        console.warn('Firebase config not found. App running in offline mode.');
        this.resolveAuthState();
        return;
      }

      if (getApps().length === 0) {
        this.app = initializeApp(firebaseConfig as FirebaseAppConfig);
      } else {
        this.app = getApp();
      }

      this.auth = getAuth(this.app);

      this.setupAuthStateObserver();
      this.isFirebaseReadySignal.set(true);
    } catch (error) {
      console.error('Firebase initialization error:', error);
      this.isFirebaseReadySignal.set(false);
      this.resolveAuthState();
    }
  }

  private async setupAuthStateObserver(): Promise<void> {
    if (!this.auth) {
      this.resolveAuthState();
      return;
    }

    try {
      await setPersistence(this.auth, browserLocalPersistence);
    } catch (error) {
      console.warn('Failed to set auth persistence:', error);
    }

    this.authUnsubscribe = onAuthStateChanged(this.auth, (user) => {
      this.currentUser.set(user);
      this.authStateChanged.set({ user, isLoggedIn: !!user });
      this.resolveAuthState();
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

  async loginWithGoogle(): Promise<User> {
    if (!this.auth) throw new Error('Auth service not initialized.');

    if (Capacitor.isNativePlatform()) {
      // Native: get Google ID token via plugin, then sign into Firebase web SDK
      const result = await FirebaseAuthentication.signInWithGoogle();
      if (!result.credential?.idToken) {
        throw new Error('Google sign-in failed: no ID token returned.');
      }
      const credential = GoogleAuthProvider.credential(result.credential.idToken);
      const userCredential = await signInWithCredential(this.auth, credential);
      return userCredential.user;
    } else {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(this.auth, provider);
      return result.user;
    }
  }

  async logout(): Promise<void> {
    if (!this.auth) throw new Error('Auth service not initialized.');
    if (Capacitor.isNativePlatform()) {
      await FirebaseAuthentication.signOut();
    }
    await signOut(this.auth);
  }

  public isFirebaseReady(): boolean {
    return this.isFirebaseReadySignal();
  }

  public waitForAuth(): Promise<void> {
    // 5s timeout so the app never hangs on a dark screen if auth stalls
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    return Promise.race([this.authStateResolved, timeout]);
  }
}
