import { Injectable, signal, computed, inject, effect, untracked, DestroyRef } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AuthService } from './auth.service';
import { getFirestore, doc, setDoc, onSnapshot, Firestore, Unsubscribe } from 'firebase/firestore';

interface LeafletLatLng {
  distanceTo(other: LeafletLatLng): number;
}

interface LeafletStatic {
  latLng(coords: [number, number]): LeafletLatLng;
}

declare var L: LeafletStatic | undefined;

const STORAGE_KEY_PREFIX = 'walker_progress_data_v3_';
const MIN_DISTANCE_THRESHOLD_METERS = 15; // Filters GPS drift while stationary
const MAX_SPEED_MS = 5; // ~18 km/h — walking/running only
const DAILY_DISTANCE_SAVE_INTERVAL_METERS = 50; // Save distance every 50m even without new tiles

interface DailyProgress {
  date: string;        // "2026-04-22"
  tileIds: string[];
  distanceMeters: number;
}

interface ProgressData {
  visitedTiles: string[];
  unlockedAchievements: string[];
  dailyProgress?: DailyProgress;
}

function todayString(): string {
  // Local calendar date, NOT UTC. toISOString() would roll the day over at
  // 00:00 UTC — e.g. in BST that is 01:00 local, so a 00:30 walk would be
  // attributed to the previous day.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // "2026-04-22"
}

@Injectable({
  providedIn: 'root',
})
export class ProgressService {
  visitedTiles = signal<Set<string>>(new Set());
  unlockedAchievements = signal<Set<string>>(new Set());

  discoveredTilesCount = computed(() => this.visitedTiles().size);

  // Daily stats — reset at midnight, persisted to Firestore
  private dailyTileIds = signal<Set<string>>(new Set());
  private dailyDistanceMeters = signal(0);
  private lastSavedDistanceMeters = 0; // tracks when to trigger a save for distance-only updates
  // Local calendar date the daily counters above belong to. Checked on every
  // incoming position (rolloverIfNeeded) so the counters reset when the app is
  // alive across midnight — otherwise yesterday's distance/tiles linger in
  // memory and get re-saved under today's date, corrupting the cloud record.
  private dailyDate = todayString();

  dailyTilesCount = computed(() => this.dailyTileIds().size);

  /** Raw daily distance in metres — use for diagnostic snapshots in other services. */
  getDailyDistanceMeters(): number { return this.dailyDistanceMeters(); }

