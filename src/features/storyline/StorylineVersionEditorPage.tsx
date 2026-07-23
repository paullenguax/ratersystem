import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore'
import { ArrowLeft, Eye, Save } from 'lucide-react'
import { db } from '@/lib/firebase'
import type {
  StorylineTemplate, StorylineTest, StorylineVersion,
  StorylineSlotContent, StorylinePart, StorylinePartNumber,
} from '@/types'
import { QuestionListField } from './QuestionListField'
import { MediaUploadField } from './MediaUploadField'
import { resolveItems } from './resolveItems'
import { previewStorylineVersion } from './useStorylinePreview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PART_NUMBERS: StorylinePartNumber[] = [1, 2, 3, 4]

async function fetchVersion(versionId: string): Promise<StorylineVersion | null> {
  const snap = await getDoc(doc(db, 'storyline_versions', versionId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineVersion) : null
}

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', 'current'))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

async function fetchTest(testId: string): Promise<StorylineTest | null> {
  const snap = await getDoc(doc(db, 'storyline_tests', testId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTest) : null
}

async function fetchParts(): Promise<StorylinePart[]> {
  const snap = await getDocs(collection(db, 'storyline_parts'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePart)
}

export function StorylineVersionEditorPage() {
  const { testId, versionId } = useParams<{ testId: string; versionId: string }>()
  const queryClient = useQueryClient()

  const { data: version, isLoading: versionLoading } = useQuery({
    queryKey: ['storyline_version', versionId],
    queryFn: () => fetchVersion(versionId!),
    enabled: !!versionId,
  })
  const { data: template, isLoading: templateLoading } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })
  const { data: test } = useQuery({ queryKey: ['storyline_test', testId], queryFn: () => fetchTest(testId!), enabled: !!testId })
  const { data: parts = [] } = useQuery({ queryKey: ['storyline_parts'], queryFn: fetchParts })

  const [versionLabel, setVersionLabel] = useState('')
  const [slotContent, setSlotContent] = useState<Record<string, StorylineSlotContent>>({})
  const [partRefs, setPartRefs] = useState<Partial<Record<StorylinePartNumber, string>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (version) {
      setVersionLabel(version.versionLabel)
      setSlotContent(version.slotContent ?? {})
      setPartRefs(version.partRefs ?? {})
    }
  }, [version])

  const disabled = version?.status !== 'draft'

  function updateSlot(slideId: string, updated: StorylineSlotContent) {
    setSlotContent(prev => ({ ...prev, [slideId]: updated }))
  }

  async function handleSave() {
    if (!versionId) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'storyline_versions', versionId), { versionLabel, slotContent, partRefs })
      queryClient.invalidateQueries({ queryKey: ['storyline_version', versionId] })
      queryClient.invalidateQueries({ queryKey: ['storyline_versions', testId] })
    } finally {
      setSaving(false)
    }
  }

  function handlePreview() {
    if (!template) return
    const selectedParts: Partial<Record<StorylinePartNumber, StorylinePart>> = {}
    for (const n of PART_NUMBERS) {
      const p = parts.find(part => part.id === partRefs[n])
      if (p) selectedParts[n] = p
    }
    previewStorylineVersion(resolveItems(template.slides, test?.variables, slotContent, selectedParts))
  }

  if (versionLoading || templateLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!version) return <p className="text-sm text-muted-foreground">Version not found.</p>
  if (!template || template.slides.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Script Template found yet. <Link to="/test-versions/template" className="underline">Set one up first</Link>.
      </p>
    )
  }

  const wholeTestSlides = template.slides.filter(s => !s.partNumber).sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to={`/test-versions/${testId}`} />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <Input
            value={versionLabel}
            onChange={e => setVersionLabel(e.target.value)}
            disabled={disabled}
            className="text-xl font-semibold h-auto py-1 max-w-md"
          />
        </div>
        <Badge variant={version.status === 'draft' ? 'outline' : version.status === 'published' ? 'default' : 'secondary'}>
          {version.status}
        </Badge>
        <Button variant="outline" size="sm" onClick={handlePreview}>
          <Eye className="size-4 mr-2" /> Preview
        </Button>
      </div>

      {disabled && (
        <p className="text-sm text-muted-foreground">
          This version is {version.status} and can no longer be edited. Duplicate it from the versions list to make changes.
        </p>
      )}

      <div className="rounded-md border p-4 space-y-3">
        <span className="font-medium">Parts</span>
        <div className="grid grid-cols-2 gap-3">
          {PART_NUMBERS.map(n => {
            const options = parts.filter(p => p.partNumber === n)
            return (
              <div key={n} className="space-y-1">
                <label className="text-sm font-medium">Part {n}</label>
                <Select
                  value={partRefs[n] ?? ''}
                  onValueChange={v => setPartRefs(prev => ({ ...prev, [n]: v }))}
                  disabled={disabled}
                >
                  <SelectTrigger><SelectValue placeholder="Choose a Part…" /></SelectTrigger>
                  <SelectContent>
                    {options.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.label} ({p.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {options.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No Part {n} exists yet. <Link to="/test-versions/parts" className="underline">Create one</Link>.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        {wholeTestSlides.map(slide => {
          const slot = slotContent[slide.id] ?? {}
          const storagePathPrefix = `storylines/${testId}/${versionId}/`
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

              {!!slide.slotSpec.images && (
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: slide.slotSpec.images }).map((_, i) => (
                    <MediaUploadField
                      key={i}
                      label={slide.slotSpec.images! > 1 ? `Image ${i + 1}` : 'Image'}
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
