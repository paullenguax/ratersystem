import type { StorylineItem } from './types'
import { getParams, previewStorageKey } from './session'

// Both examiner.ts and candidate.ts call this independently at startup so
// neither window depends on receiving the initial item list from the other
// over BroadcastChannel — that would need a ready/handshake protocol and a
// race between window.open() and channel subscription. BroadcastChannel is
// used only for the runtime "advance to state X" signal, once both windows
// are already up.
export async function loadItems(): Promise<StorylineItem[]> {
  const { sessionId, isPreview } = getParams()

  if (isPreview) {
    const raw = localStorage.getItem(previewStorageKey(sessionId))
    const items = raw ? (JSON.parse(raw) as StorylineItem[]) : []
    return [...items].sort((a, b) => a.order - b.order)
  }

  const res = await fetch('./version.json')
  if (!res.ok) throw new Error(`version.json not found (${res.status})`)
  const items = (await res.json()) as StorylineItem[]
  return [...items].sort((a, b) => a.order - b.order)
}
