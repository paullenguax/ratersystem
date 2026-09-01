import type { StorylineItem } from './shared/types'
import { channelName } from './shared/session'
import { loadItems, loadTheme } from './shared/dataSource'
import { applyTheme } from './shared/applyTheme'
import { renderInlineMarkup, renderScriptText } from './shared/markup'
import { preloadAllMedia } from './shared/preloadMedia'
import teacLogo from './assets/teac-logo.png'

// Self-service practice/sample player — the third and simplest of the three
// player-src entry points. Mirrors the real exam's two-window shape (this
// window drives audio/text/controls, a genuine candidate.html popup shows
// the actual images — reused completely unmodified, see candidate.ts) so
// practicing feels like the real thing, but by design reports nothing
// anywhere and calls no WordPress endpoint — no violation tracking (not
// even "candidate window closed"), no completion/exposure reporting, no
// Next-button gating. All of that stays scoped to versions exported as
// Live/Backup (see StorylineVersion.versionType, exportStorylineVersion())
// — this entry point, exported by exportStorylinePractice(), is purely
// static content playback for a version marked Practice.
//
// Slide kinds that only make sense inside a real proctored booking
// (confirm centre/examiner/candidate details, the examiner's private
// room-setup checklist) are dropped entirely rather than rendered inert —
// see SKIPPED_KINDS. accept_reject_test is kept, but re-rendered as a
// simple non-interactive "here's which test this is" intro (see
// BRANDED_KINDS/renderIntro) instead of the real accept/reject controls,
// which depend on a real booking to mean anything.
const SKIPPED_KINDS = new Set(['test_data_confirm', 'admin_checklist'])
const BRANDED_KINDS = new Set(['accept_reject_test'])

// practice.html/story.html is opened directly with no launch URL supplying
// a session id (unlike examiner.php, which WordPress generates per
// booking) — mint one locally, just to scope the BroadcastChannel to this
// one page load/candidate-window pair.
const sessionId = crypto.randomUUID()
const channel = new BroadcastChannel(channelName(sessionId))
let candidateWindow: Window | null = null

let items: StorylineItem[] = []
let currentIndex = 0

// --- Candidate window (images only — see candidate.ts) -------------------
function candidateUrl(): string {
  const params = new URLSearchParams()
  params.set('session', sessionId)
  return `./candidate.html?${params.toString()}`
}

function openCandidateWindow() {
  candidateWindow = window.open(candidateUrl(), `candidateWindow_${sessionId}`, 'width=1024,height=768')
  candidateWindow?.focus()
  logEvent('candidate_window_opened', 'second (candidate) screen launched')
  updateCandidateStatus()
}

function openOrFocusCandidateWindow() {
  if (candidateWindow && !candidateWindow.closed) candidateWindow.focus()
  else openCandidateWindow()
}

document.getElementById('open-candidate')?.addEventListener('click', openOrFocusCandidateWindow)
document.getElementById('candidate-status')?.addEventListener('click', openOrFocusCandidateWindow)

document.getElementById('notes-toggle')?.addEventListener('click', () => {
  const drawer = document.getElementById('notes-drawer')
  drawer?.classList.toggle('open')
  logEvent(drawer?.classList.contains('open') ? 'notes_opened' : 'notes_closed', 'examiner notes drawer')
})
document.getElementById('notes-close')?.addEventListener('click', () => {
  document.getElementById('notes-drawer')?.classList.remove('open')
  logEvent('notes_closed', 'examiner notes drawer')
})

// Polled rather than event-driven (no reliable "closed" event across
// browsers) — same approach as examiner.ts. Transitions are logged so the
// event stream shows the candidate screen being opened/closed mid-session,
// exactly as a real test records it (there, a mid-session close is flagged
// as a possible violation).
let candidateWasOpen = false
function updateCandidateStatus() {
  const open = !!candidateWindow && !candidateWindow.closed
  if (open !== candidateWasOpen) {
    if (open) logEvent('candidate_window_connected', 'candidate screen ready')
    else logEvent('candidate_window_closed', 'candidate screen closed mid-session — a real test flags this as a possible violation')
    candidateWasOpen = open
  }
  const btn = document.getElementById('candidate-status')
  if (!btn) return
  btn.classList.toggle('open', open)
  btn.title = open ? 'Candidate window open' : 'Candidate window closed — click to open'
}
window.setInterval(updateCandidateStatus, 1000)
updateCandidateStatus()

