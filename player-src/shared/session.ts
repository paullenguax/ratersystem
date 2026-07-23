// Query-string params shared by examiner.html and candidate.html.
//
//   ?preview=1        — read items from localStorage instead of version.json
//   &session=<id>     — scopes the BroadcastChannel/localStorage key so
//                        concurrent preview tabs on different drafts (or
//                        concurrent real tests on one machine) can't cross-talk

export function getParams() {
  const params = new URLSearchParams(location.search)
  const sessionId = params.get('session') ?? 'default'
  const isPreview = params.get('preview') === '1'
  return { sessionId, isPreview }
}

export function previewStorageKey(sessionId: string) {
  return `storyline_preview_${sessionId}`
}

export function channelName(sessionId: string) {
  return `storyline-sync-${sessionId}`
}
