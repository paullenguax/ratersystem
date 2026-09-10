import type { StorylineItem, CandidateInstructionLine } from './shared/types'
import { getParams, channelName } from './shared/session'
import { loadItems } from './shared/dataSource'
import { initOnlineStatusDot } from './shared/onlineStatus'
import { renderInlineMarkup } from './shared/markup'
import { applyMediaBlobs } from './shared/preloadMedia'
import teacLogo from './assets/teac-logo.png'

const { sessionId } = getParams()
const channel = new BroadcastChannel(channelName(sessionId))

const statusDot = document.getElementById('internet-status')
if (statusDot) initOnlineStatusDot(statusDot)

function panelId(candidateState: string): string {
  return `panel-${candidateState.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

// Shown on first load and whenever the current slide has no candidate-facing
// state of its own — the accept/reject, test-data, room-setup and preview
// slides send no `advance` at all, so without this the candidate window sat
// blank (just the status dot) until the first real Part slide. The logo
// straight away is reassuring for the candidate.
const BRAND_STATE = '__brand__'

function buildInstructions(lines: CandidateInstructionLine[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'candidate-instructions'
  let list: HTMLUListElement | null = null
  for (const line of lines) {
    // A line written wholly in `[ … ]` is a secondary "how to do the task"
    // note (e.g. "[ Take notes to explain the details. ]") — set it apart
    // from the prompts it follows with an indent (see .candidate-instruction-note).
    const isNote = /^\s*\[[\s\S]*\]\s*$/.test(line.text)
    if (line.bullet) {
      if (!list) {
        list = document.createElement('ul')
        wrap.appendChild(list)
      }
      const li = document.createElement('li')
      li.innerHTML = renderInlineMarkup(line.text)
      if (isNote) li.className = 'candidate-instruction-note'
      if (line.color) li.style.color = line.color
      list.appendChild(li)
    } else {
      list = null
      const p = document.createElement('p')
      p.innerHTML = renderInlineMarkup(line.text)
      if (isNote) p.className = 'candidate-instruction-note'
      if (line.color) p.style.color = line.color
      wrap.appendChild(p)
    }
  }
  return wrap
}

function renderPanels(items: StorylineItem[]) {
  const container = document.getElementById('panels')
  if (!container) return
  container.innerHTML = ''

  // Several slides can share one candidateState (e.g. Part 3's four
  // sub-slides all stay on "Task3") — group them so exactly one panel per
  // state is created, picking whichever item in the group actually has
  // content to show, rather than stacking duplicate panels at the same
  // fixed position.
  const groups = new Map<string, StorylineItem[]>()
  for (const item of items) {
    if (!item.candidateState) continue
    const group = groups.get(item.candidateState) ?? []
    group.push(item)
    groups.set(item.candidateState, group)
  }

  for (const [state, group] of groups) {
    const representative = group.find(i => i.media?.images?.length || i.candidateInstructions?.length) ?? group[0]

    const panel = document.createElement('div')
    panel.className = 'polaroid'
    panel.id = panelId(state)

    const images = representative.media?.images
    if (images && images.length > 0) {
      const imageRow = document.createElement('div')
      imageRow.className = 'image-row'
      images.forEach((url, i) => {
        const cell = document.createElement('div')
        cell.className = 'image-cell'
        const img = document.createElement('img')
        img.src = url
        img.alt = state
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
    }

    if (representative.candidateInstructions?.length) {
      panel.appendChild(buildInstructions(representative.candidateInstructions))
    } else if (!images || images.length === 0) {
      // Nothing to show for this state (instructions, preamble, closing) —
      // show the brand logo rather than the internal candidateState key,
      // which candidates were never meant to see.
      const logo = document.createElement('img')
      logo.src = teacLogo
      logo.alt = 'Test of English for Aeronautical Communication'
      logo.className = 'candidate-logo'
      panel.appendChild(logo)
    }

    // Audio plays from the examiner's own console (same room, one set of
    // speakers) — see examiner.ts. The candidate screen only ever shows
    // images/text.

    container.appendChild(panel)
  }

  // Always-present brand panel — the fallback whenever the current slide
  // has no panel of its own (see showState).
  const brand = document.createElement('div')
  brand.className = 'polaroid'
  brand.id = panelId(BRAND_STATE)
  const brandLogo = document.createElement('img')
  brandLogo.src = teacLogo
  brandLogo.alt = 'Test of English for Aeronautical Communication'
  brandLogo.className = 'candidate-logo'
  brand.appendChild(brandLogo)
  container.appendChild(brand)

  // Show the logo straight away, before the examiner sends any state.
  showState(BRAND_STATE)

  // Fit instruction text once layout has settled.
  requestAnimationFrame(fitInstructionsPanels)
}

function showState(candidateState: string) {
  const panels = document.querySelectorAll<HTMLElement>('#panels .polaroid')
  let targetId = panelId(candidateState)
  // A state with no panel of its own (or an empty/unknown state) falls back
  // to the brand panel rather than leaving the window blank.
  if (!document.getElementById(targetId)) targetId = panelId(BRAND_STATE)
  panels.forEach(panel => {
    panel.style.visibility = panel.id === targetId ? 'visible' : 'hidden'
  })
}

// Size each instruction block to the largest font that still fits its panel
// whole — so a long Part 3 list on a small secondary screen isn't clipped,
// and a short prompt on a big screen still fills the space. Binary search on
// px; the panel is always window-sized (position: fixed; inset: 0) even
// while hidden, so every panel can be measured up front. `.candidate-
// instructions` is `max-*: 100%; overflow: hidden`, so scroll* > client*
// means it's overflowing.
function fitInstructionsPanels() {
  document.querySelectorAll<HTMLElement>('#panels .polaroid').forEach(panel => {
    const box = panel.querySelector<HTMLElement>('.candidate-instructions')
    if (!box) return
    const fits = () =>
      box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1
    let lo = 14
    let hi = 96
    box.style.fontSize = `${hi}px`
    if (fits()) return
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      box.style.fontSize = `${mid}px`
      if (fits()) lo = mid
      else hi = mid
    }
    box.style.fontSize = `${lo}px`
  })
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(fitInstructionsPanels, 150)
})

let loadedItems: StorylineItem[] = []
let lastState = BRAND_STATE

channel.onmessage = event => {
  const data = event.data as { type: string; candidateState?: string; blobs?: Map<string, Blob> }
  if (data?.type === 'advance' && data.candidateState) {
    lastState = data.candidateState
    showState(data.candidateState)
  } else if (data?.type === 'media' && data.blobs) {
    // The examiner has cached every recording/picture and pushed the whole
    // set here — swap the panels over to those local copies so this window
    // needs no network for the rest of the test either.
    applyMediaBlobs(loadedItems, data.blobs)
    renderPanels(loadedItems)
    showState(lastState)
  }
}

loadItems().then(items => {
  loadedItems = items
  renderPanels(items)
  // Announces readiness on first load and on every reopen (a fresh
  // page load either way) — examiner.ts replies with whatever state the
  // current slide should be showing, plus the cached media set, so a
  // (re)opened window never sits blank and never needs to fetch.
  channel.postMessage({ type: 'ready' })
}).catch(err => {
  const container = document.getElementById('panels')
  if (container) container.textContent = `Failed to load items: ${String(err)}`
})
