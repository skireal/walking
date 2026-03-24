import { Injectable, signal, computed, inject, effect, DestroyRef } from '@angular/core';
import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  type Auth,
  onAuthStateChanged,
  type User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';

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
        console.warn('Firebase config not found (env vars missing). App running in offline mode.');
        this.resolveAuthState(); // Resolve auth state if Firebase is not configured
        return;
      }

      if (getApps().length === 0) {
        this.app = initializeApp(firebaseConfig as FirebaseAppConfig);
      } else {
        this.app = getApp();
      }

      // initializeAuth с явным массивом persistence гарантирует правильное хранилище
      // ещё ДО первого обращения к Auth — IndexedDB надёжнее на Android WebView (Capacitor),
      // localStorage как fallback для браузера.
      this.auth = initializeAuth(this.app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      });

      this.setupAuthStateObserver();
      this.isFirebaseReadySignal.set(true);
    } catch (error) {
      console.error('Firebase initialization error:', error);
      this.isFirebaseReadySignal.set(false);
      this.resolveAuthState(); // Resolve auth state on initialization error
    }
  }

  private setupAuthStateObserver(): void {
    if (!this.auth) {
      this.resolveAuthState();
      return;
    }

    this.authUnsubscribe = onAuthStateChanged(this.auth, (user) => {
      this.currentUser.set(user);
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

  async loginWithGoogle(): Promise<User> {
    if (!this.auth) throw new Error('Auth service not initialized.');
    const provider = new GoogleAuthProvider();
    if (Capacitor.isNativePlatform()) {
      await signInWithRedirect(this.auth, provider);
      const result = await getRedirectResult(this.auth);
      if (!result) throw new Error('Google sign-in was cancelled.');
      return result.user;
    } else {
      const result = await signInWithPopup(this.auth, provider);
      return result.user;
    }
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
