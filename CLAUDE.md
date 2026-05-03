# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Walker** — Angular 17+ standalone app wrapped in Capacitor for Android. Tracks GPS walks and reveals a fog-of-war map as you explore. Features Firebase auth (email + native Google Sign-In on Android), Firestore progress sync, Leaflet map with canvas fog layer, and Gemini AI route planning.

## Node.js Version

**Requires Node 22.12.0.** The Angular CLI will refuse to run on anything older.

```bash
nvm use 22.12.0   # run this first in every new terminal session
```

`nvm-windows` ignores `.nvmrc`, so there's no auto-switch — always set manually before building.

## Commands

```bash
# Dev server
npm start             # http://localhost:4200

# Build (IMPORTANT: never use --base-href / in Git Bash — it resolves to C:/Program Files/Git/)
npm run build         # Production build → dist/walker/

# Sync to Android after build
npx cap sync android  # Copies dist/ into android/app/src/main/assets/public/

# Then rebuild APK in Android Studio (Build → Rebuild Project)
```

There are no automated tests in this project.

## Critical Build Rule

**Always use `npm run build`, never `ng build` directly.** The global `ng` may be a different version and will fail with `availableParallelism is not a function`. Also never use `--base-href /` — in Git Bash it expands to `C:/Program Files/Git/`, breaking Capacitor asset loading.

## Architecture

### Entry Point
`index.tsx` bootstraps the app (not `main.ts`, which was removed). `index.html` loads Tailwind, Inter font, and Leaflet via CDN. Firebase, Angular, and RxJS are loaded via importmap from ESM CDN — there's no bundled build of these libraries.

### Angular Patterns
- All components are standalone (no NgModules)
- `ChangeDetectionStrategy.OnPush` everywhere
- `provideZonelessChangeDetection()` — no Zone.js in the app providers
- Angular signals (`signal()`, `computed()`, `effect()`) for reactive state — **no RxJS in components**
- New control flow syntax (`@if`, `@for`) not `*ngIf`/`*ngFor`
- Lazy-loaded routes via `loadComponent`

### Services
| Service | Responsibility |
|---|---|
| `AuthService` | Firebase auth, Google Sign-In (native/web), 5s timeout on init |
| `LocationService` | `watchPosition()` GPS tracking, accuracy filtering (50m threshold) |
| `ProgressService` | Tile discovery, Firestore sync (debounced 2s), localStorage fallback |
| `AchievementService` | Computed achievements from progress thresholds |
| `GeminiService` | Gemini 2.5 Flash route suggestions and image descriptions |

### Fog of War (DashboardComponent)
- Extends `L.GridLayer` — Leaflet renders individual canvas tiles, fog is drawn as semi-transparent overlays cleared where tiles have been visited
- `updateWhenZooming: false` reduces zoom flicker (some flicker is accepted as a known limitation)
- Row index optimization: caches visited tile rows for faster lookup during canvas draw
- Tile size: `0.0005` degrees lat (`TILE_SIZE_DEGREES_LAT` in `ProgressService`), lng size adjusted for Mercator projection

### Native Android (Capacitor)
- Platform detection: `Capacitor.isNativePlatform()` gates native-only code paths
- Google Sign-In: `@capacitor-firebase/authentication` gets ID token → passed to Firebase Web SDK via `signInWithCredential`
- Auth state timeout: `Promise.race([authStateResolved, 5s timeout])` prevents hang on Android cold start

### Config & Keys
- `src/env.ts` — Firebase config + Gemini API key (not environment files, not git-ignored)
- `capacitor.config.ts` — `webDir: 'dist/walker'`, app ID `com.walker.app`

## Logging

When adding diagnostic logging, follow the checklist in [`docs/logging-checklist.md`](docs/logging-checklist.md) — do the full pass in one go before committing.
