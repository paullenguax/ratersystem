import type { StorylineItem } from './shared/types'
import { getParams, channelName } from './shared/session'
import { loadItems } from './shared/dataSource'
import { initOnlineStatusDot } from './shared/onlineStatus'

const { sessionId, isPreview } = getParams()
const channel = new BroadcastChannel(channelName(sessionId))
let candidateWindow: Window | null = null

const statusDot = document.getElementById('internet-status')
if (statusDot) initOnlineStatusDot(statusDot)

function candidateUrl(): string {
  const params = new URLSearchParams()
  params.set('session', sessionId)
  if (isPreview) params.set('preview', '1')
  return `./candidate.html?${params.toString()}`
}

function openCandidateWindow() {
  candidateWindow = window.open(candidateUrl(), `candidateWindow_${sessionId}`, 'width=1024,height=768')
  candidateWindow?.focus()
}

document.getElementById('open-candidate')?.addEventListener('click', openCandidateWindow)

function renderItems(items: StorylineItem[]) {
  const container = document.getElementById('items')
  if (!container) return
  container.innerHTML = ''

  if (items.length === 0) {
    container.textContent = 'No items in this version.'
    return
  }

  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'item-row'

    const label = document.createElement('div')
    label.innerHTML = `<strong>${item.candidateState || '(no state)'}</strong>` +
      (item.examinerText ? `<div class="meta">${escapeHtml(item.examinerText)}</div>` : '')

    const button = document.createElement('button')
    button.textContent = 'Show'
    button.disabled = !item.candidateState
    button.addEventListener('click', () => {
      if (candidateWindow && !candidateWindow.closed) {
        channel.postMessage({ type: 'advance', candidateState: item.candidateState })
      } else if (window.confirm('The candidate window has been closed. Reopen it?')) {
        openCandidateWindow()
      }
    })

    row.appendChild(label)
    row.appendChild(button)
    container.appendChild(row)
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

loadItems().then(renderItems).catch(err => {
  const container = document.getElementById('items')
  if (container) container.textContent = `Failed to load items: ${String(err)}`
})