  dailyDistance = computed(() => {
    const m = this.dailyDistanceMeters();
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(2)} km`;
  });

  public readonly TILE_SIZE_DEGREES_LAT = 0.0005;

  // ── Debug position log ────────────────────────────────────────────────────
  // Captures every incoming position with the reason it was counted or skipped.
  // Persisted to localStorage AND reloaded on startup so it survives a full
  // app restart (e.g. a force-kill mid-walk) — the previous session's log is
  // appended to, never overwritten. Ring buffer trims oldest entries at the cap.
  // Header: ts_ms|lat|lng|gps_spd_ms|lp_lat|lp_lng|dist_m|dt_sec|eff_spd_ms|action|total_m
  private _posLog: string[] = [];
  private readonly POS_LOG_KEY = 'walker_pos_log';
  private readonly MAX_POS_LOG_ENTRIES = 20000;

  // Stationary SKIP_DIST collapsing: while the user stands still, positions
  // arrive every few seconds and each would emit an identical SKIP_DIST line.
  // Instead we count them and emit a single STATIONARY summary when movement
  // resumes (or every 60s so a long stop still persists and bounds staleness).
  private _skipDistCount = 0;
  private _skipDistFirstTs = 0;
  private _skipDistLastTs = 0;
  private _skipDistLat = 0;
  private _skipDistLng = 0;

  /** Load the persisted log on startup so appends continue instead of the first
   *  flush overwriting the previous walk. Called once from the constructor. */
  private _loadPosLog(): void {
    try {
      const saved = localStorage.getItem(this.POS_LOG_KEY);
      if (saved) {
        this._posLog = saved.split('\n').filter(l => l.length > 0);
        if (this._posLog.length > this.MAX_POS_LOG_ENTRIES) {
          this._posLog = this._posLog.slice(-this.MAX_POS_LOG_ENTRIES);
        }
      }
    } catch (e) {
      console.error('Error loading pos log from localStorage', e);
    }
  }

  /** Push a line and trim to the cap. Does NOT flush — callers decide when. */
  private _append(line: string): void {
    this._posLog.push(line);
    if (this._posLog.length > this.MAX_POS_LOG_ENTRIES) this._posLog.shift();
  }

  /** Emit the pending STATIONARY summary (if any) and reset the counters.
   *  Must be called before any non-SKIP_DIST entry so ordering is preserved. */
  private _flushStationary(): void {
    if (this._skipDistCount === 0) return;
    const durS = ((this._skipDistLastTs - this._skipDistFirstTs) / 1000).toFixed(0);
    this._append(
      `${this._skipDistLastTs}|${this._skipDistLat.toFixed(5)}|${this._skipDistLng.toFixed(5)}|null|null|null|null|null|null|STATIONARY|x${this._skipDistCount},${durS}s`
    );
    this._skipDistCount = 0;
    this._skipDistFirstTs = 0;
    this._skipDistLastTs = 0;
    this._flushPosLog();
  }

  // posTs = the position's own GPS-fix timestamp (pos.timestamp), NOT Date.now().
  // Buffered positions are all processed in one tight flush loop, so using the
  // processing time would collapse an hour of walking into the same instant and
  // make STATIONARY durations always read 0s. The fix time keeps the log
  // chronologically meaningful for both live and buffered positions.
  private logPos(
    action: string,
    posTs: number,
    lat: number, lng: number,
    gpsSpd: number | null,
    lastPos: GeolocationPosition | null,
    distM: number | null,
    dtSec: number | null,
    effSpd: number | null,
    totalM: number,
  ): void {
    // Collapse runs of SKIP_DIST (standing still) into one STATIONARY summary.
    if (action === 'SKIP_DIST') {
      if (this._skipDistCount === 0) this._skipDistFirstTs = posTs;
      this._skipDistCount++;
      this._skipDistLastTs = posTs;
      this._skipDistLat = lat;
      this._skipDistLng = lng;
      // Persist a rolling summary during long stops so it isn't lost on a kill.
      if (posTs - this._skipDistFirstTs >= 60_000) this._flushStationary();
      return;
    }
    this._flushStationary();
    const f = (v: number | null, d = 2) => v === null ? 'null' : v.toFixed(d);
    const lpLat = lastPos ? lastPos.coords.latitude.toFixed(5) : 'null';
    const lpLng = lastPos ? lastPos.coords.longitude.toFixed(5) : 'null';
    this._append(
      `${posTs}|${lat.toFixed(5)}|${lng.toFixed(5)}|${f(gpsSpd)}|${lpLat}|${lpLng}|${f(distM)}|${f(dtSec)}|${f(effSpd)}|${action}|${totalM.toFixed(0)}`
    );
    if (this._posLog.length % 5 === 0) this._flushPosLog();
  }

  private _flushPosLog(): void {
    try { localStorage.setItem(this.POS_LOG_KEY, this._posLog.join('\n')); } catch {}
  }

  // Generic event log entry (TRACKING_START, APP_RESUME, DASH_SKIP_*, etc.).
  // extra = any short string appended to last column.
  logEvent(tag: string, extra = ''): void {
    this._flushStationary();
    this._append(`${Date.now()}|null|null|null|null|null|null|null|null|${tag}|${extra}`);
    this._flushPosLog();
  }

  // Called by LocationService BEFORE the accuracy filter — records every raw GPS callback.
  // For RAW_* entries: last column = accuracy_m (not total_m).
  logRawPos(
    action: string, // 'RAW_LIVE_PASS' | 'RAW_LIVE_FAIL' | 'RAW_BUF_PASS' | 'RAW_BUF_FAIL'
    lat: number,
    lng: number,
    speed: number | null,
    accuracy: number,
    posTimestamp: number,
  ): void {
    this._flushStationary();
    const f = (v: number | null, d = 2) => v === null ? 'null' : v.toFixed(d);
    this._append(
      `${posTimestamp}|${lat.toFixed(5)}|${lng.toFixed(5)}|${f(speed)}|null|null|null|null|null|${action}|${accuracy.toFixed(0)}`
    );
    if (this._posLog.length % 5 === 0) this._flushPosLog();
  }

  /** True when there is anything to copy/clear — drives the profile buttons. */
  hasPosLog(): boolean {
    return this._posLog.length > 0 || this._skipDistCount > 0;
  }

  getPosLog(): string {
    this._flushStationary();
    this._flushPosLog();
    const platform = Capacitor.isNativePlatform() ? 'native' : 'web';
    const tzHours = -new Date().getTimezoneOffset() / 60;
    const tz = `${tzHours >= 0 ? '+' : ''}${tzHours}`;
    const meta =
      `# exported=${new Date().toISOString()} platform=${platform} tz=${tz} ` +
      `tiles=${this.visitedTiles().size} dailyTiles=${this.dailyTileIds().size} ` +
      `dailyDist=${Math.round(this.dailyDistanceMeters())}m entries=${this._posLog.length}`;
    // last column: total_m for COUNT/SKIP_* rows; accuracy_m for RAW_* rows
    return meta + '\n' +
      'ts_ms|lat|lng|gps_spd_ms|lp_lat|lp_lng|dist_m|dt_sec|eff_spd_ms|action|total_m_or_accuracy_m\n' +
      this._posLog.join('\n');
  }

