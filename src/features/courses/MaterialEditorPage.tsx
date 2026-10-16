import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, Download, Printer } from 'lucide-react'
import { db } from '@/lib/firebase'
import { fetchMaterials, SCOPE_LABELS } from '@/lib/courseMaterials'
import { fetchCourses } from '@/lib/courses'
import { useCurrentPersonName } from './MaterialsSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function MaterialEditorPage() {
  const { materialId } = useParams<{ materialId: string }>()
  const location = useLocation()
  const queryClient = useQueryClient()
  const myName = useCurrentPersonName()
  const previewRef = useRef<HTMLDivElement>(null)

  const { data: materials = [], isLoading } = useQuery({ queryKey: ['course-materials'], queryFn: fetchMaterials })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const material = materials.find(m => m.id === materialId)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Load once per note, so a background refetch never overwrites typing
  useEffect(() => {
    if (material && loadedId !== material.id) {
      setTitle(material.title)
      setBody(material.markdown ?? '')
      setLoadedId(material.id)
    }
  }, [material, loadedId])

  const dirty = !!material && loadedId === material.id && (title !== material.title || body !== (material.markdown ?? ''))

  // The app uses <BrowserRouter> (no data router), so useBlocker isn't
  // available — the Back link confirms instead, and the browser warns on
  // tab close/reload.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    if (!material || !title.trim()) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'course_materials', material.id), {
        title: title.trim(), markdown: body, updatedByName: myName, updatedAt: serverTimestamp(),
      })
      await queryClient.invalidateQueries({ queryKey: ['course-materials'] })
      setSavedAt(new Date())
    } finally {
      setSaving(false)
    }
  }

  // Ctrl/Cmd+S saves
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Prints just the rendered note in a clean window — the browser's print
  // dialog doubles as "Save as PDF".
  function printNote() {
    const w = window.open('', '_blank')
    if (!w || !previewRef.current) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      body { font: 11pt/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
      h1 { font-size: 1.6rem; } h2 { font-size: 1.25rem; margin-top: 1.6em; } h3 { font-size: 1.05rem; }
      table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: .3em .5em; text-align: left; }
      code { background: #f2f2f2; padding: 0 .2em; border-radius: 3px; } pre { background: #f2f2f2; padding: .6em; overflow-x: auto; }
      blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #444; }
      a { color: #00528C; }
    </style></head><body>${previewRef.current.innerHTML}</body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  function downloadMarkdown() {
    const blob = new Blob([body], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.trim() || 'note'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const course = material?.courseId ? courses.find(c => c.id === material.courseId) : undefined
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo
    ?? (course ? `/courses/${course.id}` : '/courses/materials')

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!material || material.kind !== 'markdown') {
    return <p className="text-sm text-muted-foreground">Note not found. <Link to="/courses/materials" className="underline">Back to materials</Link></p>
  }

  return (
    <div className="space-y-4">
      <Link
        to={returnTo}
        onClick={e => { if (dirty && !confirm('You have unsaved changes. Leave without saving?')) e.preventDefault() }}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={title} onChange={e => setTitle(e.target.value)} className="text-lg font-semibold flex-1 min-w-48" aria-label="Title" />
        <Button variant="outline" onClick={downloadMarkdown}><Download className="size-4 mr-1.5" /> .md</Button>
        <Button variant="outline" onClick={printNote}><Printer className="size-4 mr-1.5" /> Print / PDF</Button>
        <Button onClick={save} disabled={!dirty || saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {course ? course.name : SCOPE_LABELS[material.scope]}
        {material.day ? ` · Day ${material.day}` : ''}
        {' · '}
        {dirty ? <span className="text-amber-700">Unsaved changes</span> : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : material.updatedByName ? `Last edited by ${material.updatedByName}` : ''}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          className="font-mono text-sm min-h-[60vh] resize-y"
          aria-label="Note (markdown)"
          spellCheck
        />
        <div ref={previewRef} className="manual-prose rounded-md border p-4 min-h-[60vh] overflow-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Markdown: <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list</code>, <code>| table | rows |</code>. Ctrl+S saves.
      </p>
    </div>
  )
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}
