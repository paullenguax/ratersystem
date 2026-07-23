import type { TemplateSlide } from '@/types'

export interface ComboImageResult {
  images: string[]
  sourceLabels: string[]
}

// A slide needing more than one image (e.g. "show both pictures together")
// always reuses the images already uploaded to the single-image slides
// immediately preceding it in the same scope (a Part, or the whole-test
// slides), rather than asking the author to upload the same files again —
// there's no independent content for it, just a combination of what's
// already there. Only produces a result once enough single-image slides
// have actually been filled in; `slides` must already be scoped to one
// Part (or the whole-test slides) and given in template order.
export function deriveComboImages(
  slides: TemplateSlide[],
  getUploadedImage: (slideId: string) => string | undefined,
): Record<string, ComboImageResult> {
  const result: Record<string, ComboImageResult> = {}
  const collected: { label: string; url: string }[] = []

  for (const slide of [...slides].sort((a, b) => a.order - b.order)) {
    const need = slide.slotSpec.images ?? 0
    if (need === 1) {
      const url = getUploadedImage(slide.id)
      if (url) collected.push({ label: slide.label, url })
    } else if (need > 1) {
      const take = collected.slice(-need)
      if (take.length === need) {
        result[slide.id] = { images: take.map(c => c.url), sourceLabels: take.map(c => c.label) }
      }
    }
  }
  return result
}
