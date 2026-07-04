import { useState, useEffect, useRef } from 'react'
import {
  collection, getDocs, query, where,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { Assignment, Test, Score } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IcaoSliders, type DimScores } from './IcaoSliders'

// ── helpers ────────────────────────────────────────────────────────────────

function levelColour(n: number) {
  if (n >= 5) return 'text-green-700 bg-green-50 border-green-300'
  if (n === 4) return 'text-blue-700 bg-blue-50 border-blue-300'
  if (n === 3) return 'text-amber-700 bg-amber-50 border-amber-300'
  return 'text-red-700 bg-red-50 border-red-300'
}

const STATUS_LABEL: Record<Assignment['status'], string> = {
  pending:   'Pending',
  submitted: 'Submitted',
  reviewed:  'Reviewed',
  published: 'Published',
}

const STATUS_VARIANT: Record<Assignment['status'], 'secondary' | 'default' | 'outline'> = {
  pending:   'secondary',
  submitted: 'default',
  reviewed:  'outline',
  published: 'outline',
}

// ── data fetching ──────────────────────────────────────────────────────────

async function fetchMyAssignments(uid: string): Promise<Assignment[]> {
  const snap = await getDocs(query(collection(db, 'assignments'), where('raterId', '==', uid)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Assignment)
    .filter(a => a.status !== 'published')
    .sort((a, b) => a.sessionName.localeCompare(b.sessionName))
}

async function fetchTestsForAssignment(testDocIds: string[]): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Test)
    .filter(t => testDocIds.includes(t.id))
    .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))
}

async function fetchExistingScores(assignmentId: string): Promise<Map<string, Score>> {
  const snap = await getDocs(query(collection(db, 'scores'), where('assignmentId', '==', assignmentId)))
  const map = new Map<string, Score>()
  snap.docs.forEach(d => {
    const s = { id: d.id, ...d.data() } as Score
    map.set(s.testDocId, s)
  })
  return map
}

// ── assignment list ────────────────────────────────────────────────────────

