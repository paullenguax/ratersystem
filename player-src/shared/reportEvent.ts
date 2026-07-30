// The exported player's *only* channel back to our own system — dataSource.ts
// has zero other Firebase connectivity (it only ever fetches its own
// version.json), so this is a plain fetch straight to an unauthenticated
// HTTPS Cloud Function (reportStorylineEvent in functions/index.js), not
// the Firebase SDK. Fire-and-forget, matching preloadAllMedia's philosophy —
// a failed report (offline, ad blocker, whatever) never blocks or alters
// the actual test flow; the worst case is a missed record, not a broken
// session.
const REPORT_ENDPOINT = 'https://us-central1-ratersystem.cloudfunctions.net/reportStorylineEvent'

export interface StorylineEventContext {
  testDisplayName?: string
  centreName?: string
  testNumber?: string
  examinerName?: string
  candidateName?: string
}

export function reportStorylineEvent(
  type: 'violation' | 'completed',
  context: StorylineEventContext,
  extra?: { subtype?: string; details?: string },
) {
  fetch(REPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...context, ...extra }),
  }).catch(() => {})
}
