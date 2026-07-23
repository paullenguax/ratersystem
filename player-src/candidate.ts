import type { StorylineItem } from './shared/types'
import { getParams, channelName } from './shared/session'
import { loadItems } from './shared/dataSource'
import { initOnlineStatusDot } from './shared/onlineStatus'

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

    if (item.media?.images && item.media.images.length > 0) {
      const imageRow = document.createElement('div')
      imageRow.className = 'image-row'
      item.media.images.forEach(url => {
        const img = document.createElement('img')
        img.src = url
        img.alt = item.candidateState
        imageRow.appendChild(img)
      })
      panel.appendChild(imageRow)
    }

    item.media?.audioClips?.forEach(clip => {
      const audio = document.createElement('audio')
      audio.src = clip.url
      audio.controls = true
      audio.className = 'panel-audio'
      panel.appendChild(audio)
    })

    const caption = document.createElement('div')
    caption.className = 'container'
    caption.innerHTML = `<p>${item.candidateState}</p>`
    panel.appendChild(caption)

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
