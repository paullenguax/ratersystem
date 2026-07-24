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

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// --- Continuous session timer ------------------------------------------
// Starts the moment the examiner reaches the slide tagged
// `startsTestTimer` (see TemplateSlide) and runs for the rest of the test.

let globalTimerStart: number | null = null

function tickGlobalTimer() {
  if (globalTimerStart === null) return
  const el = document.getElementById('global-timer')
  if (!el) return
  el.textContent = formatTime((Date.now() - globalTimerStart) / 1000)
}

function startGlobalTimer() {
  if (globalTimerStart !== null) return
  globalTimerStart = Date.now()
  const el = document.getElementById('global-timer')
  if (el) el.hidden = false
  tickGlobalTimer()
  window.setInterval(tickGlobalTimer, 1000)
}

// --- Per-slide timer ------------------------------------------------------
// Auto-starts the moment a slide with timing.prepSeconds/responseSeconds
// becomes current. Prep counts down first, then response, if both are set.
// Purely informational — never gates navigation.

let slideTimerHandle: number | undefined
let slideTimerRemaining = 0

function clearSlideTimer() {
  if (slideTimerHandle !== undefined) window.clearInterval(slideTimerHandle)
  slideTimerHandle = undefined
  const el = document.getElementById('slide-timer')
  if (el) {
    el.hidden = true
    el.classList.remove('exam-timer-done')
  }
}

function runSlideTimerPhase(phase: 'Prep' | 'Response', seconds: number, then?: () => void) {
  slideTimerRemaining = seconds
  const el = document.getElementById('slide-timer')
  if (!el) return
  el.hidden = false
  el.classList.remove('exam-timer-done')
  el.textContent = `${phase} ${formatTime(slideTimerRemaining)}`
  slideTimerHandle = window.setInterval(() => {
    slideTimerRemaining--
    if (slideTimerRemaining < 0) {
      window.clearInterval(slideTimerHandle)
      if (then) {
        then()
      } else {
        el.textContent = `${phase} 00:00`
        el.classList.add('exam-timer-done')
      }
      return
    }
    el.textContent = `${phase} ${formatTime(slideTimerRemaining)}`
  }, 1000)
}

function startSlideTimer(item: StorylineItem) {
  clearSlideTimer()
  const { prepSeconds, responseSeconds } = item.timing ?? {}
  if (prepSeconds) {
    runSlideTimerPhase('Prep', prepSeconds, responseSeconds ? () => runSlideTimerPhase('Response', responseSeconds) : undefined)
  } else if (responseSeconds) {
    runSlideTimerPhase('Response', responseSeconds)
  }
}

// --- Audio playback (from the examiner's own console — everyone in the ---
// room hears it via the examiner's speakers, matching the in-person,
// single-room setup). Soft lock: past maxPlays it still plays, just warns
// and logs it — never blocks. `onPlay` lets the caller re-check whether
// Next should now be enabled (every clip needs >=1 play).
const playCounts = new Map<string, number>()

function createAudioControls(clip: { label: string; url: string; maxPlays?: number }, onPlay: () => void): HTMLElement {
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
    onPlay()
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

// --- Slide navigator --------------------------------------------------

let items: StorylineItem[] = []
let currentIndex = 0

function sendAdvance(item: StorylineItem) {
  if (!item.candidateState) return
  if (candidateWindow && !candidateWindow.closed) {
    channel.postMessage({ type: 'advance', candidateState: item.candidateState })
    logEvent(`Advanced candidate screen to "${item.candidateState}".`)
  } else {
    logEvent(`Candidate window is not open — "${item.candidateState}" was not shown.`)
  }
}

function updateNavState() {
  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement | null
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (!prevBtn || !nextBtn) return
  prevBtn.disabled = currentIndex === 0
  const item = items[currentIndex]
  const clips = item?.media?.audioClips ?? []
  const allPlayed = clips.every(c => (playCounts.get(c.url) ?? 0) > 0)
  const isLast = currentIndex >= items.length - 1
  // Preview mode lets an admin click through freely regardless of audio gating.
  nextBtn.disabled = isLast || (!isPreview && !allPlayed)
}

function renderCurrentSlide() {
  const card = document.getElementById('slide-card')
  const progressLabel = document.getElementById('progress-label')
  const progressFill = document.getElementById('progress-fill') as HTMLElement | null
  const notesContent = document.getElementById('notes-content')
  if (!card) return

  if (items.length === 0) {
    card.textContent = 'No items in this version.'
    return
  }

  const item = items[currentIndex]

  if (progressLabel) progressLabel.textContent = `Slide ${currentIndex + 1}/${items.length}`
  if (progressFill) progressFill.style.width = `${((currentIndex + 1) / items.length) * 100}%`

  card.innerHTML = ''
  const heading = document.createElement('div')
  heading.className = 'slide-heading'
  heading.textContent = item.candidateState || '(examiner-only)'
  card.appendChild(heading)

  if (item.examinerText) {
    const text = document.createElement('div')
    text.className = 'slide-text'
    text.textContent = item.examinerText
    card.appendChild(text)
  }

  item.media?.audioClips?.forEach(clip => {
    card.appendChild(createAudioControls(clip, updateNavState))
  })

  if (notesContent) notesContent.textContent = item.notes || 'No notes for this slide.'

  if (item.startsTestTimer) startGlobalTimer()
  startSlideTimer(item)
  sendAdvance(item)
  updateNavState()
}

document.getElementById('prev-btn')?.addEventListener('click', () => {
  if (currentIndex === 0) return
  currentIndex--
  renderCurrentSlide()
})

document.getElementById('next-btn')?.addEventListener('click', () => {
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn?.disabled || currentIndex >= items.length - 1) return
  currentIndex++
  renderCurrentSlide()
})

document.getElementById('notes-toggle')?.addEventListener('click', () => {
  document.getElementById('notes-drawer')?.classList.toggle('open')
})
document.getElementById('notes-close')?.addEventListener('click', () => {
  document.getElementById('notes-drawer')?.classList.remove('open')
})

loadItems().then(loaded => {
  items = loaded
  renderCurrentSlide()
}).catch(err => {
  const card = document.getElementById('slide-card')
  if (card) card.textContent = `Failed to load items: ${String(err)}`
})
