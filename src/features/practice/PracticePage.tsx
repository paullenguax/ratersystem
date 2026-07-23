import { useState, useEffect } from 'react'
import {
  collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  doc, query, where, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, Download, Trash2, X, ChevronLeft, Radio, Plus, GraduationCap } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { PracticeSession, PracticeScore, Test } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DIMENSIONS } from '@/features/scoring/IcaoSliders'

// ── helpers ────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function levelColour(n: number) {
  if (n >= 5) return 'text-green-700 bg-green-50 border-green-300'
  if (n === 4) return 'text-blue-700 bg-blue-50 border-blue-300'
  if (n === 3) return 'text-amber-700 bg-amber-50 border-amber-300'
  return 'text-red-700 bg-red-50 border-red-300'
}

function practiceUrl(code: string): string {
  const base = window.location.origin
  return `${base}/ratersystem/practice/${code}`
}

function exportCsv(session: PracticeSession, scores: PracticeScore[]) {
  const header = ['Name', 'Pronunciation', 'Structure', 'Vocabulary', 'Fluency', 'Comprehension', 'Interactions', 'Overall', 'Submitted']
  const rows = scores.map(s => [
    s.participantName,
    s.pronunciation, s.structure, s.vocabulary,
    s.fluency, s.comprehension, s.interactions,
    s.overallLevel,
    s.submittedAt ? new Date((s.submittedAt as unknown as { seconds: number }).seconds * 1000).toISOString() : '',
  ])
  const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `practice-${session.code}-${session.title.replace(/\s+/g, '_')}.csv`
  a.click()
}

// ── data ────────────────────────────────────────────────────────────────────

async function fetchSessions(): Promise<PracticeSession[]> {
  // Sorted client-side rather than via Firestore's orderBy — orderBy silently
  // excludes any document missing the ordered field entirely (not an error,
  // just dropped from the results), so a session somehow missing createdAt
  // would vanish from this list while still working fine for participants
  // (who find it by code, not by this query).
  const snap = await getDocs(collection(db, 'practice_sessions'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as PracticeSession)
    .sort((a, b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0))
}

async function fetchTests(): Promise<Test[]> {
  const snap = await getDocs(query(collection(db, 'test_bank'), where('status', '==', 'active')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Test)
    .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))
}

// ── create dialog ────────────────────────────────────────────────────────────

