import type { StorylineItem } from './types'

// Fire-and-forget: warms the browser's HTTP cache for every image/audio
// this version references, as soon as items load — rather than each asset
// only being requested lazily when its slide is actually reached. Doesn't
// guarantee true offline playback (that would need a service worker
// explicitly caching responses regardless of server cache headers, a
// bigger step not taken here — see exportStoryline.ts's media-bundling
// comment for the offline-posture history); this just means a centre's
// brief connectivity hiccup partway through a test is far less likely to
// land on a slide whose media hasn't been fetched yet. Errors are
// swallowed — a failed preload just falls back to the original lazy
// per-slide fetch, same as before this existed.
export function preloadAllMedia(items: StorylineItem[]) {
  const urls = new Set<string>()
  for (const item of items) {
    item.media?.images?.forEach(u => urls.add(u))
    item.media?.audioClips?.forEach(c => urls.add(c.url))
  }
  for (const url of urls) {
    fetch(url).catch(() => {})
  }
}
