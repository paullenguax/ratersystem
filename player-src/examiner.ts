import type { StorylineItem, ChecklistItem } from './shared/types'
import { getParams, channelName } from './shared/session'
import { loadItems } from './shared/dataSource'
import { initOnlineStatusDot } from './shared/onlineStatus'
import teacLogo from './assets/teac-logo.png'

// The first few slides (accept/reject, test data, room-setup checklist) get
// the old system's branded look — a logo strip + a blue content block —
// since they're a one-time "getting set up" sequence, not the repeated
// per-Part flow the rest of the redesign deliberately kept plain/modern.
const BRANDED_KINDS = new Set(['accept_reject_test', 'test_data_confirm', 'admin_checklist'])

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
  updateCandidateStatus()
}

document.getElementById('open-candidate')?.addEventListener('click', openCandidateWindow)

// The candidate window can be closed by the examiner at any time (or
// crash/lose focus) with no reliable "closed" event to listen for across
// browsers, so this is polled rather than event-driven — matches the old
// system's "wait for the indicator to turn green" checklist instruction.
function updateCandidateStatus() {
  const btn = document.getElementById('candidate-status')
  if (!btn) return
  const open = !!candidateWindow && !candidateWindow.closed
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
      p.textContent = `Topic: ${entry.topic}`
      block.appendChild(p)
    }
    if (entry.questions?.length) {
      const ul = document.createElement('ul')
      ul.className = 'preview-questions'
      entry.questions.forEach(q => {
        const li = document.createElement('li')
        li.className = 'preview-highlight'
        li.textContent = q
        ul.appendChild(li)
      })
      block.appendChild(ul)
    }
    card.appendChild(block)
  }
}

// --- Live field substitution (Test Data confirm) ------------------------
// The Test Data confirm slide is filled in by the examiner live, during the
// session — a manual stand-in for what a real booking system will supply
// later (Phase 2). Unlike everything else, this can't be resolved ahead of
// time in resolveItems.ts, so it's a small bit of genuinely new runtime
// state, applied to examinerText at render time only (never mutates item).

let liveFields: { centreName?: string; testNumber?: string; examinerName?: string; candidateName?: string } = {}

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

function renderChecklist(container: HTMLElement, checklistItems: ChecklistItem[]) {
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

const TEST_DATA_FIELDS = [
  { id: 'td-centre', label: 'Centre Name' },
  { id: 'td-testnum', label: 'Test Number' },
  { id: 'td-examiner', label: 'Examiner Name' },
  { id: 'td-candidate', label: 'Candidate Name' },
]

function renderTestDataConfirm(card: HTMLElement) {
  const wrap = document.createElement('div')
  wrap.className = 'test-data-fields'
  for (const f of TEST_DATA_FIELDS) {
    const row = document.createElement('label')
    row.className = 'test-data-field'
    const span = document.createElement('span')
    span.textContent = f.label
    const input = document.createElement('input')
    input.type = 'text'
    input.id = f.id
    input.addEventListener('input', () => updateNavState())
    row.append(span, input)
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

function testDataValues() {
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? ''
  const agree = (document.getElementById('td-agree') as HTMLInputElement | null)?.checked ?? false
  return { centreName: get('td-centre'), testNumber: get('td-testnum'), examinerName: get('td-examiner'), candidateName: get('td-candidate'), agree }
}

function testDataComplete(): boolean {
  const v = testDataValues()
  return !!(v.centreName && v.testNumber && v.examinerName && v.candidateName && v.agree)
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
    endSession('Test rejected — session ended.')
  })

  row.append(acceptBtn, rejectBtn)
  card.appendChild(row)
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
  const checklistDone = !item?.checklistItems?.length || item.checklistItems.every((_, i) => checkedItems.has(i))
  const testDataDone = item?.kind !== 'test_data_confirm' || testDataComplete()
  const isLast = currentIndex >= items.length - 1
  // Preview mode lets an admin click through freely regardless of gating.
  nextBtn.disabled = isLast || (!isPreview && (!allPlayed || !checklistDone || !testDataDone))
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

  if (item.examinerText) {
    const text = document.createElement('div')
    text.className = 'slide-text'
    text.textContent = applyLiveFieldSubstitutions(item.examinerText)
    content.appendChild(text)
  }

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

  // The volume check (if any) is meant to happen before the scored
  // recording, so it's shown above the slide's other clip(s) regardless of
  // the order resolveItems.ts produced them in.
  const orderedClips = [...(item.media?.audioClips ?? [])].sort((a, b) => {
    const aFirst = a.label === 'Volume check' ? 0 : 1
    const bFirst = b.label === 'Volume check' ? 0 : 1
    return aFirst - bFirst
  })
  orderedClips.forEach(clip => {
    content.appendChild(createAudioControls(clip, () => { updateNavState() }))
  })
  refreshClipButtons()

  if (item.kind === 'accept_reject_test') {
    setNavVisible(false)
    renderAcceptReject(content, item)
  } else {
    setNavVisible(true)
  }

  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn) {
    nextBtn.textContent = item.nextButtonLabel || 'Next ▶'
    nextBtn.classList.toggle('next-btn-prominent', !!item.nextButtonLabel)
  }

  if (notesContent) notesContent.textContent = item.notes || 'No notes for this slide.'

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

document.getElementById('next-btn')?.addEventListener('click', () => {
  if (sessionEnded) return
  const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null
  if (nextBtn?.disabled || currentIndex >= items.length - 1) return
  const item = items[currentIndex]
  if (item.kind === 'test_data_confirm') {
    const v = testDataValues()
    liveFields = { centreName: v.centreName, testNumber: v.testNumber, examinerName: v.examinerName, candidateName: v.candidateName }
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

loadItems().then(loaded => {
  items = loaded
  renderCurrentSlide()
}).catch(err => {
  const card = document.getElementById('slide-card')
  if (card) card.textContent = `Failed to load items: ${String(err)}`
})
