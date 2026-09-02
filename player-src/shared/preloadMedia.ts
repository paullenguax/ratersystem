import type { StorylineItem } from './types'

export interface PreloadResult {
  // original URL -> in-memory Blob. Held for the life of the page (object
  // URLs built from these are never revoked), and handed whole to the
  // candidate window so both screens can run with the network gone.
  blobs: Map<string, Blob>
  failed: string[]
}

function collectUrls(items: StorylineItem[]): string[] {
  const urls = new Set<string>()
  for (const item of items) {
    item.media?.images?.forEach(u => u && urls.add(u))
    item.media?.audioClips?.forEach(c => c.url && urls.add(c.url))
  }
  return [...urls]
}

async function fetchWithRetry(url: string, tries = 4): Promise<Blob> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: 'force-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.blob()
    } catch (e) {
      lastErr = e
      if (i < tries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw lastErr
}

// Fetches every image/audio the version references and holds each as an
// in-memory Blob, so once this resolves the whole test can play with the
// network fully gone — the point being that after "START TEST" a
// connectivity loss can't stop a Part 3 recording or Part 4 picture
// appearing. `onProgress(done, total, failed)` fires as each settles.
// Never rejects: assets that still fail after retries come back in
// `failed` for the caller to surface (and let the examiner decide).
export async function preloadMediaToBlobs(
  items: StorylineItem[],
  onProgress?: (done: number, total: number, failed: number) => void,
): Promise<PreloadResult> {
  const urls = collectUrls(items)
  const blobs = new Map<string, Blob>()
  const failed: string[] = []
  let done = 0
  onProgress?.(0, urls.length, 0)
  await Promise.all(
    urls.map(async url => {
      try {
        blobs.set(url, await fetchWithRetry(url))
      } catch {
        failed.push(url)
      } finally {
        done++
        onProgress?.(done, urls.length, failed.length)
      }
    }),
  )
  return { blobs, failed }
}

// Rewrites each item's media URLs to local object URLs built from `blobs`.
// A URL not present in the map is left as-is (it'll still lazy-fetch on
// demand — that's the `failed` case). Mutates `items` in place, since the
// player keeps that array as its render source.
export function applyMediaBlobs(items: StorylineItem[], blobs: Map<string, Blob>): void {
  const objectUrls = new Map<string, string>()
  const toLocal = (u: string): string => {
    if (!blobs.has(u)) return u
    let local = objectUrls.get(u)
    if (!local) {
      local = URL.createObjectURL(blobs.get(u)!)
      objectUrls.set(u, local)
    }
    return local
  }
  for (const item of items) {
    if (item.media?.images) item.media.images = item.media.images.map(toLocal)
    if (item.media?.audioClips) {
      item.media.audioClips = item.media.audioClips.map(c => ({ ...c, url: toLocal(c.url) }))
    }
  }
}
