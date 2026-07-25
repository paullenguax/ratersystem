import type { TemplateSlide, StorylineSlotContent, StorylinePartNumber } from '@/types'

// What's missing from a Part's authored content, checked against the
// template slides tagged for its Part number — used to block Publish on an
// incomplete Part (e.g. a slide needing a recording that was never
// uploaded, discovered only once a real test tried to use it). Mirrors
// resolveItems.ts's understanding of what each slotSpec needs, but checks
// presence instead of producing resolved output.
export function missingPartContent(
  slides: TemplateSlide[],
  partNumber: StorylinePartNumber,
  slotContent: Record<string, StorylineSlotContent>,
): string[] {
  const missing: string[] = []
  const partSlides = slides.filter(s => s.partNumber === partNumber)

  for (const slide of partSlides) {
    const slot = slotContent[slide.id]
    if (slide.slotSpec.topic && !slot?.topic?.trim()) missing.push(`${slide.label}: topic`)
    if (slide.slotSpec.questions && !slot?.questions?.some(q => q.trim())) missing.push(`${slide.label}: questions`)
    // Multi-image (combo) slides derive their images from the preceding
    // single-image slides in the same scope — nothing authored directly on
    // them, so only single-image slides are checked here.
    if (slide.slotSpec.images === 1 && !slot?.images?.[0]) missing.push(`${slide.label}: image`)
    if (slide.slotSpec.audio === 'single' && !slot?.audio?.recordings?.[0]) missing.push(`${slide.label}: recording`)
    if (slide.slotSpec.audio === 'set') {
      if (!slot?.audio?.intro) missing.push(`${slide.label}: introduction clip`)
      const needed = slide.slotSpec.audioSetSize ?? 3
      const have = slot?.audio?.recordings?.filter(Boolean).length ?? 0
      if (have < needed) missing.push(`${slide.label}: ${needed - have} more recording(s)`)
    }
    if (slide.slotSpec.volumeCheck && !slot?.audio?.volumeCheck) missing.push(`${slide.label}: volume-check clip`)
  }

  return missing
}
