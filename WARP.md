# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

### Install and run locally
- Install dependencies: `npm install`
- Start dev server (opens browser): `npm run dev`
- Alternative dev server (no auto-open): `npm start`

The dev server runs the Angular CLI `ng serve` for the single application defined in `angular.json` (`walker`), serving the SPA front-end only (no backend).

### Build
- Development/standard build: `npm run build`
- Production build (with production configuration): `npm run build:prod`

Build output is written to `dist/walker` as configured in `angular.json`.

### Testing and linting
There are currently no test or lint scripts defined in `package.json`, and there are no `*.spec.ts` files in the repo. If you need tests, you will have to add Angular testing configuration and scripts first.

### Environment configuration
The app expects a Gemini API key configured for local development:
- Set `GEMINI_API_KEY` in `.env.local` as documented in `README.md`.

The Gemini client code in `src/services/gemini.service.ts` currently looks for `process.env.API_KEY`, so keep that in mind if behavior does not match the README’s `GEMINI_API_KEY` convention.

## High-level architecture

### Overall structure
This is a client-only Angular application (Angular 21, standalone components) named `walker`.
Key configuration files:
- `angular.json` – single project `walker`, `sourceRoot` is `src`, build output under `dist/walker`, entry HTML `src/index.html`, main TS entry `src/main.ts` (referenced but not present in the repo).
- `tsconfig.json` / `tsconfig.app.json` – strict TypeScript & Angular compiler options.
- `package.json` – Angular CLI and dev tooling, runtime dependencies including `@google/genai`, `firebase`, `tailwindcss`, and RxJS.

The runtime app is entirely front-end:
- Uses browser geolocation (`navigator.geolocation`) for location tracking.
- Uses Leaflet (loaded from a CDN, referenced via global `L`) for mapping and distance calculations.
- Persists progress and achievements in `localStorage`.
- Integrates Gemini via the `@google/genai` client in a dedicated service.

### Routing and shell
- `src/app.component.ts` – Root application shell.
  - Standalone component using `RouterOutlet` and the `BottomNavComponent`.
  - Uses `ChangeDetectionStrategy.OnPush`.
- `src/app.routes.ts` – Central route configuration as a `Routes` array:
  - `/dashboard` → lazy-loaded `DashboardComponent`.
  - `/feed` → lazy-loaded `FeedComponent`.
  - `/planner` → lazy-loaded `AiRoutePlannerComponent`.
  - `/profile` → lazy-loaded `ProfileComponent`.
  - Empty path redirects to `/dashboard`; wildcard routes also redirect to `/dashboard`.

### Navigation / layout
- `src/components/bottom-nav/bottom-nav.component.ts`
  - Standalone bottom navigation bar using `RouterLink` / `RouterLinkActive`.
  - Encodes the primary navigation model as `navItems` pointing to `/dashboard`, `/feed`, `/planner`, `/profile`.
  - If you add new top-level pages, you will typically update both `app.routes.ts` and this nav component.

### Core feature areas

#### 1. Map dashboard and “fog of war” exploration
- `src/components/dashboard/dashboard.component.ts`
  - Central view for the live map and exploration stats.
  - Injects `LocationService` and `ProgressService` and uses Angular signals/effects heavily.
  - Maintains Leaflet objects (`map`, `userMarker`, `pathPolyline`, `fogGridLayer`) as class fields.
  - Uses several `effect` calls to:
    - Watch live positions from `LocationService` and update the map, marker, and path.
    - Draw or update the polyline representing the explored path.
    - Recompute and draw the fog grid whenever visited tiles or map movement changes.
  - Implements `updateFogGrid()` which:
    - Reads visited tiles from `ProgressService`.
    - Computes a tile grid over the current viewport.
    - Draws semi-opaque rectangles over tiles that have not yet been visited, implementing the fog-of-war effect.
  - Uses `recenterMap()` to center the map on the current user position, if available.

This component is the main consumer of the map-related state from `ProgressService` and connects the browser’s geolocation updates to the Leaflet map rendering.

#### 2. Progress and persistence
- `src/services/progress.service.ts`
  - Injectable singleton (`providedIn: 'root'`) that owns all long-lived progress state:
    - `totalDistance` (meters walked, as a signal).
    - `visitedTiles` (set of tile IDs, as a signal of `Set<string>`).
    - `exploredPath` (array of `[lat, lng]` coordinate tuples forming a polyline).
    - `unlockedAchievements` (set of achievement IDs).
    - `discoveredTilesCount` (derived count of visited tiles).
  - Uses internal constants for localStorage keys and a tile size in degrees latitude.
  - `updatePosition(pos: GeolocationPosition)` is the primary mutation entrypoint:
    - Appends the new point to `exploredPath`.
    - Uses Leaflet’s `L.latLng(...).distanceTo(...)` to increment `totalDistance` based on the last point.
    - Computes the current tile ID and updates `visitedTiles` when entering a new tile.
  - `unlockAchievement(id: string)` adds to `unlockedAchievements` using a new `Set` instance for signal updates.
  - `loadProgress()` / `saveProgress()` handle serialization to/from localStorage using `JSON.stringify` with `Array.from` on `Set`s.

