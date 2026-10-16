import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Person } from '@/types'
import { fetchCourses, heardByForTest, coursesAttendedBy } from '@/lib/courses'

function courseDate(startDate?: string | null) {
  return startDate
    ? new Date(startDate + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : ''
}

// Test drawer: every course that played this recording, and who was on it.
export function HeardBySection({ testDocId }: { testDocId: string }) {
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const heard = heardByForTest(courses, testDocId)
  const total = heard.reduce((n, h) => n + h.attendees.length, 0)

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Heard on courses</p>
      {heard.length === 0 ? (
        <p className="text-xs text-muted-foreground">Not played on any recorded course.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{total} attendee{total === 1 ? '' : 's'} across {heard.length} course{heard.length === 1 ? '' : 's'}</p>
          {heard.map(({ course, attendees }) => (
            <details key={course.id} className="rounded border px-2 py-1 text-sm">
              <summary className="cursor-pointer">
                <Link to={`/courses/${course.id}`} className="hover:underline">{course.name}</Link>
                <span className="text-muted-foreground text-xs ml-2">{courseDate(course.startDate)} · {attendees.length}</span>
              </summary>
              <p className="text-xs text-muted-foreground py-1">{attendees.map(a => a.name).join(', ') || 'No attendees recorded'}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

// Person drawer: the courses this person was on.
export function CoursesAttendedSection({ person }: { person: Person }) {
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const attended = coursesAttendedBy(courses, person)
  const recordings = new Set(attended.flatMap(c => c.testDocIds ?? [])).size

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Courses attended</p>
      {attended.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <>
          <ul className="text-sm space-y-0.5">
            {attended.map(c => (
              <li key={c.id}>
                <Link to={`/courses/${c.id}`} className="hover:underline">{c.name}</Link>
                <span className="text-muted-foreground text-xs ml-2">{courseDate(c.startDate)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Has heard {recordings} course recording{recordings === 1 ? '' : 's'}.</p>
        </>
      )}
    </div>
  )
}
