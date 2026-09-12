// The Test name and Version label often restate each other in different
// words ("Airline Sample Version" + "Airline Sample Collection") — showing
// both back to back on the accept/reject splash slide reads as repetitive.
// If they share a leading run of words, that's exactly the redundant part:
// drop it and show only the Version's own label, since that's the more
// specific "which one is this" identifier. Genuinely distinct names (e.g.
// "Airline Pilot" + "020") keep the full "Test: Version" form — there's
// nothing shared to trim, so this never makes an already-fine pair worse.
//
// Kept as a tiny, easily-ported function (like resolveItems.js) rather than
// a shared import, since functions/index.js is a separate Node/CommonJS
// deploy that can't import from this Vite app bundle.
export function formatTestDisplayName(testName: string, versionLabel: string): string {
  const test = (testName ?? '').trim()
  const version = (versionLabel ?? '').trim()
  if (!test) return version
  if (!version) return test

  const testWords = test.toLowerCase().split(/\s+/)
  const versionWords = version.toLowerCase().split(/\s+/)
  let shared = 0
  while (shared < testWords.length && shared < versionWords.length && testWords[shared] === versionWords[shared]) {
    shared++
  }
  return shared > 0 ? version : `${test}: ${version}`
}
