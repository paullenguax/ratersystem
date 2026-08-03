// Query-string params shared by examiner.html and candidate.html.
//
//   ?preview=1        — read items from localStorage instead of version.json
//   &session=<id>     — scopes the BroadcastChannel/localStorage key so
//                        concurrent preview tabs on different drafts (or
//                        concurrent real tests on one machine) can't cross-talk
//   &testId=...&p1=...&p2=...&p3=...&p4=...
//                     — dynamic Part-pooling launch: WordPress hands the 4
//                        Parts it assigned this candidate instead of the
//                        bundle shipping one pre-picked Version's content.
//                        When present, dataSource.ts fetches/composes from
//                        several small per-Part/per-Test fragments instead
//                        of one bundled version.json — see dataSource.ts.
//                        Absent on any zip built by the older
//                        exportStorylineVersion() path, which keeps working
//                        unchanged (falls back to the single version.json
//                        fetch).

export function getParams() {
  const params = new URLSearchParams(location.search)
  const sessionId = params.get('session') ?? 'default'
  const isPreview = params.get('preview') === '1'
  const testId = params.get('testId')
  const partIds: Partial<Record<1 | 2 | 3 | 4, string>> = {}
  for (const n of [1, 2, 3, 4] as const) {
    const v = params.get(`p${n}`)
    if (v) partIds[n] = v
  }
  // A dynamic launch needs all 5 — a partially-specified URL (e.g. testId
  // with only 2 of 4 parts, a malformed manual edit) isn't a valid dynamic
  // launch, so dataSource.ts should fall back to the legacy path rather
  // than try to resolve with missing Parts.
  const isDynamic = !!testId && [1, 2, 3, 4].every(n => partIds[n as 1 | 2 | 3 | 4])
  return { sessionId, isPreview, testId, partIds, isDynamic }
}

export function previewStorageKey(sessionId: string) {
  return `storyline_preview_${sessionId}`
}

export function themeStorageKey(sessionId: string) {
  return `storyline_theme_${sessionId}`
}

export function channelName(sessionId: string) {
  return `storyline-sync-${sessionId}`
}