function CreateDialog({
  tests,
  trainerName,
  onClose,
  onCreate,
}: {
  tests: Test[]
  trainerName: string
  onClose: () => void
  onCreate: (s: PracticeSession) => void
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [selectedTestId, setSelectedTestId] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!title.trim() || !user) return
    setSaving(true)
    const code = generateCode()
    const selectedTest = tests.find(t => t.id === selectedTestId)
    const payload: Omit<PracticeSession, 'id'> = {
      code,
      title: title.trim(),
      trainerId: user.uid,
      trainerName,
      status: 'active',
      createdAt: serverTimestamp() as PracticeSession['createdAt'],
      ...(selectedTest && {
        testDocId: selectedTest.id,
        testSource: 'test_bank' as const,
        audioUrl: selectedTest.recordingUrl,
        testLabel: `#${selectedTest.testId ?? '?'} — ${selectedTest.candidateName}`,
      }),
    }
    const ref = await addDoc(collection(db, 'practice_sessions'), payload)
    onCreate({ id: ref.id, ...payload } as PracticeSession)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
      <div className="bg-background rounded-xl border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">New practice session</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">Session title</label>
            <input
              type="text"
              placeholder="e.g. Module 3 – Pronunciation focus"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Test recording (optional)</label>
            <select
              value={selectedTestId}
              onChange={e => setSelectedTestId(e.target.value)}
              className="w-full border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background"
            >
              <option value="">— Trainer plays audio externally —</option>
              {tests.map(t => (
                <option key={t.id} value={t.id}>
                  #{t.testId ?? '?'} — {t.candidateName} ({t.testType})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              If selected, participants hear the audio on their own device.
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!title.trim() || saving} onClick={handleCreate}>
            {saving ? 'Creating…' : 'Create session'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── results view ─────────────────────────────────────────────────────────────

function ResultsView({ session, onBack }: { session: PracticeSession; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [scores, setScores] = useState<PracticeScore[]>([])
  const [hideNames, setHideNames] = useState(false)
  const [shuffledIds, setShuffledIds] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [promoting, setPromoting] = useState(false)

  // The Test this session was built from (if any) — needed to supply
  // candidateName/testType/testNumber when promoting scores, since
  // standardization_scores requires those and PracticeScore doesn't carry them.
  const { data: linkedTest } = useQuery({
    queryKey: ['practice-linked-test', session.testDocId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'test_bank', session.testDocId!))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Test) : null
    },
    enabled: !!session.testDocId,
  })

  // Real-time listener
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'practice_scores'), where('sessionId', '==', session.id)),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PracticeScore)
        setScores(data)
      }
    )
    return unsub
  }, [session.id])

  // Shuffle order for name-hidden view — regenerate when scores change (new submissions)
  useEffect(() => {
    setShuffledIds(prev => {
      const existingIds = new Set(prev)
      const newIds = scores.map(s => s.id).filter(id => !existingIds.has(id))
      const shuffled = [...prev, ...newIds].sort(() => Math.random() - 0.5)
      return shuffled.filter(id => scores.some(s => s.id === id))
    })
  }, [scores.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayScores = hideNames
    ? shuffledIds.map((id, i) => {
        const s = scores.find(sc => sc.id === id)
        return s ? { ...s, participantName: `Rater ${i + 1}` } : null
      }).filter(Boolean) as PracticeScore[]
    : [...scores].sort((a, b) => {
        const aTime = (a.submittedAt as unknown as { seconds: number })?.seconds ?? 0
        const bTime = (b.submittedAt as unknown as { seconds: number })?.seconds ?? 0
        return aTime - bTime
      })

  async function closeSession() {
    await updateDoc(doc(db, 'practice_sessions', session.id), { status: 'closed' })
    queryClient.invalidateQueries({ queryKey: ['practice-sessions'] })
    onBack()
  }

  async function clearScores() {
    if (!confirm(`Delete all ${scores.length} scores for this session? This cannot be undone.`)) return
    setClearing(true)
    await Promise.all(scores.map(s => deleteDoc(doc(db, 'practice_scores', s.id))))
    setClearing(false)
  }

  // Copies Canvas-identified, not-yet-promoted scores into standardization_scores.
  // Anonymous submissions (no raterId) are skipped — there's no real person to
  // attribute them to. Written as the signed-in admin, so the existing
  // standardization_scores create rule's isAdmin() branch covers this without
  // needing any rule changes.
  async function promoteScores() {
    if (!linkedTest) return
    const eligible = scores.filter(s => s.raterId && !s.promotedToStandardization)
    if (eligible.length === 0) return
    if (!confirm(`Save ${eligible.length} score${eligible.length === 1 ? '' : 's'} to the standardization pool?`)) return
    setPromoting(true)
    try {
      await Promise.all(eligible.map(async s => {
        await addDoc(collection(db, 'standardization_scores'), {
          assignmentId: `practice:${session.id}`,
          sessionId: `practice:${session.id}`,
          sessionName: `Practice: ${session.title}`,
          raterId: s.raterId,
          raterName: s.raterName ?? s.participantName,
          testDocId: linkedTest.id,
          testNumber: linkedTest.testId ?? null,
          candidateName: linkedTest.candidateName,
          testType: linkedTest.testType,
          pronunciation: s.pronunciation,
          structure: s.structure,
          vocabulary: s.vocabulary,
          fluency: s.fluency,
          comprehension: s.comprehension,
          interactions: s.interactions,
          overallLevel: s.overallLevel,
          createdAt: serverTimestamp(),
        })
        await updateDoc(doc(db, 'practice_scores', s.id), { promotedToStandardization: true })
      }))
    } finally {
      setPromoting(false)
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(practiceUrl(session.code))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const dimKeys = DIMENSIONS.map(d => d.key)
  const promotableCount = scores.filter(s => s.raterId && !s.promotedToStandardization).length
  const promoteDisabledReason = !session.testDocId
    ? 'Only available for sessions built from a Test Bank recording'
    : promotableCount === 0
      ? 'No Canvas-identified scores yet'
      : undefined

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ChevronLeft className="size-4" /> Sessions
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold">{session.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{session.code}</code>
            {session.status === 'active' && (
              <span className="flex items-center gap-1 text-xs text-green-700">
                <Radio className="size-3" /> Live
              </span>
            )}
            {session.testLabel && (
              <span className="text-xs text-muted-foreground truncate">{session.testLabel}</span>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        {session.status === 'active' && (
          <Button variant="outline" size="sm" onClick={copyUrl}>
            <Copy className="size-3.5 mr-1.5" />
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
        )}
        <Button
          variant="outline" size="sm"
          onClick={() => setHideNames(h => !h)}
        >
          {hideNames ? <Eye className="size-3.5 mr-1.5" /> : <EyeOff className="size-3.5 mr-1.5" />}
          {hideNames ? 'Show names' : 'Hide names'}
        </Button>
        {scores.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => exportCsv(session, scores)}>
            <Download className="size-3.5 mr-1.5" /> Export CSV
          </Button>
        )}
        {scores.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearScores} disabled={clearing} className="text-destructive hover:text-destructive">
            <Trash2 className="size-3.5 mr-1.5" /> Clear scores
          </Button>
        )}
        {scores.length > 0 && (
          <Button
            variant="outline" size="sm"
            onClick={promoteScores}
            disabled={promoting || !!promoteDisabledReason}
            title={promoteDisabledReason}
          >
            <GraduationCap className="size-3.5 mr-1.5" />
            {promoting ? 'Saving…' : `Save${promotableCount > 0 ? ` ${promotableCount}` : ''} to standardization pool`}
          </Button>
        )}
        {session.status === 'active' && (
          <Button variant="outline" size="sm" onClick={closeSession} className="text-destructive hover:text-destructive ml-auto">
            Close session
          </Button>
        )}
      </div>

      {/* Results table */}
      {displayScores.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p>Waiting for submissions…</p>
          <p className="text-sm mt-1">Share the link and results will appear here in real time.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                {DIMENSIONS.map(d => (
                  <th key={d.key} className="text-center px-2 py-2 font-medium text-xs">{d.label.slice(0, 4)}</th>
                ))}
                <th className="text-center px-3 py-2 font-medium">Overall</th>
              </tr>
            </thead>
            <tbody>
              {displayScores.map((s, i) => {
                return (
                  <tr key={s.id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                    <td className="px-3 py-2 font-medium">
                      {s.participantName}
                      {!s.raterId && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">anonymous</span>
                      )}
                      {s.promotedToStandardization && (
                        <span className="ml-1.5 text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1 py-0.5 font-normal">
                          ✓ saved
                        </span>
                      )}
                    </td>
                    {dimKeys.map(k => (
                      <td key={k} className="text-center px-2 py-2">
                        <span className={`inline-block text-xs font-bold px-1.5 py-0.5 rounded border ${levelColour(s[k as keyof PracticeScore] as number)}`}>
                          {s[k as keyof PracticeScore] as number}
                        </span>
                      </td>
                    ))}
                    <td className="text-center px-3 py-2">
                      <span className={`inline-block text-xs font-bold px-1.5 py-0.5 rounded border ${levelColour(s.overallLevel)}`}>
                        {s.overallLevel}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {displayScores.length > 1 && (() => {
              const avg = (key: keyof PracticeScore) =>
                (displayScores.reduce((sum, s) => sum + (s[key] as number), 0) / displayScores.length).toFixed(1)
              return (
                <tfoot>
                  <tr className="border-t bg-muted/50 font-medium">
                    <td className="px-3 py-2 text-xs text-muted-foreground">Average ({displayScores.length})</td>
                    {dimKeys.map(k => (
                      <td key={k} className="text-center px-2 py-2 text-xs">{avg(k as keyof PracticeScore)}</td>
                    ))}
                    <td className="text-center px-3 py-2 text-xs">{avg('overallLevel')}</td>
                  </tr>
                </tfoot>
              )
            })()}
          </table>
        </div>
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export function PracticePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedSession, setSelectedSession] = useState<PracticeSession | null>(null)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['practice-sessions'],
    queryFn: fetchSessions,
    enabled: !!user,
  })

  const { data: tests = [] } = useQuery({
    queryKey: ['test-bank-active'],
    queryFn: fetchTests,
    enabled: showCreate,
  })

  function handleCreated(s: PracticeSession) {
    setShowCreate(false)
    queryClient.invalidateQueries({ queryKey: ['practice-sessions'] })
    setSelectedSession(s)
  }

  function copyUrl(code: string, e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(practiceUrl(code))
  }

  async function deleteSession(s: PracticeSession, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${s.title}" and all its scores? This cannot be undone.`)) return
    const scoresSnap = await getDocs(query(collection(db, 'practice_scores'), where('sessionId', '==', s.id)))
    await Promise.all(scoresSnap.docs.map(d => deleteDoc(doc(db, 'practice_scores', d.id))))
    await deleteDoc(doc(db, 'practice_sessions', s.id))
    queryClient.invalidateQueries({ queryKey: ['practice-sessions'] })
  }

  function formatDate(s: PracticeSession): string {
    const ts = s.createdAt as unknown as { seconds: number } | undefined
    if (!ts?.seconds) return ''
    return new Date(ts.seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (selectedSession) {
    return (
      <ResultsView
        session={selectedSession}
        onBack={() => {
          setSelectedSession(null)
          queryClient.invalidateQueries({ queryKey: ['practice-sessions'] })
        }}
      />
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Practice Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Share a link so trainees can score a test live during a course.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="size-4 mr-1.5" /> New session
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <p>No sessions yet.</p>
          <p className="text-sm mt-1">Create one and share the link with your trainees.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => setSelectedSession(s)}
              className="w-full text-left rounded-lg border p-4 hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{s.title}</p>
                    <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className="shrink-0">
                      {s.status === 'active' ? 'Live' : 'Closed'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {s.testLabel && (
                      <p className="text-xs text-muted-foreground truncate">{s.testLabel}</p>
                    )}
                    {formatDate(s) && (
                      <p className="text-xs text-muted-foreground shrink-0">{formatDate(s)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{s.code}</code>
                  {s.status === 'active' && (
                    <button
                      onClick={e => copyUrl(s.code, e)}
                      className="text-muted-foreground hover:text-foreground p-1"
                      title="Copy link"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  )}
                  <button
                    onClick={e => deleteSession(s, e)}
                    className="text-muted-foreground hover:text-destructive p-1 ml-1"
                    title="Delete session"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDialog
          tests={tests}
          trainerName={user?.displayName ?? user?.email ?? 'Trainer'}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreated}
        />
      )}
    </div>
  )
}
