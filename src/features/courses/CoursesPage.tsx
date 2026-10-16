import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Course, Person, Test } from '@/types'
import { fetchCourses, nextRefresherNumber } from '@/lib/courses'
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Courses</h1>
          <p className="text-sm text-muted-foreground">Each rater or refresher course: who attended and the audio they heard.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreating('rater')}>
            <Plus className="size-4 mr-2" /> Rater course
          </Button>
          <Button onClick={() => setCreating('refresher')}>
            <Plus className="size-4 mr-2" /> Refresher course
          </Button>
        </div>
      </div>

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
