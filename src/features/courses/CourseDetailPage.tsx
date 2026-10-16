import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ChevronLeft, Play, Square, X, RefreshCw, UserPlus } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import type { Course, CourseAttendee, Person, Test } from '@/types'
import {
  fetchCourses, mergeAttendees, cohortExposure, raterCourseSet,
} from '@/lib/courses'
import { formatTestNumber } from '@/lib/testNumber'
import { CourseDrawer } from './CourseDrawer'
import { fetchPeople, fetchAllTests, formatDateRange } from './CoursesPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface CanvasSection { id: number; name: string; courseName: string; displayName: string }
interface CanvasUser { canvasId: number; name: string; email: string }

const canvasSectionsFn = httpsCallable<void, { sections: CanvasSection[] }>(functions, 'canvasSections')
const sectionEnrollmentsFn = httpsCallable<{ sectionId: number }, { users: CanvasUser[] }>(functions, 'canvasSectionEnrollments')

export function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)

  const { data: courses = [], isLoading } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchAllTests })

  const course = courses.find(c => c.id === courseId)
  const testById = useMemo(() => new Map(tests.map(t => [t.id, t])), [tests])

  async function save(patch: Partial<Course>) {
    if (!course) return
    await updateDoc(doc(db, 'courses', course.id), patch)
    await queryClient.invalidateQueries({ queryKey: ['courses'] })
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!course) return <p className="text-sm text-muted-foreground">Course not found. <Link to="/courses" className="underline">Back to Courses</Link></p>

  const trainerNames = (course.trainerIds ?? [])
    .map(id => people.find(p => p.id === id)?.name)
    .filter(Boolean)

  const togglePlay = (url: string) => setPlayingUrl(playingUrl === url ? null : url)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/courses" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Courses
        </Link>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">{course.name}</h1>
            <p className="text-sm text-muted-foreground">
              {course.kind === 'refresher' ? 'Refresher course' : 'Rater course'} · {formatDateRange(course)}
              {trainerNames.length > 0 && <> · Trainer{trainerNames.length > 1 ? 's' : ''}: {trainerNames.join(', ')}</>}
            </p>
            {course.notes && <p className="text-sm mt-1 whitespace-pre-wrap">{course.notes}</p>}
          </div>
          <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
        </div>
      </div>

      {playingUrl && (
        <audio controls autoPlay src={playingUrl} className="w-full sticky top-2 z-10" onEnded={() => setPlayingUrl(null)} />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <AttendeesSection course={course} people={people} save={save} />
        <AudioSection
          course={course}
          courses={courses}
          tests={tests}
          testById={testById}
          playingUrl={playingUrl}
          onPlay={togglePlay}
          save={save}
        />
      </div>

      <CourseDrawer
        open={editing}
        onClose={() => setEditing(false)}
        kind={course.kind}
        course={course}
        people={people}
        tests={tests}
        onDeleted={() => navigate('/courses')}
      />
    </div>
  )
}

// ── attendees ──────────────────────────────────────────────────────────────

