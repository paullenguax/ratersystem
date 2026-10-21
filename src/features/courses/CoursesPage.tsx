import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import { Plus, Search } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Course, Person, Test } from '@/types'
import { fetchCourses, latestRefresherNumber, normName, setForCourse } from '@/lib/courses'
import { CourseDrawer } from './CourseDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export async function fetchPeople(): Promise<Person[]> {
  return (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person)
}

export async function fetchAllTests(): Promise<Test[]> {
  return (await getDocs(collection(db, 'test_bank'))).docs.map(d => ({ id: d.id, ...d.data() }) as Test)
}

export function formatDateRange(c: Pick<Course, 'startDate' | 'endDate'>): string {
  const fmt = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (!c.startDate) return '—'
  return c.endDate && c.endDate !== c.startDate ? `${fmt(c.startDate)} – ${fmt(c.endDate)}` : fmt(c.startDate)
}

// How many finished courses show under Recent before the rest fold into Earlier
const RECENT_COUNT = 3

export function CoursesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState<Course['kind'] | null>(null)

  const { data: courses = [], isLoading } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchAllTests })
  const queryClient = useQueryClient()

  // Runs created before their set was tagged (e.g. imported past courses)
  // have no audio; this gives each one its set in one go.
  const emptyRuns = courses.filter(c => !(c.testDocIds?.length))
  const fillable = emptyRuns
    .map(c => ({ course: c, set: setForCourse(tests, c) }))
    .filter(x => x.set.length > 0)

  async function applySets() {
    if (!confirm(`Give ${fillable.length} course${fillable.length === 1 ? '' : 's'} with no audio the recordings from their set? Their attendees will then count as having heard them.`)) return
    // Firestore batches cap at 500 writes
    for (let i = 0; i < fillable.length; i += 450) {
      const batch = writeBatch(db)
      fillable.slice(i, i + 450).forEach(({ course, set }) =>
        batch.update(doc(db, 'courses', course.id), { testDocIds: set.map(t => t.id) }))
      await batch.commit()
    }
    queryClient.invalidateQueries({ queryKey: ['courses'] })
  }

  // Set tabs (URL ?set=all|initial|rc3) and a person/course search
  const tabKey = params.get('set') ?? 'all'
  const setTab = (key: string) => setParams(key === 'all' ? {} : { set: key }, { replace: true })
  const rcNumbers = [...new Set(courses.filter(c => c.kind === 'refresher').map(c => c.number ?? 0))].sort((a, b) => a - b)
  const inSet = (c: Course, key: string) =>
    key === 'all' || (key === 'initial' ? c.kind === 'rater' : c.kind === 'refresher' && `rc${c.number ?? 0}` === key)
  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'initial', label: 'Initial' },
    ...rcNumbers.map(n => ({ key: `rc${n}`, label: n ? `RC${n}` : 'RC?' })),
  ].map(t => ({ ...t, count: courses.filter(c => inSet(c, t.key)).length }))
  const inTab = courses.filter(c => inSet(c, tabKey))

  const query = normName(search)
  const matchedNames = new Map<string, string[]>()
  const matches = !query ? [] : inTab.filter(c => {
    const names = (c.attendees ?? []).filter(a => normName(a.name).includes(query)).map(a => a.name)
    if (names.length) matchedNames.set(c.id, names)
    return names.length > 0 || normName(c.name).includes(query)
  })

  // Coming up: running now or in the future, soonest first. Recent: the last
  // few that have finished, newest first. Earlier: everything else.
  const today = new Date().toISOString().slice(0, 10)
  const comingUp = inTab
    .filter(c => !!c.startDate && (c.endDate ?? c.startDate) >= today)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!))
  const finished = inTab.filter(c => !comingUp.includes(c)) // already newest first; undated last
  const recent = finished.filter(c => c.startDate).slice(0, RECENT_COUNT)
  const earlier = finished.filter(c => !recent.includes(c))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Courses</h1>
          <p className="text-sm text-muted-foreground">Each rater or refresher course: who attended and the audio they heard.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" nativeButton={false} render={<Link to="/courses/materials" />}>Materials &amp; documents</Button>
          <Button variant="ghost" nativeButton={false} render={<Link to="/courses/import" />}>Import past courses</Button>
          <Button variant="outline" onClick={() => setCreating('rater')}>
            <Plus className="size-4 mr-2" /> Rater course
          </Button>
          <Button onClick={() => setCreating('refresher')}>
            <Plus className="size-4 mr-2" /> Refresher course
          </Button>
        </div>
      </div>

      {emptyRuns.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {emptyRuns.length} course{emptyRuns.length === 1 ? ' has' : 's have'} no audio yet.
            {fillable.length < emptyRuns.length && ' Tag recordings with a Rater Course day or RC set in Test Bank to fill the rest.'}
          </span>
          {fillable.length > 0 && (
            <Button size="sm" variant="outline" onClick={applySets}>Apply course sets ({fillable.length})</Button>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No courses yet — add one to start recording who heard which audio.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 flex-wrap border-b">
            <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Course set">
              {tabs.map(t => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={t.key === tabKey}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-2 text-sm -mb-px border-b-2 ${t.key === tabKey ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label} <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </button>
              ))}
            </div>
            <div className="relative pb-2 w-full sm:w-72">
              <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find a person or course…"
                className="pl-8"
                aria-label="Find a person or course"
              />
            </div>
          </div>

          {query ? (
            <section className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {matches.length === 0 ? 'No courses match' : `${matches.length} course${matches.length === 1 ? '' : 's'}`} for “{search.trim()}”
                {tabKey !== 'all' && <> in {tabs.find(t => t.key === tabKey)?.label} — <button className="underline" onClick={() => setTab('all')}>search all</button></>}
              </p>
              {matches.length > 0 && <CourseTable rows={matches} matchedNames={matchedNames} />}
            </section>
          ) : (
            <>
              <section className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">Coming up</h2>
                {comingUp.length === 0
                  ? <p className="text-sm text-muted-foreground">Nothing scheduled — add a course with a start date to see it here.</p>
                  : <CourseTable rows={comingUp} />}
              </section>
              {recent.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
                  <CourseTable rows={recent} />
                </section>
              )}
              {earlier.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground py-1">
                    Earlier <span className="tabular-nums">({earlier.length})</span>
                  </summary>
                  <div className="pt-2"><CourseTable rows={earlier} /></div>
                </details>
              )}
            </>
          )}
        </>
      )}

      <CourseDrawer
        open={creating !== null}
        onClose={() => setCreating(null)}
        kind={creating ?? 'refresher'}
        suggestedNumber={latestRefresherNumber(courses, tests)}
        people={people}
        tests={tests}
        onCreated={id => navigate(`/courses/${id}`)}
      />
    </div>
  )
}

