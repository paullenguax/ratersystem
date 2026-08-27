import type { StorylineItem, ChecklistItem } from './shared/types'
import { getParams, channelName } from './shared/session'
import { loadItems, loadTheme, loadFlags, loadLiveText, applyLiveText } from './shared/dataSource'
import { applyTheme } from './shared/applyTheme'
import { initOnlineStatusDot } from './shared/onlineStatus'
import { renderInlineMarkup, renderScriptText } from './shared/markup'
import { preloadAllMedia } from './shared/preloadMedia'
import { reportStorylineEvent, type StorylineEventContext } from './shared/reportEvent'
import { callSendStats, callRejectTest } from './shared/wpCallback'
import teacLogo from './assets/teac-logo.png'

// The first few slides (accept/reject, test data, room-setup checklist) get
// the old system's branded look — a logo strip + a blue content block —
// since they're a one-time "getting set up" sequence, not the repeated
// per-Part flow the rest of the redesign deliberately kept plain/modern.
const BRANDED_KINDS = new Set(['accept_reject_test', 'test_data_confirm', 'admin_checklist'])

const { sessionId, isPreview, testNumber, centreName, examinerName, candidateName } = getParams()
// Set (if applicable) once loadFlags() resolves, before the first render —
// see the Promise.all in the boot sequence at the bottom of this file.
// Unlike isPreview, this does NOT affect violation/completion reporting or
// the Accept/Reject screen's session-lock — an ungated export may still be
// used with a real candidate (e.g. a backup version an admin wants faster
// to run through), unlike Preview, which is never real. It only relaxes
// the Next-button confirmation gating below (bypassesGating()).
let isUngated = false
function bypassesGating(): boolean {
  return isPreview || isUngated
}
const channel = new BroadcastChannel(channelName(sessionId))
let candidateWindow: Window | null = null
// "{test.name} — {version.versionLabel}" — the one item.testDisplayName is
// ever set on (the accept_reject_test slide) — captured once items load so
// completion/violation reports can identify which test they're about.
let testDisplayName: string | undefined

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
  updateCandidateStatus()
}

document.getElementById('open-candidate')?.addEventListener('click', openCandidateWindow)

// The candidate window can be closed by the examiner at any time (or
// crash/lose focus) with no reliable "closed" event to listen for across
// browsers, so this is polled rather than event-driven — matches the old
// system's "wait for the indicator to turn green" checklist instruction.
let candidateWasOpen = false

function updateCandidateStatus() {
  const open = !!candidateWindow && !candidateWindow.closed
  if (candidateWasOpen && !open && !isPreview) {
    reportStorylineEvent('violation', eventContext(), {
      subtype: 'candidate_window_closed',
      details: 'The candidate window closed during the session.',
    })
    logEvent('Violation reported: candidate window closed during the session.')
  }
  candidateWasOpen = open
  const btn = document.getElementById('candidate-status')
  if (!btn) return
  btn.classList.toggle('open', open)
  btn.title = open ? 'Candidate window open' : 'Candidate window closed — click to open'
}

function openOrFocusCandidateWindow() {
  if (candidateWindow && !candidateWindow.closed) candidateWindow.focus()
  else openCandidateWindow()
}

document.getElementById('candidate-status')?.addEventListener('click', openOrFocusCandidateWindow)

window.setInterval(updateCandidateStatus, 1000)
updateCandidateStatus()

// Timestamped event log, visible in the examiner window — mirrors the old
// system's footer log. Purely local/visual — reportStorylineEvent() below
// is the actual backend write, for the specific subset of events worth a
// violation/completion record; this log shows every event regardless.
function logEvent(message: string) {
  const list = document.getElementById('event-log')
  if (!list) return
  const time = new Date().toLocaleTimeString()
  const li = document.createElement('li')
  li.textContent = `[${time}] ${message}`
  list.insertBefore(li, list.firstChild)
}

