import type { TemplateSlide, StorylineSlotContent, StorylineItem, StorylinePartFragment, StorylinePartNumber, ChecklistItem } from './types'
import { deriveComboImages, type ComboImageResult } from './deriveComboImages'

// Ported from src/features/storyline/resolveItems.ts — keep in sync (also
// keep functions/resolveItems.js, a third plain-JS port used by
// getStorylineLiveContent, in sync with both).
// Player-src stays a fully self-contained TypeScript project, see types.ts.
// The only real difference from the original: `parts` here is keyed to the
// lighter StorylinePartFragment (just slotContent, fetched from a Part's
// exported part.json) instead of the full authoring StorylinePart — the
// player has no use for id/label/status/theme/etc.

function normalizeChecklistItems(items: (string | ChecklistItem)[] | undefined): ChecklistItem[] | undefined {
  return items?.map(item => (typeof item === 'string' ? { text: item } : item))
}

function substituteVariables(text: string, variables?: Record<string, string>): string {
  if (!variables) return text
  let result = text
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(`[${key}]`).join(value)
  }
  return result
}

function formatQuestions(questions?: string[]): string {
  if (!questions || questions.length === 0) return ''
  return questions.map(q => `- ${q}`).join('\n')
}

function resolveScriptText(slide: TemplateSlide, testVariables: Record<string, string> | undefined, slot?: StorylineSlotContent): string {
  let text = substituteVariables(slide.scriptText, testVariables)
  if (slide.slotSpec.topic) {
    text = text.includes('{topic}') ? text.replace('{topic}', slot?.topic ?? '') : text
  }
  if (slide.slotSpec.questions) {
    const questionsBlock = formatQuestions(slot?.questions)
    text = text.includes('{questions}')
      ? text.replace('{questions}', questionsBlock ? `\n${questionsBlock}\n` : '')
      : [text, questionsBlock].filter(Boolean).join('\n')
  }
  return text
}

function slidePreviewEntry(slide: TemplateSlide, slot?: StorylineSlotContent): { label: string; topic?: string; questions?: string[] } | undefined {
  const topic = slide.slotSpec.topic ? slot?.topic : undefined
  const questions = slide.slotSpec.questions ? slot?.questions?.filter(Boolean) : undefined
  if (!topic && !questions?.length) return undefined
  // Keep in sync with src/features/storyline/resolveItems.ts — that copy
  // omits undefined-valued optional fields rather than assigning them
  // explicitly, since its output gets written straight to Firestore via
  // updateDoc() (which rejects a literal undefined field value). Not load-
  // bearing here (this copy's output only ever feeds JSON/DOM rendering,
  // never a Firestore write), kept identical anyway per the file's own
  // "keep in sync" contract.
  const entry: { label: string; topic?: string; questions?: string[] } = { label: slide.label }
  if (topic) entry.topic = topic
  if (questions?.length) entry.questions = questions
  return entry
}

type PreviewEntry = { label: string; topic?: string; questions?: string[]; partNumber: StorylinePartNumber }

function resolveMedia(slide: TemplateSlide, slot?: StorylineSlotContent): StorylineItem['media'] {
  const images = slot?.images?.filter(Boolean)
  const audioClips: { label: string; url: string; maxPlays?: number }[] = []
  const maxPlays = slide.slotSpec.maxPlays

  const maxPlaysField = maxPlays !== undefined ? { maxPlays } : {}
  if (slide.slotSpec.audio === 'single' && slot?.audio?.recordings?.[0]) {
    audioClips.push({ label: slide.label, url: slot.audio.recordings[0], ...maxPlaysField })
  }
  if (slide.slotSpec.audio === 'set') {
    // The set's intro clip is a "here's what a recording sounds like"
    // primer — free to replay, so it never carries the per-recording
    // maxPlays. Only the numbered recordings below are play-limited.
    if (slot?.audio?.intro) audioClips.push({ label: 'Introduction', url: slot.audio.intro })
    slot?.audio?.recordings?.forEach((url, i) => {
      if (url) audioClips.push({ label: `Recording ${i + 1}`, url, ...maxPlaysField })
    })
  }
  // Volume check and (above) the set intro are reference audio — no
  // maxPlays, so the player shows them with no counter and no lock.
  if (slide.slotSpec.volumeCheck && slot?.audio?.volumeCheck) {
    audioClips.push({ label: 'Volume check', url: slot.audio.volumeCheck })
  }

  const media: NonNullable<StorylineItem['media']> = {}
  if (images && images.length > 0) media.images = images
  if (audioClips.length > 0) media.audioClips = audioClips
  return Object.keys(media).length > 0 ? media : undefined
}

