import type { StorylineItem } from './shared/types'
import { loadItems, loadTheme } from './shared/dataSource'
import { applyTheme } from './shared/applyTheme'
import { renderInlineMarkup } from './shared/markup'
import { preloadAllMedia } from './shared/preloadMedia'

// Self-service practice/sample player — the third and simplest of the three
// player-src entry points (see examiner.ts/candidate.ts for the real,
// proctored exam pair). One person plays both roles alone, on one device,
// hearing audio through their own speakers instead of an examiner's. By
// design this reports nothing anywhere and calls no WordPress endpoint —
// no violation tracking, no completion/exposure reporting, no Next-button
// gating. All of that stays scoped to versions exported as Live/Backup (see
// StorylineVersion.versionType, exportStorylineVersion()) — this entry
// point, exported by exportStorylinePractice(), is purely static content
// playback for a version marked Practice.
//
// Slide kinds that only make sense inside a real proctored booking
// (accept/reject the test, confirm centre/examiner/candidate details, the
// examiner's private room-setup checklist) are dropped entirely rather than
// rendered inert — see SKIPPED_KINDS.
const SKIPPED_KINDS = new Set(['accept_reject_test', 'test_data_confirm', 'admin_checklist'])

let items: StorylineItem[] = []
let currentIndex = 0

// --- Audio playback — same one-clip-at-a-time console as the real player,
// minus play-count limits/warnings/logging: no reporting or gating here,
// so nothing needs to track how many times a clip was played.
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

function createAudioControls(clip: { label: string; url: string }): HTMLElement {
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

  const playBtn = document.createElement('button')
  playBtn.textContent = '▶ Play'
  playBtn.addEventListener('click', () => {
    if (activeAudio !== null) return
    audio.currentTime = 0
    audio.play()
    activeAudio = audio
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
    if (activeAudio === audio) activeAudio = null
    refreshClipButtons()
  })

  clipRegistry.push({ audio, playBtn, pauseBtn, stopBtn, indicator })
  wrap.append(indicator, label, playBtn, pauseBtn, stopBtn)
  return wrap
}

function renderTextAndAudio(content: HTMLElement, item: StorylineItem) {
  const text = item.examinerText ?? ''
  const clips = item.media?.audioClips ?? []
  const volumeClip = clips.find(c => c.label === 'Volume check')
  const mainClips = clips.filter(c => c.label !== 'Volume check')

  function appendText(segment: string) {
    if (!segment.trim()) return
    const div = document.createElement('div')
    div.className = 'slide-text'
    div.innerHTML = renderInlineMarkup(segment)
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

// --- Slide navigator ---
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
}

function renderCurrentSlide() {
  if (sessionEnded) return
  const card = document.getElementById('slide-card')
  const progressLabel = document.getElementById('progress-label')
  const progressFill = document.getElementById('progress-fill') as HTMLElement | null
  if (!card) return

  if (items.length === 0) {
    card.textContent = 'No items in this version.'
    return
  }

  if (activeAudio) { activeAudio.pause(); activeAudio = null }
  clipRegistry = []
  closeZoom()

  const item = items[currentIndex]

  if (progressLabel) progressLabel.textContent = `Slide ${currentIndex + 1}/${items.length}`
  if (progressFill) progressFill.style.width = `${((currentIndex + 1) / items.length) * 100}%`

  card.innerHTML = ''

  const heading = document.createElement('div')
  heading.className = 'slide-heading'
  heading.textContent = item.label
  card.appendChild(heading)

  renderTextAndAudio(card, item)

  if (item.previewContent?.length) renderPreviewContent(card, item.previewContent)

  const images = item.media?.images
  if (images?.length) {
    const thumbRow = document.createElement('div')
    thumbRow.className = 'practice-images'
    images.forEach((url, i) => {
      const thumb = document.createElement('div')
      thumb.className = 'practice-image-wrap'
      const img = document.createElement('img')
      img.src = url
      img.alt = ''
      img.className = 'practice-image'
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
    card.appendChild(thumbRow)
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

  if (item.startsTestTimer) startGlobalTimer()
  startSlideTimer(item)
}

document.getElementById('prev-btn')?.addEventListener('click', () => {
  if (sessionEnded || currentIndex === 0) return
  currentIndex--
  renderCurrentSlide()
})

document.getElementById('next-btn')?.addEventListener('click', () => {
  if (sessionEnded) return
  if (currentIndex >= items.length - 1) {
    endSession('Sample test complete — thanks for trying it out.')
    return
  }
  currentIndex++
  renderCurrentSlide()
})

loadTheme().then(applyTheme)

loadItems().then(loaded => {
  items = loaded.filter(item => !SKIPPED_KINDS.has(item.kind)).sort((a, b) => a.order - b.order)
  preloadAllMedia(items)
  renderCurrentSlide()
}).catch(err => {
  const card = document.getElementById('slide-card')
  if (card) card.textContent = `Failed to load items: ${String(err)}`
})
