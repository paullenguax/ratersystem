import type { StorylineItem } from '@/types'

// Opens the standalone player shell (public/player-shell/, built from
// player-src/ via `npm run build:player`) against the draft's current items,
// without needing to publish/export first. Uses import.meta.env.BASE_URL
// (not a hardcoded '/ratersystem/') so this resolves correctly in both dev
// and the deployed site regardless of vite.config.ts's `base`.
export function previewStorylineVersion(items: StorylineItem[]) {
  const sessionId = crypto.randomUUID()
  localStorage.setItem(`storyline_preview_${sessionId}`, JSON.stringify(items))

  const url = `${import.meta.env.BASE_URL}player-shell/examiner.html?preview=1&session=${sessionId}`
  window.open(url, '_blank')
}
