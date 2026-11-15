import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, functions } from '@/lib/firebase'
import type { Course, CourseAttendee, Person, Test } from '@/types'
import { COURSE_DAYS, autoCourseName, latestRefresherNumber, mergeAttendees, setForCourse } from '@/lib/courses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface CanvasSection {
  id: number
  name: string
  courseName: string
  sectionStartAt: string | null
  sectionEndAt: string | null
}
interface CanvasUser { canvasId: number; name: string; email: string }

const canvasSectionsFn = httpsCallable<void, { sections: CanvasSection[] }>(functions, 'canvasSections')
const sectionEnrollmentsFn = httpsCallable<{ sectionId: number }, { users: CanvasUser[] }>(functions, 'canvasSectionEnrollments')

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

// The section's own start date in Canvas, or else the month in its name
// ("July 2026" → 1 July 2026, flagged so the day gets checked).
function sectionStart(s: CanvasSection): { date: string; fromName: boolean } {
  if (s.sectionStartAt) return { date: isoDay(new Date(s.sectionStartAt)), fromName: false }
  const m = s.name.toLowerCase().match(/\b([a-z]{3})[a-z]*\.?\s+(\d{4})\b/)
  const month = m ? MONTHS.indexOf(m[1]) : -1
  if (m && month >= 0) return { date: `${m[2]}-${String(month + 1).padStart(2, '0')}-01`, fromName: true }
  return { date: '', fromName: false }
}

function guessKind(courseName: string): Course['kind'] | null {
  if (/refresher/i.test(courseName)) return 'refresher'
  if (/rater/i.test(courseName)) return 'rater'
  return null
}

interface Row {
  section: CanvasSection
  include: boolean
  kind: Course['kind']
  number: string
  startDate: string
  endDate: string
  fromName: boolean
}

