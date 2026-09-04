import type { StorylineItem, ChecklistItem } from './shared/types'
import { channelName } from './shared/session'
import { loadItems, loadTheme, loadFlags } from './shared/dataSource'
import { applyTheme } from './shared/applyTheme'
import { renderInlineMarkup, renderScriptText } from './shared/markup'
import { preloadMediaToBlobs, applyMediaBlobs } from './shared/preloadMedia'
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
// Skipped in a normal Practice export — booking-only screens that mean
// nothing without a real proctored sitting. A *training run* (flags.json
// { trainingRun: true }, written by the "Export training run" button on a
// Practice version) keeps them, gated, so an interlocutor rehearses the
// whole flow — see trainingRun below.
const SKIPPED_KINDS = new Set(['test_data_confirm', 'admin_checklist'])
const BRANDED_KINDS = new Set(['accept_reject_test', 'test_data_confirm', 'admin_checklist'])

// Set once flags.json resolves, before the first render. A training run
// dresses the sample player up to feel like a real Live sitting: the
// pre-test screens are shown and must be completed, recordings must play
// to the end before Next, the booking identity is pre-filled, and the
// event log opens by default to make the point that a real test records
// all of this. Still entirely local — nothing is sent or stored, no
// WordPress calls — exactly like any Practice export.
let trainingRun = false

// Baked booking identity for a training run — a real Live test gets these
// from WordPress before the examiner sits down, so they are pre-filled
// here too rather than typed on the day.
const TRAINING_FIELDS = {
  candidateName: 'SALLY SMITH',
  centreName: 'Lenguax Centre',
  testNumber: 'SAMPLE 001',
  examinerName: 'SAMPLE INTERLOCUTOR',
}

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

