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
import { printDocument } from '@/lib/printDocument'
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

  // Branded print window — "Save as PDF" in the print dialog is the PDF export
  function printNote() {
    if (!previewRef.current || !material) return
    printDocument({
      title: title.trim() || 'Document',
      html: previewRef.current.innerHTML,
      subtitle: course ? course.name : material.scope === 'library' ? undefined : SCOPE_LABELS[material.scope],
    })
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