// Courses → From Canvas: turns upcoming Canvas sections that no course is
// linked to yet into courses, each starting from its set's audio and with
// the section's enrolled students as attendees.
export function CanvasCoursesPanel({ courses, tests, people, onClose }: {
  courses: Course[]
  tests: Test[]
  people: Person[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  useEffect(() => {
    const linked = new Set(courses.flatMap(c => (c.canvasSections ?? []).map(s => s.id)))
    const today = isoDay(new Date())
    const nextRc = String(latestRefresherNumber(courses, tests))
    canvasSectionsFn()
      .then(res => {
        const out: Row[] = []
        for (const s of res.data.sections) {
          if (linked.has(s.id)) continue
          const kind = guessKind(s.courseName)
          const { date, fromName } = sectionStart(s)
          const k = kind ?? 'rater'
          const endDate = date ? addDays(date, COURSE_DAYS[k] - 1) : ''
          // Upcoming or still running; undated ones are listed but not ticked
          if (date && endDate < today) continue
          out.push({
            section: s, kind: k, number: k === 'refresher' ? nextRc : '',
            startDate: date, endDate, fromName,
            include: !!kind && !!date,
          })
        }
        out.sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'))
        setRows(out)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load Canvas sections'))
    // Load once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (id: number, patch: Partial<Row>) =>
    setRows(rs => rs!.map(r => r.section.id === id ? { ...r, ...patch } : r))

  const chosen = (rows ?? []).filter(r => r.include)
  const missingNumber = chosen.some(r => r.kind === 'refresher' && !(Number(r.number) >= 1))

  async function create() {
    setBusy(true); setError('')
    let made = 0
    const failed: string[] = []
    try {
      for (const r of chosen) {
        const number = r.kind === 'refresher' ? Math.floor(Number(r.number)) : null
        let attendees: CourseAttendee[] = []
        try {
          const res = await sectionEnrollmentsFn({ sectionId: r.section.id })
          attendees = mergeAttendees([], res.data.users.map(u => ({ canvasUserId: u.canvasId, name: u.name, email: u.email })), people)
        } catch {
          failed.push(r.section.name)
        }
        await addDoc(collection(db, 'courses'), {
          name: autoCourseName(r.kind, number, r.startDate || null),
          kind: r.kind,
          number,
          startDate: r.startDate || null,
          endDate: r.endDate || null,
          notes: '',
          trainerIds: [],
          testDocIds: setForCourse(tests, { kind: r.kind, number }).map(t => t.id),
          attendees,
          canvasSections: [{ id: r.section.id, name: r.section.name }],
          createdAt: serverTimestamp(),
        })
        made++
      }
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      setResult(`Created ${made} course${made === 1 ? '' : 's'}.${failed.length ? ` Couldn't fetch students for ${failed.join(', ')} — click the section under “From Canvas” on the course page to try again.` : ''}`)
      setRows(rs => rs!.filter(r => !r.include))
    } catch (e) {
      setError(`${made ? `Created ${made}, then: ` : ''}${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Courses from Canvas</h2>
          <p className="text-sm text-muted-foreground">
            Canvas sections that are upcoming or running and aren't linked to a course yet. The type comes from the Canvas course name
            and the start date from the section (or the month in its name). Each new course starts from its set's audio, with the
            section's students as attendees.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && <p className="text-sm text-green-700">{result}</p>}

      {rows === null ? (
        !error && <p className="text-sm text-muted-foreground">Checking Canvas…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming Canvas sections without a course.</p>
      ) : (
        <>
          <div className="rounded-md border bg-background overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-1 font-normal" />
                  <th className="px-1 py-1 font-normal">Canvas section</th>
                  <th className="px-1 py-1 font-normal">Type</th>
                  <th className="px-1 py-1 font-normal">Start</th>
                  <th className="px-3 py-1 font-normal">End</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.section.id}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" checked={r.include} onChange={e => update(r.section.id, { include: e.target.checked })} aria-label={`Create a course for ${r.section.name}`} />
                    </td>
                    <td className="px-1 py-1.5">
                      <div className="font-medium">{r.section.name}</div>
                      <div className="text-xs text-muted-foreground">{r.section.courseName}</div>
                    </td>
                    <td className="px-1 py-1.5 whitespace-nowrap">
                      <select
                        value={r.kind}
                        aria-label="Course type"
                        onChange={e => {
                          const kind = e.target.value as Course['kind']
                          update(r.section.id, {
                            kind,
                            number: kind === 'refresher' ? (r.number || String(latestRefresherNumber(courses, tests))) : '',
                            endDate: r.startDate ? addDays(r.startDate, COURSE_DAYS[kind] - 1) : r.endDate,
                          })
                        }}
                        className="h-8 text-sm border rounded-md px-1 bg-background"
                      >
                        <option value="rater">Rater course</option>
                        <option value="refresher">Refresher</option>
                      </select>
                      {r.kind === 'refresher' && (
                        <span className="inline-flex items-center gap-1 ml-1">
                          <span className="text-muted-foreground">RC</span>
                          <Input type="number" min={1} className="w-16 h-8" aria-label="Refresher set" value={r.number}
                            onChange={e => update(r.section.id, { number: e.target.value })} />
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-1.5">
                      <Input type="date" className="h-8 w-36" value={r.startDate} aria-label="Start date"
                        onChange={e => update(r.section.id, {
                          startDate: e.target.value, fromName: false,
                          endDate: e.target.value ? addDays(e.target.value, COURSE_DAYS[r.kind] - 1) : r.endDate,
                        })} />
                      {r.fromName && <div className="text-[11px] text-amber-700 mt-0.5">From the section name — check the day</div>}
                      {!r.startDate && <div className="text-[11px] text-muted-foreground mt-0.5">No date in Canvas</div>}
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="date" className="h-8 w-36" value={r.endDate} aria-label="End date"
                        onChange={e => update(r.section.id, { endDate: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button disabled={busy || chosen.length === 0 || missingNumber} onClick={create}>
              {busy ? 'Creating…' : `Create ${chosen.length} course${chosen.length === 1 ? '' : 's'}`}
            </Button>
            {missingNumber && <span className="text-xs text-destructive">Give each refresher an RC set number.</span>}
            <span className="text-xs text-muted-foreground">End dates assume consecutive days ({COURSE_DAYS.rater} for a rater course, {COURSE_DAYS.refresher} for a refresher); change them if not.</span>
          </div>
        </>
      )}
    </div>
  )
}