// Notes are docked and shown by default (see practice.html / .notes-panel).
// "Hide Notes" collapses the panel and restores the header "Notes" button.
const examShell = document.querySelector('.examiner-shell')
document.getElementById('notes-toggle')?.addEventListener('click', () => {
  examShell?.classList.remove('notes-hidden')
  logEvent('notes_opened', 'interlocutor notes panel')
})
document.getElementById('notes-close')?.addEventListener('click', () => {
  examShell?.classList.add('notes-hidden')
  logEvent('notes_closed', 'interlocutor notes panel')
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

// --- Offline media guarantee (same as the real player) ----------------
// Every recording/picture is fetched into memory before the test can
// start, and the whole set is pushed to the candidate window — so once
// "START TEST" unlocks, losing the connection can't stop a Part 3
// recording or Part 4 picture appearing.
let mediaState: 'loading' | 'partial' | 'ready' = 'loading'
let mediaBlobs = new Map<string, Blob>()
let mediaFailed: string[] = []
let startWaived = false
let mediaOriginals: (StorylineItem['media'] | undefined)[] = []

function renderMediaPreloadBanner(done: number, total: number) {
  const el = document.getElementById('media-preload')
  if (!el) return
  if (mediaState === 'ready') { el.hidden = true; return }
  el.hidden = false
  el.className = mediaState === 'partial' ? 'media-preload media-preload-warn' : 'media-preload'
  el.replaceChildren()
  if (mediaState === 'loading') {
    el.textContent = `Caching test media so it can't be lost mid-test… ${done}/${total}`
    return
  }
  const msg = document.createElement('span')
  msg.textContent = `⚠ ${mediaFailed.length} media file(s) could not be cached. If the connection drops mid-test those slides may not load. `
  const retry = document.createElement('button')
  retry.textContent = 'Retry'
  retry.addEventListener('click', () => { void runMediaPreload() })
  const waive = document.createElement('button')
  waive.textContent = 'Start without them'
  waive.addEventListener('click', () => {
    startWaived = true
    logEvent('media_preload_waived', `${mediaFailed.length} file(s) not cached`)
    el.hidden = true
    renderCurrentSlide()
  })
  el.append(msg, retry, document.createTextNode(' '), waive)
}

async function runMediaPreload() {
  if (!mediaOriginals.length) {
    mediaOriginals = items.map(it => (it.media ? structuredClone(it.media) : undefined))
  } else {
    items.forEach((it, i) => {
      if (mediaOriginals[i]) it.media = structuredClone(mediaOriginals[i]!)
    })
  }
  mediaState = 'loading'
  renderMediaPreloadBanner(0, 0)
  renderCurrentSlide()
  const res = await preloadMediaToBlobs(items, (d, t) => renderMediaPreloadBanner(d, t))
  mediaBlobs = res.blobs
  mediaFailed = res.failed
  mediaState = res.failed.length ? 'partial' : 'ready'
  applyMediaBlobs(items, mediaBlobs)
  logEvent(mediaState === 'ready' ? 'media_cached' : 'media_cached_partial', `${mediaBlobs.size} file(s) in memory${mediaFailed.length ? `, ${mediaFailed.length} failed` : ''}`)
  renderMediaPreloadBanner(0, 0)
  pushMediaToCandidate()
  renderCurrentSlide()
}

function pushMediaToCandidate() {
  if (mediaBlobs.size) channel.postMessage({ type: 'media', blobs: mediaBlobs })
}

function mediaGateBlocks(item: StorylineItem): boolean {
  return !!item.startsTestTimer && mediaState !== 'ready' && !startWaived
}

// candidate.ts posts `ready` on first load and on every reopen — reply with
// whatever state the current slide should be showing so a (re)opened
// window never sits blank, plus the cached media set. Same pattern as
// examiner.ts.
channel.onmessage = event => {
  const data = event.data as { type: string }
  if (data?.type !== 'ready') return
  pushMediaToCandidate()
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

// --- Audio playback — same one-clip-at-a-time console as the real player,
// including the identical play counter + soft lock: a clip only shows a
// counter when it carries a maxPlays (resolveItems sets it on the real
// response recordings only — never a volume check, Part 3 example, or set
// intro), and at the limit Play greys out until "↻ Play again" re-arms one
// more play. Here it's purely a training aid — nothing is reported.
const playCounts = new Map<string, number>()
let masterVolume = 1
const allAudios: HTMLAudioElement[] = []
let activeAudio: HTMLAudioElement | null = null
let clipRegistry: { sync: () => void }[] = []

function refreshClipButtons() {
  for (const c of clipRegistry) c.sync()
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

function createAudioControls(
  clip: { label: string; url: string; maxPlays?: number },
  onComplete?: () => void,
): HTMLElement {
  const audio = new Audio(clip.url)
  audio.volume = masterVolume
  allAudios.push(audio)

  const limit = clip.maxPlays                       // undefined => free replay, no counter
  let overrideArmed = false

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

  const playBtn = document.createElement('button')
  playBtn.textContent = '▶ Play'
  const pauseBtn = document.createElement('button')
  pauseBtn.textContent = 'Pause'
  const stopBtn = document.createElement('button')
  stopBtn.textContent = 'Stop'

  // Just the ↻ glyph, no label — the override isn't something to advertise.
  const againBtn = document.createElement('button')
  againBtn.className = 'audio-again'
  againBtn.textContent = '↻'
  againBtn.title = 'This recording has reached its play limit. In a real test, playing it again is recorded.'
  againBtn.setAttribute('aria-label', 'Play this recording again (recorded)')

  const atLimit = () => limit !== undefined && (playCounts.get(clip.url) ?? 0) >= limit

  function sync() {
    const isActive = audio === activeAudio
    playBtn.disabled = activeAudio !== null || (atLimit() && !overrideArmed)
    pauseBtn.disabled = !isActive
    stopBtn.disabled = !isActive
    pauseBtn.textContent = isActive && audio.paused ? 'Resume' : 'Pause'
    indicator.classList.toggle('playing', isActive && !audio.paused)
    indicator.classList.toggle('paused', isActive && audio.paused)
    if (limit !== undefined) {
      const count = playCounts.get(clip.url) ?? 0
      countLabel.textContent = `${count}/${limit} plays`
      const over = count > limit
      ticksLabel.textContent = `${'✓'.repeat(Math.min(count, limit))}${over ? ' ❗' : ''}`
      ticksLabel.classList.toggle('audio-exclaim', over)
      playBtn.classList.toggle('audio-locked', atLimit() && !overrideArmed && activeAudio === null)
      againBtn.hidden = !atLimit() || overrideArmed || activeAudio !== null
    }
  }

  playBtn.addEventListener('click', () => {
    if (activeAudio !== null) return
    if (atLimit() && !overrideArmed) return
    overrideArmed = false
    audio.currentTime = 0
    audio.play()
    activeAudio = audio
    const attempt = (playCounts.get(clip.url) ?? 0) + 1
    logEvent('audio_play', `"${clip.label}" — attempt ${attempt}${limit !== undefined ? ` of ${limit} allowed` : ''}`)
    refreshClipButtons()
  })

  pauseBtn.addEventListener('click', () => {
    if (activeAudio !== audio) return
    if (audio.paused) { audio.play(); logEvent('audio_resumed', `"${clip.label}" at ${formatTime(audio.currentTime)}`) }
    else { audio.pause(); logEvent('audio_paused', `"${clip.label}" at ${formatTime(audio.currentTime)}`) }
    refreshClipButtons()
  })

  stopBtn.addEventListener('click', () => {
    if (activeAudio !== audio) return
    logEvent('audio_stopped', `"${clip.label}" at ${formatTime(audio.currentTime)} — reset to start, does not count as a play`)
    audio.pause()
    audio.currentTime = 0
    activeAudio = null
    refreshClipButtons()
  })

  againBtn.addEventListener('click', () => {
    if (!atLimit()) return
    overrideArmed = true
    const count = playCounts.get(clip.url) ?? 0
    logEvent('audio_replay_limit', `"${clip.label}" re-enabled past its ${limit}-play limit (was ${count}/${limit}) — a real test records this as a violation`)
    refreshClipButtons()
  })

  audio.addEventListener('ended', () => {
    const count = (playCounts.get(clip.url) ?? 0) + 1
    playCounts.set(clip.url, count)
    logEvent('audio_ended', `"${clip.label}" played in full — ${count}${limit !== undefined ? `/${limit}` : ''} play${count === 1 ? '' : 's'}`)
    if (activeAudio === audio) activeAudio = null
    refreshClipButtons()
    onComplete?.()
  })

  clipRegistry.push({ sync })
  wrap.append(indicator, label, playBtn, pauseBtn, stopBtn)
  if (limit !== undefined) wrap.append(ticksLabel, countLabel, againBtn)
  sync()
  return wrap
}

// In a training run only: fill the {Centre Name}/{Test Number}/{Examiner
// Name}/{Candidate Name}/{Date} script tokens from the baked identity, the
// same way examiner.ts fills them from the real booking. A plain Practice
// run leaves the tokens untouched (its sample content rarely uses them).
function applyTrainingFields(text: string): string {
  if (!trainingRun) return text
  const subs: Record<string, string> = {
    '{Centre Name}': TRAINING_FIELDS.centreName,
    '{Test Number}': TRAINING_FIELDS.testNumber,
    '{Examiner Name}': TRAINING_FIELDS.examinerName,
    '{Candidate Name}': TRAINING_FIELDS.candidateName,
    '{Date}': new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
  let out = text
  for (const [token, value] of Object.entries(subs)) out = out.split(token).join(value)
  return out
}

function renderTextAndAudio(content: HTMLElement, item: StorylineItem) {
  const text = applyTrainingFields(item.examinerText ?? '')
  const clips = item.media?.audioClips ?? []
  const volumeClip = clips.find(c => c.label === 'Volume check')
  const mainClips = clips.filter(c => c.label !== 'Volume check')
  const onClipDone = () => updateNavState()

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
    ordered.forEach(clip => content.appendChild(createAudioControls(clip, onClipDone)))
    return
  }

  const mainQueue = [...mainClips]
  for (const seg of text.split(/(\{audio\}|\{volumeCheck\})/g)) {
    if (seg === '{volumeCheck}') {
      if (volumeClip) content.appendChild(createAudioControls(volumeClip, onClipDone))
    } else if (seg === '{audio}') {
      const clip = mainQueue.shift()
      if (clip) content.appendChild(createAudioControls(clip, onClipDone))
    } else {
      appendText(seg)
    }
  }
  mainQueue.forEach(clip => content.appendChild(createAudioControls(clip, onClipDone)))
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

// --- Per-Part elapsed timer (count-up, restarts when the Part changes) ---
// Only Parts 1 and 4 — the open-ended conversational Parts. Parts 2 and 3
// run on fixed recordings with their own play limits, no paced budget.
const TIMED_PARTS = new Set([1, 4])
let partTimerStart: number | null = null
let partTimerNumber: number | null = null
let partTimerTicking = false
function tickPartTimer() {
  const el = document.getElementById('part-timer')
  if (!el || partTimerStart === null) return
  el.textContent = `Part ${partTimerNumber} · ${formatTime((Date.now() - partTimerStart) / 1000)}`
}
function updatePartTimer(partNumber: number | undefined) {
  const el = document.getElementById('part-timer')
  if (!el) return
  if (!partNumber || !TIMED_PARTS.has(partNumber)) {
    partTimerStart = null
    partTimerNumber = null
    el.hidden = true
    return
  }
  if (partNumber !== partTimerNumber) {
    partTimerNumber = partNumber
    partTimerStart = Date.now()
    logEvent('part_timer_started', `Part ${partNumber} elapsed clock running`)
  }
  el.hidden = false
  tickPartTimer()
  if (!partTimerTicking) {
    partTimerTicking = true
    window.setInterval(tickPartTimer, 1000)
  }
}

// --- Per-phase duration ----------------------------------------------
// Mirrors examiner.ts: how long the sitting spent in each phase —
// Pre-test, Introduction, Part 1–4, Closing — logged on the way out.
// examiner.ts also sends this as a `phase_duration` telemetry event; here
// it is only a log line, like everything else in this player.
function phaseLabelFor(item: StorylineItem): string {
  if (item.partNumber) return `Part ${item.partNumber}`
  if (item.kind === 'closing') return 'Closing'
  if (item.kind === 'instruction') return 'Introduction'
  return 'Pre-test'
}
let phaseLabel: string | null = null
let phaseStartedAt = 0
function flushPhase() {
  if (phaseLabel === null) return
  const seconds = Math.round((Date.now() - phaseStartedAt) / 1000)
  if (seconds > 0) logEvent('phase_duration', `${phaseLabel} took ${formatTime(seconds)}`)
  phaseLabel = null
}
function enterPhase(item: StorylineItem) {
  const label = phaseLabelFor(item)
  if (label === phaseLabel) return
  flushPhase()
  phaseLabel = label
  phaseStartedAt = Date.now()
}

// --- Per-slide prep/response countdown — manual ▶ Start / ↻ Reset -------
let slideTimerHandle: number | undefined
let slideTimerRemaining = 0
let pendingTiming: StorylineItem['timing'] | null = null

function clearSlideTimer() {
  if (slideTimerHandle !== undefined) window.clearInterval(slideTimerHandle)
  slideTimerHandle = undefined
  pendingTiming = null
  const el = document.getElementById('slide-timer')
  if (el) {
    el.hidden = true
    el.classList.remove('exam-timer-done', 'exam-timer-ready')
  }
  const btn = document.getElementById('slide-timer-btn') as HTMLButtonElement | null
  if (btn) {
    btn.hidden = true
    btn.dataset.state = 'ready'
  }
}
// Prep = fixed countdown (candidate preparing); red at 00:00.
function runPrepCountdown(seconds: number, then?: () => void) {
  slideTimerRemaining = seconds
  const el = document.getElementById('slide-timer')
  if (!el) return
  el.hidden = false
  el.classList.remove('exam-timer-done', 'exam-timer-ready')
  el.textContent = `Prep ${formatTime(slideTimerRemaining)}`
  logEvent('timer_started', `prep — ${seconds}s`)
  slideTimerHandle = window.setInterval(() => {
    slideTimerRemaining--
    if (slideTimerRemaining < 0) {
      window.clearInterval(slideTimerHandle)
      logEvent('timer_expired', 'prep')
      if (then) {
        then()
      } else {
        el.textContent = 'Prep 00:00'
        el.classList.add('exam-timer-done')
      }
      return
    }
    el.textContent = `Prep ${formatTime(slideTimerRemaining)}`
  }, 1000)
}
// Response = counts UP (elapsed speaking time), keeps running past the
// limit; goes red once it passes `limitSeconds`.
function runResponseCountUp(limitSeconds: number) {
  let elapsed = 0
  const el = document.getElementById('slide-timer')
  if (!el) return
  el.hidden = false
  el.classList.remove('exam-timer-done', 'exam-timer-ready')
  el.textContent = `Response ${formatTime(0)}`
  logEvent('timer_started', `response — soft limit ${limitSeconds}s, counting up`)
  slideTimerHandle = window.setInterval(() => {
    elapsed++
    el.textContent = `Response ${formatTime(elapsed)}`
    if (elapsed === limitSeconds) logEvent('timer_limit_reached', `response passed ${limitSeconds}s`)
    if (elapsed >= limitSeconds) el.classList.add('exam-timer-done')
  }, 1000)
}
function startPendingSlideTimer() {
  const { prepSeconds, responseSeconds } = pendingTiming ?? {}
  if (prepSeconds) {
    runPrepCountdown(prepSeconds, responseSeconds ? () => runResponseCountUp(responseSeconds) : undefined)
  } else if (responseSeconds) {
    runResponseCountUp(responseSeconds)
  }
}
function prepareSlideTimer(item: StorylineItem) {
  clearSlideTimer()
  const { prepSeconds, responseSeconds } = item.timing ?? {}
  if (!prepSeconds && !responseSeconds) return
  pendingTiming = item.timing ?? null
  const el = document.getElementById('slide-timer')
  if (el) {
    el.hidden = false
    el.classList.add('exam-timer-ready')
    el.textContent = prepSeconds ? `Prep ${formatTime(prepSeconds)}` : `Response ${formatTime(0)}`
  }
  const btn = document.getElementById('slide-timer-btn') as HTMLButtonElement | null
  if (btn) {
    btn.hidden = false
    btn.dataset.state = 'ready'
    btn.textContent = '▶ Start'
  }
}
document.getElementById('slide-timer-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('slide-timer-btn') as HTMLButtonElement | null
  if (!btn) return
  if (btn.dataset.state === 'ready') {
    startPendingSlideTimer()
    btn.dataset.state = 'running'
    btn.textContent = '↻ Reset'
  } else {
    prepareSlideTimer(items[currentIndex])
  }
})

// --- Slide navigator ---
let sessionEnded = false

function setNavVisible(visible: boolean) {
  const nav = document.querySelector('.slide-nav') as HTMLElement | null
  if (nav) nav.style.display = visible ? '' : 'none'
}

// --- Training-run gating (all no-ops unless trainingRun) ---------------
// Ticked room-setup items and audio slides that have been explicitly
// skipped-without-playing. checkedItems is rebuilt per render (fresh DOM);
// skipArmed persists so a slide skipped once stays passable if revisited.
let checkedItems = new Set<number>()
const skipArmed = new Set<number>()

function testDataComplete(): boolean {
  return (document.getElementById('td-agree') as HTMLInputElement | null)?.checked ?? false
}

function audioGateBlocks(item: StorylineItem): boolean {
  if (!trainingRun) return false
  if (item.kind !== 'audio_response' && item.kind !== 'audio_set') return false
  if (skipArmed.has(currentIndex)) return false
  const clips = item.media?.audioClips ?? []
  return clips.length > 0 && !clips.every(c => (playCounts.get(c.url) ?? 0) > 0)
}

function updateNavState() {
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement | null
  if (prevBtn) prevBtn.disabled = currentIndex === 0
  if (!nextBtn) return
  const item = items[currentIndex]
  if (!item) { nextBtn.disabled = true; return }

  let blocked = mediaGateBlocks(item)
  if (trainingRun && !blocked) {
    if (item.kind === 'test_data_confirm' && !testDataComplete()) blocked = true
    else if (item.checklistItems?.length && !item.checklistItems.every((_, i) => checkedItems.has(i))) blocked = true
    else if (audioGateBlocks(item)) blocked = true
  }
  nextBtn.disabled = blocked
}

// --- Training-run pre-test screens (ported from examiner.ts, minus the
// telemetry and the real WordPress reject call — this player reports
// nothing anywhere) ---------------------------------------------------
function findVolumeCheckUrl(): string | undefined {
  for (const it of items) {
    const clip = it.media?.audioClips?.find(c => c.label === 'Volume check')
    if (clip) return clip.url
  }
  return undefined
}

function renderChecklist(container: HTMLElement, rawItems: (string | ChecklistItem)[]) {
  const checklistItems = rawItems.map(it => (typeof it === 'string' ? { text: it } : it))
  const wrap = document.createElement('div')
  wrap.className = 'checklist'
  checklistItems.forEach((it, i) => {
    const row = document.createElement('div')
    row.className = 'checklist-item'
    const label = document.createElement('label')
    label.className = 'checklist-item-label'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.addEventListener('change', () => {
      if (box.checked) checkedItems.add(i)
      else checkedItems.delete(i)
      logEvent('checklist_item_toggled', `${box.checked ? 'ticked' : 'unticked'} "${it.text}"`)
      updateNavState()
    })
    const span = document.createElement('span')
    span.textContent = it.text
    label.append(box, span)
    row.appendChild(label)
    if (it.icon === 'screen') {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'checklist-action'
      btn.textContent = '🖥'
      btn.title = 'Open/focus the candidate window'
      btn.addEventListener('click', openOrFocusCandidateWindow)
      row.appendChild(btn)
    } else if (it.icon === 'speaker') {
      const url = findVolumeCheckUrl()
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'checklist-action'
      btn.textContent = '🔊'
      if (url) {
        btn.title = 'Play the volume check clip'
        btn.addEventListener('click', () => {
          const audio = new Audio(url)
          audio.volume = masterVolume
          audio.play()
        })
      } else {
        btn.disabled = true
        btn.title = 'No volume check clip in this version'
      }
      row.appendChild(btn)
    }
    wrap.appendChild(row)
  })
  container.appendChild(wrap)
}

const TEST_DATA_FIELDS = [
  { label: 'Centre Name', value: TRAINING_FIELDS.centreName },
  { label: 'Test Number', value: TRAINING_FIELDS.testNumber },
  { label: 'Examiner Name', value: TRAINING_FIELDS.examinerName },
  { label: 'Candidate Name', value: TRAINING_FIELDS.candidateName },
]

function renderTestDataConfirm(card: HTMLElement) {
  const wrap = document.createElement('div')
  wrap.className = 'test-data-fields'
  for (const f of TEST_DATA_FIELDS) {
    const row = document.createElement('div')
    row.className = 'test-data-field'
    const span = document.createElement('span')
    span.textContent = f.label
    const value = document.createElement('strong')
    value.textContent = f.value || '—'
    row.append(span, value)
    wrap.appendChild(row)
  }
  const agreeRow = document.createElement('label')
  agreeRow.className = 'test-data-agree'
  const agreeBox = document.createElement('input')
  agreeBox.type = 'checkbox'
  agreeBox.id = 'td-agree'
  agreeBox.addEventListener('change', () => updateNavState())
  const agreeSpan = document.createElement('span')
  agreeSpan.textContent = 'I agree to abide by Lenguax terms.'
  agreeRow.append(agreeBox, agreeSpan)
  wrap.appendChild(agreeRow)
  card.appendChild(wrap)
}

function renderAcceptReject(card: HTMLElement, item: StorylineItem) {
  if (item.testDisplayName) {
    const name = document.createElement('div')
    name.className = 'test-display-name'
    name.textContent = item.testDisplayName
    card.appendChild(name)
  }
  const note = document.createElement('div')
  note.className = 'practice-intro-note'
  note.textContent =
    'Training run — a sample sitting. Nothing here is scored or recorded, but every action is shown in the event log below, exactly as a real test would record it.'
  card.appendChild(note)

  const row = document.createElement('div')
  row.className = 'accept-reject-buttons'
  const acceptBtn = document.createElement('button')
  acceptBtn.type = 'button'
  acceptBtn.className = 'accept-btn'
  acceptBtn.textContent = '✓ Accept this Test'
  acceptBtn.addEventListener('click', () => {
    if (currentIndex >= items.length - 1) return
    logEvent('test_accepted', 'examiner accepted the test')
    currentIndex++
    renderCurrentSlide()
  })
  const rejectBtn = document.createElement('button')
  rejectBtn.type = 'button'
  rejectBtn.className = 'reject-btn'
  rejectBtn.textContent = '✕ Reject this Test'
  rejectBtn.addEventListener('click', () => {
    if (!window.confirm('Reject this test? This will end the session.')) return
    logEvent('test_rejected', 'examiner rejected the test before completion — a real test emails the centre and compliance')
    endSession('Test rejected — session ended.')
  })
  row.append(acceptBtn, rejectBtn)
  card.appendChild(row)
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
  flushPhase()
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

    // Training runs aren't one of the candidate-facing tests on the public
    // board — this session shouldn't route back there (and the folder it
    // lives in isn't necessarily even linked from it). A plain Practice
    // sample keeps the link.
    if (!trainingRun) {
      const backLink = document.createElement('a')
      backLink.className = 'session-ended-back'
      backLink.href = BACK_TO_INDEX_URL
      backLink.textContent = '← Back to sample tests'
      card.appendChild(backLink)
    }
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
  checkedItems = new Set()

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
    // practice-taker. Both renderers use testDisplayName as the heading.
    // A training run shows the real Accept/Reject controls (they mean
    // something once the whole pre-test flow is being rehearsed); a plain
    // Practice run keeps the non-interactive intro.
    if (trainingRun) renderAcceptReject(content, item)
    else renderIntro(content, item)
  } else {
    const heading = document.createElement('div')
    heading.className = 'slide-heading'
    heading.textContent = item.label
    content.appendChild(heading)
    renderTextAndAudio(content, item)
    if (item.previewContent?.length) renderPreviewContent(content, item.previewContent)
    // Booking-only screens — only reached in a training run (SKIPPED_KINDS
    // filters them out of a plain Practice export).
    if (item.kind === 'test_data_confirm') renderTestDataConfirm(content)
    if (item.checklistItems?.length) renderChecklist(content, item.checklistItems)

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

  // Training run: on an audio slide still waiting on a recording, offer a
  // working escape hatch — it advances, and says plainly in the log that a
  // real test would not have allowed it.
  if (audioGateBlocks(item)) {
    const skip = document.createElement('button')
    skip.type = 'button'
    skip.className = 'audio-skip'
    skip.textContent = 'Skip without playing every recording'
    skip.addEventListener('click', () => {
      skipArmed.add(currentIndex)
      logEvent('audio_gate_skipped', `advanced past "${item.label}" without playing every recording — a real test does not allow this`)
      skip.disabled = true
      updateNavState()
    })
    content.appendChild(skip)
  }

  refreshClipButtons()
  setNavVisible(!(trainingRun && item.kind === 'accept_reject_test'))

  const isLast = currentIndex >= items.length - 1
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn) {
    nextBtn.textContent = isLast ? '✓ Finish' : (item.nextButtonLabel || 'Next ▶')
    nextBtn.classList.toggle('next-btn-prominent', isLast || !!item.nextButtonLabel)
  }

  if (notesContent) notesContent.innerHTML = renderInlineMarkup(item.notes || 'No notes for this slide.')

  if (item.startsTestTimer) startGlobalTimer()
  updatePartTimer(item.partNumber)
  enterPhase(item)
  prepareSlideTimer(item)
  sendAdvance(item)
  updateNavState()
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
    endSession(trainingRun ? 'Training run complete.' : 'Sample test complete — thanks for trying it out.')
    return
  }
  logEvent('navigate', 'forward to next slide')
  currentIndex++
  renderCurrentSlide()
})

loadTheme().then(applyTheme)

// A training run opens the event log by default and sharpens the summary —
// the point is that a real sitting records every line of it.
function applyTrainingChrome() {
  const panel = document.querySelector('.log-panel')
  if (!panel) return
  panel.setAttribute('open', '')
  const summary = panel.querySelector('summary')
  if (summary) summary.textContent = 'Event log — everything you do is recorded. This training run isn’t saved; a real test is.'
}

Promise.all([loadFlags(), loadItems()]).then(([flags, loaded]) => {
  trainingRun = !!flags.trainingRun
  if (trainingRun) applyTrainingChrome()
  const skipped = trainingRun ? new Set<string>() : SKIPPED_KINDS
  items = loaded.filter(item => !skipped.has(item.kind)).sort((a, b) => a.order - b.order)
  logSessionStart()
  renderCurrentSlide()
  void runMediaPreload()
}).catch(err => {
  const card = document.getElementById('slide-card')
  if (card) card.textContent = `Failed to load items: ${String(err)}`
})
