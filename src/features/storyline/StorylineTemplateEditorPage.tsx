import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { Plus, Save, Sparkles } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { TemplateSlide, TemplateSlideKind, StorylineTemplate } from '@/types'
import { TemplateSlideRow } from './TemplateSlideRow'
import { buildSeedTemplateSlides } from './templateSeed'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TEMPLATE_DOC_ID = 'current'

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', TEMPLATE_DOC_ID))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

function newSlide(kind: TemplateSlideKind, order: number): TemplateSlide {
  return { id: crypto.randomUUID(), order, kind, label: '', scriptText: '', slotSpec: {} }
}

export function StorylineTemplateEditorPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const { data: template, isLoading } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })

  const [slides, setSlides] = useState<TemplateSlide[]>([])
  const [addKind, setAddKind] = useState<TemplateSlideKind>('instruction')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (template) setSlides(template.slides)
  }, [template])

  function addSlide() {
    setSlides(prev => [...prev, newSlide(addKind, prev.length)])
  }

  function updateSlide(index: number, updated: TemplateSlide) {
    setSlides(prev => prev.map((s, i) => (i === index ? updated : s)))
  }

  function removeSlide(index: number) {
    setSlides(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i })))
  }

  function moveSlide(index: number, direction: -1 | 1) {
    setSlides(prev => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((s, i) => ({ ...s, order: i }))
    })
  }

  function loadExampleScript() {
    if (slides.length > 0 && !window.confirm('This replaces the current unsaved slide list with the example script. Continue?')) return
    setSlides(buildSeedTemplateSlides())
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'storyline_template', TEMPLATE_DOC_ID), {
        slides,
        updatedBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      })
      queryClient.invalidateQueries({ queryKey: ['storyline_template'] })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Script Template</h1>
          <p className="text-sm text-muted-foreground">
            The shared examiner script, edited once here. Test versions only fill in the questions/media each slide needs.
          </p>
        </div>
        <Button variant="outline" onClick={loadExampleScript}>
          <Sparkles className="size-4 mr-2" /> Load example script
        </Button>
      </div>

      <div className="space-y-3">
        {slides.map((slide, index) => (
          <TemplateSlideRow
            key={slide.id}
            slide={slide}
            canMoveUp={index > 0}
            canMoveDown={index < slides.length - 1}
            onChange={updated => updateSlide(index, updated)}
            onRemove={() => removeSlide(index)}
            onMoveUp={() => moveSlide(index, -1)}
            onMoveDown={() => moveSlide(index, 1)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="w-64">
          <Select value={addKind} onValueChange={v => setAddKind(v as TemplateSlideKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin_checklist">Admin checklist (examiner-only)</SelectItem>
              <SelectItem value="examiner_preview">Examiner preview (examiner-only)</SelectItem>
              <SelectItem value="instruction">Instruction</SelectItem>
              <SelectItem value="question_set">Question set</SelectItem>
              <SelectItem value="image_question_set">Image + question set</SelectItem>
              <SelectItem value="timed_picture_description">Timed picture description</SelectItem>
              <SelectItem value="audio_response">Audio + response</SelectItem>
              <SelectItem value="audio_set">Audio set (intro + recordings)</SelectItem>
              <SelectItem value="closing">Closing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={addSlide}>
          <Plus className="size-4 mr-2" /> Add slide
        </Button>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="size-4 mr-2" /> {saving ? 'Saving…' : 'Save template'}
        </Button>
      </div>
    </div>
  )
}
