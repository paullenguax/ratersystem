import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Course, Person, Test } from '@/types'
import { fetchCourses, nextRefresherNumber, raterCourseSet } from '@/lib/courses'
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

  // Rater runs created before the Rater Course set was tagged (e.g. imported
  // past courses) have no audio; this gives them the set in one go.
  const emptyRaterRuns = courses.filter(c => c.kind === 'rater' && !(c.testDocIds?.length))
  const raterSet = raterCourseSet(tests)

  async function applyRaterSet() {
    if (!confirm(`Give ${emptyRaterRuns.length} rater course${emptyRaterRuns.length === 1 ? '' : 's'} with no audio the current Rater Course set (${raterSet.length} recordings)? Their attendees will then count as having heard them.`)) return
    const batch = writeBatch(db)
    emptyRaterRuns.forEach(c => batch.update(doc(db, 'courses', c.id), { testDocIds: raterSet.map(t => t.id) }))
    await batch.commit()
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
          <Button variant="ghost" nativeButton={false} render={<Link to="/courses/materials" />}>Shared materials</Button>
          <Button variant="ghost" nativeButton={false} render={<Link to="/courses/import" />}>Import past courses</Button>
          <Button variant="outline" onClick={() => setCreating('rater')}>
            <Plus className="size-4 mr-2" /> Rater course
          </Button>
          <Button onClick={() => setCreating('refresher')}>
            <Plus className="size-4 mr-2" /> Refresher course
          </Button>
        </div>
      </div>

      {emptyRaterRuns.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {emptyRaterRuns.length} rater course{emptyRaterRuns.length === 1 ? ' has' : 's have'} no audio yet.
            {raterSet.length === 0 && ' Tag Training recordings with a Rater Course day in Test Bank first.'}
          </span>
          {raterSet.length > 0 && (
            <Button size="sm" variant="outline" onClick={applyRaterSet}>Apply Rater Course set ({raterSet.length})</Button>
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
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Attendees</TableHead>
                <TableHead className="text-right">Audio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map(c => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/courses/${c.id}`)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge variant={c.kind === 'refresher' ? 'secondary' : 'outline'}>
                      {c.kind === 'refresher' ? 'Refresher' : 'Rater course'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateRange(c)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.attendees?.length ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.testDocIds?.length ?? 0}</TableCell>
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
        suggestedNumber={nextRefresherNumber(courses)}
        people={people}
        tests={tests}
        onCreated={id => navigate(`/courses/${id}`)}
      />
    </div>
  )
}
