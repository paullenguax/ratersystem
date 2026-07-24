import { useState, useEffect, useRef } from 'react'
import {
  collection, getDocs, query, where,
  addDoc, updateDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { db } from '@/lib/firebase'
import { formatTestNumber } from '@/lib/testNumber'
import { useAuth } from '@/context/AuthContext'
import type { Assignment, Test, StandardizationScore } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { IcaoSliders, DIMENSIONS, type DimScores } from '@/features/scoring/IcaoSliders'

// Independent copy of ScoringPage's fetch/save/confirm mechanics — same
// review→confirm→lock pattern, but no trainee anonymisation (this is never a
// blind exam) and no self-serve auto-open, plus a per-test comments field.
// See ScoringPage.tsx / README.md "Scoring player" for why the mechanics
// (drafts, auto-save-on-navigate-away, single Continue button) look the way
// they do — kept intentionally, not simplified.

const COMMENT_MAX = 250

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

type Draft = { scores: DimScores; comments: string }
const EMPTY_SCORES: DimScores = [null, null, null, null, null, null]

// ── data fetching ──────────────────────────────────────────────────────────

async function fetchMyAssignments(uid: string): Promise<Assignment[]> {
  const snap = await getDocs(query(collection(db, 'assignments'), where('raterId', '==', uid)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Assignment)
    .filter(a => a.category === 'standardization' && a.status !== 'published' && !a.confirmedAt)
    .sort((a, b) => a.sessionName.localeCompare(b.sessionName))
}

async function fetchTestsForAssignment(testDocIds: string[]): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Test)
    .filter(t => testDocIds.includes(t.id))
    .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))
}

