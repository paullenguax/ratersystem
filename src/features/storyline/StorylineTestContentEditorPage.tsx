import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Eye, Save, Rocket, Download } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StorylineTemplate, StorylineTest, StorylineSlotContent } from '@/types'
import { QuestionListField } from './QuestionListField'
import { MediaUploadField } from './MediaUploadField'
import { deriveComboImages } from './deriveComboImages'
import { resolveItems } from './resolveItems'
import { missingPartContent } from './partCompleteness'
import { previewStorylineVersion } from './useStorylinePreview'
import { exportStorylineTest } from './exportStoryline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

async function fetchTest(testId: string): Promise<StorylineTest | null> {
  const snap = await getDoc(doc(db, 'storyline_tests', testId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTest) : null
}

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', 'current'))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

// Whole-test (partNumber-undefined) slide content — preamble, accept/
// reject test name, test data confirm, checklist, closing. One canonical
// set per Test, shared by every dynamically-pooled candidate instance
// (see StorylineTest.slotContent) — the successor to what used to live on
// each hand-built StorylineVersion.slotContent. Publishing here snapshots
// into StorylineTest.items exactly the way a Part's content gets
// snapshotted at Version-publish time, except previewParts-driven slides
// come back empty by design: which 4 Parts a candidate gets isn't known
// until WordPress assigns them, so that content can only be re-derived by
// the exported player at runtime, not baked in here.
export function StorylineTestContentEditorPage() {
  const { testId } = useParams<{ testId: string }>()
  const queryClient = useQueryClient()

  const { data: test, isLoading: testLoading } = useQuery({
    queryKey: ['storyline_test', testId],
    queryFn: () => fetchTest(testId!),
    enabled: !!testId,
  })
  const { data: template, isLoading: templateLoading } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })

  const [slotContent, setSlotContent] = useState<Record<string, StorylineSlotContent>>({})
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (test) setSlotContent(test.slotContent ?? {})
  }, [test])

  const disabled = test?.status === 'published'

  function updateSlot(slideId: string, updated: StorylineSlotContent) {
    setSlotContent(prev => ({ ...prev, [slideId]: updated }))
  }

  async function handleSave() {
    if (!testId) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'storyline_tests', testId), { slotContent, status: test?.status ?? 'draft' })
      queryClient.invalidateQueries({ queryKey: ['storyline_test', testId] })
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!testId || !template) return
    const missing = missingPartContent(template.slides, undefined, slotContent)
    if (missing.length > 0) {
      window.alert(`Can't publish — still missing:\n${missing.map(m => `- ${m}`).join('\n')}`)
      return
    }
    if (!window.confirm(`Publish this test's whole-test content? Published content is immutable — further edits require unpublishing first.`)) return
    setPublishing(true)
    try {
      const wholeTestSlides = template.slides.filter(s => !s.partNumber)
      const items = resolveItems(wholeTestSlides, test?.variables, slotContent, {}, test?.name)
      await updateDoc(doc(db, 'storyline_tests', testId), {
        slotContent, status: 'published', items, publishedAt: serverTimestamp(),
      })
      queryClient.invalidateQueries({ queryKey: ['storyline_test', testId] })
    } finally {
      setPublishing(false)
    }
  }

  function handlePreview() {
    if (!template) return
    const wholeTestSlides = template.slides.filter(s => !s.partNumber)
    previewStorylineVersion(resolveItems(wholeTestSlides, test?.variables, slotContent, {}, test?.name), template.theme)
  }

  async function handleExport() {
    if (!test) return
    setExporting(true)
    try {
      await exportStorylineTest(test)
    } finally {
      setExporting(false)
    }
  }

  if (testLoading || templateLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!test) return <p className="text-sm text-muted-foreground">Test not found.</p>
  if (!template || template.slides.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Script Template found yet. <Link to="/test-versions/template" className="underline">Set one up first</Link>.
      </p>
    )
  }

  const wholeTestSlides = template.slides.filter(s => !s.partNumber).sort((a, b) => a.order - b.order)
  // A slide needing >1 images always reuses the images from the single-image
  // slides above it — no separate upload for it, see deriveComboImages.
  const comboImages = deriveComboImages(wholeTestSlides, id => slotContent[id]?.images?.[0])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{test.name} — whole-test content</h1>
          <p className="text-sm text-muted-foreground">
            Preamble, accept/reject, checklist, closing — shared by every candidate of this test type. Parts (1–4) are authored separately in the Parts Library.
          </p>
        </div>
        <Badge variant={test.status === 'published' ? 'default' : 'outline'}>{test.status ?? 'draft'}</Badge>
        <Button variant="outline" size="sm" onClick={handlePreview}>
          <Eye className="size-4 mr-2" /> Preview
        </Button>
        {test.status === 'published' && (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            <Download className="size-4 mr-2" /> {exporting ? 'Exporting…' : 'Export'}
          </Button>
        )}
      </div>

      {!test.wpTestId && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          No WordPress Test ID set on this test yet — required before it can sync for dynamic pooling. Set it via Edit on the Test Types list.
        </p>
      )}

      {disabled && (
        <p className="text-sm text-muted-foreground">
          This content is published and can no longer be edited directly.
        </p>
      )}

      <div className="space-y-3">
        {wholeTestSlides.map(slide => {
          const slot = slotContent[slide.id] ?? {}
          const storagePathPrefix = `storylines/tests/${testId}/`
          return (
            <div key={slide.id} className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{slide.label}</span>
                <Badge variant="outline">{slide.kind.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap italic">{slide.scriptText}</p>

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

              {/* Rendered before the recording field(s) below, matching the
                  order this slide's own script actually uses them in — see
                  scriptText's {volumeCheck} token, which always comes
                  before {audio}. */}
              {slide.slotSpec.volumeCheck && (
                <MediaUploadField
                  label="Volume check clip (played first, before the recording below)"
                  accept="audio/*"
                  value={slot.audio?.volumeCheck}
                  storagePathPrefix={storagePathPrefix}
                  disabled={disabled}
                  onChange={url => updateSlot(slide.id, { ...slot, audio: { ...slot.audio, volumeCheck: url } })}
                />
              )}

              {slide.slotSpec.audio === 'single' && (
                <MediaUploadField
                  label="Recording"
                  accept="audio/*"
                  value={slot.audio?.recordings?.[0]}
                  storagePathPrefix={storagePathPrefix}
                  disabled={disabled}
                  onChange={url => updateSlot(slide.id, { ...slot, audio: { ...slot.audio, recordings: [url] } })}
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            <Save className="size-4 mr-2" /> {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button onClick={handlePublish} disabled={publishing}>
            <Rocket className="size-4 mr-2" /> {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      )}
    </div>
  )
}