function eventContext(): StorylineEventContext {
  return {
    testDisplayName,
    centreName: liveFields.centreName,
    testNumber: liveFields.testNumber,
    examinerName: liveFields.examinerName,
    candidateName: liveFields.candidateName,
  }
}

// The first ('offline') report almost certainly fails to reach our Cloud
// Function — there's no connectivity to send it over, that's the whole
// point — but it's fired anyway on the off chance of a flaky-not-fully-
// down connection. The second ('online') report, once connectivity is
// actually back, is far more likely to succeed and carries how long the
// drop lasted, so at least one useful record usually gets through even
// though the outage it describes is exactly what could stop it arriving.
let offlineSince: number | null = null
window.addEventListener('offline', () => {
  offlineSince = Date.now()
  if (isPreview) return
  reportStorylineEvent('violation', eventContext(), {
    subtype: 'connectivity_dropped',
    details: 'Internet connectivity was lost during the session.',
  })
  logEvent('Violation reported: internet connectivity lost.')
})
window.addEventListener('online', () => {
  if (offlineSince === null) return
  const downForSeconds = Math.round((Date.now() - offlineSince) / 1000)
  offlineSince = null
  if (isPreview) return
  reportStorylineEvent('violation', eventContext(), {
    subtype: 'connectivity_dropped',
    details: `Internet connectivity was restored after approximately ${downForSeconds}s offline.`,
  })
  logEvent(`Internet connectivity restored after ~${downForSeconds}s offline.`)
})

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
// single-room setup). Only one clip may be active at a time across the
// whole console: starting one disables every other Play button until it's
// explicitly Stopped (or finishes on its own) — pausing does not free the
// slot. Soft lock: past maxPlays it still plays, just warns and logs it —
// never blocks. `onComplete` fires once a clip finishes (not on click) so
// the caller can re-check whether Next should now be enabled.
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

function createAudioControls(clip: { label: string; url: string; maxPlays?: number }, onComplete: () => void): HTMLElement {
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
    logEvent(`Started "${clip.label}".`)
    refreshClipButtons()
  })

  const pauseBtn = document.createElement('button')
  pauseBtn.textContent = 'Pause'
  pauseBtn.addEventListener('click', () => {
    if (activeAudio !== audio) return
    if (audio.paused) audio.play()
    else audio.pause()
    refreshClipButtons()
  })

  const stopBtn = document.createElement('button')
  stopBtn.textContent = 'Stop'
  stopBtn.addEventListener('click', () => {
    if (activeAudio !== audio) return
    audio.pause()
    audio.currentTime = 0
    activeAudio = null
    refreshClipButtons()
  })

  audio.addEventListener('ended', () => {
    const count = (playCounts.get(clip.url) ?? 0) + 1
    playCounts.set(clip.url, count)
    updateCount()
    if (clip.maxPlays && count > clip.maxPlays) {
      window.alert(`"${clip.label}" has now been played ${count} times (limit: ${clip.maxPlays}). This has been logged.`)
      logEvent(`Played "${clip.label}" beyond its limit (${count}/${clip.maxPlays}).`)
      if (!isPreview) {
        reportStorylineEvent('violation', eventContext(), {
          subtype: 'audio_replay_limit',
          details: `"${clip.label}" was played ${count} times (limit: ${clip.maxPlays}).`,
        })
      }
    } else {
      logEvent(`Played "${clip.label}" to completion (${count}${clip.maxPlays ? '/' + clip.maxPlays : ''}).`)
    }
    if (activeAudio === audio) activeAudio = null
    refreshClipButtons()
    onComplete()
  })

  updateCount()
  clipRegistry.push({ audio, playBtn, pauseBtn, stopBtn, indicator })
  wrap.append(indicator, label, playBtn, pauseBtn, stopBtn, ticksLabel, countLabel)
  return wrap
}

