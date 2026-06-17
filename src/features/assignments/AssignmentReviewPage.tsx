import { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore'
import { ChevronLeft } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Assignment, Score, Test } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const DIMS = [
  { key: 'pronunciation' as const, abbr: 'PRO' },
  { key: 'structure'     as const, abbr: 'STR' },
  { key: 'vocabulary'    as const, abbr: 'VOC' },
  { key: 'fluency'       as const, abbr: 'FLU' },
  { key: 'comprehension' as const, abbr: 'COM' },
  { key: 'interactions'  as const, abbr: 'INT' },
]

const STATUS_VARIANT: Record<Assignment['status'], 'default' | 'secondary' | 'outline'> = {
  pending: 'secondary', submitted: 'default', reviewed: 'outline', published: 'outline',
}

function mean(vals: number[]) {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function fmt(n: number | null) {
  return n == null ? '—' : n % 1 === 0 ? String(n) : n.toFixed(1)
}

function scoreColour(n: number) {
  if (n >= 5) return 'text-green-700'
  if (n === 4) return 'text-blue-700'
  if (n === 3) return 'text-amber-700'
  return 'text-red-700'
}

async function fetchAssignment(id: string): Promise<Assignment> {
  const snap = await getDoc(doc(db, 'assignments', id))
  return { id: snap.id, ...snap.data() } as Assignment
}

async function fetchTests(ids: string[]): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Test)
    .filter(t => ids.includes(t.id))
    .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))
}

