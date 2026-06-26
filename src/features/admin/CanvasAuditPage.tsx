import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { AlertTriangle, RefreshCw, Users, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── types ─────────────────────────────────────────────────────────────────────

interface CanvasUser {
  canvasId: number
  name: string
  email: string
}

interface CanvasSection {
  id: number
  name: string
  courseId: number
  courseName: string
  courseDate: string
}

// ── firebase callables ────────────────────────────────────────────────────────

const sectionsFn = httpsCallable<Record<string, never>, { sections: CanvasSection[] }>(functions, 'canvasSections')
const enrollmentsFn = httpsCallable<{ courseId: string }, { users: CanvasUser[] }>(functions, 'canvasEnrollments')

// ── helpers ───────────────────────────────────────────────────────────────────

function normalizeName(n: string) {
  return n.toLowerCase().replace(/\s+/g, ' ').trim()
}

function nameSimilar(a: string, b: string) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na === nb) return true
  const wa = na.split(' ')
  const wb = nb.split(' ')
  const overlap = wa.filter(w => wb.includes(w)).length
  return overlap >= 2 || (overlap >= 1 && Math.min(wa.length, wb.length) === 1)
}

// ── DuplicateAudit ────────────────────────────────────────────────────────────
// Fetches all enrollments across all active sections, then finds users who appear
// more than once with similar names but different Canvas IDs.

interface DuplicatePair {
  a: CanvasUser & { courses: string[] }
  b: CanvasUser & { courses: string[] }
}