// --- Image zoom (click a thumbnail to pop it out to full size, click ------
// again — or the backdrop — to collapse it back to where it was). Animates
// a fixed-position clone from the thumbnail's own on-screen rect out to a
// centered, near-full-viewport size, and reverses the same rect on close,
// so it visibly "returns" to its origin rather than just disappearing.
let zoomEl: HTMLElement | null = null

function closeZoom() {
  if (!zoomEl) return
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

// A, B, C… labels for multi-image slides (e.g. Part 4's two pictures) so
// everyone can unambiguously refer to "picture A" vs "picture B".
function imageLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

// Renders a slide's script text and its audio clip(s) together. By default
// (no markers) it's the old behavior — one text block, then every clip
// after it (volume check first). But an author can place literal `{audio}`/
// `{volumeCheck}` tokens in scriptText to interleave a clip's controls at
// an exact point (e.g. "We will first check the volume:\n{volumeCheck}\n\n
// How is the volume?" before the scored recording) — these tokens are
// never touched by resolveItems.ts, so they arrive here as plain text.
function renderTextAndAudio(content: HTMLElement, item: StorylineItem, onComplete: () => void) {
  const text = applyLiveFieldSubstitutions(item.examinerText ?? '')
  const clips = item.media?.audioClips ?? []
  const volumeClip = clips.find(c => c.label === 'Volume check')
  const mainClips = clips.filter(c => c.label !== 'Volume check')

  function appendText(segment: string) {
    if (!segment.trim()) return
    const div = document.createElement('div')
    div.className = 'slide-text'
    div.innerHTML = renderScriptText(segment)
    content.appendChild(div)
  }

  if (!text.includes('{audio}') && !text.includes('{volumeCheck}')) {
    appendText(text)
    const ordered = volumeClip ? [volumeClip, ...mainClips] : mainClips
    ordered.forEach(clip => content.appendChild(createAudioControls(clip, onComplete)))
    return
  }

  const mainQueue = [...mainClips]
  for (const seg of text.split(/(\{audio\}|\{volumeCheck\})/g)) {
    if (seg === '{volumeCheck}') {
      if (volumeClip) content.appendChild(createAudioControls(volumeClip, onComplete))
    } else if (seg === '{audio}') {
      const clip = mainQueue.shift()
      if (clip) content.appendChild(createAudioControls(clip, onComplete))
    } else {
      appendText(seg)
    }
  }
  // Any main clip not placed by a marker (e.g. more recordings than
  // {audio} tokens used) still needs to appear, rather than being dropped.
  mainQueue.forEach(clip => content.appendChild(createAudioControls(clip, onComplete)))
}

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
      p.className = 'preview-highlight'
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

// --- Live field substitution (Test Data confirm) ------------------------
// Sourced directly from the real WP booking-accept flow's own launch URL
// (tc/in/cn/id — see getParams() in session.ts for exactly where these
// come from and why they're already trustworthy by the time this code
// runs). Known at boot, not something the examiner enters — the Test Data
// Confirm slide (renderTestDataConfirm()) just displays these read-only,
// as a "is this the right candidate/test" sanity check, matching the old
// Storyline system's equivalent screen exactly. Undefined in Preview mode
// (no real booking behind a preview) — renderTestDataConfirm() shows "—"
// for whichever fields are missing rather than crashing or showing
// "undefined".

const liveFields = { centreName, testNumber, examinerName, candidateName }

function applyLiveFieldSubstitutions(text: string): string {
  const subs: Record<string, string> = {
    '{Centre Name}': liveFields.centreName ?? '{Centre Name}',
    '{Test Number}': liveFields.testNumber ?? '{Test Number}',
    '{Examiner Name}': liveFields.examinerName ?? '{Examiner Name}',
    '{Candidate Name}': liveFields.candidateName ?? '{Candidate Name}',
    '{Date}': new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
  let result = text
  for (const [token, value] of Object.entries(subs)) result = result.split(token).join(value)
  return result
}

// --- Checklist gating (admin_checklist slides with checklistItems) ------

let checkedItems = new Set<number>()

// The checklist's speaker button plays whichever clip is labeled "Volume
// check" anywhere in the resolved version (see slotSpec.volumeCheck) — the
// same clip Part 2 uses later, not a separate upload for the checklist.
function findVolumeCheckUrl(): string | undefined {
  for (const it of items) {
    const clip = it.media?.audioClips?.find(c => c.label === 'Volume check')
    if (clip) return clip.url
  }
  return undefined
}

// checklistItems used to be string[] before per-item icons existed — an
// already-published Version or exported zip built before that change still
// has plain strings baked into its snapshot, even though resolveItems.ts
// now normalizes fresh data. Defend here too rather than assume every
// StorylineItem the player ever loads went through today's resolveItems.ts.
function renderChecklist(container: HTMLElement, rawItems: (string | ChecklistItem)[]) {
  const checklistItems = rawItems.map(item => (typeof item === 'string' ? { text: item } : item))
  const wrap = document.createElement('div')
  wrap.className = 'checklist'
  checklistItems.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = 'checklist-item'

    const label = document.createElement('label')
    label.className = 'checklist-item-label'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.addEventListener('change', () => {
      if (box.checked) checkedItems.add(i)
      else checkedItems.delete(i)
      updateNavState()
    })
    const span = document.createElement('span')
    span.textContent = item.text
    label.append(box, span)
    row.appendChild(label)

    if (item.icon === 'screen') {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'checklist-action'
      btn.textContent = '🖥'
      btn.title = 'Open/focus the candidate window'
      btn.addEventListener('click', openOrFocusCandidateWindow)
      row.appendChild(btn)
    } else if (item.icon === 'speaker') {
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
        btn.title = 'No volume check clip uploaded yet (set one on Part 2’s "Section 1 recording" slide)'
      }
      row.appendChild(btn)
    }

    wrap.appendChild(row)
  })
  container.appendChild(wrap)
}

