import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { FileText, NotebookPen, Upload, Plus, Trash2, Pencil, ExternalLink, FileDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { CourseMaterial } from '@/types'
import {
  createNote, deleteMaterial, formatSize, uploadMaterialFile, SCOPE_LABELS, type MaterialTarget,
} from '@/lib/courseMaterials'
import { fetchPeople } from './CoursesPage'
import { Button } from '@/components/ui/button'

export interface AddTarget { label: string; target: MaterialTarget }

interface Props {
  title?: string
  materials: CourseMaterial[]
  // Where "Upload"/"New note" can put things; the first is the default
  addTargets: AddTarget[]
  // Rater-course material can be tied to a day
  allowDay: boolean
  // Path the note editor's back link returns to
  returnTo: string
}

export function useCurrentPersonName(): string {
  const { user } = useAuth()
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  return people.find(p => p.id === user?.uid)?.name ?? user?.email ?? 'Unknown'
}

export function MaterialsSection({ title = 'Materials', materials, addTargets, allowDay, returnTo }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const myName = useCurrentPersonName()
  const fileInput = useRef<HTMLInputElement>(null)
  const mdInput = useRef<HTMLInputElement>(null)
  const [targetIndex, setTargetIndex] = useState(0)
  const [day, setDay] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState('')

  const target: MaterialTarget = { ...addTargets[targetIndex].target, day: allowDay && day ? Number(day) : null }
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['course-materials'] })

  async function handleFiles(files: FileList) {
    setError('')
    try {
      for (const [i, file] of [...files].entries()) {
        await uploadMaterialFile(file, target, myName, pct => setProgress(`Uploading ${i + 1}/${files.length} · ${pct}%`))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setProgress(null)
      if (fileInput.current) fileInput.current.value = ''
      refresh()
    }
  }

  async function handleNewNote() {
    const name = prompt('Title for the new note:')?.trim()
    if (!name) return
    const id = await createNote(name, target, myName)
    await refresh()
    navigate(`/courses/materials/${id}`, { state: { returnTo } })
  }

  // Turns existing .md/.txt files into editable notes (one note per file)
  async function handleImportMarkdown(files: FileList) {
    setError('')
    try {
      for (const file of [...files]) {
        const body = await file.text()
        await createNote(file.name.replace(/\.(md|markdown|txt)$/i, ''), target, myName, body)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      if (mdInput.current) mdInput.current.value = ''
      refresh()
    }
  }

  async function handleRename(m: CourseMaterial) {
    const name = prompt('Rename to:', m.title)?.trim()
    if (!name || name === m.title) return
    await updateDoc(doc(db, 'course_materials', m.id), { title: name, updatedByName: myName, updatedAt: serverTimestamp() })
    refresh()
  }

  async function handleDelete(m: CourseMaterial) {
    if (!confirm(`Delete "${m.title}"?${m.scope !== 'course' ? ` It's shared — it will disappear from ${SCOPE_LABELS[m.scope].toLowerCase()}.` : ''}`)) return
    await deleteMaterial(m)
    refresh()
  }

  function open(m: CourseMaterial) {
    if (m.kind === 'markdown') navigate(`/courses/materials/${m.id}`, { state: { returnTo } })
    else if (m.url) window.open(m.url, '_blank', 'noopener')
  }

  // Grouped by where each item is shared, in the order the add targets list them
  const scopeOrder = [...new Set([...addTargets.map(t => t.target.scope), 'course', 'rater', 'refresher', 'library'])] as CourseMaterial['scope'][]
  const groups = scopeOrder
    .map(scope => [scope, materials.filter(m => m.scope === scope)] as const)
    .filter(([, ms]) => ms.length > 0)
  const showGroupHeadings = new Set(materials.map(m => m.scope)).size > 1 || addTargets.length > 1

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{title} <span className="text-muted-foreground font-normal">({materials.length})</span></h2>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
        <span className="text-muted-foreground">Add to</span>
        {addTargets.length > 1 ? (
          <select
            value={targetIndex}
            onChange={e => setTargetIndex(Number(e.target.value))}
            className="border border-input rounded-md px-2 py-1 bg-background"
          >
            {addTargets.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
          </select>
        ) : (
          <span className="font-medium">{addTargets[0].label}</span>
        )}
        {allowDay && (
          <select value={day} onChange={e => setDay(e.target.value)} className="border border-input rounded-md px-2 py-1 bg-background">
            <option value="">Any day</option>
            {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>Day {d}</option>)}
          </select>
        )}
        <div className="flex gap-2 ml-auto">
          <Button size="sm" variant="outline" disabled={!!progress} onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5 mr-1.5" /> Upload files
          </Button>
          <Button size="sm" variant="outline" onClick={handleNewNote}>
            <Plus className="size-3.5 mr-1.5" /> New note
          </Button>
          <Button size="sm" variant="outline" onClick={() => mdInput.current?.click()} title="Bring in existing .md files as editable notes">
            <FileDown className="size-3.5 mr-1.5" /> Import .md
          </Button>
        </div>
        <input
          ref={mdInput} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only"
          onChange={e => e.target.files?.length && handleImportMarkdown(e.target.files)}
        />
        <input
          ref={fileInput} type="file" multiple className="sr-only"
          onChange={e => e.target.files?.length && handleFiles(e.target.files)}
        />
      </div>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {materials.length === 0 ? (
        <p className="text-sm text-muted-foreground">No materials yet — upload PDFs or other files, or write a note.</p>
      ) : (
        groups.map(([scope, ms]) => (
          <div key={scope} className="space-y-1">
            {showGroupHeadings && <h3 className="text-sm font-medium text-muted-foreground">{SCOPE_LABELS[scope]}</h3>}
            <ul className="rounded-md border divide-y">
              {ms.map(m => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  {m.kind === 'markdown'
                    ? <NotebookPen className="size-4 text-muted-foreground shrink-0" />
                    : <FileText className="size-4 text-muted-foreground shrink-0" />}
                  <button type="button" onClick={() => open(m)} className="flex-1 min-w-0 text-left truncate hover:underline">
                    {m.title}
                    {m.kind === 'file' && <ExternalLink className="inline size-3 ml-1 text-muted-foreground" />}
                  </button>
                  {m.day && <span className="text-xs text-muted-foreground border rounded px-1">Day {m.day}</span>}
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {m.kind === 'file' ? formatSize(m.size) : 'note'}
                    {m.updatedByName && ` · ${m.updatedByName}`}
                  </span>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Rename ${m.title}`} onClick={() => handleRename(m)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete ${m.title}`} onClick={() => handleDelete(m)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
