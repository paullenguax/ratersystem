import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Course, CourseAttendee, Person, Test } from '@/types'

export async function fetchCourses(): Promise<Course[]> {
  const snap = await getDocs(collection(db, 'courses'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Course)
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || a.name.localeCompare(b.name))
}

// The newest refresher set in use (by courses or by tagged recordings) —
// the default for a new refresher run. A brand-new set is this + 1.
export function latestRefresherNumber(courses: Course[], tests: Test[]): number {
  return Math.max(
    0,
    ...courses.filter(c => c.kind === 'refresher').map(c => c.number ?? 0),
    ...tests.map(t => t.refresherNumber ?? 0),
  ) || 1
}

// The Initial Rater Course's fixed audio set: Training tests tagged with a
// day, in day then test-number order.
export function raterCourseSet(tests: Test[]): Test[] {
  return tests
    .filter(t => t.category === 'training' && t.status === 'active' && t.raterCourseDay)
    .sort((a, b) => (a.raterCourseDay! - b.raterCourseDay!) || ((a.testId ?? 999) - (b.testId ?? 999)))
}

// Refresher set RC N: Training tests tagged with that number.
export function refresherSet(tests: Test[], n: number): Test[] {
  return tests
    .filter(t => t.category === 'training' && t.status === 'active' && t.refresherNumber === n)
    .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))
}

// The set a run starts from: the Rater Course set, or its RC number's set.
export function setForCourse(tests: Test[], c: Pick<Course, 'kind' | 'number'>): Test[] {
  if (c.kind === 'rater') return raterCourseSet(tests)
  return c.number ? refresherSet(tests, c.number) : []
}

// "Refresher Course 1 — February 2025", "Rater Course — July 2026"
export function autoCourseName(kind: Course['kind'], number: number | null | undefined, startDate: string | null | undefined): string {
  const when = startDate
    ? new Date(startDate + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : 'undated'
  return kind === 'refresher' ? `Refresher Course ${number ?? '?'} — ${when}` : `Rater Course — ${when}`
}

export function setLabel(c: Pick<Course, 'kind' | 'number'>): string {
  return c.kind === 'rater' ? 'Rater Course set' : c.number ? `RC${c.number} set` : 'refresher set'
}

export function inAnySet(t: Test): boolean {
  return !!(t.raterCourseDay || t.refresherNumber)
}

const norm = (e?: string | null) => (e ?? '').toLowerCase().trim()
export const normName = (n?: string | null) => (n ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

// Same precedence as Canvas Sync: the Canvas user ID is what really ties a
// person to an account; email is the fallback for records that predate it.
export function findPerson(people: Person[], a: Pick<CourseAttendee, 'personId' | 'canvasUserId' | 'email'>): Person | undefined {
  return (a.personId ? people.find(p => p.id === a.personId) : undefined)
    ?? (a.canvasUserId ? people.find(p => p.canvasUserId === a.canvasUserId) : undefined)
    ?? (a.email ? people.find(p => norm(p.email) === norm(a.email)) : undefined)
}

// Attendees imported from old records may carry a name only — those match
// a person by exact (accent/case-insensitive) name.
export function attendeeIsPerson(a: CourseAttendee, p: Person): boolean {
  if (a.personId) return a.personId === p.id
  if (a.canvasUserId && p.canvasUserId) return a.canvasUserId === p.canvasUserId
  if (a.email) return norm(a.email) === norm(p.email)
  return normName(a.name) === normName(p.name)
}

// Compares on the strongest identifier both sides have; name only when
// neither shares one (name-only records from imports).
export function sameAttendee(a: CourseAttendee, b: CourseAttendee): boolean {
  if (a.personId && b.personId) return a.personId === b.personId
  if (a.canvasUserId && b.canvasUserId) return a.canvasUserId === b.canvasUserId
  if (a.email && b.email) return norm(a.email) === norm(b.email)
  return normName(a.name) === normName(b.name)
}

// Adds attendees not already on the list (by person, Canvas ID or email),
// linking each to a `people` record where one exists.
export function mergeAttendees(existing: CourseAttendee[], incoming: CourseAttendee[], people: Person[]): CourseAttendee[] {
  const out = [...existing]
  for (const raw of incoming) {
    const person = findPerson(people, raw)
    const a: CourseAttendee = {
      personId: person?.id ?? null,
      canvasUserId: raw.canvasUserId ?? person?.canvasUserId ?? null,
      name: person?.name ?? raw.name,
      email: raw.email ?? person?.email ?? null,
    }
    if (!out.some(e => sameAttendee(e, a))) out.push(a)
  }
  return out.sort((x, y) => x.name.localeCompare(y.name))
}

// Who has heard a test: every attendee of every course that played it.
export function heardByForTest(courses: Course[], testDocId: string): { course: Course; attendees: CourseAttendee[] }[] {
  return courses
    .filter(c => c.testDocIds?.includes(testDocId))
    .map(c => ({ course: c, attendees: c.attendees ?? [] }))
}

export function coursesAttendedBy(courses: Course[], person: Person): Course[] {
  return courses.filter(c => (c.attendees ?? []).some(a => attendeeIsPerson(a, person)))
}

// For a cohort: test ID → names of this cohort's attendees who already heard
// it on some *other* course.
export function cohortExposure(courses: Course[], course: Course): Map<string, string[]> {
  const result = new Map<string, Set<string>>()
  for (const other of courses) {
    if (other.id === course.id) continue
    const overlap = course.attendees.filter(a => (other.attendees ?? []).some(o => sameAttendee(a, o)))
    if (overlap.length === 0) continue
    for (const testId of other.testDocIds ?? []) {
      if (!result.has(testId)) result.set(testId, new Set())
      overlap.forEach(a => result.get(testId)!.add(a.name))
    }
  }
  return new Map([...result].map(([k, v]) => [k, [...v].sort()]))
}
