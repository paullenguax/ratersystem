import type { TemplateSlide, StorylineSlotContent, StorylineItem, StorylinePart, StorylinePartNumber } from '@/types'

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
      ? text.replace('{questions}', questionsBlock)
      : [text, questionsBlock].filter(Boolean).join('\n')
  }
  return text
}

function resolveMedia(slide: TemplateSlide, slot?: StorylineSlotContent): StorylineItem['media'] {
  const images = slot?.images?.filter(Boolean)
  const audioClips: { label: string; url: string; maxPlays?: number }[] = []
  const maxPlays = slide.slotSpec.maxPlays

  if (slide.slotSpec.audio === 'single' && slot?.audio?.recordings?.[0]) {
    audioClips.push({ label: slide.label, url: slot.audio.recordings[0], maxPlays })
  }
  if (slide.slotSpec.audio === 'set') {
    if (slot?.audio?.intro) audioClips.push({ label: 'Introduction', url: slot.audio.intro, maxPlays })
    slot?.audio?.recordings?.forEach((url, i) => {
      if (url) audioClips.push({ label: `Recording ${i + 1}`, url, maxPlays })
    })
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
): StorylineItem[] {
  return [...slides]
    .sort((a, b) => a.order - b.order)
    .map(slide => {
      const slot = slide.partNumber
        ? parts[slide.partNumber]?.slotContent[slide.id]
        : versionSlotContent[slide.id]
      const item: StorylineItem = {
        id: slide.id,
        order: slide.order,
        candidateState: slide.candidateState ?? '',
        examinerText: resolveScriptText(slide, testVariables, slot),
        timing: slide.timing,
      }
      const media = resolveMedia(slide, slot)
      if (media) item.media = media
      return item
    })
}