function sendAdvance(item: StorylineItem) {
  if (!item.candidateState) return
  channel.postMessage({ type: 'advance', candidateState: item.candidateState })
}

// candidate.ts posts `ready` on first load and on every reopen — reply with
// whatever state the current slide should be showing so a (re)opened
// window never sits blank. Same pattern as examiner.ts.
channel.onmessage = event => {
  const data = event.data as { type: string }
  if (data?.type !== 'ready') return
  const item = items[currentIndex]
  if (item?.candidateState) channel.postMessage({ type: 'advance', candidateState: item.candidateState })
}

// Verbose, screen-only mirror of the telemetry a real (Live) test streams
// to the server as it happens. Every line here lines up with a track() call
// in examiner.ts and a row in the `storyline_events` Firestore collection —
// session start/end, every slide view, every audio play/pause/stop/finish
// and its replay count, candidate-window focus, timers, connectivity, the
// lot. This is Practice, so NONE of it is sent or stored; it is shown only
// to make visible exactly what a real sitting captures. `event` is the
// canonical telemetry name; `detail` is the human-readable context.
function logEvent(event: string, detail = '') {
  const list = document.getElementById('event-log')
  if (!list) return
  const time = new Date().toLocaleTimeString()
  const li = document.createElement('li')
  const name = document.createElement('code')
  name.className = 'log-event'
  name.textContent = event
  li.append(`[${time}] `, name)
  if (detail) li.append(` ${detail}`)
  list.insertBefore(li, list.firstChild)
}

// Fired once, plus a 'session_end' when the test is finished. In a real
// test session_start also carries the run id, player build, centre, test
// number, examiner and candidate — stamped onto every subsequent event.
function logSessionStart() {
  logEvent('session_start', `sample run ${sessionId.slice(0, 8)} — a real test also records player build, centre, test number, examiner and candidate on every line below`)
}

window.addEventListener('offline', () =>
  logEvent('connectivity_offline', 'network lost — a real test reports this and the later recovery'))
window.addEventListener('online', () =>
  logEvent('connectivity_online', 'network restored'))

// --- Audio playback — same one-clip-at-a-time console as the real player.
// Play counts are tallied and shown (tick marks + an "N plays" label, plus
// the local event log above), same visual cue the examiner console gives —
// but here it is purely a training aid: nothing gates Next, nothing warns
// with a modal, nothing is reported.
const playCounts = new Map<string, number>()
let masterVolume = 1
const allAudios: HTMLAudioElement[] = []
let activeAudio: HTMLAudioElement | null = null
let clipRegistry: { audio: HTMLAudioElement; playBtn: HTMLButtonElement; pauseBtn: HTMLButtonElement; stopBtn: HTMLButtonElement; indicator: HTMLElement }[] = []

function refreshClipButtons() {
  for (const c of clipRegistry) {
    const isActive = c.audio === activeAudio
    c.playBtn.disabled = activeAudio !== null
    c.pauseBtn.disabled = !isActive
    c.stopBtn.disabled = !isActive
    c.pauseBtn.textContent = isActive && c.audio.paused ? 'Resume' : 'Pause'
    c.indicator.classList.toggle('playing', isActive && !c.audio.paused)
    c.indicator.classList.toggle('paused', isActive && c.audio.paused)
  }
}

const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null
volumeSlider?.addEventListener('input', () => {
  masterVolume = Number(volumeSlider.value) / 100
  allAudios.forEach(a => { a.volume = masterVolume })
})
// Log on 'change' (pointer released), not every 'input' tick, so one
// adjustment is one line.
volumeSlider?.addEventListener('change', () =>
  logEvent('volume_changed', `master volume ${Math.round(masterVolume * 100)}%`))