  clearPosLog(): void {
    this._posLog = [];
    this._skipDistCount = 0;
    this._skipDistFirstTs = 0;
    this._skipDistLastTs = 0;
    try { localStorage.removeItem(this.POS_LOG_KEY); } catch {}
  }
  // ─────────────────────────────────────────────────────────────────────────

  // GPS warm-up: first few live positions after tracking starts can have
  // spurious high speed readings while the chip stabilises. Skip the speed
  // filter for this many positions, then enforce it normally.
  private warmupPositionsLeft = 0;
  startGpsWarmup(count = 5): void { this.warmupPositionsLeft = count; }


  private authService = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private db: Firestore | null = null;
  private progressUnsubscribe: Unsubscribe | null = null;
  private isSyncing = signal(false);
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPosition: GeolocationPosition | null = null;
  // Becomes true once the FIRST Firestore snapshot for the current user has been
  // received (even an empty one for a new user). Until then we must not write to
  // Firestore: setDoc with merge:true replaces the visitedTiles array wholesale,
  // so writing our local-only set before the cloud history has merged would wipe
  // it. Writes attempted while unseeded are deferred to localStorage and flushed
  // once the snapshot arrives and the sets have been unioned.
  private cloudSeeded = false;

  constructor() {
    // Reload the persisted pos-log first so this session appends to the previous
    // walk instead of overwriting it, then mark the app boot so cold-start
    // boundaries (force-kill → reopen within one walk) are visible in the log.
    this._loadPosLog();
    this.logEvent('SESSION_BOOT', `${Capacitor.isNativePlatform() ? 'native' : 'web'},tz=${-new Date().getTimezoneOffset() / 60}`);

    this.destroyRef.onDestroy(() => {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      if (this.progressUnsubscribe) {
        this.progressUnsubscribe();
        this.progressUnsubscribe = null;
      }
    });

    effect(() => {
      const user = this.authService.currentUser();
      const isFirebaseReady = this.authService.isFirebaseReady();

      if (!isFirebaseReady) return;

      if (this.db === null) {
        try {
          this.db = getFirestore();
        } catch (e) {
          console.error('Failed to initialize Firestore', e);
          return;
        }
      }

      if (this.progressUnsubscribe) {
        this.progressUnsubscribe();
        this.progressUnsubscribe = null;
      }

      if (user) {
        // Load localStorage first as crash-safe seed,
        // then Firestore snapshot will merge on top.
        // Wrapped in untracked() so signal reads inside resetProgress/loadFromLocalStorage
        // don't create tracking dependencies that would re-trigger this effect.
        // New subscription for this user — the cloud history has not merged yet,
        // so block Firestore writes until the first snapshot arrives.
        this.cloudSeeded = false;

        untracked(() => {
          this.resetProgress(false);
          this.loadFromLocalStorage();
        });

        const progressDocRef = doc(this.db, 'users', user.uid, 'progress', 'main');
        this.progressUnsubscribe = onSnapshot(
          progressDocRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data() as ProgressData;
              untracked(() => {
                this.visitedTiles.update(existing => {
                  const merged = new Set(existing);
                  (data.visitedTiles || []).forEach((t: string) => merged.add(t));
                  console.log(`☁️ [Progress] Firestore snapshot: ${data.visitedTiles?.length ?? 0} cloud tiles merged → total ${merged.size}`);
                  return merged;
                });
                this.unlockedAchievements.update(existing => {
                  const merged = new Set(existing);
                  (data.unlockedAchievements || []).forEach((a: string) => merged.add(a));
                  return merged;
                });
                // Restore daily progress if it's still today
                this.applyDailyProgress(data.dailyProgress);
              });
            }

            // First snapshot for this user (exists or not) — cloud history has now
            // merged into memory, so writes are safe. Reconcile once: if the local
            // set has tiles the cloud lacked (offline walk, or writes deferred
            // before seeding), push the unioned set back.
            if (!this.cloudSeeded) {
              this.cloudSeeded = true;
              if (untracked(() => this.visitedTiles().size) > 0) {
                console.log(`🌱 [Progress] cloud seeded — reconciling local ∪ cloud back to Firestore`);
                this.saveProgress();
              }
            }
          },
          (error) => {
            console.error('Error listening to progress document:', error);
          }
        );
      } else {
        untracked(() => {
          this.resetProgress(false);
          this.loadFromLocalStorage();
        });
      }
    });
  }

  /** Reset daily counters when the local calendar day changes while the app is
   *  running. Safe to call on every position — a no-op unless the date rolled
   *  over. Resetting lastPosition prevents distance being accrued across the
   *  midnight gap (a pre-midnight point → first post-midnight point jump). */
  private rolloverIfNeeded(): void {
    const today = todayString();
    if (this.dailyDate === today) return;
    console.log(`📅 [Progress] day rollover ${this.dailyDate} → ${today} — resetting daily stats`);
    this.logEvent('DAY_ROLLOVER', `${this.dailyDate}->${today}`);
    this.dailyDate = today;
    this.dailyTileIds.set(new Set());
    this.dailyDistanceMeters.set(0);
    this.lastSavedDistanceMeters = 0;
    this.lastPosition = null;
  }

  // countDailyStats=false is used for buffer positions from a previous day:
  // total tile discovery is still credited (you did walk there) but daily
  // distance and daily tile counts are NOT updated so yesterday's walk does
  // not appear in today's stats.
  updatePosition(pos: GeolocationPosition, trackDistance: boolean = true, countDailyStats: boolean = true): void {
    this.rolloverIfNeeded();
    const speed = pos.coords.speed;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newPoint: [number, number] = [lat, lng];

    // Displacement from the last tracked point — computed UP FRONT so the speed
    // gate below can distinguish a real vehicle (vehicle-scale displacement)
    // from a spurious GPS speed spike while walking (walking-scale displacement).
    // Stays null when there is no reference point yet or Leaflet is unavailable.
    let distanceChange: number | null = null;
    let timeDeltaSec: number | null = null;
    let effectiveSpeed: number | null = null;
    if (trackDistance && this.lastPosition && typeof L !== 'undefined') {
      try {
        const lastLatLng = L.latLng([this.lastPosition.coords.latitude, this.lastPosition.coords.longitude]);
        distanceChange = lastLatLng.distanceTo(L.latLng(newPoint));
        timeDeltaSec = (pos.timestamp - this.lastPosition.timestamp) / 1000;
        effectiveSpeed = timeDeltaSec > 0 ? distanceChange / timeDeltaSec : null;
      } catch (e) {
        console.error('🗺️ [Progress] displacement calc error:', e);
      }
    }

    // Vehicle speed gate. A high instantaneous GPS speed only rejects the
    // position — including tile discovery — when the actual displacement
    // confirms vehicle-scale movement. A lone spurious speed spike while
    // walking (GPS glitch under buildings/trees) has walking-scale
    // displacement, so the tile still opens instead of being silently dropped.
    // Decision is per-fix and stateless: no vehicle-mode latch, because a
    // latch driven by GPS speed spikes (which arrive in bursts) wrongly stuck
    // in vehicle mode on foot / while stationary and even across sessions.
    // When there is no displacement reference yet (effectiveSpeed === null),
    // fall back to trusting the raw GPS speed as before.
    const gpsFast = speed !== null && speed > MAX_SPEED_MS;
    if (gpsFast && this.warmupPositionsLeft === 0) {
      const effConfirmsVehicle = effectiveSpeed === null || effectiveSpeed > MAX_SPEED_MS;
      if (effConfirmsVehicle) {
        // Clearly vehicle movement — skip distance and tile discovery.
        // Advance lastPosition so when the device slows back to walking speed,
        // the effective-speed check below has a recent reference point.
        this.logPos('SKIP_GPS_SPD', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters());
        if (trackDistance) this.lastPosition = pos;
        return;
      }
      // GPS reported vehicle speed but displacement says we barely moved —
      // spurious spike. Let it through so the tile opens; distance accrual
      // below still applies MIN_DISTANCE and effective-speed filters.
      this.logPos('SPURIOUS_SPD', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters());
    } else if (gpsFast) {
      // GPS chip is still stabilising — spurious speed on cold start.
      // Let the position through and log it so we can verify in session log.
      this.logPos('WARMUP_SPD', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters());
    }
    // Consume one warmup slot for every position that passes the speed gate.
    if (this.warmupPositionsLeft > 0) this.warmupPositionsLeft--;

    // Tile discovery happens before any distance filtering — every position
    // must open whatever tile it lands in, regardless of how close it is to
    // the previous counted position. Skipping tile discovery on SKIP_DIST
    // caused gaps: positions inside the threshold radius were discarded
    // before reaching the tile check, leaving intermediate tiles unopened.
    const currentTileId = this.getTileIdForLatLng(lat, lng);
    if (!this.visitedTiles().has(currentTileId)) {
      this.visitedTiles.update(tiles => {
        const newTiles = new Set(tiles);
        newTiles.add(currentTileId);
        return newTiles;
      });
      if (countDailyStats) {
        this.dailyTileIds.update(tiles => {
          const newTiles = new Set(tiles);
          newTiles.add(currentTileId);
          return newTiles;
        });
        this.lastSavedDistanceMeters = this.dailyDistanceMeters();
      }
      console.log(`🟩 [Progress] new tile: ${currentTileId} (total: ${this.visitedTiles().size}, today: ${this.dailyTileIds().size})`);
      this.saveToLocalStorage();
      this.saveProgress();
    }

    // Distance accrual — reuses the displacement computed above.
    if (trackDistance && distanceChange !== null) {
      if (distanceChange < MIN_DISTANCE_THRESHOLD_METERS) {
        this.logPos('SKIP_DIST', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters());
        return;
      }

      // Effective speed check: catches vehicle movement where GPS speed is null
      // or lags (e.g. metro decelerating into a station, speed briefly < MAX_SPEED_MS
      // but the actual displacement from the last tracked point is vehicle-scale).
      // Distance-only: the tile at this landing point already opened above.
      if (effectiveSpeed !== null && effectiveSpeed > MAX_SPEED_MS) {
        this.logPos('SKIP_EFF_SPD', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters());
        console.log(`🚇 [Progress] effective speed ${effectiveSpeed.toFixed(1)} m/s — skipping`);
        this.lastPosition = pos;
        return;
      }

      if (countDailyStats) {
        this.logPos('COUNT', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters() + distanceChange);
        this.dailyDistanceMeters.update(d => d + distanceChange);

        // Save distance every 50m even if no new tiles were opened
        const current = this.dailyDistanceMeters();
        if (current - this.lastSavedDistanceMeters >= DAILY_DISTANCE_SAVE_INTERVAL_METERS) {
          this.lastSavedDistanceMeters = current;
          this.saveToLocalStorage();
          this.saveProgress();
        }
      } else {
        // Position from a previous day — distance computed for speed checking
        // and lastPosition advancement, but not added to today's daily total.
        this.logPos('COUNT_OLD', pos.timestamp, lat, lng, speed, this.lastPosition, distanceChange, timeDeltaSec, effectiveSpeed, this.dailyDistanceMeters());
      }
    } else if (trackDistance && !this.lastPosition) {
      console.log(`🗺️ [Progress] first position received, L available: ${typeof L !== 'undefined'}`);
    }

    if (trackDistance) {
      this.lastPosition = pos;
    }
  }

  unlockAchievement(achievementId: string): void {
    if (!this.unlockedAchievements().has(achievementId)) {
      this.unlockedAchievements.update((achievements) => {
        achievements.add(achievementId);
        return new Set(achievements);
      });
      this.saveProgress();
    }
  }

  public getTileLngSizeAtLat(lat: number): number {
    const latRad = (lat * Math.PI) / 180;
    if (Math.abs(lat) >= 85) {
      return this.TILE_SIZE_DEGREES_LAT / Math.cos((85 * Math.PI) / 180);
    }
    return this.TILE_SIZE_DEGREES_LAT / Math.cos(latRad);
  }

  public getTileIdForLatLng(lat: number, lng: number): string {
    const tileY = Math.floor(lat / this.TILE_SIZE_DEGREES_LAT);
    const representativeLat = (tileY + 0.5) * this.TILE_SIZE_DEGREES_LAT;
    const tileSizeLng = this.getTileLngSizeAtLat(representativeLat);
    const tileX = Math.floor(lng / tileSizeLng);
    return `${tileX},${tileY}`;
  }

  private applyDailyProgress(daily: DailyProgress | undefined): void {
    // Reset in-memory counters first if the day changed while the app was alive.
    // Guarantees any local data past this point genuinely belongs to today, so
    // the "keep local" branch below is safe.
    this.rolloverIfNeeded();
    if (daily?.date === todayString()) {
      // Merge tile IDs — local and cloud may each have tiles the other doesn't
      // (e.g. buffer-discovered tiles get overwritten by an older Firestore snapshot)
      this.dailyTileIds.update(existing => {
        const merged = new Set(existing);
        (daily.tileIds || []).forEach(id => merged.add(id));
        return merged;
      });
      // Take the higher distance value — distance only grows during the day,
      // so the larger number is always more accurate
      const incoming = daily.distanceMeters || 0;
      if (incoming > this.dailyDistanceMeters()) {
        this.dailyDistanceMeters.set(incoming);
        this.lastSavedDistanceMeters = incoming;
      }
      console.log(`📅 [Progress] daily merged: ${this.dailyTileIds().size} tiles, ${this.dailyDistanceMeters()}m`);
    } else if (daily?.date && daily.date !== todayString()) {
      // Firestore has a stale date (previous day or older).
      // Only reset if we haven't already accumulated today's data locally —
      // e.g. from a buffer flush after a force-kill where the 2s debounce
      // never fired and Firestore was never updated.  If local data exists,
      // keep it; the next saveProgress() call will push today's date to Firestore.
      if (this.dailyDistanceMeters() === 0 && this.dailyTileIds().size === 0) {
        this.dailyTileIds.set(new Set());
        this.dailyDistanceMeters.set(0);
        this.lastSavedDistanceMeters = 0;
        console.log(`📅 [Progress] new day detected, daily stats reset`);
      } else {
        console.log(`📅 [Progress] new day in Firestore but local today data exists — keeping local (dist=${this.dailyDistanceMeters()}m, tiles=${this.dailyTileIds().size})`);
      }
    }
  }

  /** Per-user localStorage key — prevents data leaking between accounts. */
  private storageKey(): string {
    const uid = this.authService.currentUser()?.uid ?? 'anonymous';
    return STORAGE_KEY_PREFIX + uid;
  }

  private loadFromLocalStorage(): void {
    try {
      const savedData = localStorage.getItem(this.storageKey());
      if (savedData) {
        const data = JSON.parse(savedData) as ProgressData;
        this.visitedTiles.set(new Set(data.visitedTiles || []));
        this.unlockedAchievements.set(new Set(data.unlockedAchievements || []));
        this.applyDailyProgress(data.dailyProgress);
      }
    } catch (e) {
      console.error('Error loading progress from localStorage', e);
    }
  }

  private saveToLocalStorage(): void {
    try {
      const data: ProgressData = {
        visitedTiles: Array.from(this.visitedTiles()),
        unlockedAchievements: Array.from(this.unlockedAchievements()),
        dailyProgress: {
          date: this.dailyDate,
          tileIds: Array.from(this.dailyTileIds()),
          distanceMeters: Math.round(this.dailyDistanceMeters()),
        },
      };
      localStorage.setItem(this.storageKey(), JSON.stringify(data));
    } catch (e) {
      console.error('Error saving progress to localStorage', e);
    }
  }

  public resetProgress(clearStorage: boolean = true): void {
    this.visitedTiles.set(new Set());
    this.unlockedAchievements.set(new Set());
    this.dailyTileIds.set(new Set());
    this.dailyDistanceMeters.set(0);
    this.lastSavedDistanceMeters = 0;
    this.lastPosition = null;
    this.dailyDate = todayString();
    if (clearStorage) {
      try {
        localStorage.removeItem(this.storageKey());
      } catch (e) {
        console.error('Error clearing progress from localStorage', e);
      }
    }
  }

  private saveProgress(): void {
    this.isSyncing.set(true);

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      if (this.authService.isLoggedIn()) {
        this.saveToFirestore().finally(() => this.isSyncing.set(false));
      } else {
        this.saveToLocalStorage();
        this.isSyncing.set(false);
      }
      this.saveTimeout = null;
    }, 2000);
  }

  private async saveToFirestore(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user || !this.db) {
      console.warn(`💾 [Progress] saveToFirestore skipped — user: ${!!user}, db: ${!!this.db}`);
      return;
    }

    // Do not write before the first snapshot has merged the cloud history — a
    // write now would replace visitedTiles with our local-only set and wipe the
    // cloud. Persist locally instead; the seed-reconcile flush pushes it later.
    if (!this.cloudSeeded) {
      console.warn('💾 [Progress] save deferred — cloud not seeded yet, persisting to localStorage');
      this.logEvent('SAVE_DEFERRED_UNSEEDED', String(this.visitedTiles().size));
      this.saveToLocalStorage();
      return;
    }

    const tilesToSave = Array.from(this.visitedTiles());
    const tileCount = tilesToSave.length;
    console.log(`💾 [Progress] saving ${tileCount} tiles to Firestore...`);
    try {
      const data: ProgressData = {
        visitedTiles: tilesToSave,
        unlockedAchievements: Array.from(this.unlockedAchievements()),
        dailyProgress: {
          date: this.dailyDate,
          tileIds: Array.from(this.dailyTileIds()),
          distanceMeters: Math.round(this.dailyDistanceMeters()),
        },
      };
      const progressDocRef = doc(this.db, 'users', user.uid, 'progress', 'main');
      await setDoc(progressDocRef, data, { merge: true });
      console.log(`✅ [Progress] saved ${tileCount} tiles to Firestore`);
      if (this.visitedTiles().size > tileCount) {
        console.log(`🔄 [Progress] new tiles added during save → re-saving`);
        this.saveProgress();
      }
    } catch (e) {
      console.error('❌ [Progress] Firestore save FAILED:', e);
    }
  }

  isSyncingNow(): boolean {
    return this.isSyncing();
  }
}
