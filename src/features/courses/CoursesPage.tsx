import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Course, Person, Test } from '@/types'
import { fetchCourses, latestRefresherNumber, setForCourse } from '@/lib/courses'
import { CourseDrawer } from './CourseDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

export function CoursesPage() {
  const navigate = useNavigate()
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
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Attendees</TableHead>
                <TableHead className="text-right">Audio</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map(c => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/courses/${c.id}`)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge variant={c.kind === 'refresher' ? 'secondary' : 'outline'}>
                      {c.kind === 'refresher' ? `RC${c.number ?? '?'}` : 'Initial'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateRange(c)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.attendees?.length ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.testDocIds?.length ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" nativeButton={false} render={<Link to={`/courses/${c.id}/teach`} />} onClick={e => e.stopPropagation()}>
                      Teach
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