function createAudioControls(clip: { label: string; url: string; maxPlays?: number }): HTMLElement {
  const audio = new Audio(clip.url)
  audio.volume = masterVolume
  allAudios.push(audio)

  const wrap = document.createElement('div')
  wrap.className = 'audio-controls'

  const indicator = document.createElement('span')
  indicator.className = 'audio-indicator'

  const label = document.createElement('span')
  label.className = 'audio-label'
  label.textContent = clip.label

  const ticksLabel = document.createElement('span')
  ticksLabel.className = 'audio-ticks'

  const countLabel = document.createElement('span')
  countLabel.className = 'audio-count'

  function updateCount() {
    const count = playCounts.get(clip.url) ?? 0
    countLabel.textContent = clip.maxPlays ? `${count}/${clip.maxPlays} plays` : `${count} plays`
    const ticks = '✓'.repeat(Math.min(count, 2))
    ticksLabel.textContent = count > 2 ? `${ticks} ❗` : ticks
    ticksLabel.classList.toggle('audio-exclaim', count > 2)
  }

  const playBtn = document.createElement('button')
  playBtn.textContent = '▶ Play'
  playBtn.addEventListener('click', () => {
    if (activeAudio !== null) return
    audio.currentTime = 0
    audio.play()
    activeAudio = audio
    const attempt = (playCounts.get(clip.url) ?? 0) + 1
    logEvent('audio_play', `"${clip.label}" — attempt ${attempt}${clip.maxPlays ? ` of ${clip.maxPlays} allowed` : ''}`)
    refreshClipButtons()
  })

  const pauseBtn = document.createElement('button')
  pauseBtn.textContent = 'Pause'
  pauseBtn.addEventListener('click', () => {
    if (activeAudio !== audio) return
    if (audio.paused) { audio.play(); logEvent('audio_resumed', `"${clip.label}" at ${formatTime(audio.currentTime)}`) }
    else { audio.pause(); logEvent('audio_paused', `"${clip.label}" at ${formatTime(audio.currentTime)}`) }
    refreshClipButtons()
  })

  const stopBtn = document.createElement('button')
  stopBtn.textContent = 'Stop'
  stopBtn.addEventListener('click', () => {
    if (activeAudio !== audio) return
    logEvent('audio_stopped', `"${clip.label}" at ${formatTime(audio.currentTime)} — reset to start, does not count as a play`)
    audio.pause()
    audio.currentTime = 0
    activeAudio = null
    refreshClipButtons()
  })

  audio.addEventListener('ended', () => {
    const count = (playCounts.get(clip.url) ?? 0) + 1
    playCounts.set(clip.url, count)
    updateCount()
    logEvent('audio_ended', `"${clip.label}" played in full — ${count}${clip.maxPlays ? `/${clip.maxPlays}` : ''} play${count === 1 ? '' : 's'}`)
    if (clip.maxPlays && count > clip.maxPlays) {
      logEvent('audio_replay_limit', `"${clip.label}" played ${count} times (limit ${clip.maxPlays}) — a real test records this as a violation`)
    }
    if (activeAudio === audio) activeAudio = null
    refreshClipButtons()
  })

  updateCount()
  clipRegistry.push({ audio, playBtn, pauseBtn, stopBtn, indicator })
  wrap.append(indicator, label, playBtn, pauseBtn, stopBtn, ticksLabel, countLabel)
  return wrap
}

