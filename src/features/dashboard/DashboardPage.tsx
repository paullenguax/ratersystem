import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { Users, FileAudio, CalendarDays, CheckCircle, Zap } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { Assignment, Person, Score, Session } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const STATUS_VARIANT: Record<Assignment['status'], 'default' | 'secondary' | 'outline'> = {
  pending: 'secondary', submitted: 'default', reviewed: 'outline', published: 'outline',
}

async function fetchAll() {
  const [people, tests, sessions, assignments, scores] = await Promise.all([
    getDocs(collection(db, 'people')),
    getDocs(collection(db, 'test_bank')),
    getDocs(collection(db, 'sessions')),
    getDocs(collection(db, 'assignments')),
    getDocs(collection(db, 'scores')),
  ])
  return {
    people:      people.docs.map(d => ({ id: d.id, ...d.data() }) as Person),
    testCount:   tests.docs.length,
    sessions:    sessions.docs.map(d => ({ id: d.id, ...d.data() }) as Session),
    assignments: assignments.docs.map(d => ({ id: d.id, ...d.data() }) as Assignment),
    scores:      scores.docs.map(d => ({ id: d.id, ...d.data() }) as Score),
  }
}

async function fetchMyData(uid: string): Promise<{ assignments: Assignment[]; scoresByAssignment: Map<string, number> }> {
  const [assignSnap, scoreSnap] = await Promise.all([
    getDocs(collection(db, 'assignments')),
    getDocs(query(collection(db, 'scores'), where('raterId', '==', uid))),
  ])
  const assignments = assignSnap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Assignment)
    .filter(a => a.raterId === uid && a.status !== 'published')
  const scoresByAssignment = new Map<string, number>()
  scoreSnap.docs.forEach(d => {
    const s = d.data() as Score
    scoresByAssignment.set(s.assignmentId, (scoresByAssignment.get(s.assignmentId) ?? 0) + 1)
  })
  return { assignments, scoresByAssignment }
}

export function DashboardPage() {
  const { user, role } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchAll,
    enabled: role === 'admin',
  })

  const { data: myData } = useQuery({
    queryKey: ['my-assignments', user?.uid],
    queryFn: () => fetchMyData(user!.uid),
    enabled: !!user?.uid && role !== 'admin',
  })
  const myAssignments = myData?.assignments ?? []
  const myScoresByAssignment = myData?.scoresByAssignment ?? new Map()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  // Admin view
  if (role === 'admin' && data) {
    const activeRaters  = data.people.filter(p => p.status === 'active' && p.role !== 'trainee').length
    const openEvents    = data.sessions.filter(s => s.status === 'open').length
    const publishedScores = data.scores.filter(s => s.published).length
    const activeAssignments = data.assignments.filter(a => a.status !== 'published')
    const selfServeSubmissions = data.assignments.filter(a => a.source === 'self_serve' && a.status === 'submitted')

    // Progress per assignment: count scored tests
    const scoresByAssignment = new Map<string, number>()
    data.scores.forEach(s => {
      scoresByAssignment.set(s.assignmentId, (scoresByAssignment.get(s.assignmentId) ?? 0) + 1)
    })

    const statCards = [
      { label: 'Active raters',    value: activeRaters,    icon: Users },
      { label: 'Tests in bank',    value: data.testCount,  icon: FileAudio },
      { label: 'Open events',      value: openEvents,      icon: CalendarDays },
      { label: 'Published scores', value: publishedScores, icon: CheckCircle },
    ]

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="size-4" />
                <span className="text-xs">{label}</span>
              </div>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Self-serve submissions awaiting review */}
        {selfServeSubmissions.length > 0 && (
          <button
            onClick={() => navigate('/assignments')}
            className="w-full flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100/70 transition-colors"
          >
            <Zap className="size-4 text-amber-700 shrink-0" />
            <span className="text-sm text-amber-800">
              <span className="font-semibold">{selfServeSubmissions.length}</span> self-serve submission{selfServeSubmissions.length !== 1 ? 's' : ''} awaiting review
            </span>
          </button>
        )}

        {/* Active assignments */}
        {activeAssignments.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Active assignments
            </h2>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Event</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Rater</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Progress</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {activeAssignments
                    .sort((a, b) => a.sessionName.localeCompare(b.sessionName) || a.raterName.localeCompare(b.raterName))
                    .map(a => {
                      const scored = scoresByAssignment.get(a.id) ?? 0
                      const total  = a.testDocIds.length
                      const pct    = total ? Math.round((scored / total) * 100) : 0
                      return (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 text-muted-foreground">{a.sessionName}</td>
                          <td className="px-4 py-2 font-medium">{a.raterName}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground">{scored}/{total}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant={STATUS_VARIANT[a.status]}>
                              {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/assignments/${a.id}`)}>
                              View
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Senior rater view
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My Assignments</h1>
      {myAssignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active assignments. Check back after your administrator creates one.</p>
      ) : (
        <div className="space-y-2">
          {myAssignments.map(a => (
            <button
              key={a.id}
              onClick={() => navigate('/scoring')}
              className="w-full text-left rounded-lg border p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{a.sessionName}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${a.testDocIds.length ? Math.round((myScoresByAssignment.get(a.id) ?? 0) / a.testDocIds.length * 100) : 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {myScoresByAssignment.get(a.id) ?? 0}/{a.testDocIds.length} scored
                      </span>
                    </div>
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[a.status]}>
                  {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