async function fetchExistingScores(assignmentId: string): Promise<Map<string, StandardizationScore>> {
  const snap = await getDocs(query(collection(db, 'standardization_scores'), where('assignmentId', '==', assignmentId)))
  const map = new Map<string, StandardizationScore>()
  snap.docs.forEach(d => {
    const s = { id: d.id, ...d.data() } as StandardizationScore
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
        <p className="text-muted-foreground">No standardization assignments pending.</p>
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

export function StandardizationPlayerPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [existingScores, setExistingScores] = useState<Map<string, StandardizationScore>>(new Map())
  const [loadingPlayer, setLoadingPlayer] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [scores, setScores] = useState<DimScores>(EMPTY_SCORES)
  const [comments, setComments] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [reviewing, setReviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map())
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null)
  const [editedThisSession, setEditedThisSession] = useState<Set<string>>(new Set())
  const audioRef = useRef<HTMLAudioElement>(null)

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['my-standardization-assignments', user?.uid],
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
    setReviewing(false)
    setDrafts(new Map())
    setEditedThisSession(new Set())
    setAssignment(a)
    setLoadingPlayer(false)
  }

  useEffect(() => {
    const test = tests[currentIdx]
    if (!test) return
    const draft = drafts.get(test.id)
    const existing = existingScores.get(test.id)
    if (draft) {
      setScores(draft.scores)
      setComments(draft.comments)
    } else if (existing) {
      setScores([
        existing.pronunciation, existing.structure, existing.vocabulary,
        existing.fluency, existing.comprehension, existing.interactions,
      ])
      setComments(existing.comments ?? '')
    } else {
      setScores(EMPTY_SCORES)
      setComments('')
    }
    setSubmitError(null)
    setShowErrors(false)
    if (audioRef.current) audioRef.current.load()
    // drafts intentionally excluded — see ScoringPage.tsx for the same pattern
  }, [currentIdx, tests, existingScores]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const test = tests[currentIdx]
    if (!test) return
    setDrafts(prev => new Map(prev).set(test.id, { scores, comments }))
    // currentIdx/tests intentionally excluded — only scores/comments changing
    // should trigger this; the effect above already reacts to navigation.
  }, [scores, comments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut: 1-6 fills next unscored dimension (ignored while
  // focus is in a text field, including the comments Textarea)
  useEffect(() => {
    if (!assignment) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
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

  function findNextIncompleteIdx(fromIdx: number, scoredMap: Map<string, StandardizationScore>): number | null {
    for (let offset = 1; offset < tests.length; offset++) {
      const idx = (fromIdx + offset) % tests.length
      if (!scoredMap.has(tests[idx].id)) return idx
    }
    return null
  }

  async function saveCurrentTest(): Promise<{ ok: boolean; updatedScores?: Map<string, StandardizationScore> }> {
    const test = tests[currentIdx]
    if (!test || !assignment || !user) return { ok: false }
    if (scores.some(s => s === null)) {
      setShowErrors(true)
      return { ok: false }
    }

    const [p, st, v, fl, c, inter] = scores as number[]
    const overall = Math.min(p, st, v, fl, c, inter)
    const trimmedComments = comments.slice(0, COMMENT_MAX)

    setSubmitting(true)
    setSubmitError(null)
    try {
      const existing = existingScores.get(test.id)
      const dimPayload = {
        pronunciation: p, structure: st, vocabulary: v,
        fluency: fl, comprehension: c, interactions: inter,
        overallLevel: overall,
        comments: trimmedComments,
      }

      let scoreId = existing?.id
      if (existing) {
        await updateDoc(doc(db, 'standardization_scores', existing.id), dimPayload)
        setEditedThisSession(prev => new Set(prev).add(test.id))
      } else {
        const newDocRef = await addDoc(collection(db, 'standardization_scores'), {
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
          createdAt: serverTimestamp(),
        })
        scoreId = newDocRef.id
      }

      const updatedScores = new Map(existingScores)
      updatedScores.set(test.id, {
        ...(existing ?? {}),
        id: scoreId!,
        testDocId: test.id,
        ...dimPayload,
      } as StandardizationScore)
      setExistingScores(updatedScores)
      setDrafts(prev => {
        const next = new Map(prev)
        next.delete(test.id)
        return next
      })

      setJustSaved(test.candidateName)
      setTimeout(() => setJustSaved(prev => (prev === test.candidateName ? null : prev)), 2500)

      if (assignment.testDocIds.every(id => updatedScores.has(id))) {
        await updateDoc(doc(db, 'assignments', assignment.id), { status: 'submitted' })
        setAssignment(prev => prev ? { ...prev, status: 'submitted' } : null)
        queryClient.invalidateQueries({ queryKey: ['my-standardization-assignments', user.uid] })
      }
      return { ok: true, updatedScores }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save scores. Please try again.')
      return { ok: false }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleContinue() {
    let scoredMap = existingScores
    if (hasChanges && allScored) {
      const result = await saveCurrentTest()
      if (!result.ok) return
      scoredMap = result.updatedScores ?? existingScores
    }
    if (reviewing) {
      setReviewing(false)
      return
    }
    const nextIdx = findNextIncompleteIdx(currentIdx, scoredMap)
    if (nextIdx !== null) setCurrentIdx(nextIdx)
  }

  async function saveIfNeeded(): Promise<boolean> {
    if (!hasChanges || !allScored) return true
    return (await saveCurrentTest()).ok
  }

  async function goToTest(newIdx: number) {
    if (!(await saveIfNeeded())) return
    setCurrentIdx(newIdx)
  }

  async function backToSummary() {
    if (!(await saveIfNeeded())) return
    setReviewing(false)
  }

  async function leaveAssignment() {
    if (!(await saveIfNeeded())) return
    setAssignment(null)
  }

  async function handleConfirm() {
    if (!assignment) return
    setConfirming(true)
    try {
      await updateDoc(doc(db, 'assignments', assignment.id), { confirmedAt: serverTimestamp() })
      setAssignment(prev => prev ? { ...prev, confirmedAt: Timestamp.now() } : null)
      queryClient.invalidateQueries({ queryKey: ['my-standardization-assignments', user!.uid] })
    } finally {
      setConfirming(false)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────

  if (!user) return null

  if ((isLoading && !assignment) || loadingPlayer) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  if (!assignment) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Standardization</h1>
        <AssignmentList assignments={assignments} onSelect={openAssignment} />
      </div>
    )
  }

  const test = tests[currentIdx]
  const allScored = scores.every(s => s !== null)
  const overall = allScored ? Math.min(...(scores as number[])) : null
  const existingScore = existingScores.get(test?.id ?? '')
  const isAlreadyScored = !!existingScore
  const totalScored = assignment.testDocIds.filter(id => existingScores.has(id)).length
  const assignmentComplete = tests.length > 0 && totalScored === tests.length
  const hasChanges = !isAlreadyScored || (allScored && (
    scores[0] !== existingScore!.pronunciation ||
    scores[1] !== existingScore!.structure ||
    scores[2] !== existingScore!.vocabulary ||
    scores[3] !== existingScore!.fluency ||
    scores[4] !== existingScore!.comprehension ||
    scores[5] !== existingScore!.interactions ||
    comments !== (existingScore!.comments ?? '')
  ))
  const readyToSubmit = allScored && !submitting && hasChanges
  const nextIncompleteIdx = findNextIncompleteIdx(currentIdx, existingScores)
  const canContinue = reviewing || (hasChanges && allScored) || nextIncompleteIdx !== null
  const continueLabelShort = reviewing ? 'Back' : nextIncompleteIdx === null ? 'Complete' : 'Continue'
  const continueLabelFull = reviewing
    ? 'Back to summary'
    : nextIncompleteIdx === null
      ? 'Complete'
      : `Continue to ${tests[nextIncompleteIdx].candidateName}`

  return (
    <div className="max-w-2xl space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => (assignmentComplete && reviewing ? backToSummary() : leaveAssignment())}
        >
          <ChevronLeft className="size-4" /> {assignmentComplete && reviewing ? 'Back to summary' : 'Assignments'}
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

      {justSaved && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800 font-medium">
          ✓ {justSaved} saved
        </div>
      )}

      {assignmentComplete && !reviewing ? (
        <div className="rounded-xl border bg-green-50 border-green-200 p-8 text-center space-y-5">
          <div>
            <p className="text-2xl font-bold text-green-800">
              {assignment.confirmedAt ? '✓ All done' : 'Review your scores'}
            </p>
            <p className="text-sm text-green-700 mt-1">
              {assignment.confirmedAt
                ? `You've submitted scores for all ${tests.length} candidates in ${assignment.sessionName}.`
                : 'Check everything below before confirming — once confirmed, you won\'t be able to change your answers.'}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 max-w-sm mx-auto">
            {tests.map(t => {
              const s = existingScores.get(t.id)
              const label = `${t.testId ? `#${t.testId} — ` : ''}${t.candidateName}`
              const isExpanded = expandedSummaryId === t.id
              return (
                <div key={t.id} className="rounded-md bg-white border text-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedSummaryId(isExpanded ? null : t.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {isExpanded ? <ChevronUp className="size-3 text-muted-foreground shrink-0" /> : <ChevronDown className="size-3 text-muted-foreground shrink-0" />}
                      <span className="font-medium truncate">{label}</span>
                      {editedThisSession.has(t.id) && (
                        <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 shrink-0">edited</span>
                      )}
                    </span>
                    {s && (
                      <span className={`font-mono font-bold text-xs px-1.5 py-0.5 rounded border shrink-0 ${levelColour(s.overallLevel)}`}>
                        {s.overallLevel}
                      </span>
                    )}
                  </button>
                  {isExpanded && s && (
                    <div className="px-3 pb-2 pt-1 border-t text-xs space-y-2">
                      <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                        {DIMENSIONS.map(dim => {
                          const val = s[dim.key] as number
                          return (
                            <div key={dim.key} className="flex items-center justify-between">
                              <span className="text-muted-foreground">{dim.label.slice(0, 3).toUpperCase()}</span>
                              <span className={`font-mono font-bold px-1 rounded ${levelColour(val)}`}>{val}</span>
                            </div>
                          )
                        })}
                      </div>
                      {s.comments && (
                        <p className="text-muted-foreground whitespace-pre-wrap">{s.comments}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-2">
            {assignment.confirmedAt ? (
              <Button size="sm" onClick={() => setAssignment(null)}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setReviewing(true)}>
                  Review or change an answer
                </Button>
                <Button size="sm" onClick={handleConfirm} disabled={confirming}>
                  {confirming ? 'Confirming…' : "Yes, that's my scores"}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
      <>
      <div className="sr-only" aria-live="polite">
        {test && `Now viewing ${test.candidateName}, ${currentIdx + 1} of ${tests.length}`}
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-5">

        {/* Progress navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Test {currentIdx + 1} of {tests.length}</span>
            {test?.testId && (
              <span className="font-mono text-xs text-muted-foreground">{formatTestNumber(test.testId, test.category)}</span>
            )}
            {isAlreadyScored && (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">scored</span>
            )}
            {test && editedThisSession.has(test.id) && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">✓ your edit saved</span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={currentIdx === 0 || submitting} onClick={() => goToTest(currentIdx - 1)} aria-label="Previous candidate">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={currentIdx === tests.length - 1 || submitting} onClick={() => goToTest(currentIdx + 1)} aria-label="Next candidate">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

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

        {submitError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 font-medium">
            Couldn't save your scores: {submitError}
          </div>
        )}

        <IcaoSliders scores={scores} onChange={setScores} showErrors={showErrors} />

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Comments (optional)</label>
            <span className="text-xs text-muted-foreground">{comments.length}/{COMMENT_MAX}</span>
          </div>
          <Textarea
            value={comments}
            onChange={e => setComments(e.target.value.slice(0, COMMENT_MAX))}
            maxLength={COMMENT_MAX}
            rows={3}
            placeholder="Any notes on this candidate…"
          />
        </div>

        {readyToSubmit && (
          <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            isAlreadyScored ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'
          }`}>
            {isAlreadyScored
              ? `You've changed this answer — click "${continueLabelFull}" below to save your change.`
              : `✓ All 6 areas scored — click "${continueLabelFull}" below to save.`}
          </div>
        )}

      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur px-4 py-3 transition-colors ${
        readyToSubmit
          ? (isAlreadyScored
              ? 'bg-amber-100/80 supports-[backdrop-filter]:bg-amber-100/70'
              : 'bg-green-100/80 supports-[backdrop-filter]:bg-green-100/70')
          : 'bg-[#B3C8D9]/50 supports-[backdrop-filter]:bg-[#B3C8D9]/40'
      }`}>
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
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline" size="sm"
              disabled={currentIdx === 0 || submitting}
              onClick={() => goToTest(currentIdx - 1)}
              aria-label="Previous candidate"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!canContinue || submitting}
              className={`max-w-[45vw] sm:max-w-none ${readyToSubmit ? (isAlreadyScored ? 'ring-2 ring-amber-500 ring-offset-1' : 'ring-2 ring-green-500 ring-offset-1') : ''}`}
            >
              {readyToSubmit && isAlreadyScored && <Pencil className="size-3.5 mr-1 shrink-0" aria-hidden="true" />}
              <span className="truncate sm:hidden">{submitting ? 'Saving…' : continueLabelShort}</span>
              <span className="hidden sm:inline">{submitting ? 'Saving…' : continueLabelFull}</span>
              {readyToSubmit && isAlreadyScored && <span className="sr-only"> (editing a previously saved answer)</span>}
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={currentIdx === tests.length - 1 || submitting}
              onClick={() => goToTest(currentIdx + 1)}
              aria-label="Next candidate"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="h-20" />
      </>
      )}
    </div>
  )
}