// Merges the shared script template with a test's whole-test slot fills and
// the 4 assigned Parts' slot fills into the resolved StorylineItem[] shape
// the player renders. Called client-side at player boot, once the 4
// assigned Part IDs are known (see dataSource.ts) — the same computation
// src/features/storyline/resolveItems.ts does in the admin app for Preview
// and (whole-test-only) Publish, just run here against real candidate
// Part data instead of a hand-picked Version's.
export function resolveItems(
  slides: TemplateSlide[],
  testVariables: Record<string, string> | undefined,
  testSlotContent: Record<string, StorylineSlotContent>,
  parts: Partial<Record<StorylinePartNumber, StorylinePartFragment>>,
  testDisplayName?: string,
): StorylineItem[] {
  const sorted = [...slides].sort((a, b) => a.order - b.order)

  function slotFor(slide: TemplateSlide): StorylineSlotContent | undefined {
    return slide.partNumber ? parts[slide.partNumber]?.slotContent[slide.id] : testSlotContent[slide.id]
  }

  const wholeTestCombo = deriveComboImages(
    sorted.filter(s => !s.partNumber),
    id => testSlotContent[id]?.images?.[0],
  )
  const partCombos: Partial<Record<StorylinePartNumber, Record<string, ComboImageResult>>> = {}
  for (const n of [1, 2, 3, 4] as StorylinePartNumber[]) {
    const part = parts[n]
    partCombos[n] = deriveComboImages(
      sorted.filter(s => s.partNumber === n),
      id => part?.slotContent[id]?.images?.[0],
    )
  }

  const previewByPart: Partial<Record<StorylinePartNumber, PreviewEntry[]>> = {}
  for (const slide of sorted) {
    if (!slide.partNumber || slide.previewExclude) continue
    const entry = slidePreviewEntry(slide, slotFor(slide))
    if (entry) (previewByPart[slide.partNumber] ??= []).push({ ...entry, partNumber: slide.partNumber })
  }

  return sorted.map(slide => {
    const slot = slotFor(slide)
    const item: StorylineItem = {
      id: slide.id,
      order: slide.order,
      kind: slide.kind,
      label: slide.label,
      candidateState: slide.candidateState ?? '',
      examinerText: resolveScriptText(slide, testVariables, slot),
    }
    if (slide.notes) item.notes = substituteVariables(slide.notes, testVariables)
    if (slide.candidateInstructions?.length) {
      item.candidateInstructions = slide.candidateInstructions.map(line => ({ ...line, text: substituteVariables(line.text, testVariables) }))
    }
    const checklistItems = normalizeChecklistItems(slide.checklistItems)
    if (checklistItems?.length) item.checklistItems = checklistItems
    if (slide.partNumber) item.partNumber = slide.partNumber
    if (slide.kind === 'accept_reject_test' && testDisplayName) item.testDisplayName = testDisplayName
    if (slide.startsTestTimer) item.startsTestTimer = slide.startsTestTimer
    if (slide.nextButtonLabel) item.nextButtonLabel = slide.nextButtonLabel
    if (slide.previewParts?.length) {
      const previewContent = slide.previewParts.flatMap(n => previewByPart[n] ?? [])
      if (previewContent.length) item.previewContent = previewContent
    }
    if (slide.timing) item.timing = slide.timing

    let media = resolveMedia(slide, slot)
    const combo = slide.partNumber ? partCombos[slide.partNumber]?.[slide.id] : wholeTestCombo[slide.id]
    if (combo) media = { ...media, images: combo.images }
    if (media) item.media = media
    return item
  })
}
