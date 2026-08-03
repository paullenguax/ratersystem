import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Plus, Save, Sparkles, Download } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { TemplateSlide, TemplateSlideKind, StorylineTemplate, StorylineTheme, ChecklistItem } from '@/types'
import { TemplateSlideRow, SLIDE_KINDS } from './TemplateSlideRow'
import { buildSeedTemplateSlides } from './templateSeed'
import { exportStorylineTemplate, exportPlayerShell } from './exportStoryline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Mirrors player.css's own fallback defaults exactly — shown as greyed-out
// placeholders so "leave it blank" visibly means "use the built-in look",
// not "zero".
const THEME_DEFAULTS = { logoHeight: 84, accentColor: '#00528c', slideMaxWidth: 1100, slideMinHeight: 640 }

const TEMPLATE_DOC_ID = 'current'

// checklistItems used to be string[] before per-item icons existed — a
// template saved before that change still has plain strings in Firestore.
// Normalize on load so the editor displays/edits it correctly regardless;
// saving afterwards migrates it to the new shape automatically.
function normalizeSlide(slide: TemplateSlide): TemplateSlide {
  if (!slide.checklistItems) return slide
  const items = slide.checklistItems as unknown as (string | ChecklistItem)[]
  return { ...slide, checklistItems: items.map(item => (typeof item === 'string' ? { text: item } : item)) }
}

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', TEMPLATE_DOC_ID))
  if (!snap.exists()) return null
  const data = snap.data() as StorylineTemplate
  return { ...data, id: snap.id, slides: data.slides.map(normalizeSlide) }
}

function newSlide(kind: TemplateSlideKind, order: number): TemplateSlide {
  return { id: crypto.randomUUID(), order, kind, label: '', scriptText: '', slotSpec: {} }
}

export function StorylineTemplateEditorPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const { data: template, isLoading } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })

  const [slides, setSlides] = useState<TemplateSlide[]>([])
  const [theme, setTheme] = useState<StorylineTheme>({})
  const [addKind, setAddKind] = useState<TemplateSlideKind>('instruction')
  const [saving, setSaving] = useState(false)
  // "Load example script" (and every other edit here) only changes this
  // component's state — nothing reaches Firestore until Save is clicked.
  // A refresh before that discards it silently, which reads exactly like
  // "loading it again did nothing." Track it explicitly so that's obvious.
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (template) {
      setSlides(template.slides)
      setTheme(template.theme ?? {})
      setDirty(false)
    }
  }, [template])

  function updateTheme(patch: Partial<StorylineTheme>) {
    setTheme(prev => ({ ...prev, ...patch }))
    setDirty(true)
  }

  useEffect(() => {
    if (!dirty) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function addSlide() {
    setSlides(prev => [...prev, newSlide(addKind, prev.length)])
    setDirty(true)
  }

  function updateSlide(index: number, updated: TemplateSlide) {
    setSlides(prev => prev.map((s, i) => (i === index ? updated : s)))
    setDirty(true)
  }

  function removeSlide(index: number) {
    setSlides(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i })))
    setDirty(true)
  }

  function moveSlide(index: number, direction: -1 | 1) {
    setSlides(prev => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((s, i) => ({ ...s, order: i }))
    })
    setDirty(true)
  }

  function loadExampleScript() {
    if (slides.length > 0 && !window.confirm('This replaces the current unsaved slide list with the example script. Continue?')) return
    // Every StorylinePart/StorylineVersion's slot content is keyed by slide
    // id, not label — reusing the existing id for any seed slide whose
    // label already exists keeps that content linked. Without this, "Load
    // example script" would silently orphan every Part/Version's already-
    // authored questions/media (they'd still be saved, just unreachable,
    // since nothing would reference their now-stale slide ids anymore).
    const existingIdByLabel = new Map(slides.map(s => [s.label, s.id]))
    const seeded = buildSeedTemplateSlides().map(s => ({ ...s, id: existingIdByLabel.get(s.label) ?? s.id }))
    setSlides(seeded)
    setDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'storyline_template', TEMPLATE_DOC_ID), {
        slides,
        theme,
        updatedBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      })
      queryClient.invalidateQueries({ queryKey: ['storyline_template'] })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  // Dynamic Part-pooling exports (see "Dynamic Part-pooling" in README.md)
  // — re-run whenever the template/theme changes and gets re-saved; the
  // player shell only needs re-export when the shell code itself changes,
  // but bundling the current theme here too keeps "export shell" a single
  // one-click step rather than needing the theme to be exported separately.
  const [exportingTemplate, setExportingTemplate] = useState(false)
  const [exportingShell, setExportingShell] = useState(false)

  function handleExportTemplate() {
    setExportingTemplate(true)
    try {
      exportStorylineTemplate({ id: TEMPLATE_DOC_ID, slides })
    } finally {
      setExportingTemplate(false)
    }
  }

  async function handleExportShell() {
    setExportingShell(true)
    try {
      await exportPlayerShell(theme)
    } finally {
      setExportingShell(false)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Script Template</h1>
            <p className="text-sm text-muted-foreground">
              The shared examiner script, edited once here. Test versions only fill in the questions/media each slide needs.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportTemplate} disabled={exportingTemplate || dirty}>
            <Download className="size-4 mr-2" /> Export template.json
          </Button>
          <Button variant="outline" onClick={handleExportShell} disabled={exportingShell || dirty}>
            <Download className="size-4 mr-2" /> {exportingShell ? 'Exporting…' : 'Export player shell'}
          </Button>
          <Button variant="outline" onClick={loadExampleScript}>
            <Sparkles className="size-4 mr-2" /> Load example script
          </Button>
        </div>
      </div>
      {dirty && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Save your changes before exporting — the export buttons above use whatever's currently saved, not these unsaved edits.
        </p>
      )}

      {dirty && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Unsaved changes — click <strong>Save template</strong> below before leaving this page, or they'll be lost. Refreshing now will discard them.
        </div>
      )}

      <div className="rounded-md border p-4 space-y-3">
        <div>
          <span className="font-medium">Look & feel</span>
          <p className="text-sm text-muted-foreground">
            Applies to every test version. Leave a field blank to use the player's built-in default.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Logo height (px)</Label>
            <Input
              type="number"
              min={1}
              placeholder={String(THEME_DEFAULTS.logoHeight)}
              value={theme.logoHeight ?? ''}
              onChange={e => updateTheme({ logoHeight: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label>Accent color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-10 rounded border cursor-pointer"
                value={theme.accentColor ?? THEME_DEFAULTS.accentColor}
                onChange={e => updateTheme({ accentColor: e.target.value })}
              />
              <Input
                placeholder={THEME_DEFAULTS.accentColor}
                value={theme.accentColor ?? ''}
                onChange={e => updateTheme({ accentColor: e.target.value || undefined })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Slide max width (px)</Label>
            <Input
              type="number"
              min={1}
              placeholder={String(THEME_DEFAULTS.slideMaxWidth)}
              value={theme.slideMaxWidth ?? ''}
              onChange={e => updateTheme({ slideMaxWidth: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label>Slide min height (px)</Label>
            <Input
              type="number"
              min={1}
              placeholder={String(THEME_DEFAULTS.slideMinHeight)}
              value={theme.slideMinHeight ?? ''}
              onChange={e => updateTheme({ slideMinHeight: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {slides.map((slide, index) => (
          <TemplateSlideRow
            key={slide.id}
            slide={slide}
            index={index}
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
            <SelectTrigger>
              <SelectValue>{(v: TemplateSlideKind) => SLIDE_KINDS.find(k => k.value === v)?.label ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SLIDE_KINDS.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
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