function renderTextAndAudio(content: HTMLElement, item: StorylineItem) {
  const text = item.examinerText ?? ''
  const clips = item.media?.audioClips ?? []
  const volumeClip = clips.find(c => c.label === 'Volume check')
  const mainClips = clips.filter(c => c.label !== 'Volume check')

  function appendText(segment: string) {
    // Trim per-segment: the {audio}/{volumeCheck} split leaves a trailing or
    // leading blank line on the pieces either side of a marker, which would
    // stack on top of the CSS gap around .audio-controls. Blank lines the
    // author put *inside* a segment are still preserved.
    const trimmed = segment.trim()
    if (!trimmed) return
    const div = document.createElement('div')
    div.className = 'slide-text'
    div.innerHTML = renderScriptText(trimmed)
    content.appendChild(div)
  }

  if (!text.includes('{audio}') && !text.includes('{volumeCheck}')) {
    appendText(text)
    const ordered = volumeClip ? [volumeClip, ...mainClips] : mainClips
    ordered.forEach(clip => content.appendChild(createAudioControls(clip)))
    return
  }

  const mainQueue = [...mainClips]
  for (const seg of text.split(/(\{audio\}|\{volumeCheck\})/g)) {
    if (seg === '{volumeCheck}') {
      if (volumeClip) content.appendChild(createAudioControls(volumeClip))
    } else if (seg === '{audio}') {
      const clip = mainQueue.shift()
      if (clip) content.appendChild(createAudioControls(clip))
    } else {
      appendText(seg)
    }
  }
  mainQueue.forEach(clip => content.appendChild(createAudioControls(clip)))
}

// --- Image zoom (click to pop out to near-full-size, click again/backdrop to collapse) ---
// This window only ever shows small reference thumbnails (same as the real
// examiner console) — the actual full-size images are on the candidate
// window (candidate.ts's .polaroid panels), same split as the real exam.
let zoomEl: HTMLElement | null = null

function closeZoom() {
  if (!zoomEl) return
  logEvent('image_zoom_closed', 'reference image returned to thumbnail')
  const el = zoomEl
  el.style.top = `${el.dataset.originTop}px`
  el.style.left = `${el.dataset.originLeft}px`
  el.style.width = `${el.dataset.originWidth}px`
  el.style.height = `${el.dataset.originHeight}px`
  document.getElementById('zoom-backdrop')?.remove()
  zoomEl = null
  window.setTimeout(() => el.remove(), 250)
}

function openZoom(source: HTMLImageElement) {
  if (zoomEl) return
  logEvent('image_zoomed', 'reference image enlarged')
  const rect = source.getBoundingClientRect()
  const clone = source.cloneNode(true) as HTMLImageElement
  clone.className = 'exam-zoom-clone'
  clone.style.top = `${rect.top}px`
  clone.style.left = `${rect.left}px`
  clone.style.width = `${rect.width}px`
  clone.style.height = `${rect.height}px`
  clone.dataset.originTop = String(rect.top)
  clone.dataset.originLeft = String(rect.left)
  clone.dataset.originWidth = String(rect.width)
  clone.dataset.originHeight = String(rect.height)
  clone.addEventListener('click', closeZoom)

  const backdrop = document.createElement('div')
  backdrop.className = 'exam-zoom-backdrop'
  backdrop.id = 'zoom-backdrop'
  backdrop.addEventListener('click', closeZoom)

  document.body.appendChild(backdrop)
  document.body.appendChild(clone)
  zoomEl = clone

  requestAnimationFrame(() => {
    const maxW = window.innerWidth * 0.85
    const maxH = window.innerHeight * 0.85
    const scale = Math.min(maxW / rect.width, maxH / rect.height, 4)
    const targetW = rect.width * scale
    const targetH = rect.height * scale
    clone.style.top = `${(window.innerHeight - targetH) / 2}px`
    clone.style.left = `${(window.innerWidth - targetW) / 2}px`
    clone.style.width = `${targetW}px`
    clone.style.height = `${targetH}px`
  })
}

function imageLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

// --- Preview content (an upcoming Part's topic/questions, shown ahead of time) ---
function renderPreviewContent(card: HTMLElement, entries: NonNullable<StorylineItem['previewContent']>) {
  let lastPartNumber: number | undefined
  for (const entry of entries) {
    if (entry.partNumber !== lastPartNumber) {
      lastPartNumber = entry.partNumber
      const heading = document.createElement('div')
      heading.className = 'preview-part-heading'
      heading.textContent = `Preview Part ${entry.partNumber}`
      card.appendChild(heading)
    }
    const block = document.createElement('div')
    block.className = 'preview-entry'
    if (entry.topic) {
      const p = document.createElement('p')
      p.className = 'preview-highlight preview-topic'
      p.innerHTML = `Topic: ${renderInlineMarkup(entry.topic)}`
      block.appendChild(p)
    }
    if (entry.questions?.length) {
      const ul = document.createElement('ul')
      ul.className = 'preview-questions'
      entry.questions.forEach(q => {
        const li = document.createElement('li')
        li.className = 'preview-highlight'
        li.innerHTML = renderInlineMarkup(q)
        ul.appendChild(li)
      })
      block.appendChild(ul)
    }
    card.appendChild(block)
  }
}

