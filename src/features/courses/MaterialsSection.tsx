import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { FileText, NotebookPen, Upload, Plus, Trash2, Pencil, ExternalLink, FileDown, Eye, ListChecks } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { CourseMaterial, MaterialPlacement } from '@/types'
import {
  createNote, deleteMaterial, formatSize, uploadMaterialFile, placementLabel, SCOPE_LABELS, type MaterialTarget,
} from '@/lib/courseMaterials'
import { fetchPeople } from './CoursesPage'
import { Button } from '@/components/ui/button'

export interface AddTarget { label: string; target: MaterialTarget }

interface Props {
  title?: string
  materials: CourseMaterial[]
  // Where "Upload"/"New note" can put things; the first is the default
  addTargets: AddTarget[]
  // Days material can be tied to (5 for rater courses, 3 for refreshers);
  // 0 for none
  dayCount: number
  // RC sets refresher material can be filed under (RC3 notes but not RC4)
  rcNumbers?: number[]
  // Path the note editor's back link returns to
  returnTo: string
}

export function useCurrentPersonName(): string {
  const { user } = useAuth()
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  return people.find(p => p.id === user?.uid)?.name ?? user?.email ?? 'Unknown'
}

export function MaterialsSection({ title = 'Materials', materials, addTargets, dayCount, rcNumbers, returnTo }: Props) {
  const allowDay = dayCount > 0
  const dayNumbers = Array.from({ length: dayCount }, (_, i) => i + 1)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const myName = useCurrentPersonName()
  const fileInput = useRef<HTMLInputElement>(null)
  const mdInput = useRef<HTMLInputElement>(null)
  const [targetIndex, setTargetIndex] = useState(0)
  const [placingId, setPlacingId] = useState<string | null>(null)
  const [day, setDay] = useState('')
  const [rc, setRc] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState('')

  const baseTarget = addTargets[targetIndex].target
  // Refresher targets that don't fix an RC set let the user pick one
  const chooseRc = !!rcNumbers?.length && baseTarget.scope === 'refresher' && baseTarget.refresherNumber === undefined
  const target: MaterialTarget = {
    ...baseTarget,
    day: allowDay && day ? Number(day) : null,
    ...(chooseRc && { refresherNumber: rc ? Number(rc) : null }),
  }
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

  async function toggleSessionPlan(m: CourseMaterial) {
    await updateDoc(doc(db, 'course_materials', m.id), { isSessionPlan: !m.isSessionPlan, updatedByName: myName, updatedAt: serverTimestamp() })
    refresh()
  }

  async function changeDay(m: CourseMaterial, value: string) {
    await updateDoc(doc(db, 'course_materials', m.id), {
      day: value ? Number(value) : null, updatedByName: myName, updatedAt: serverTimestamp(),
    })
    refresh()
  }

  async function changeRc(m: CourseMaterial, value: string) {
    await updateDoc(doc(db, 'course_materials', m.id), {
      refresherNumber: value ? Number(value) : null, updatedByName: myName, updatedAt: serverTimestamp(),
    })
    refresh()
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
            {dayNumbers.map(d => <option key={d} value={d}>Day {d}</option>)}
          </select>
        )}
        {chooseRc && (
          <select value={rc} onChange={e => setRc(e.target.value)} aria-label="RC set" className="border border-input rounded-md px-2 py-1 bg-background">
            <option value="">All refreshers</option>
            {rcNumbers!.map(n => <option key={n} value={n}>RC{n} only</option>)}
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
                <li key={m.id} className="text-sm">
                  <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap">
                    {m.kind === 'markdown'
                      ? m.isSessionPlan
                        ? <ListChecks className="size-4 text-primary shrink-0" />
                        : <NotebookPen className="size-4 text-muted-foreground shrink-0" />
                      : <FileText className="size-4 text-muted-foreground shrink-0" />}
                    <button type="button" onClick={() => open(m)} className="flex-1 min-w-0 text-left truncate hover:underline">
                      {m.title}
                      {m.kind === 'file' && <ExternalLink className="inline size-3 ml-1 text-muted-foreground" />}
                    </button>
                    {m.isSessionPlan && <span className="text-[10px] text-primary border border-primary/40 rounded px-1">session plan</span>}
                    {allowDay && m.scope !== 'library' ? (
                      // The day can be corrected in place
                      <select
                        value={m.day ?? ''}
                        onChange={e => changeDay(m, e.target.value)}
                        aria-label={`Day for ${m.title}`}
                        className={`text-xs border rounded px-1 py-0.5 bg-background ${m.day ? '' : 'text-muted-foreground'}`}
                      >
                        <option value="">Any day</option>
                        {[...new Set([...dayNumbers, ...(m.day ? [m.day] : [])])].sort((a, b) => a - b)
                          .map(d => <option key={d} value={d}>Day {d}</option>)}
                      </select>
                    ) : m.day ? (
                      <span className="text-xs text-muted-foreground border rounded px-1">Day {m.day}</span>
                    ) : null}
                    {m.scope === 'refresher' && (rcNumbers?.length ? (
                      // Refresher material: which RC set it belongs to, correctable in place
                      <select
                        value={m.refresherNumber ?? ''}
                        onChange={e => changeRc(m, e.target.value)}
                        aria-label={`RC set for ${m.title}`}
                        className={`text-xs border rounded px-1 py-0.5 bg-background ${m.refresherNumber ? '' : 'text-muted-foreground'}`}
                      >
                        <option value="">All refreshers</option>
                        {[...new Set([...rcNumbers, ...(m.refresherNumber ? [m.refresherNumber] : [])])].sort((a, b) => a - b)
                          .map(n => <option key={n} value={n}>RC{n}</option>)}
                      </select>
                    ) : m.refresherNumber ? (
                      <span className="text-xs text-muted-foreground border rounded px-1">RC{m.refresherNumber}</span>
                    ) : null)}
                    {m.scope === 'library' && (
                      (m.showIn ?? []).length
                        ? (m.showIn ?? []).map(p => (
                            <span key={`${p.kind}-${p.day ?? 'any'}-${p.number ?? 'all'}`} className="text-[10px] text-teal-800 bg-teal-50 border border-teal-200 rounded px-1">{placementLabel(p)}</span>
                          ))
                        : <span className="text-[10px] text-muted-foreground border rounded px-1">Not on any course</span>
                    )}
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {m.kind === 'file' ? formatSize(m.size) : 'note'}
                      {m.updatedByName && ` · ${m.updatedByName}`}
                    </span>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Rename ${m.title}`} onClick={() => handleRename(m)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    {m.kind === 'markdown' && (
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        aria-pressed={!!m.isSessionPlan}
                        onClick={() => toggleSessionPlan(m)}
                        title={m.isSessionPlan ? 'Stop using this as a session plan' : 'Show this note open at the top of Teach, with T-numbers as play buttons'}
                      >
                        {m.isSessionPlan ? 'Unset plan' : 'Make plan'}
                      </Button>
                    )}
                    {m.scope === 'library' && (
                      <Button
                        variant={placingId === m.id ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs"
                        aria-expanded={placingId === m.id}
                        onClick={() => setPlacingId(placingId === m.id ? null : m.id)}
                      >
                        <Eye className="size-3.5 mr-1" /> Show in…
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete ${m.title}`} onClick={() => handleDelete(m)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  {placingId === m.id && (
                    <PlacementEditor material={m} rcNumbers={rcNumbers ?? []} onDone={() => { setPlacingId(null); refresh() }} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}

// Where a General document also appears. "Any day" and specific days are
// mutually exclusive for rater courses — any day already shows on every day.
function PlacementEditor({ material, rcNumbers, onDone }: { material: CourseMaterial; rcNumbers: number[]; onDone: () => void }) {
  const initial = material.showIn ?? []
  const [raterAny, setRaterAny] = useState(initial.some(p => p.kind === 'rater' && !p.day))
  const [raterDays, setRaterDays] = useState<number[]>(initial.filter(p => p.kind === 'rater' && p.day).map(p => p.day!))
  // Same pattern for refreshers: every refresher, or particular RC sets
  const [refresherAll, setRefresherAll] = useState(initial.some(p => p.kind === 'refresher' && !p.number))
  const [refresherSets, setRefresherSets] = useState<number[]>(initial.filter(p => p.kind === 'refresher' && p.number).map(p => p.number!))
  const rcChoices = [...new Set([...rcNumbers, ...refresherSets])].sort((a, b) => a - b)
  // …and on any day of those refreshers, or particular days (1–3)
  const [refresherDays, setRefresherDays] = useState<number[]>(
    [...new Set(initial.filter(p => p.kind === 'refresher' && p.day).map(p => p.day!))].sort())
  const [saving, setSaving] = useState(false)

  function toggleDay(d: number) {
    setRaterAny(false)
    setRaterDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort())
  }

  function toggleSet(n: number) {
    setRefresherAll(false)
    setRefresherSets(ns => ns.includes(n) ? ns.filter(x => x !== n) : [...ns, n].sort((a, b) => a - b))
  }

  async function save() {
    const sets = refresherAll ? [null] : refresherSets
    const days = refresherDays.length ? refresherDays : [null]
    const showIn: MaterialPlacement[] = [
      ...(raterAny ? [{ kind: 'rater' as const, day: null }] : raterDays.map(d => ({ kind: 'rater' as const, day: d }))),
      ...sets.flatMap(n => days.map(d => ({ kind: 'refresher' as const, day: d, number: n }))),
    ]
    setSaving(true)
    try {
      await updateDoc(doc(db, 'course_materials', material.id), { showIn })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const chip = (on: boolean) =>
    `px-2 py-0.5 rounded border text-xs ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-muted'}`

  return (
    <div className="mx-3 mb-2 rounded-md border bg-muted/30 p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        Also show this document on courses — it stays one General document, so edits show everywhere.
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-medium w-28">Rater courses</span>
        <button type="button" aria-pressed={raterAny} className={chip(raterAny)} onClick={() => { setRaterAny(!raterAny); setRaterDays([]) }}>Any day</button>
        {[1, 2, 3, 4, 5].map(d => (
          <button key={d} type="button" aria-pressed={raterDays.includes(d)} className={chip(raterDays.includes(d))} onClick={() => toggleDay(d)}>Day {d}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-medium w-28">Refresher courses</span>
        <button type="button" aria-pressed={refresherAll} className={chip(refresherAll)} onClick={() => { setRefresherAll(!refresherAll); setRefresherSets([]) }}>All refreshers</button>
        {rcChoices.map(n => (
          <button key={n} type="button" aria-pressed={refresherSets.includes(n)} className={chip(refresherSets.includes(n))} onClick={() => toggleSet(n)}>RC{n}</button>
        ))}
      </div>
      {(refresherAll || refresherSets.length > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium w-28">…on</span>
          <button type="button" aria-pressed={!refresherDays.length} className={chip(!refresherDays.length)} onClick={() => setRefresherDays([])}>Any day</button>
          {[1, 2, 3].map(d => (
            <button
              key={d} type="button" aria-pressed={refresherDays.includes(d)} className={chip(refresherDays.includes(d))}
              onClick={() => setRefresherDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort())}
            >
              Day {d}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}
