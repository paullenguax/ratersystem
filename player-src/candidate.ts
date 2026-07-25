import type { StorylineItem } from './shared/types'
import { getParams, channelName } from './shared/session'
import { loadItems } from './shared/dataSource'
import { initOnlineStatusDot } from './shared/onlineStatus'
import lenguaxLogo from './assets/lenguax-logo.png'

const { sessionId } = getParams()
const channel = new BroadcastChannel(channelName(sessionId))

const statusDot = document.getElementById('internet-status')
if (statusDot) initOnlineStatusDot(statusDot)

function panelId(candidateState: string): string {
  return `panel-${candidateState.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function renderPanels(items: StorylineItem[]) {
  const container = document.getElementById('panels')
  if (!container) return
  container.innerHTML = ''

  for (const item of items) {
    if (!item.candidateState) continue

    const panel = document.createElement('div')
    panel.className = 'polaroid'
    panel.id = panelId(item.candidateState)

    const images = item.media?.images
    if (images && images.length > 0) {
      const imageRow = document.createElement('div')
      imageRow.className = 'image-row'
      images.forEach((url, i) => {
        const cell = document.createElement('div')
        cell.className = 'image-cell'
        const img = document.createElement('img')
        img.src = url
        img.alt = item.candidateState
        cell.appendChild(img)
        // A, B, C… labels so everyone can unambiguously refer to "picture A"
        // vs "picture B" once more than one image is shown at once.
        if (images.length > 1) {
          const tag = document.createElement('span')
          tag.className = 'image-cell-label'
          tag.textContent = String.fromCharCode(65 + i)
          cell.appendChild(tag)
        }
        imageRow.appendChild(cell)
      })
      panel.appendChild(imageRow)
    } else {
      // No image content for this state (instructions, preamble, audio-only
      // tasks, closing) — show the brand logo rather than the internal
      // candidateState key, which candidates were never meant to see.
      const logo = document.createElement('img')
      logo.src = lenguaxLogo
      logo.alt = 'Lenguax'
      logo.className = 'candidate-logo'
      panel.appendChild(logo)
    }

    // Audio plays from the examiner's own console (same room, one set of
    // speakers) — see examiner.ts. The candidate screen only ever shows
    // images.

    container.appendChild(panel)
  }
}

function showState(candidateState: string) {
  const panels = document.querySelectorAll<HTMLElement>('#panels .polaroid')
  const targetId = panelId(candidateState)
  panels.forEach(panel => {
    panel.style.visibility = panel.id === targetId ? 'visible' : 'hidden'
  })
}

channel.onmessage = event => {
  const data = event.data as { type: string; candidateState: string }
  if (data?.type === 'advance') showState(data.candidateState)
}

loadItems().then(renderPanels).catch(err => {
  const container = document.getElementById('panels')
  if (container) container.textContent = `Failed to load items: ${String(err)}`
})
