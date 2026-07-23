import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { ArrowLeft, Save } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StorylinePart, StorylineSlotContent, StorylineTemplate } from '@/types'
import { QuestionListField } from './QuestionListField'
import { MediaUploadField } from './MediaUploadField'
import { deriveComboImages } from './deriveComboImages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

async function fetchPart(partId: string): Promise<StorylinePart | null> {
  const snap = await getDoc(doc(db, 'storyline_parts', partId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylinePart) : null
}

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', 'current'))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

export function StorylinePartEditorPage() {
  const { partId } = useParams<{ partId: string }>()
  const queryClient = useQueryClient()

  const { data: part, isLoading: partLoading } = useQuery({
    queryKey: ['storyline_part', partId],
    queryFn: () => fetchPart(partId!),
    enabled: !!partId,
  })
  const { data: template, isLoading: templateLoading } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })

  const [label, setLabel] = useState('')
  const [slotContent, setSlotContent] = useState<Record<string, StorylineSlotContent>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (part) {
      setLabel(part.label)
      setSlotContent(part.slotContent ?? {})
    }
  }, [part])

  const disabled = part?.status !== 'draft'

  function updateSlot(slideId: string, updated: StorylineSlotContent) {
    setSlotContent(prev => ({ ...prev, [slideId]: updated }))
  }

  async function handleSave() {
    if (!partId) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'storyline_parts', partId), { label, slotContent })
      queryClient.invalidateQueries({ queryKey: ['storyline_part', partId] })
      queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
    } finally {
      setSaving(false)
    }
  }

  if (partLoading || templateLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!part) return <p className="text-sm text-muted-foreground">Part not found.</p>
  if (!template) {
    return (
      <p className="text-sm text-muted-foreground">
        No Script Template found yet. <Link to="/test-versions/template" className="underline">Set one up first</Link>.
      </p>
    )
  }

  const slides = template.slides.filter(s => s.partNumber === part.partNumber).sort((a, b) => a.order - b.order)
  const storagePathPrefix = `storylines/parts/${partId}/`
  // A slide needing >1 images (e.g. Part 4's "show both pictures together")
  // always reuses the images from the single-image slides above it — no
  // separate upload for it, see deriveComboImages.
  const comboImages = deriveComboImages(slides, id => slotContent[id]?.images?.[0])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions/parts" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <Input
            value={label}
            onChange={e => setLabel(e.target.value)}
            disabled={disabled}
            className="text-xl font-semibold h-auto py-1 max-w-md"
          />
        </div>
        <Badge variant="outline">Part {part.partNumber}</Badge>
        <Badge variant={part.status === 'draft' ? 'outline' : part.status === 'published' ? 'default' : 'secondary'}>
          {part.status}
        </Badge>
      </div>

      {disabled && (
        <p className="text-sm text-muted-foreground">
          This Part is {part.status} and can no longer be edited. Duplicate it from the Parts library to make changes.
        </p>
      )}

      {slides.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No template slides are tagged as Part {part.partNumber} yet — add some in the{' '}
          <Link to="/test-versions/template" className="underline">Script Template</Link>.
        </p>
      )}

      <div className="space-y-3">
        {slides.map(slide => {
          const slot = slotContent[slide.id] ?? {}
          return (
            <div key={slide.id} className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{slide.label}</span>
                <Badge variant="outline">{slide.kind.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-line italic">{slide.scriptText}</p>

              {slide.slotSpec.topic && (
                <div className="space-y-1">
                  <Label>Topic</Label>
                  <Input
                    value={slot.topic ?? ''}
                    onChange={e => updateSlot(slide.id, { ...slot, topic: e.target.value })}
                    placeholder="e.g. Effective Radio Communications"
                    disabled={disabled}
                  />
                </div>
              )}

              {slide.slotSpec.questions && (
                <QuestionListField
                  label="Questions"
                  questions={slot.questions ?? []}
                  onChange={questions => updateSlot(slide.id, { ...slot, questions })}
                  disabled={disabled}
                />
              )}

              {!!slide.slotSpec.images && slide.slotSpec.images > 1 ? (
                <div className="space-y-1">
                  <Label>Images</Label>
                  {comboImages[slide.id] ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Automatically reuses: {comboImages[slide.id].sourceLabels.join(', ')}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {comboImages[slide.id].images.map((url, i) => (
                          <img key={i} src={url} alt="" className="max-h-32 rounded border object-contain" />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Waiting for the image(s) from the slide(s) above to be uploaded first.
                    </p>
                  )}
                </div>
              ) : !!slide.slotSpec.images && (
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: slide.slotSpec.images }).map((_, i) => (
                    <MediaUploadField
                      key={i}
                      label="Image"
                      accept="image/*"
                      value={slot.images?.[i]}
                      storagePathPrefix={storagePathPrefix}
                      disabled={disabled}
                      onChange={url => {
                        const images = [...(slot.images ?? [])]
                        images[i] = url
                        updateSlot(slide.id, { ...slot, images })
                      }}
                    />
                  ))}
                </div>
              )}

              {slide.slotSpec.audio === 'single' && (
                <MediaUploadField
                  label="Recording"
                  accept="audio/*"
                  value={slot.audio?.recordings?.[0]}
                  storagePathPrefix={storagePathPrefix}
                  disabled={disabled}
                  onChange={url => updateSlot(slide.id, { ...slot, audio: { recordings: [url] } })}
                />
              )}

              {slide.slotSpec.audio === 'set' && (
                <div className="space-y-3">
                  <MediaUploadField
                    label="Introduction"
                    accept="audio/*"
                    value={slot.audio?.intro}
                    storagePathPrefix={storagePathPrefix}
                    disabled={disabled}
                    onChange={url => updateSlot(slide.id, { ...slot, audio: { ...slot.audio, intro: url } })}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: slide.slotSpec.audioSetSize ?? 3 }).map((_, i) => (
                      <MediaUploadField
                        key={i}
                        label={`Recording ${i + 1}`}
                        accept="audio/*"
                        value={slot.audio?.recordings?.[i]}
                        storagePathPrefix={storagePathPrefix}
                        disabled={disabled}
                        onChange={url => {
                          const recordings = [...(slot.audio?.recordings ?? [])]
                          recordings[i] = url
                          updateSlot(slide.id, { ...slot, audio: { ...slot.audio, recordings } })
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="size-4 mr-2" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