function DuplicateAudit() {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  async function runAudit() {
    setLoading(true)
    setError('')
    setPairs(null)
    setProgress('')

    try {
      setProgress('Loading sections…')
      const sectionsRes = await sectionsFn({})
      const sections = sectionsRes.data.sections

      // Get unique courses from sections
      const courseIds = [...new Set(sections.map(s => s.courseId))]

      // Fetch enrollments per course, accumulate all users with course labels
      const userMap = new Map<number, CanvasUser & { courses: string[] }>()

      for (let i = 0; i < courseIds.length; i++) {
        const courseId = courseIds[i]
        const courseName = sections.find(s => s.courseId === courseId)?.courseName ?? String(courseId)
        setProgress(`Fetching enrollments for ${courseName} (${i + 1}/${courseIds.length})…`)

        try {
          const res = await enrollmentsFn({ courseId: String(courseId) })
          for (const user of res.data.users) {
            if (userMap.has(user.canvasId)) {
              userMap.get(user.canvasId)!.courses.push(courseName)
            } else {
              userMap.set(user.canvasId, { ...user, courses: [courseName] })
            }
          }
        } catch {
          // skip courses we can't read
        }
      }

      setProgress('Finding duplicates…')
      const users = Array.from(userMap.values())
      const found: DuplicatePair[] = []
      const seenPairs = new Set<string>()

      for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
          const a = users[i]
          const b = users[j]
          if (a.canvasId === b.canvasId) continue
          if (!nameSimilar(a.name, b.name)) continue
          const key = [Math.min(a.canvasId, b.canvasId), Math.max(a.canvasId, b.canvasId)].join('-')
          if (seenPairs.has(key)) continue
          seenPairs.add(key)
          found.push({ a, b })
        }
      }

      setPairs(found)
      setProgress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed')
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" />
          Duplicate Account Audit
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scans all active course enrolments for Canvas users with similar names but different accounts.
        </p>
      </div>

      <Button onClick={runAudit} disabled={loading} variant="outline">
        {loading
          ? <><RefreshCw className="size-4 mr-2 animate-spin" />Running…</>
          : 'Run duplicate scan'
        }
      </Button>

      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />{error}
        </div>
      )}

      {pairs !== null && (
        pairs.length === 0 ? (
          <p className="text-sm text-green-700 font-medium">No probable duplicates found.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-amber-700">
              {pairs.length} probable duplicate pair{pairs.length !== 1 ? 's' : ''} found.
              Review in Canvas and merge if needed.
            </p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Account A</th>
                    <th className="text-left px-3 py-2 font-medium">Account B</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((pair, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">
                        <p className="font-medium">{pair.a.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{pair.a.email}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Canvas ID: {pair.a.canvasId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Courses: {pair.a.courses.join(', ')}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{pair.b.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{pair.b.email}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Canvas ID: {pair.b.canvasId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Courses: {pair.b.courses.join(', ')}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ── SectionMembershipAudit ────────────────────────────────────────────────────
// Finds users enrolled in more than one section of the same course.

interface MultiSectionUser {
  user: CanvasUser
  courseId: number
  courseName: string
  sections: { id: number; name: string }[]
}

function SectionMembershipAudit() {
  const [issues, setIssues] = useState<MultiSectionUser[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  async function runAudit() {
    setLoading(true)
    setError('')
    setIssues(null)
    setProgress('')

    try {
      setProgress('Loading sections…')
      const sectionsRes = await sectionsFn({})
      const sections = sectionsRes.data.sections

      // Group sections by course
      const byCourse = new Map<number, { courseName: string; sections: CanvasSection[] }>()
      for (const s of sections) {
        if (!byCourse.has(s.courseId)) {
          byCourse.set(s.courseId, { courseName: s.courseName, sections: [] })
        }
        byCourse.get(s.courseId)!.sections.push(s)
      }

      // For each course with multiple sections, find users in more than one
      const found: MultiSectionUser[] = []

      const courseEntries = Array.from(byCourse.entries()).filter(([, c]) => c.sections.length > 1)

      for (let i = 0; i < courseEntries.length; i++) {
        const [courseId, { courseName, sections: courseSections }] = courseEntries[i]
        setProgress(`Checking ${courseName} (${i + 1}/${courseEntries.length})…`)

        // Map: canvasId → { user, sections enrolled in }
        const userSections = new Map<number, { user: CanvasUser; sections: { id: number; name: string }[] }>()

        for (const section of courseSections) {
          try {
            const res = await enrollmentsFn({ courseId: String(courseId) })
            for (const user of res.data.users) {
              if (!userSections.has(user.canvasId)) {
                userSections.set(user.canvasId, { user, sections: [] })
              }
              const entry = userSections.get(user.canvasId)!
              if (!entry.sections.find(s => s.id === section.id)) {
                entry.sections.push({ id: section.id, name: section.name })
              }
            }
          } catch {
            // skip
          }
        }

        for (const { user, sections: userSecs } of userSections.values()) {
          if (userSecs.length > 1) {
            found.push({ user, courseId, courseName, sections: userSecs })
          }
        }
      }

      setIssues(found)
      setProgress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed')
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BookOpen className="size-5 text-muted-foreground" />
          Multi-Section Membership Audit
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Finds students enrolled in more than one section of the same course — the likely cause of missing assignments.
        </p>
      </div>

      <Button onClick={runAudit} disabled={loading} variant="outline">
        {loading
          ? <><RefreshCw className="size-4 mr-2 animate-spin" />Running…</>
          : 'Run section audit'
        }
      </Button>

      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />{error}
        </div>
      )}

      {issues !== null && (
        issues.length === 0 ? (
          <p className="text-sm text-green-700 font-medium">No multi-section memberships found.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-amber-700">
              {issues.length} student{issues.length !== 1 ? 's' : ''} enrolled in multiple sections of the same course.
            </p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Student</th>
                    <th className="text-left px-3 py-2 font-medium">Course</th>
                    <th className="text-left px-3 py-2 font-medium">Sections</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">
                        <p className="font-medium">{issue.user.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{issue.user.email}</p>
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        {issue.courseName}
                      </td>
                      <td className="px-3 py-2">
                        <ul className="space-y-0.5">
                          {issue.sections.map(s => (
                            <li key={s.id} className="text-xs text-muted-foreground">
                              {s.name}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Use the Enrol in Canvas tool to move these students to the correct section (it will conclude the old enrolment).
            </p>
          </div>
        )
      )}
    </div>
  )
}

// ── CanvasAuditPage ───────────────────────────────────────────────────────────

export function CanvasAuditPage() {
  return (
    <div className="space-y-10 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Canvas Audit</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Health checks for Canvas enrolments. Run these periodically to catch problems early.
        </p>
      </div>
      <DuplicateAudit />
      <div className="border-t pt-6">
        <SectionMembershipAudit />
      </div>
    </div>
  )
}