This service is the source of truth for exploration metrics and is shared between `DashboardComponent` and `AchievementService`/`ProfileComponent`. Any new features that depend on distance, visited area, or achievements should go through this service rather than duplicating state.

#### 3. Location tracking
- `src/services/location.service.ts`
  - Wraps `navigator.geolocation.watchPosition` / `clearWatch`.
  - Exposes two signals:
    - `position: signal<GeolocationPosition | null>`.
    - `status: signal<'idle' | 'tracking' | 'denied' | 'error'>`.
  - `startWatching()` sets up a watch with high accuracy and reasonable timeouts and updates `position` and `status` based on callbacks.
  - `stopWatching()` clears the watch and resets status.

This isolates browser API usage and error handling from UI components. Consumers typically read `position()` and `status()` reactively.

#### 4. Achievements system
- `src/services/achievement.service.ts`
  - Depends on `ProgressService` and defines the achievements catalog.
  - `allAchievements` is a signal of definitions that each include a `condition(progress: ProgressService)` predicate.
  - `achievements` is a computed signal combining definitions with unlock status from `ProgressService.unlockedAchievements()`.
  - An `effect` runs whenever progress or achievements change, checking each condition and calling `progressService.unlockAchievement(id)` when newly satisfied.

This service encapsulates all achievement logic; consumers (e.g. the profile screen) should read from the `achievements` signal rather than directly touching unlock sets.

#### 5. Profile and social UI
- `src/components/profile/profile.component.ts`
  - Injects `ProgressService` and `AchievementService`.
  - Derives high-level stats (tiles explored, total distance) from `ProgressService`.
  - Exposes `achievements` directly from `AchievementService` for display.

- `src/components/feed/feed.component.ts`
  - Simple local signal-based feed of hard-coded `FeedItem` objects — currently mock data.
  - Suitable starting point if you later integrate a real backend or Firestore (note that `firebase` is listed as a dependency but not yet used in the checked-in code).

#### 6. AI route planning
- `src/components/ai-route-planner/ai-route-planner.component.ts`
  - Standalone component that provides the Gemini-powered walking route planner UI.
  - Uses signals for user input (`location`, `duration`), view state (`viewState`), and results (`suggestion`, `error`, `loadingMessage`).
  - `generateRoute()` validates input, sets loading state, and calls `GeminiService.getRouteSuggestion(...)`.
  - Handles success by storing the typed `RouteSuggestion` and switching the view state to `success`; handles errors by capturing the message and setting view state to `error`.

- `src/services/gemini.service.ts`
  - Injectable singleton that encapsulates all interaction with the Gemini API via `@google/genai`.
  - Lazily constructs a `GoogleGenAI` client in the constructor if `process.env.API_KEY` is present; otherwise logs an error and leaves the client unset.
  - `getRouteSuggestion(location: string, duration: number)`:
    - Asserts that the client is initialized, otherwise throws.
    - Builds a natural-language prompt describing the requested walking route.
    - Defines a structured `responseSchema` (using `Type.OBJECT`, `Type.ARRAY`, etc.) to request a JSON response matching the `RouteSuggestion` interface.
    - Calls `this.genAI.models.generateContent` with system instructions and schema, reads `response.text`, and `JSON.parse`s it to `RouteSuggestion`.

Any additional AI features should ideally be added as new methods on `GeminiService` (with their own schemas) and consumed from components, staying consistent with this pattern.

## Notes for future changes
- Leaflet usage relies on a global `L` symbol (loaded via `<script>` from a CDN, not via ES module import). When refactoring or introducing SSR/build-time tooling, ensure that `L` remains available where `DashboardComponent` and `ProgressService` expect it.
- The map tile grid and tile IDs are computed in both `DashboardComponent` and `ProgressService`. If you change tile sizing or ID logic, update both places consistently to avoid mismatched fog-of-war vs. stored progress.
- Progress and achievement data are persisted in `localStorage` under versioned keys (`*_v2`). If you introduce breaking schema changes, consider bumping these keys and providing migration/cleanup logic.
- There is currently no backend integration; all state (except AI suggestions) lives in the browser. Introducing a backend or Firebase would primarily affect the feed, achievements, and progress persistence, and should be designed to coexist or replace the localStorage-based model.