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

## Logging Checklist

When adding or reviewing `logEvent` / diagnostic logging, go through **all** of the following in one pass before committing. Do not commit logging work until every box is mentally checked.

### 1. Every error path is in the session log
- Every `catch (err)` block → `logEvent('SOMETHING_FAIL', String(err))`
- Every `if (error)` callback → `logEvent`
- Every `.catch(...)` on a Promise → `logEvent` (not just `console.error`)
- Search the files for `console.error` and `console.warn` — each one is a candidate

### 2. Every lifecycle transition is logged
Draw the full state machine first, then verify each edge:
- Service init / start / stop
- App foreground → background → foreground (both directions)
- Cold start vs resume (distinguish them explicitly)
- Permission granted / denied

### 3. Every branching decision that affects data is logged
For each `if/else` that decides whether to count distance, skip a position, or skip a flush:
- Log which branch was taken
- Log the reason (value that caused the branch, e.g. gap in seconds, accuracy in metres)
- Log both FROM and TO state where relevant (e.g. coordinates for a skipped jump)

### 4. Key numeric results are in the session log (not just console)
- Distance added per flush (`distAdded=Xm`)
- Positions counted vs skipped per flush
- Timestamps that control skip logic (e.g. `lastLiveTimestamp` at load and at flush)

### 5. No log is noisy
- A log that fires on every position update during normal walking is useless noise
- Use throttling (time-based) or flags (`pendingXxx = true/false`) to ensure diagnostic
  tags fire at meaningful transitions, not on every tick
- After writing a new `logEvent`, ask: "how often will this fire during a 1-hour walk?"
  If the answer is "hundreds of times", it needs throttling or a different trigger

### 6. Errors in the logging infrastructure itself
- What if the buffer plugin isn't running? → `BUF_START_FAIL`
- What if the resume listener fails to register? → `RESUME_LISTENER_FAIL`
- What if the flush itself throws? → `BUF_FLUSH_ERROR`
- What if the GPS watcher fails to start? → `BG_WATCHER_FAIL`

### Current logEvent tags (reference)
| Tag | Where | Meaning |
|-----|-------|---------|
| `TRACKING_START native\|web` | `startWatching` | Tracking session begins |
| `TRACKING_STOP` | `stopWatching` | Tracking session ends |
| `LIVE_TS_LOAD` | `startNativeWatching` | Persisted lastLiveTimestamp loaded |
| `LIVE_TS_ADV` | `markLiveTimestamp` | Timestamp advanced (throttled 1/min) |
| `BUF_START_FAIL` | `startNativeWatching` | LocationBuffer.startBuffering() failed |
| `BG_WATCHER_FAIL` | `startNativeWatching` | BackgroundGeolocation.addWatcher() failed |
| `RESUME_LISTENER_FAIL` | `startNativeWatching` | App.addListener('resume') failed |
| `GPS_DENIED` | BG callback | Location permission revoked |
| `GPS_ERROR` | BG callback | Other GPS error |
| `VISIBILITY_HIDDEN` | `onVisibilityChange` | App went to background |
| `VISIBILITY_VISIBLE` | `onVisibilityChange` | App returned to foreground |
| `COLD_START_FLUSH` | `flushLocationBuffer` | Buffer flushed on cold start |
| `APP_RESUME` | `flushLocationBuffer` | Buffer flushed on Capacitor resume |
| `BUF_FLUSH_TS` | `flushLocationBuffer` | live/first/last timestamps at flush time |
| `BUF_ALL_SKIPPED_WARN` | `flushLocationBuffer` | liveThreshold ≥ last buffer ts → all skipped |
| `BUF_FLUSH_DONE` | `flushLocationBuffer` | Flush summary with distAdded |
| `BUF_FLUSH_ERROR` | `flushLocationBuffer` | Flush threw an exception |
| `DASH_SKIP_MAP` | dashboard effect | Position arrived before map init |
| `DASH_SKIP_BG_JUMP` | dashboard effect | BG recovery, good accuracy — jump skipped |
| `DASH_SKIP_BG_ACC` | dashboard effect | BG recovery, low accuracy |
| `DASH_SKIP_ACC` | dashboard effect | Low accuracy in foreground |
| `DASH_LIVE_RESUME` | dashboard effect | First counted position after BG recovery |