// --- Slide timer (purely informational — never gates navigation) ---
function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

let globalTimerStart: number | null = null
function tickGlobalTimer() {
  if (globalTimerStart === null) return
  const el = document.getElementById('global-timer')
  if (el) el.textContent = formatTime((Date.now() - globalTimerStart) / 1000)
}
function startGlobalTimer() {
  if (globalTimerStart !== null) return
  globalTimerStart = Date.now()
  const el = document.getElementById('global-timer')
  if (el) el.hidden = false
  logEvent('test_timer_started', 'overall session timer running')
  tickGlobalTimer()
  window.setInterval(tickGlobalTimer, 1000)
}

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
  logEvent('timer_started', `${phase.toLowerCase()} — ${seconds}s`)
  slideTimerHandle = window.setInterval(() => {
    slideTimerRemaining--
    if (slideTimerRemaining < 0) {
      window.clearInterval(slideTimerHandle)
      logEvent('timer_expired', phase.toLowerCase())
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

// --- Slide navigator ---
let sessionEnded = false

function setNavVisible(visible: boolean) {
  const nav = document.querySelector('.slide-nav') as HTMLElement | null
  if (nav) nav.style.display = visible ? '' : 'none'
}

// Every exported Practice zip is meant to be unpacked into its own
// subfolder one level under the shared home.html/index.html (see HOW-TO-
// PUBLISH.txt — e.g. lenguax.com/sample/Airline/story.html next to
// lenguax.com/sample/index.html), so "back to the index" is always exactly
// one level up, regardless of which folder this particular export ends up
// named.
const BACK_TO_INDEX_URL = '../index.html'

function endSession(message: string) {
  sessionEnded = true
  if (activeAudio) { activeAudio.pause(); activeAudio = null }
  closeZoom()
  const card = document.getElementById('slide-card')
  if (card) {
    card.innerHTML = ''
    card.classList.add('session-ended')
    const msg = document.createElement('div')
    msg.className = 'session-ended-message'
    msg.textContent = message
    card.appendChild(msg)

    const backLink = document.createElement('a')
    backLink.className = 'session-ended-back'
    backLink.href = BACK_TO_INDEX_URL
    backLink.textContent = '← Back to sample tests'
    card.appendChild(backLink)
  }
  setNavVisible(false)
  logEvent('session_end', 'a real test would now flush any buffered events and close the session record')
}

// The intro screen — branded blue/white, same treatment the real exam gives
// its pre-test screens (see BRANDED_KINDS), just showing which test this is
// rather than real accept/reject controls, which only mean something
// against a real booking.
function renderIntro(content: HTMLElement, item: StorylineItem) {
  if (item.testDisplayName) {
    const name = document.createElement('div')
    name.className = 'test-display-name'
    name.textContent = item.testDisplayName
    content.appendChild(name)
  }
  const note = document.createElement('div')
  note.className = 'practice-intro-note'
  note.textContent = "This is a sample test for practice — it isn't scored and nothing about this run is recorded. Click Next when you're ready to begin."
  content.appendChild(note)
}

function renderCurrentSlide() {
  if (sessionEnded) return
  const card = document.getElementById('slide-card')
  const progressLabel = document.getElementById('progress-label')
  const progressFill = document.getElementById('progress-fill') as HTMLElement | null
  const notesContent = document.getElementById('notes-content')
  if (!card) return

  if (items.length === 0) {
    card.textContent = 'No items in this version.'
    return
  }

  if (activeAudio) { activeAudio.pause(); activeAudio = null }
  clipRegistry = []
  closeZoom()

  const item = items[currentIndex]
  logEvent('slide_view', `${currentIndex + 1}/${items.length} — "${item.label || item.kind}" (${item.kind})`)

  if (progressLabel) progressLabel.textContent = `Slide ${currentIndex + 1}/${items.length}`
  if (progressFill) progressFill.style.width = `${((currentIndex + 1) / items.length) * 100}%`

  card.innerHTML = ''
  const branded = BRANDED_KINDS.has(item.kind)
  card.classList.toggle('branded', branded)

  let content: HTMLElement = card
  if (branded) {
    const logoStrip = document.createElement('div')
    logoStrip.className = 'branded-logo-strip'
    const logoImg = document.createElement('img')
    logoImg.src = teacLogo
    logoImg.alt = 'Test of English for Aeronautical Communication'
    logoStrip.appendChild(logoImg)
    card.appendChild(logoStrip)

    content = document.createElement('div')
    content.className = 'branded-content'
    card.appendChild(content)
  }

  if (item.kind === 'accept_reject_test') {
    // No item.label heading here — the admin-authored slide name (e.g.
    // "Accept/Reject") is meaningful to an examiner, not to a solo
    // practice-taker. renderIntro()'s testDisplayName already serves as
    // this screen's heading.
    renderIntro(content, item)
  } else {
    const heading = document.createElement('div')
    heading.className = 'slide-heading'
    heading.textContent = item.label
    content.appendChild(heading)
    renderTextAndAudio(content, item)
    if (item.previewContent?.length) renderPreviewContent(content, item.previewContent)

    const images = item.media?.images
    if (images?.length) {
      const thumbRow = document.createElement('div')
      thumbRow.className = 'exam-thumbs'
      images.forEach((url, i) => {
        const thumb = document.createElement('div')
        thumb.className = 'exam-thumb-wrap'
        const img = document.createElement('img')
        img.src = url
        img.alt = ''
        img.className = 'exam-thumb'
        img.addEventListener('click', () => openZoom(img))
        thumb.appendChild(img)
        if (images.length > 1) {
          const tag = document.createElement('span')
          tag.className = 'exam-thumb-label'
          tag.textContent = imageLabel(i)
          thumb.appendChild(tag)
        }
        thumbRow.appendChild(thumb)
      })
      content.appendChild(thumbRow)
    }
  }

  refreshClipButtons()
  setNavVisible(true)

  const isLast = currentIndex >= items.length - 1
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn) {
    nextBtn.disabled = false
    nextBtn.textContent = isLast ? '✓ Finish' : (item.nextButtonLabel || 'Next ▶')
    nextBtn.classList.toggle('next-btn-prominent', isLast || !!item.nextButtonLabel)
  }
  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement | null
  if (prevBtn) prevBtn.disabled = currentIndex === 0

  if (notesContent) notesContent.innerHTML = renderInlineMarkup(item.notes || 'No notes for this slide.')

  if (item.startsTestTimer) startGlobalTimer()
  startSlideTimer(item)
  sendAdvance(item)
}

document.getElementById('prev-btn')?.addEventListener('click', () => {
  if (sessionEnded || currentIndex === 0) return
  logEvent('navigate', 'back to previous slide')
  currentIndex--
  renderCurrentSlide()
})

document.getElementById('next-btn')?.addEventListener('click', () => {
  if (sessionEnded) return
  if (currentIndex >= items.length - 1) {
    logEvent('test_finished', 'reached the end of the test')
    endSession('Sample test complete — thanks for trying it out.')
    return
  }
  logEvent('navigate', 'forward to next slide')
  currentIndex++
  renderCurrentSlide()
})

loadTheme().then(applyTheme)

loadItems().then(loaded => {
  items = loaded.filter(item => !SKIPPED_KINDS.has(item.kind)).sort((a, b) => a.order - b.order)
  preloadAllMedia(items)
  logSessionStart()
  renderCurrentSlide()
}).catch(err => {
  const card = document.getElementById('slide-card')
  if (card) card.textContent = `Failed to load items: ${String(err)}`
})
