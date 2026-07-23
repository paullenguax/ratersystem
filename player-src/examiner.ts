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

// Timestamped event log, visible in the examiner window — mirrors the old
// system's footer log. No backend write: there's no real test-run/booking
// record to attach it to yet (that's Phase 2's WordPress integration), so
// this stays a local, in-session record only.
function logEvent(message: string) {
  const list = document.getElementById('event-log')
  if (!list) return
  const time = new Date().toLocaleTimeString()
  const li = document.createElement('li')
  li.textContent = `[${time}] ${message}`
  list.insertBefore(li, list.firstChild)
}

// Audio plays from the examiner's own console — everyone in the room hears
// it via the examiner's speakers, matching the in-person, single-room setup
// (recorder on the desk, one device). The candidate screen never plays
// audio itself (candidate.ts is images-only). Play is a soft lock: past
// maxPlays it still plays, just warns and logs it — never blocks.
const playCounts = new Map<string, number>()

function createAudioControls(clip: { label: string; url: string; maxPlays?: number }): HTMLElement {
  const audio = new Audio(clip.url)
  const wrap = document.createElement('div')
  wrap.className = 'audio-controls'

  const label = document.createElement('span')
  label.className = 'audio-label'
  label.textContent = clip.label

  const countLabel = document.createElement('span')
  countLabel.className = 'audio-count'

  function updateCount() {
    const count = playCounts.get(clip.url) ?? 0
    countLabel.textContent = clip.maxPlays ? `${count}/${clip.maxPlays} plays` : `${count} plays`
    countLabel.classList.toggle('audio-count-over', !!clip.maxPlays && count > clip.maxPlays)
  }

  const playBtn = document.createElement('button')
  playBtn.textContent = '▶ Play'
  playBtn.addEventListener('click', () => {
    audio.currentTime = 0
    audio.play()
    const count = (playCounts.get(clip.url) ?? 0) + 1
    playCounts.set(clip.url, count)
    updateCount()
    if (clip.maxPlays && count > clip.maxPlays) {
      window.alert(`"${clip.label}" has now been played ${count} times (limit: ${clip.maxPlays}). This has been logged.`)
      logEvent(`Played "${clip.label}" beyond its limit (${count}/${clip.maxPlays}).`)
    } else {
      logEvent(`Played "${clip.label}" (${count}${clip.maxPlays ? '/' + clip.maxPlays : ''}).`)
    }
  })

  const pauseBtn = document.createElement('button')
  pauseBtn.textContent = 'Pause'
  pauseBtn.addEventListener('click', () => audio.pause())

  const stopBtn = document.createElement('button')
  stopBtn.textContent = 'Stop'
  stopBtn.addEventListener('click', () => { audio.pause(); audio.currentTime = 0 })

  updateCount()
  wrap.append(label, playBtn, pauseBtn, stopBtn, countLabel)
  return wrap
}

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
    row.appendChild(label)

    item.media?.audioClips?.forEach(clip => {
      row.appendChild(createAudioControls(clip))
    })

    const button = document.createElement('button')
    button.textContent = 'Show'
    button.disabled = !item.candidateState
    button.addEventListener('click', () => {
      if (candidateWindow && !candidateWindow.closed) {
        channel.postMessage({ type: 'advance', candidateState: item.candidateState })
        logEvent(`Advanced candidate screen to "${item.candidateState}".`)
      } else if (window.confirm('The candidate window has been closed. Reopen it?')) {
        openCandidateWindow()
      }
    })
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