// --- Test Data confirm ---------------------------------------------------
// Read-only display of liveFields (sourced from the real booking's launch
// URL, see getParams()) — a "John from the waiting room wandering into
// Bob's test" sanity check, not a spelling-correction step (that's a
// separate paperwork process) and not something the examiner types in, so
// unlike every other slide's gating, the only thing to actually confirm
// here is the agree-to-terms checkbox.

const TEST_DATA_FIELDS = [
  { label: 'Centre Name', value: () => liveFields.centreName },
  { label: 'Test Number', value: () => liveFields.testNumber },
  { label: 'Examiner Name', value: () => liveFields.examinerName },
  { label: 'Candidate Name', value: () => liveFields.candidateName },
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
    // Undefined only in Preview (no real booking behind it) — never shown
    // as "undefined".
    value.textContent = f.value() || '—'
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

function testDataComplete(): boolean {
  return (document.getElementById('td-agree') as HTMLInputElement | null)?.checked ?? false
}

// --- Accept/Reject test ---------------------------------------------------

let sessionEnded = false

function setNavVisible(visible: boolean) {
  const nav = document.querySelector('.slide-nav') as HTMLElement | null
  if (nav) nav.style.display = visible ? '' : 'none'
}

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
  }
  setNavVisible(false)
  logEvent(message)
}