function AttendeesSection({ course, people, save }: {
  course: Course
  people: Person[]
  save: (p: Partial<Course>) => Promise<void>
}) {
  const [sections, setSections] = useState<CanvasSection[] | null>(null)
  const [sectionId, setSectionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')

  async function loadSections() {
    setError('')
    try {
      const res = await canvasSectionsFn()
      setSections(res.data.sections)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Canvas sections')
    }
  }

  async function pullSection(id: number, name: string) {
    setBusy(true); setError('')
    try {
      const res = await sectionEnrollmentsFn({ sectionId: id })
      const incoming: CourseAttendee[] = res.data.users.map(u => ({ canvasUserId: u.canvasId, name: u.name, email: u.email }))
      const linked = course.canvasSections ?? []
      await save({
        attendees: mergeAttendees(course.attendees ?? [], incoming, people),
        canvasSections: linked.some(s => s.id === id) ? linked : [...linked, { id, name }],
      })
      setSectionId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fetch the section from Canvas')
    } finally {
      setBusy(false)
    }
  }

  async function addManual() {
    const text = manual.trim()
    if (!text) return
    const person = people.find(p => `${p.name} <${p.email}>` === text || p.email.toLowerCase() === text.toLowerCase())
    const incoming: CourseAttendee = person
      ? { personId: person.id, name: person.name, email: person.email }
      : text.includes('@') ? { name: text, email: text } : { name: text }
    await save({ attendees: mergeAttendees(course.attendees ?? [], [incoming], people) })
    setManual('')
  }

  async function remove(index: number) {
    await save({ attendees: (course.attendees ?? []).filter((_, i) => i !== index) })
  }

  const attendees = course.attendees ?? []

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Attendees <span className="text-muted-foreground font-normal">({attendees.length})</span></h2>
      </div>

      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-medium">From Canvas</p>
        {(course.canvasSections ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {course.canvasSections!.map(s => (
              <Button key={s.id} size="sm" variant="outline" disabled={busy} onClick={() => pullSection(s.id, s.name)} title="Pull this section's students again">
                <RefreshCw className="size-3.5 mr-1.5" /> {s.name}
              </Button>
            ))}
          </div>
        )}
        {sections === null ? (
          <Button size="sm" variant="outline" onClick={loadSections}>Link a Canvas section…</Button>
        ) : (
          <div className="flex gap-2">
            <select
              value={sectionId}
              onChange={e => setSectionId(e.target.value)}
              className="flex-1 min-w-0 border border-input rounded-md px-2 py-1.5 text-sm bg-background"
            >
              <option value="">Choose a section…</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </select>
            <Button
              size="sm"
              disabled={!sectionId || busy}
              onClick={() => {
                const s = sections.find(x => String(x.id) === sectionId)!
                pullSection(s.id, s.displayName)
              }}
            >
              {busy ? 'Pulling…' : 'Pull students'}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Sections that ended more than a week ago aren't listed — add those attendees by hand.</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex gap-2">
        <Input
          list="course-people"
          value={manual}
          onChange={e => setManual(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual() } }}
          placeholder="Add a person by name or email…"
        />
        <datalist id="course-people">
          {people.map(p => <option key={p.id} value={`${p.name} <${p.email}>`} />)}
        </datalist>
        <Button variant="outline" onClick={addManual} disabled={!manual.trim()}>
          <UserPlus className="size-4" />
        </Button>
      </div>

      {attendees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attendees yet.</p>
      ) : (
        <ul className="rounded-md border divide-y">
          {attendees.map((a, i) => (
            <li key={`${a.personId ?? a.canvasUserId ?? a.email ?? a.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{a.name}</span>
                {a.email && <span className="text-muted-foreground ml-2 text-xs">{a.email}</span>}
              </div>
              {!a.personId && (
                <span className="text-[10px] text-muted-foreground border rounded px-1" title="No RaterSystem person record — tracked by name/email only">
                  not in People
                </span>
              )}
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${a.name}`} onClick={() => remove(i)}>
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── audio ────────────────────────────────────────────────────────────────────

function AudioSection({ course, courses, tests, testById, playingUrl, onPlay, save }: {
  course: Course
  courses: Course[]
  tests: Test[]
  testById: Map<string, Test>
  playingUrl: string | null
  onPlay: (url: string) => void
  save: (p: Partial<Course>) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const courseTests = (course.testDocIds ?? []).map(id => testById.get(id)).filter((t): t is Test => !!t)
  const missing = (course.testDocIds ?? []).length - courseTests.length

  async function remove(id: string) {
    await save({ testDocIds: (course.testDocIds ?? []).filter(x => x !== id) })
  }

  async function resyncRaterSet() {
    const set = raterCourseSet(tests)
    if (!confirm(`Replace this course's audio with the current Rater Course set (${set.length} recordings)? Attendees will then count as having heard exactly those.`)) return
    await save({ testDocIds: set.map(t => t.id) })
  }

  // Rater runs are grouped by the day each recording is tagged with
  const groups: [string, Test[]][] = course.kind === 'rater'
    ? [1, 2, 3, 4, 5, 0]
        .map(d => [d ? `Day ${d}` : 'Other', courseTests.filter(t => (t.raterCourseDay ?? 0) === d)] as [string, Test[]])
        .filter(([, ts]) => ts.length > 0)
    : [['', courseTests]]

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Audio <span className="text-muted-foreground font-normal">({courseTests.length})</span></h2>
        {course.kind === 'rater' ? (
          <Button size="sm" variant="outline" onClick={resyncRaterSet}>Update from Rater Course set</Button>
        ) : (
          <Button size="sm" onClick={() => setAdding(a => !a)}>{adding ? 'Done adding' : 'Add audio'}</Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Everyone on this course counts as having heard all of this audio.</p>

      {adding && course.kind === 'refresher' && (
        <AddAudioPanel course={course} courses={courses} tests={tests} playingUrl={playingUrl} onPlay={onPlay} save={save} />
      )}

      {courseTests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {course.kind === 'rater'
            ? 'No audio — tag Training recordings with a Rater Course day in Test Bank, then update from the set.'
            : 'No audio yet — use Add audio to choose recordings from the Training pool.'}
        </p>
      ) : (
        groups.map(([label, ts]) => (
          <div key={label || 'all'} className="space-y-1">
            {label && <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>}
            <ul className="rounded-md border divide-y">
              {ts.map(t => (
                <TestRow key={t.id} test={t} playing={playingUrl === t.recordingUrl} onPlay={onPlay}>
                  {course.kind === 'refresher' && (
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Remove from course" onClick={() => remove(t.id)}>
                      <X className="size-3.5" />
                    </Button>
                  )}
                </TestRow>
              ))}
            </ul>
          </div>
        ))
      )}
      {missing > 0 && <p className="text-xs text-amber-700">{missing} recording{missing === 1 ? ' is' : 's are'} no longer in Test Bank.</p>}
    </section>
  )
}

function TestRow({ test, playing, onPlay, children }: {
  test: Test
  playing: boolean
  onPlay: (url: string) => void
  children?: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 text-sm">
      <Button variant="ghost" size="icon" className="size-7" aria-label={playing ? 'Stop' : 'Play'} onClick={() => onPlay(test.recordingUrl)}>
        {playing ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <span className="font-mono text-xs text-muted-foreground w-10 shrink-0">{formatTestNumber(test.testId, test.category)}</span>
      <span className="flex-1 min-w-0 truncate">{test.candidateName}</span>
      <Badge variant="outline" className="hidden sm:inline-flex">{test.testType}</Badge>
      {children}
    </li>
  )
}

function AddAudioPanel({ course, courses, tests, playingUrl, onPlay, save }: {
  course: Course
  courses: Course[]
  tests: Test[]
  playingUrl: string | null
  onPlay: (url: string) => void
  save: (p: Partial<Course>) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [onlyNew, setOnlyNew] = useState(true)
  // Everyone on a refresher did the Initial Rater Course at some point, so
  // its fixed set is assumed heard even where that run isn't recorded here.
  const [hideRaterSet, setHideRaterSet] = useState(true)

  const exposure = useMemo(() => cohortExposure(courses, course), [courses, course])
  const inCourse = new Set(course.testDocIds ?? [])

  const candidates = tests
    .filter(t => t.category === 'training' && t.status === 'active' && !inCourse.has(t.id))
    .filter(t => !hideRaterSet || !t.raterCourseDay)
    .filter(t => !onlyNew || !exposure.has(t.id))
    .filter(t => {
      const s = search.toLowerCase()
      return !s || t.candidateName.toLowerCase().includes(s) || t.testType.toLowerCase().includes(s) || formatTestNumber(t.testId, t.category).toLowerCase() === s
    })
    .sort((a, b) => (exposure.get(a.id)?.length ?? 0) - (exposure.get(b.id)?.length ?? 0) || (a.testId ?? 999) - (b.testId ?? 999))

  async function add(id: string) {
    await save({ testDocIds: [...(course.testDocIds ?? []), id] })
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Training audio…" className="w-56 bg-background" />
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} />
          New to everyone on this course
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={hideRaterSet} onChange={e => setHideRaterSet(e.target.checked)} />
          Hide Rater Course set
        </label>
      </div>
      {course.attendees.length === 0 && (
        <p className="text-xs text-amber-700">Add attendees first — "new to everyone" can only check people who are on the course.</p>
      )}
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No matching Training audio.</p>
      ) : (
        <ul className="rounded-md border divide-y bg-background max-h-96 overflow-y-auto">
          {candidates.map(t => {
            const heard = exposure.get(t.id)
            return (
              <TestRow key={t.id} test={t} playing={playingUrl === t.recordingUrl} onPlay={onPlay}>
                {heard && (
                  <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5" title={`Already heard by: ${heard.join(', ')}`}>
                    heard by {heard.length}
                  </span>
                )}
                <Button size="sm" variant="outline" className="h-7" onClick={() => add(t.id)}>Add</Button>
              </TestRow>
            )
          })}
        </ul>
      )}
    </div>
  )
}