function CourseTable({ rows, matchedNames }: { rows: Course[]; matchedNames?: Map<string, string[]> }) {
  const navigate = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Course</TableHead>
            <TableHead>Set</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead className="text-right">Students</TableHead>
            <TableHead className="text-right">Audio</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(c => {
            const upcoming = !!c.startDate && c.startDate > today
            const running = !!c.startDate && c.startDate <= today && (c.endDate ?? c.startDate) >= today
            const names = matchedNames?.get(c.id)
            return (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/courses/${c.id}`)}>
                <TableCell>
                  <span className="font-medium">{c.name}</span>
                  {upcoming && <span className="ml-2 text-[10px] text-blue-800 bg-blue-50 border border-blue-200 rounded px-1">upcoming</span>}
                  {running && <span className="ml-2 text-[10px] text-green-800 bg-green-50 border border-green-200 rounded px-1">running</span>}
                  {names && <div className="text-xs text-muted-foreground mt-0.5">{names.join(', ')}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={c.kind === 'refresher' ? 'secondary' : 'outline'}>
                    {c.kind === 'refresher' ? `RC${c.number ?? '?'}` : 'Initial'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDateRange(c)}</TableCell>
                <TableCell className="text-right tabular-nums">{c.attendees?.length ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.testDocIds?.length
                    ? c.testDocIds.length
                    : <span className="text-amber-700" title="No audio yet — tag its set in Test Bank, then Apply course sets">none</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" nativeButton={false} render={<Link to={`/courses/${c.id}/teach`} />} onClick={e => e.stopPropagation()}>
                    Teach
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