function AssignmentList({
  assignments,
  onSelect,
}: {
  assignments: Assignment[]
  onSelect: (a: Assignment) => void
}) {
  if (assignments.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">No assignments pending.</p>
        <p className="text-sm text-muted-foreground mt-1">Check back later or contact your administrator.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {assignments.map(a => (
        <button
          key={a.id}
          onClick={() => onSelect(a)}
          className="w-full text-left rounded-lg border p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{a.sessionName}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{a.testDocIds.length} tests assigned</p>
            </div>
            <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</Badge>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

export function ScoringPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [existingScores, setExistingScores] = useState<Map<string, Score>>(new Map())
  const [loadingPlayer, setLoadingPlayer] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [scores, setScores] = useState<DimScores>([null, null, null, null, null, null])
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const audioRef = useRef<HTMLAudioElement>(null)

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['my-assignments', user?.uid],
    queryFn: () => fetchMyAssignments(user!.uid),
    enabled: !!user?.uid,
  })

  async function openAssignment(a: Assignment) {
    setLoadingPlayer(true)
    const [ts, sc] = await Promise.all([
      fetchTestsForAssignment(a.testDocIds),
      fetchExistingScores(a.id),
    ])
    setTests(ts)
    setExistingScores(sc)
    setCurrentIdx(0)
    setAssignment(a)
    setLoadingPlayer(false)
  }

  useEffect(() => {
    const test = tests[currentIdx]
    if (!test) return
    const existing = existingScores.get(test.id)
    if (existing) {
      setScores([
        existing.pronunciation, existing.structure, existing.vocabulary,
        existing.fluency, existing.comprehension, existing.interactions,
      ])
    } else {
      setScores([null, null, null, null, null, null])
    }
    setSubmitSuccess(false)
    setShowErrors(false)
    if (audioRef.current) audioRef.current.load()
  }, [currentIdx, tests, existingScores])

  // Keyboard shortcut: 1-6 fills next unscored dimension
  useEffect(() => {
    if (!assignment) return
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const n = parseInt(e.key)
      if (n >= 1 && n <= 6) {
        setScores(prev => {
          const next = [...prev] as DimScores
          const firstNull = next.findIndex(v => v === null)
          if (firstNull !== -1) next[firstNull] = n
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assignment])

  async function handleSubmit() {
    const test = tests[currentIdx]
    if (!test || !assignment || !user) return
    if (scores.some(s => s === null)) {
      setShowErrors(true)
      return
    }

    const [p, st, v, fl, c, inter] = scores as number[]
    const overall = Math.min(p, st, v, fl, c, inter)

    setSubmitting(true)
    try {
      const existing = existingScores.get(test.id)
      const dimPayload = {
        pronunciation: p, structure: st, vocabulary: v,
        fluency: fl, comprehension: c, interactions: inter,
        overallLevel: overall,
      }

      if (existing) {
        await updateDoc(doc(db, 'scores', existing.id), dimPayload)
      } else {
        await addDoc(collection(db, 'scores'), {
          ...dimPayload,
          assignmentId: assignment.id,
          sessionId: assignment.sessionId,
          sessionName: assignment.sessionName,
          raterId: user.uid,
          raterName: assignment.raterName,
          testDocId: test.id,
          testNumber: test.testId ?? null,
          candidateName: test.candidateName,
          testType: test.testType,
          published: false,
          notes: '',
          createdAt: serverTimestamp(),
        })
      }

      const updatedScores = new Map(existingScores)
      updatedScores.set(test.id, {
        ...(existing ?? {}),
        id: existing?.id ?? '',
        testDocId: test.id,
        ...dimPayload,
      } as Score)
      setExistingScores(updatedScores)

      if (assignment.testDocIds.every(id => updatedScores.has(id))) {
        await updateDoc(doc(db, 'assignments', assignment.id), { status: 'submitted' })
        setAssignment(prev => prev ? { ...prev, status: 'submitted' } : null)
        queryClient.invalidateQueries({ queryKey: ['my-assignments', user.uid] })
      }

      setSubmitSuccess(true)
      setTimeout(() => {
        setSubmitSuccess(false)
        if (currentIdx < tests.length - 1) setCurrentIdx(idx => idx + 1)
      }, 1500)
    } finally {
      setSubmitting(false)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────

  if (!user) return null

  if (isLoading || loadingPlayer) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  if (!assignment) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">My Assignments</h1>
        <AssignmentList assignments={assignments} onSelect={openAssignment} />
      </div>
    )
  }

  const test = tests[currentIdx]
  const allScored = scores.every(s => s !== null)
  const overall = allScored ? Math.min(...(scores as number[])) : null
  const isAlreadyScored = !!existingScores.get(test?.id ?? '')
  const totalScored = assignment.testDocIds.filter(id => existingScores.has(id)).length

  return (
    <div className="max-w-2xl space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setAssignment(null)}>
          <ChevronLeft className="size-4" /> Assignments
        </Button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{assignment.sessionName}</p>
          <p className="text-xs text-muted-foreground">
            {totalScored} of {tests.length} scored
            {assignment.status === 'submitted' && ' · submitted'}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[assignment.status]}>{STATUS_LABEL[assignment.status]}</Badge>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-5">

        {/* Progress navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Test {currentIdx + 1} of {tests.length}</span>
            {test?.testId && (
              <span className="font-mono text-xs text-muted-foreground">#{test.testId}</span>
            )}
            {isAlreadyScored && (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">scored</span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => i - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={currentIdx === tests.length - 1} onClick={() => setCurrentIdx(i => i + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Test info */}
        {test && (
          <div className="text-sm">
            <p className="font-medium">{test.candidateName}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {test.testType}{test.candidateNationality ? ` · ${test.candidateNationality}` : ''}
            </p>
          </div>
        )}

        {/* Audio player */}
        {test?.recordingUrl ? (
          <div className="rounded-lg bg-muted/40 p-4 space-y-2 border">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Recording</p>
              <div className="flex gap-1">
                {[0.75, 1, 1.25, 1.5].map(speed => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => {
                      setPlaybackSpeed(speed)
                      if (audioRef.current) audioRef.current.playbackRate = speed
                    }}
                    className={`px-2 py-0.5 text-xs rounded font-medium border transition-colors ${
                      playbackSpeed === speed
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
            </div>
            <audio
              ref={audioRef}
              controls
              controlsList="nodownload"
              onContextMenu={e => e.preventDefault()}
              onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = playbackSpeed }}
              className="w-full"
              src={test.recordingUrl}
              preload="metadata"
            />
          </div>
        ) : test ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            No recording available for this test.
          </p>
        ) : null}

        {/* Success banner */}
        {submitSuccess && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 font-medium">
            ✓ Scores saved{currentIdx < tests.length - 1 ? ' — moving to next test…' : ' — all done!'}
          </div>
        )}

        <IcaoSliders scores={scores} onChange={setScores} showErrors={showErrors} />

      </div>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground shrink-0">Overall</span>
            {overall !== null
              ? <span className={`text-base font-bold px-2 py-0.5 rounded border ${levelColour(overall)}`}>{overall}</span>
              : <span className="text-sm text-muted-foreground">—</span>
            }
            <span className="text-xs text-muted-foreground ml-2 truncate">
              {scores.filter(s => s !== null).length}/6 scored
            </span>
          </div>
          <p className="text-xs text-muted-foreground hidden sm:block shrink-0">1–6 to fill next</p>
          <Button
            onClick={handleSubmit}
            disabled={!allScored || submitting || submitSuccess}
            className="shrink-0"
          >
            {submitting ? 'Saving…' : submitSuccess ? 'Saved!' : isAlreadyScored ? 'Update scores' : 'Submit scores'}
          </Button>
        </div>
      </div>

      <div className="h-20" />
    </div>
  )
}