async function fetchRaterScores(assignmentId: string): Promise<Score[]> {
  const snap = await getDocs(query(collection(db, 'scores'), where('assignmentId', '==', assignmentId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Score)
}

async function fetchAllTestScores(testDocIds: string[]): Promise<Score[]> {
  if (!testDocIds.length) return []
  // Firestore 'in' limit is 30 — batch if needed
  const batches: Score[][] = []
  for (let i = 0; i < testDocIds.length; i += 30) {
    const snap = await getDocs(
      query(collection(db, 'scores'), where('testDocId', 'in', testDocIds.slice(i, i + 30)))
    )
    batches.push(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Score))
  }
  return batches.flat()
}

export function AssignmentReviewPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()

  const { data: assignment, isLoading: loadingAssignment } = useQuery({
    queryKey: ['assignment', assignmentId],
    queryFn: () => fetchAssignment(assignmentId!),
    enabled: !!assignmentId,
  })

  const { data: tests = [] } = useQuery({
    queryKey: ['assignment-tests', assignmentId],
    queryFn: () => fetchTests(assignment!.testDocIds),
    enabled: !!assignment,
  })

  const { data: raterScores = [] } = useQuery({
    queryKey: ['assignment-scores', assignmentId],
    queryFn: () => fetchRaterScores(assignmentId!),
    enabled: !!assignmentId,
  })

  const { data: allTestScores = [] } = useQuery({
    queryKey: ['all-test-scores', assignmentId],
    queryFn: () => fetchAllTestScores(assignment!.testDocIds),
    enabled: !!assignment?.testDocIds.length,
  })

  // Index rater's own scores by testDocId
  const raterScoreMap = useMemo(() => {
    const m = new Map<string, Score>()
    raterScores.forEach(s => m.set(s.testDocId, s))
    return m
  }, [raterScores])

  // Calculate per-test means across ALL raters
  const testMeans = useMemo(() => {
    const m = new Map<string, { dims: Record<string, number | null>; overall: number | null; n: number }>()
    for (const test of tests) {
      const testScores = allTestScores.filter(s => s.testDocId === test.id)
      if (!testScores.length) { m.set(test.id, { dims: {}, overall: null, n: 0 }); continue }
      const dims: Record<string, number | null> = {}
      DIMS.forEach(d => { dims[d.key] = mean(testScores.map(s => s[d.key] as number)) })
      m.set(test.id, { dims, overall: mean(testScores.map(s => s.overallLevel)), n: testScores.length })
    }
    return m
  }, [tests, allTestScores])

  // Summary averages for the rater across all scored tests
  const raterSummary = useMemo(() => {
    const scored = tests.map(t => raterScoreMap.get(t.id)).filter(Boolean) as Score[]
    if (!scored.length) return null
    const dims: Record<string, number | null> = {}
    DIMS.forEach(d => { dims[d.key] = mean(scored.map(s => s[d.key] as number)) })
    return { dims, overall: mean(scored.map(s => s.overallLevel)) }
  }, [tests, raterScoreMap])

  // Summary averages across all raters
  const globalSummary = useMemo(() => {
    if (!allTestScores.length) return null
    const dims: Record<string, number | null> = {}
    DIMS.forEach(d => { dims[d.key] = mean(allTestScores.map(s => s[d.key] as number)) })
    return { dims, overall: mean(allTestScores.map(s => s.overallLevel)) }
  }, [allTestScores])

  if (loadingAssignment || !assignment) {
    return <p className="text-sm text-muted-foreground p-4">Loading…</p>
  }

  const scoredCount = tests.filter(t => raterScoreMap.has(t.id)).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/assignments')}>
          <ChevronLeft className="size-4" /> Assignments
        </Button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{assignment.raterName}</p>
          <p className="text-xs text-muted-foreground">{assignment.sessionName}</p>
        </div>
        <Badge variant={STATUS_VARIANT[assignment.status]}>
          {assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)}
        </Badge>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{tests.length} tests assigned</span>
        <span>·</span>
        <span>{scoredCount} scored</span>
        <span>·</span>
        <span>{allTestScores.length} total observations across all raters</span>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8">#</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Candidate</th>
              {/* Rater's scores */}
              {DIMS.map(d => (
                <th key={d.key} className="px-2 py-2 font-medium text-center text-xs w-10" title={d.key}>
                  {d.abbr}
                </th>
              ))}
              <th className="px-2 py-2 font-medium text-center text-xs w-10">OVL</th>
              {/* Divider */}
              <th className="px-2 py-2 text-center text-xs text-muted-foreground/50 w-6">|</th>
              {/* Means */}
              {DIMS.map(d => (
                <th key={`mean-${d.key}`} className="px-2 py-2 font-medium text-center text-xs text-muted-foreground w-10">
                  {d.abbr}
                </th>
              ))}
              <th className="px-2 py-2 font-medium text-center text-xs text-muted-foreground w-10">OVL</th>
              <th className="px-2 py-2 font-medium text-center text-xs text-muted-foreground w-8">n</th>
            </tr>
            <tr className="border-b text-[10px] text-muted-foreground">
              <th colSpan={2} />
              <th colSpan={7} className="text-center py-1 font-normal">{assignment.raterName}</th>
              <th />
              <th colSpan={7} className="text-center py-1 font-normal">All raters (mean)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tests.map(test => {
              const rs = raterScoreMap.get(test.id)
              const means = testMeans.get(test.id)
              return (
                <tr key={test.id} className="border-b hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {test.testId ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-medium">{test.candidateName}</td>

                  {/* Rater's scores */}
                  {DIMS.map(d => (
                    <td key={d.key} className="px-2 py-2 text-center font-mono">
                      {rs
                        ? <span className={`font-semibold ${scoreColour(rs[d.key] as number)}`}>{rs[d.key] as number}</span>
                        : <span className="text-muted-foreground/30">—</span>
                      }
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center font-mono">
                    {rs
                      ? <span className={`font-bold ${scoreColour(rs.overallLevel)}`}>{rs.overallLevel}</span>
                      : <span className="text-muted-foreground/30">—</span>
                    }
                  </td>

                  <td className="px-2 py-2 text-center text-muted-foreground/30 text-xs">|</td>

                  {/* Means */}
                  {DIMS.map(d => (
                    <td key={`mean-${d.key}`} className="px-2 py-2 text-center font-mono text-muted-foreground text-xs">
                      {fmt(means?.dims[d.key] ?? null)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center font-mono text-muted-foreground text-xs">
                    {fmt(means?.overall ?? null)}
                  </td>
                  <td className="px-2 py-2 text-center text-muted-foreground text-xs">
                    {means?.n ?? 0}
                  </td>
                </tr>
              )
            })}

            {/* Summary row */}
            {(raterSummary || globalSummary) && (
              <tr className="border-t-2 bg-muted/20 font-medium">
                <td colSpan={2} className="px-3 py-2 text-xs text-muted-foreground">Average</td>
                {DIMS.map(d => (
                  <td key={d.key} className="px-2 py-2 text-center font-mono text-xs">
                    {raterSummary ? fmt(raterSummary.dims[d.key]) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-mono text-xs font-bold">
                  {raterSummary ? fmt(raterSummary.overall) : '—'}
                </td>
                <td className="px-2 py-2 text-center text-muted-foreground/30 text-xs">|</td>
                {DIMS.map(d => (
                  <td key={`mean-${d.key}`} className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
                    {globalSummary ? fmt(globalSummary.dims[d.key]) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground font-bold">
                  {globalSummary ? fmt(globalSummary.overall) : '—'}
                </td>
                <td className="px-2 py-2 text-center text-xs text-muted-foreground">
                  {allTestScores.length}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
