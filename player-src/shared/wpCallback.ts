// Best-effort calls into the OLD system's own completion/rejection
// endpoints (assets/sendStats.php, assets/rejectTest.php) — confirmed
// real, working, already-sending-email files for every existing
// Storyline-based test (see interlocutor-tool-master/assets/). Calling
// them keeps existing WP-side workflows/emails firing unchanged for
// versions built with this tool too, alongside (not instead of)
// reportStorylineEvent()'s own Firestore record.
//
// Relative path assumes examiner.php sits at the same folder depth the old
// story.php did (see exportStoryline.ts's PHP_GATE_HEADER comment) —
// assets/ is one level shallower (a sibling of every test's own folder,
// not nested inside it), hence `../assets/...` rather than `./assets/...`.
//
// Field mapping is a best-effort approximation, not a confirmed exact
// match — only the header of each file was read, not its full body, and
// there's no clean equivalent in this app's data model for the old
// system's short test-type codes (tt, e.g. "TWR"/"APP") or a numeric
// centre code (ce). Verify against a real deployment before relying on
// this for anything beyond a best-effort duplicate of the old
// notification. Never called in Preview mode — callers are expected to
// guard on `!isPreview` themselves, since there's no real WP folder
// structure (or session) to call into from a localStorage-backed preview.

function callWpEndpoint(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString()
  fetch(`../assets/${path}?${query}`).catch(() => {})
}

export function callSendStats(fields: { tt: string; tv: string; ce: string; tn: string; in: string; cn: string }) {
  callWpEndpoint('sendStats.php', { ...fields, ip: '' })
}

export function callRejectTest(fields: { tt: string; tv: string; ce: string; tn: string; in: string; rr: string }) {
  callWpEndpoint('rejectTest.php', { ...fields, ip: '' })
}
