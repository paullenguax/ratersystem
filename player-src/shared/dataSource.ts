import type { StorylineItem, StorylineTheme, TemplateSlide, StorylinePartFragment, StorylineTestFragment, StorylinePartNumber } from './types'
import { getParams, previewStorageKey, themeStorageKey } from './session'
import { resolveItems } from './resolveItems'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} not found (${res.status})`)
  return (await res.json()) as T
}

// Dynamic Part-pooling launch: compose the final items client-side from
// several small, independently-exported static fragments — the shared
// template, this Test's whole-test content, and the 4 Parts WordPress
// assigned this candidate — rather than one pre-built version.json.
// Preserves the same offline-resilience property the old single-zip export
// had (same-origin static fetches, no live Firestore/API dependency) while
// letting each Part be exported once and reused across every candidate who
// gets assigned it, instead of re-bundled into every Version that ever
// referenced it.
async function loadDynamicItems(testId: string, partIds: Partial<Record<StorylinePartNumber, string>>): Promise<StorylineItem[]> {
  const [template, test, ...parts] = await Promise.all([
    fetchJson<{ slides: TemplateSlide[] }>('./template.json'),
    fetchJson<StorylineTestFragment>(`./tests/${testId}/test.json`),
    ...([1, 2, 3, 4] as const).map(n =>
      fetchJson<StorylinePartFragment>(`./parts/${n}/${partIds[n]}/part.json`),
    ),
  ])
  const selectedParts: Partial<Record<StorylinePartNumber, StorylinePartFragment>> = {
    1: parts[0], 2: parts[1], 3: parts[2], 4: parts[3],
  }
  // No StorylineVersion in the dynamic model, so no "{test} — {version}"
  // label to build — just the test's own name.
  return resolveItems(template.slides, test.variables, test.slotContent, selectedParts, test.name)
}

// Both examiner.ts and candidate.ts call this independently at startup so
// neither window depends on receiving the initial item list from the other
// over BroadcastChannel — that would need a ready/handshake protocol and a
// race between window.open() and channel subscription. BroadcastChannel is
// used only for the runtime "advance to state X" signal, once both windows
// are already up.
export async function loadItems(): Promise<StorylineItem[]> {
  const { sessionId, isPreview, isDynamic, testId, partIds } = getParams()

  if (isPreview) {
    const raw = localStorage.getItem(previewStorageKey(sessionId))
    const items = raw ? (JSON.parse(raw) as StorylineItem[]) : []
    return [...items].sort((a, b) => a.order - b.order)
  }

  if (isDynamic) {
    const items = await loadDynamicItems(testId!, partIds)
    return [...items].sort((a, b) => a.order - b.order)
  }

  // Legacy path — a zip built by exportStorylineVersion(), one bundled
  // version.json shipped with the export. Kept working unchanged; still
  // the only path for the hand-built Practice/example-test flow.
  const res = await fetch('./version.json')
  if (!res.ok) throw new Error(`version.json not found (${res.status})`)
  const items = (await res.json()) as StorylineItem[]
  return [...items].sort((a, b) => a.order - b.order)
}

// Export-time flags (currently just `ungated` — see StorylineVersion.
// ungated in the main app's types). Only meaningful for the legacy
// per-Version export path; the dynamic-pooling path doesn't fetch this at
// all (no per-candidate concept of "skip the confirm gating" exists there
// yet). Absent flags.json (any export built before this feature, or
// preview mode, which never fetches this) = every flag false = today's
// only behavior, same absent-is-safe pattern as loadTheme() below.
export async function loadFlags(): Promise<{ ungated?: boolean }> {
  const { isPreview, isDynamic } = getParams()
  if (isPreview || isDynamic) return {}

  try {
    const res = await fetch('./flags.json')
    if (!res.ok) return {}
    return (await res.json()) as { ungated?: boolean }
  } catch {
    return {}
  }
}

// A separate file/key from items, not a sibling field on them — theme is
// global template config, not per-item, and keeping it separate means an
// export built before this feature (no theme.json at all) just falls back
// to every default rather than needing version.json's shape to change.
// Shared across both the legacy and dynamic paths — theme.json is exported
// once (alongside the player shell for dynamic launches, or in the zip for
// legacy ones) at the same relative location either way.
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
