// Broad, structured event stream from the exported examiner console — see
// README's "Storyline telemetry" section. The player emits everything it
// can cheaply observe; the server (reportStorylineEvent) decides what to
// keep and what, if anything, to email. That split is deliberate: the set
// of emitted events is baked into every exported zip and only changes by
// re-exporting, whereas storage and alerting policy is server-side and
// changeable at any time. So we over-emit now rather than discover later
// that a wanted signal was never being sent.
//
// Not used by candidate.ts (nothing to observe there) or the practice
// player (practice runs are deliberately never recorded). examiner.ts also
// gates on !isPreview before init — preview sessions report nothing.

const ENDPOINT = 'https://us-central1-ratersystem.cloudfunctions.net/reportStorylineEvent'

// Bump whenever the set of emitted events or their `data` shapes changes,
// so a stored log stays self-describing about what the client of the day
// was capable of seeing.
export const PLAYER_BUILD = '2026-09-04'

// Events that must not linger in the buffer — they either gate an email or
// tend to fire exactly as the page is going away (window closing, network
// dropping), when a later interval flush would never run.
const URGENT = new Set([
  'session_start',
  'test_rejected',
  'test_finished',
  'audio_replay_limit',
  'candidate_window_closed',
  'connectivity_offline',
  'connectivity_online',
])

const FLUSH_INTERVAL_MS = 15_000

type Primitive = string | number | boolean | undefined
type Context = Record<string, Primitive>

let enabled = false
let runId = ''
let context: Context = {}
let buffer: Record<string, unknown>[] = []

function post(events: Record<string, unknown>[], viaBeacon: boolean): void {
  if (events.length === 0) return
  const payload = JSON.stringify({ events })
  if (viaBeacon) {
    try {
      if (navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }))) return
    } catch {
      /* fall through to fetch */
    }
  }
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: viaBeacon,
  }).catch(() => {})
}

export function flushTelemetry(viaBeacon = false): void {
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []
  post(batch, viaBeacon)
}

export function track(event: string, data?: Record<string, unknown>): void {
  if (!enabled) return
  buffer.push({
    event,
    runId,
    playerBuild: PLAYER_BUILD,
    clientTs: new Date().toISOString(),
    ...context,
    ...(data ? { data } : {}),
  })
  if (URGENT.has(event)) flushTelemetry()
}

// Call once, after flags/items have resolved so the context is complete.
// `context` fields are attached to every subsequent event.
export function initTelemetry(ctx: Context): void {
  if (enabled) return
  enabled = true
  context = ctx
  runId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`

  setInterval(() => flushTelemetry(), FLUSH_INTERVAL_MS)
  // Tab hidden: flush what we have (could be a real close, could be an
  // alt-tab — either way don't sit on events). Actual page teardown: send a
  // session_end and beacon everything out.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTelemetry(true)
  })
  addEventListener('pagehide', () => {
    track('session_end')
    flushTelemetry(true)
  })
}
