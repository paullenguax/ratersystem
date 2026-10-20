import { useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, Play, Pause, FileText, NotebookPen, ExternalLink, Printer, Users, MessageSquareText } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Course, CourseMaterial, Test } from '@/types'
import { fetchCourses } from '@/lib/courses'
import { fetchMaterials, materialDays, materialsForCourse } from '@/lib/courseMaterials'
import { formatTestNumber } from '@/lib/testNumber'
import { printDocument } from '@/lib/printDocument'
import { fetchAllTests, formatDateRange } from './CoursesPage'
import { TeachingNotesView } from './TeachingNotes'
import { useCurrentPersonName } from './MaterialsSection'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

const SPEEDS = [0.75, 1, 1.25, 1.5]
// Tab keys: '1'…'5' (Rater Course days), 'extra' (added for this run),
// 'all' (refreshers — no day-by-day)
type Tab = string

export function TeachPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [nowPlaying, setNowPlaying] = useState<Test | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const myName = useCurrentPersonName()
  // Which recordings have their teaching notes open, and which one is being edited
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set())
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const { data: courses = [], isLoading } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchAllTests })
  const { data: materials = [] } = useQuery({ queryKey: ['course-materials'], queryFn: fetchMaterials })

  const course = courses.find(c => c.id === courseId)
  const testById = useMemo(() => new Map(tests.map(t => [t.id, t])), [tests])
  const courseTests = (course?.testDocIds ?? []).map(id => testById.get(id)).filter((t): t is Test => !!t)

  const tabs: { key: Tab; label: string; tests: Test[] }[] = !course ? [] : course.kind === 'rater'
    ? [
        ...[1, 2, 3, 4, 5].map(d => ({ key: String(d), label: `Day ${d}`, tests: courseTests.filter(t => t.raterCourseDay === d) })),
        { key: 'extra', label: 'Added for this run', tests: courseTests.filter(t => !t.raterCourseDay) },
      ].filter(t => t.key !== 'extra' || t.tests.length > 0)
    : [{ key: 'all', label: 'Audio', tests: courseTests }]
  const tab = tabs.find(t => t.key === params.get('day')) ?? tabs[0]

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!course || !tab) return <p className="text-sm text-muted-foreground">Course not found. <Link to="/courses" className="underline">Back to Courses</Link></p>

  const played = course.playedAt ?? {}
  const playedCount = (ts: Test[]) => ts.filter(t => played[t.id]).length

  async function setPlayed(testId: string, value: boolean) {
    await updateDoc(doc(db, 'courses', course!.id), { [`playedAt.${testId}`]: value ? serverTimestamp() : deleteField() })
    queryClient.invalidateQueries({ queryKey: ['courses'] })
  }

  async function resetTab() {
    if (!confirm(`Untick all ${tab.label.toLowerCase()} audio?`)) return
    const patch: Record<string, unknown> = {}
    tab.tests.forEach(t => { patch[`playedAt.${t.id}`] = deleteField() })
    await updateDoc(doc(db, 'courses', course!.id), patch)
    queryClient.invalidateQueries({ queryKey: ['courses'] })
  }

  function toggleNotes(id: string) {
    setOpenNotes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function saveNotes(t: Test) {
    setSavingNotes(true)
    try {
      await updateDoc(doc(db, 'test_bank', t.id), {
        teachingNotes: draft,
        teachingNotesUpdatedBy: myName,
        teachingNotesUpdatedAt: serverTimestamp(),
      })
      await queryClient.invalidateQueries({ queryKey: ['tests'] })
      setEditingNotes(null)
    } finally {
      setSavingNotes(false)
    }
  }

  // Jump to a teaching-note timestamp, loading that recording first if needed
  function seek(t: Test, seconds: number) {
    const el = audioRef.current
    if (!el) return
    if (nowPlaying?.id !== t.id) {
      setNowPlaying(t)
      el.src = t.recordingUrl
      el.addEventListener('loadedmetadata', () => { el.currentTime = seconds; el.play() }, { once: true })
      return
    }
    el.currentTime = seconds
    el.play()
  }

  function playToggle(t: Test) {
    const el = audioRef.current
    if (!el) return
    if (nowPlaying?.id === t.id) {
      if (el.paused) el.play(); else el.pause()
      return
    }
    setNowPlaying(t)
    el.src = t.recordingUrl
    el.playbackRate = speed
    el.play()
  }

  // This day's materials first, then the ones for the whole course
  const allMaterials = materialsForCourse(materials, course)
  const dayNumber = Number(tab.key)
  const dayMaterials = course.kind === 'rater' && dayNumber ? allMaterials.filter(m => materialDays(m, course).includes(dayNumber)) : []
  const generalMaterials = allMaterials.filter(m => materialDays(m, course).includes(null))
  // Every General document, folded at the bottom — minus any already shown above
  const shownIds = new Set([...dayMaterials, ...generalMaterials].map(m => m.id))
  const libraryDocs = materials.filter(m => m.scope === 'library' && !shownIds.has(m.id))

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link to={`/courses/${course.id}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> {course.name}
        </Link>
        <h1 className="text-2xl font-semibold">Teach: {course.name}</h1>
        <p className="text-sm text-muted-foreground">{formatDateRange(course)} · {course.attendees?.length ?? 0} students · {playedCount(courseTests)} of {courseTests.length} recordings played</p>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 flex-wrap border-b" role="tablist">
          {tabs.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === tab.key}
              onClick={() => setParams({ day: t.key }, { replace: true })}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${t.key === tab.key ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
              {t.tests.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{playedCount(t.tests)}/{t.tests.length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Player — one recording at a time, played to the room */}
      <div className={`sticky top-2 z-10 rounded-md border bg-background p-3 space-y-2 shadow-sm ${nowPlaying ? '' : 'hidden'}`}>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium">
            {nowPlaying && <>{formatTestNumber(nowPlaying.testId, nowPlaying.category)} — {nowPlaying.candidateName}</>}
          </span>
          <span className="text-muted-foreground">{nowPlaying?.testType}</span>
          <div className="ml-auto flex gap-1" aria-label="Playback speed">
            {SPEEDS.map(s => (
              <button
                key={s}
                onClick={() => { setSpeed(s); if (audioRef.current) audioRef.current.playbackRate = s }}
                className={`px-2 py-0.5 rounded border text-xs ${speed === s ? 'bg-primary text-primary-foreground border-primary' : 'border-input'}`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <audio
          ref={audioRef}
          controls
          className="w-full"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = speed }}
          // Ticks the recording off once it has played to the end
          onEnded={() => { setIsPlaying(false); if (nowPlaying && !played[nowPlaying.id]) setPlayed(nowPlaying.id, true) }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6 min-w-0">
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {tab.label === 'Audio' ? 'Audio' : `${tab.label} audio`}
                <span className="text-muted-foreground font-normal text-base ml-2 tabular-nums">{playedCount(tab.tests)} of {tab.tests.length} played</span>
              </h2>
              {playedCount(tab.tests) > 0 && <Button size="sm" variant="ghost" onClick={resetTab}>Untick all</Button>}
            </div>
            {tab.tests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recordings for {tab.label.toLowerCase()} — tag them in Test Bank and use “Update from set” on the course page.
              </p>
            ) : (
              <ul className="rounded-md border divide-y">
                {tab.tests.map(t => {
                  const isCurrent = nowPlaying?.id === t.id
                  const when = played[t.id]?.toDate?.()
                  const hasNotes = !!t.teachingNotes?.trim()
                  const notesOpen = openNotes.has(t.id)
                  return (
                    <li key={t.id} className={isCurrent ? 'bg-primary/5' : ''}>
                      <div className="flex items-center gap-3 px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={!!played[t.id]}
                          onChange={e => setPlayed(t.id, e.target.checked)}
                          aria-label={`Played ${t.candidateName}`}
                        />
                        <Button variant={isCurrent && isPlaying ? 'default' : 'outline'} size="icon" className="size-8 shrink-0" onClick={() => playToggle(t)} aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}>
                          {isCurrent && isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                        </Button>
                        <span className="font-mono text-xs text-muted-foreground w-10 shrink-0">{formatTestNumber(t.testId, t.category)}</span>
                        <span className={`flex-1 min-w-0 truncate text-sm ${played[t.id] ? 'text-muted-foreground line-through decoration-1' : ''}`}>{t.candidateName}</span>
                        <Badge variant="outline" className="hidden sm:inline-flex">{t.testType}</Badge>
                        <span className="text-xs text-muted-foreground w-12 text-right hidden sm:inline">
                          {when ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                        <Button
                          variant={notesOpen ? 'secondary' : 'ghost'}
                          size="icon"
                          className={`size-8 shrink-0 ${hasNotes ? 'text-primary' : 'text-muted-foreground/50'}`}
                          onClick={() => toggleNotes(t.id)}
                          aria-expanded={notesOpen}
                          aria-label={hasNotes ? `Teaching notes for ${t.candidateName}` : `Add teaching notes for ${t.candidateName}`}
                          title={hasNotes ? 'Teaching notes' : 'No teaching notes yet — click to add'}
                        >
                          <MessageSquareText className="size-4" />
                        </Button>
                      </div>
                      {notesOpen && (
                        <div className="px-3 pb-3 pl-[4.75rem]">
                          {editingNotes === t.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                rows={6}
                                autoFocus
                                className="font-mono text-xs"
                                placeholder={'What to point out to the class, e.g.\n0:42 — listen for the readback error\n- **Fluency**: long pauses before numbers'}
                              />
                              <div className="flex items-center gap-2">
                                <Button size="sm" onClick={() => saveNotes(t)} disabled={savingNotes}>{savingNotes ? 'Saving…' : 'Save notes'}</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>Cancel</Button>
                                <span className="text-xs text-muted-foreground">Shared by every course that plays this recording. m:ss timestamps become jump buttons.</span>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
                              {hasNotes
                                ? <TeachingNotesView markdown={t.teachingNotes!} onSeek={sec => seek(t, sec)} />
                                : <p className="text-sm text-muted-foreground">No teaching notes for this recording yet.</p>}
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <button type="button" className="underline hover:text-foreground" onClick={() => { setDraft(t.teachingNotes ?? ''); setEditingNotes(t.id) }}>
                                  {hasNotes ? 'Edit' : 'Add notes'}
                                </button>
                                {t.teachingNotesUpdatedBy && <span>· last edited by {t.teachingNotesUpdatedBy}</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {dayMaterials.length > 0 && <MaterialsList title={`${tab.label} materials`} items={dayMaterials} courseName={course.name} />}
          <MaterialsList title={course.kind === 'rater' ? 'Whole-course materials' : 'Materials'} items={generalMaterials} courseName={course.name} emptyHint />
          {libraryDocs.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-lg font-semibold">
                General documents <span className="text-muted-foreground font-normal text-base">({libraryDocs.length})</span>
              </summary>
              <div className="pt-2">
                <MaterialsList title="" items={libraryDocs} courseName={course.name} />
              </div>
            </details>
          )}
        </div>

        <aside className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="size-4" /> Students <span className="text-muted-foreground font-normal text-base">({course.attendees?.length ?? 0})</span></h2>
          {(course.attendees ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No students yet — add them on the <Link to={`/courses/${course.id}`} className="underline">course page</Link>.</p>
          ) : (
            <ol className="rounded-md border divide-y text-sm">
              {course.attendees.map((a, i) => (
                <li key={i} className="px-3 py-1.5 flex gap-2">
                  <span className="text-muted-foreground tabular-nums w-5 text-right">{i + 1}</span>
                  <span>{a.name}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  )
}

function MaterialsList({ title, items, courseName, emptyHint }: {
  title: string
  items: CourseMaterial[]
  courseName: Course['name']
  emptyHint?: boolean
}) {
  return (
    <section className="space-y-2">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {items.length === 0 ? (
        emptyHint ? <p className="text-sm text-muted-foreground">No materials — add them on the course page or under Materials &amp; documents.</p> : null
      ) : (
        <ul className="space-y-2">
          {items.map(m => m.kind === 'markdown' ? (
            <NoteItem key={m.id} note={m} courseName={courseName} />
          ) : (
            <li key={m.id} className="rounded-md border px-3 py-2 text-sm">
              <a href={m.url ?? undefined} target="_blank" rel="noopener" className="flex items-center gap-2 hover:underline">
                <FileText className="size-4 text-muted-foreground" /> {m.title} <ExternalLink className="size-3 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Notes open in place, already formatted, so a trainer can read from them mid-session
function NoteItem({ note, courseName }: { note: CourseMaterial; courseName: string }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <li className="rounded-md border">
      <details>
        <summary className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
          <NotebookPen className="size-4 text-muted-foreground" />
          <span className="flex-1">{note.title}</span>
          <Link to={`/courses/materials/${note.id}`} className="text-xs text-muted-foreground hover:underline" onClick={e => e.stopPropagation()}>Edit</Link>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Print ${note.title}`}
            onClick={e => {
              e.preventDefault()
              if (bodyRef.current) printDocument({ title: note.title, html: bodyRef.current.innerHTML, subtitle: courseName })
            }}
          >
            <Printer className="size-3.5" />
          </button>
        </summary>
        <div ref={bodyRef} className="manual-prose border-t px-4 py-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.markdown ?? ''}</ReactMarkdown>
        </div>
      </details>
    </li>
  )
}