function renderAcceptReject(card: HTMLElement, item: StorylineItem) {
  if (item.testDisplayName) {
    const name = document.createElement('div')
    name.className = 'test-display-name'
    name.textContent = item.testDisplayName
    card.appendChild(name)
  }
  const row = document.createElement('div')
  row.className = 'accept-reject-buttons'

  const acceptBtn = document.createElement('button')
  acceptBtn.type = 'button'
  acceptBtn.className = 'accept-btn'
  acceptBtn.textContent = '✓ Accept this Test'
  acceptBtn.addEventListener('click', () => {
    if (currentIndex >= items.length - 1) return
    currentIndex++
    renderCurrentSlide()
  })

  const rejectBtn = document.createElement('button')
  rejectBtn.type = 'button'
  rejectBtn.className = 'reject-btn'
  rejectBtn.textContent = '✕ Reject this Test'
  rejectBtn.addEventListener('click', () => {
    if (!window.confirm('Reject this test? This will end the session.')) return
    if (isPreview) {
      logEvent('Test rejected (Preview mode — session not locked).')
      return
    }
    reportStorylineEvent('violation', eventContext(), {
      subtype: 'test_rejected',
      details: 'The examiner rejected this test before completion.',
    })
    callRejectTest({
      tt: '', tv: testDisplayName ?? '',
      ce: liveFields.centreName ?? '', tn: liveFields.testNumber ?? '', in: liveFields.examinerName ?? '',
      rr: 'Rejected by examiner',
    })
    endSession('Test rejected — session ended.')
  })

  row.append(acceptBtn, rejectBtn)
  card.appendChild(row)
}

// --- Slide navigator --------------------------------------------------

let items: StorylineItem[] = []
let currentIndex = 0

// Slides with no candidateState of their own (accept/reject, test data,
// room setup, previews) send this so the candidate window falls back to the
// TEAC logo rather than lingering on the previous slide's panel — see
// candidate.ts's BRAND_STATE.
const CANDIDATE_BRAND_STATE = '__brand__'

function sendAdvance(item: StorylineItem) {
  const state = item.candidateState || CANDIDATE_BRAND_STATE
  if (candidateWindow && !candidateWindow.closed) {
    channel.postMessage({ type: 'advance', candidateState: state })
    logEvent(`Advanced candidate screen to "${state}".`)
  } else {
    logEvent(`Candidate window is not open — "${state}" was not shown.`)
  }
}

// The candidate page only ever gets shown a state when it's told to
// `advance` — which examiner.ts only sends on slide transitions. Opening
// (or reopening) the candidate window mid-slide previously left it blank
// until the *next* Next/Prev click, since nothing re-sent the state of the
// slide already on screen. Candidate.ts posts `ready` once its panels are
// built (on first load and on every reopen) — reply with the current
// slide's state directly over the channel rather than gating on the
// examiner's own `candidateWindow` reference, which the message itself
// already proves is live.
channel.onmessage = event => {
  const data = event.data as { type: string }
  if (data?.type !== 'ready') return
  const item = items[currentIndex]
  const state = item?.candidateState || CANDIDATE_BRAND_STATE
  channel.postMessage({ type: 'advance', candidateState: state })
  logEvent(`Candidate window connected — resent "${state}".`)
}

function updateNavState() {
  const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement | null
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (!prevBtn || !nextBtn) return
  prevBtn.disabled = currentIndex === 0
  const item = items[currentIndex]
  const clips = item?.media?.audioClips ?? []
  const allPlayed = clips.every(c => (playCounts.get(c.url) ?? 0) > 0)
  const checklistDone = !item?.checklistItems?.length || item.checklistItems.every((_, i) => checkedItems.has(i))
  const testDataDone = item?.kind !== 'test_data_confirm' || testDataComplete()
  // Preview mode (and an ungated Version, see bypassesGating()) lets the
  // examiner click through freely regardless of gating. The last slide
  // still respects gating (e.g. a closing slide's audio must finish
  // playing) but is no longer unconditionally disabled — Next becomes
  // "Finish test" there instead of stopping dead, see
  // renderCurrentSlide()/finishTest().
  nextBtn.disabled = !bypassesGating() && (!allPlayed || !checklistDone || !testDataDone)
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

  // Never let audio bleed across a slide transition.
  if (activeAudio) { activeAudio.pause(); activeAudio = null }
  clipRegistry = []
  closeZoom()
  checkedItems = new Set()

  const item = items[currentIndex]

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

  const heading = document.createElement('div')
  heading.className = 'slide-heading'
  heading.textContent = item.label
  content.appendChild(heading)

  renderTextAndAudio(content, item, () => { updateNavState() })

  if (item.previewContent?.length) renderPreviewContent(content, item.previewContent)
  if (item.checklistItems?.length) renderChecklist(content, item.checklistItems)
  if (item.kind === 'test_data_confirm') renderTestDataConfirm(content)

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

  refreshClipButtons()

  if (item.kind === 'accept_reject_test') {
    setNavVisible(false)
    renderAcceptReject(content, item)
  } else {
    setNavVisible(true)
  }

  const isLast = currentIndex >= items.length - 1
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn) {
    nextBtn.textContent = isLast ? '✓ Finish test' : (item.nextButtonLabel || 'Next ▶')
    nextBtn.classList.toggle('next-btn-prominent', isLast || !!item.nextButtonLabel)
  }

  if (notesContent) notesContent.innerHTML = renderInlineMarkup(item.notes || 'No notes for this slide.')

  if (item.startsTestTimer) startGlobalTimer()
  startSlideTimer(item)
  sendAdvance(item)
  updateNavState()
}

