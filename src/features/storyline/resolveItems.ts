import type { TemplateSlide, StorylineSlotContent, StorylineItem, StorylinePart, StorylinePartNumber, ChecklistItem } from '@/types'
import { deriveComboImages, type ComboImageResult } from './deriveComboImages'

// checklistItems used to be string[] before per-item icons existed —
// templates saved before that change still have plain strings in Firestore.
// Normalize defensively rather than assuming every document was migrated.
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
      // Wrapped in blank lines so the imported question list reads as its
      // own paragraph rather than running straight into the surrounding
      // scripted wording — matches the spacing questions already get on
      // the compiled Part-preview slide.
      ? text.replace('{questions}', questionsBlock ? `\n${questionsBlock}\n` : '')
      : [text, questionsBlock].filter(Boolean).join('\n')
  }
  return text
}

// A compact "what's actually in this slide" summary — topic/questions only,
// not the fixed scripted wording — used to compile a Part's content into an
// examiner-preview slide elsewhere in the template (see previewParts below).
// Kept structured (not pre-formatted text) so the player can style it
// distinctly from ordinary script text.
function slidePreviewEntry(slide: TemplateSlide, slot?: StorylineSlotContent): { label: string; topic?: string; questions?: string[] } | undefined {
  const topic = slide.slotSpec.topic ? slot?.topic : undefined
  const questions = slide.slotSpec.questions ? slot?.questions?.filter(Boolean) : undefined
  if (!topic && !questions?.length) return undefined
  // Firestore's updateDoc() rejects a literal `undefined` field value (must
  // be omitted entirely, not just falsy) — items resolved here get written
  // straight to StorylineVersion.items at Publish time, so every optional
  // field below is included only when it has a real value, never assigned
  // undefined outright.
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

  // maxPlays is optional (see TemplateSlide.slotSpec.maxPlays) — spread in
  // only when set, never as an explicit `maxPlays: undefined` key (Firestore
  // rejects literal undefined field values on the updateDoc() write at
  // Publish time — see slidePreviewEntry() above for the same rule).
  const maxPlaysField = maxPlays !== undefined ? { maxPlays } : {}
  if (slide.slotSpec.audio === 'single' && slot?.audio?.recordings?.[0]) {
    audioClips.push({ label: slide.label, url: slot.audio.recordings[0], ...maxPlaysField })
  }
  if (slide.slotSpec.audio === 'set') {
    if (slot?.audio?.intro) audioClips.push({ label: 'Introduction', url: slot.audio.intro, ...maxPlaysField })
    slot?.audio?.recordings?.forEach((url, i) => {
      if (url) audioClips.push({ label: `Recording ${i + 1}`, url, ...maxPlaysField })
    })
  }
  // Unlimited-replay by design — a level check, not scored content.
  if (slide.slotSpec.volumeCheck && slot?.audio?.volumeCheck) {
    audioClips.push({ label: 'Volume check', url: slot.audio.volumeCheck })
  }

  const media: NonNullable<StorylineItem['media']> = {}
  if (images && images.length > 0) media.images = images
  if (audioClips.length > 0) media.audioClips = audioClips
  return Object.keys(media).length > 0 ? media : undefined
}

// Merges the shared script template with a version's own whole-test slot
// fills and its 4 referenced Parts' slot fills into the resolved
// StorylineItem[] shape player-src/ and exportStoryline.ts consume.
// Variable substitution always uses the Test's variables, regardless of
// whether a slide's content came from the version or a shared Part — a
// role type is fixed per Test, so the same pooled Part resolves correctly
// for whichever Test is using it.
//
// Used both for live Preview (computed on the fly, not persisted) and once
// at Publish time (persisted into StorylineVersion.items, after which the
// version no longer depends on the template or its Parts at all).
export function resolveItems(
  slides: TemplateSlide[],
  testVariables: Record<string, string> | undefined,
  versionSlotContent: Record<string, StorylineSlotContent>,
  parts: Partial<Record<StorylinePartNumber, StorylinePart>>,
  // "{test.name} — {version.versionLabel}" — not authored on any
  // TemplateSlide, so the caller (which already has both loaded) computes
  // it; only ever read from the accept_reject_test item.
  testDisplayName?: string,
): StorylineItem[] {
  const sorted = [...slides].sort((a, b) => a.order - b.order)

  function slotFor(slide: TemplateSlide): StorylineSlotContent | undefined {
    return slide.partNumber ? parts[slide.partNumber]?.slotContent[slide.id] : versionSlotContent[slide.id]
  }

  // A multi-image slide (e.g. "show both pictures together") always reuses
  // the images from the single-image slides before it in the same scope —
  // computed once here, per scope, rather than trusting each slide's own
  // slotContent (which the author never fills for these).
  const wholeTestCombo = deriveComboImages(
    sorted.filter(s => !s.partNumber),
    id => versionSlotContent[id]?.images?.[0],
  )
  const partCombos: Partial<Record<StorylinePartNumber, Record<string, ComboImageResult>>> = {}
  for (const n of [1, 2, 3, 4] as StorylinePartNumber[]) {
    const part = parts[n]
    partCombos[n] = deriveComboImages(
      sorted.filter(s => s.partNumber === n),
      id => part?.slotContent[id]?.images?.[0],
    )
  }

  // Pre-pass: compile each Part's actual topic/question content, keyed by
  // Part number, so an "examiner preview" slide elsewhere (previewParts) can
  // pull in real content regardless of where in the slide order it sits.
  const previewByPart: Partial<Record<StorylinePartNumber, PreviewEntry[]>> = {}
  for (const slide of sorted) {
    if (!slide.partNumber || slide.previewExclude) continue
    const entry = slidePreviewEntry(slide, slotFor(slide))
    if (entry) (previewByPart[slide.partNumber] ??= []).push({ ...entry, partNumber: slide.partNumber })
  }

  return sorted.map(slide => {
    const slot = slotFor(slide)
    // Every optional field below is assigned only when it has a real value —
    // never set to a literal `undefined` — because this resolved item gets
    // written straight to StorylineVersion.items via Firestore's updateDoc()
    // at Publish time, which rejects any field whose value is undefined
    // (must be omitted from the object entirely, not just falsy).
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
