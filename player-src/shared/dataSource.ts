import type { StorylineItem, StorylineTheme } from './types'
import { getParams, previewStorageKey, themeStorageKey } from './session'

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

// A separate file/key from items, not a sibling field on them — theme is
// global template config, not per-item, and keeping it separate means an
// export built before this feature (no theme.json at all) just falls back
// to every default rather than needing version.json's shape to change.
export async function loadTheme(): Promise<StorylineTheme> {
  const { sessionId, isPreview } = getParams()

  if (isPreview) {
    const raw = localStorage.getItem(themeStorageKey(sessionId))
    return raw ? (JSON.parse(raw) as StorylineTheme) : {}
  }

  try {
    const res = await fetch('./theme.json')
    if (!res.ok) return {}
    return (await res.json()) as StorylineTheme
  } catch {
    return {}
  }
}