document.getElementById('prev-btn')?.addEventListener('click', () => {
  if (sessionEnded || currentIndex === 0) return
  currentIndex--
  renderCurrentSlide()
})

// Reached only once the current slide is the last one — no more slides to
// advance to. Preview keeps its "free exploration, nothing real fires"
// posture (matching Reject's preview behavior): just logs, doesn't call
// out to anything or lock the session, since there's no real candidate.
function finishTest() {
  if (isPreview) {
    logEvent('Test finished (Preview mode — no report sent, session not locked).')
    return
  }
  reportStorylineEvent('completed', eventContext())
  callSendStats({
    tt: '', tv: testDisplayName ?? '',
    ce: liveFields.centreName ?? '', tn: liveFields.testNumber ?? '',
    in: liveFields.examinerName ?? '', cn: liveFields.candidateName ?? '',
  })
  endSession('Test completed.')
}

document.getElementById('next-btn')?.addEventListener('click', () => {
  if (sessionEnded) return
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn?.disabled) return
  if (currentIndex >= items.length - 1) {
    finishTest()
    return
  }
  currentIndex++
  renderCurrentSlide()
})

document.getElementById('notes-toggle')?.addEventListener('click', () => {
  document.getElementById('notes-drawer')?.classList.toggle('open')
})
document.getElementById('notes-close')?.addEventListener('click', () => {
  document.getElementById('notes-drawer')?.classList.remove('open')
})

loadTheme().then(applyTheme)

function showUngatedBadge() {
  const header = document.querySelector('.exam-header')
  if (!header) return
  const badge = document.createElement('span')
  badge.className = 'ungated-badge'
  badge.textContent = 'UNGATED — confirmation gating skipped'
  header.appendChild(badge)
}

// Flags load in parallel with items — both need to be settled before the
// first render, since updateNavState() (called from renderCurrentSlide())
// reads isUngated. Theme is independent of rendering (just CSS custom
// properties) so it stays a separate fire-and-forget above. The live-text
// fetch (Live-typed Versions only, see flags.liveContentId) happens after
// flags/items resolve, since it needs flags.liveContentId — it's the only
// variable-latency step here (loadFlags/loadItems are same-origin static
// fetches), bounded by loadLiveText()'s own internal timeout so a slow or
// unreachable live-content endpoint never meaningfully delays exam start.
Promise.all([loadFlags(), loadItems()]).then(async ([flags, loaded]) => {
  isUngated = !!flags.ungated
  if (isUngated) showUngatedBadge()
  const liveText = await loadLiveText(flags.liveContentId)
  items = applyLiveText(loaded, liveText)
  testDisplayName = items.find(i => i.kind === 'accept_reject_test')?.testDisplayName
  preloadAllMedia(items)
  renderCurrentSlide()
}).catch(err => {
  const card = document.getElementById('slide-card')
  if (card) card.textContent = `Failed to load items: ${String(err)}`
})
