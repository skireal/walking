# Logging Checklist

When adding or reviewing `logEvent` / diagnostic logging, go through **all** of the following in one pass before committing.

## 1. Every error path is in the session log
- Every `catch (err)` block → `logEvent('SOMETHING_FAIL', String(err))`
- Every `if (error)` callback → `logEvent`
- Every `.catch(...)` on a Promise → `logEvent` (not just `console.error`)
- Grep for `console.error` and `console.warn` — each one is a candidate

## 2. Every lifecycle transition is logged
Draw the full state machine first, then verify each edge:
- Service init / start / stop
- App foreground → background → foreground (both directions)
- Cold start vs resume (distinguish them explicitly)
- Permission granted / denied

## 3. Every branching decision that affects data is logged
For each `if/else` that decides whether to count distance, skip a position, or skip a flush:
- Log which branch was taken
- Log the reason (value that caused the branch, e.g. gap in seconds, accuracy in metres)
- Log both FROM and TO state where relevant (e.g. coordinates for a skipped jump)

## 4. Key numeric results are in the session log (not just console)
- Distance added per flush (`distAdded=Xm`)
- Positions counted vs skipped per flush
- Timestamps that control skip logic (e.g. `lastLiveTimestamp` at load and at flush)

## 5. No log is noisy
- A log that fires on every position update during normal walking is useless noise
- Use throttling (time-based) or flags (`pendingXxx = true/false`) so tags fire at
  meaningful transitions, not on every tick
- After writing a new `logEvent`, ask: "how often does this fire during a 1-hour walk?"
  If the answer is "hundreds of times" → throttle it or find a better trigger

## 6. Errors in the logging infrastructure itself
- Buffer plugin not running? → `BUF_START_FAIL`
- Resume listener failed to register? → `RESUME_LISTENER_FAIL`
- Flush itself threw? → `BUF_FLUSH_ERROR`
- GPS watcher failed to start? → `BG_WATCHER_FAIL`

---

## Current logEvent tags

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
