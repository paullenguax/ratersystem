import { Fragment, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { ChevronLeft } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Person, Session, Test } from '@/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const DIMS = [
  { key: 'pronunciation',  abbr: 'PRO' },
  { key: 'structure',      abbr: 'STR' },
  { key: 'vocabulary',     abbr: 'VOC' },
  { key: 'fluency',        abbr: 'FLU' },
  { key: 'comprehension',  abbr: 'COM' },
  { key: 'interactions',   abbr: 'INT' },
] as const

function btnColour(n: number, selected: boolean) {
  if (!selected) return 'border-input hover:bg-muted text-muted-foreground'
  if (n >= 5) return 'border-green-600 bg-green-50 text-green-700 font-bold'
  if (n === 4) return 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
  if (n === 3) return 'border-amber-500 bg-amber-50 text-amber-700 font-bold'
  return 'border-red-500 bg-red-50 text-red-700 font-bold'
}

interface TestEntry {
  testDocId: string
  scores: (number | null)[]
}

const emptyEntry = (): TestEntry => ({ testDocId: '', scores: Array(6).fill(null) })

export function QuickEntryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [raterId, setRaterId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [entries, setEntries] = useState<TestEntry[]>([emptyEntry(), emptyEntry(), emptyEntry(), emptyEntry()])
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person),
  })
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await getDocs(collection(db, 'sessions'))).docs.map(d => ({ id: d.id, ...d.data() }) as Session),
  })
  const { data: tests = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: async () => (await getDocs(collection(db, 'test_bank'))).docs
      .map(d => ({ id: d.id, ...d.data() }) as Test)
      .filter(t => t.status !== 'retired')
      .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999)),
  })

  const rater = useMemo(() => people.find(p => p.id === raterId), [people, raterId])
  const session = useMemo(() => sessions.find(s => s.id === sessionId), [sessions, sessionId])

  const activePeople = useMemo(() =>
    people.filter(p => p.status === 'active').sort((a, b) => a.name.localeCompare(b.name)),
    [people]
  )
  const openSessions = useMemo(() =>
    sessions.filter(s => s.status === 'open').sort((a, b) => a.name.localeCompare(b.name)),
    [sessions]
  )

  // Tests already selected in other slots
  const selectedTestIds = useMemo(() => new Set(entries.map(e => e.testDocId).filter(Boolean)), [entries])

  function setTestDocId(i: number, testDocId: string) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, testDocId } : e))
  }

  function setScore(i: number, dimIdx: number, val: number) {
    setEntries(prev => prev.map((e, idx) =>
      idx === i ? { ...e, scores: e.scores.map((s, si) => si === dimIdx ? val : s) } : e
    ))
  }

  function validate() {
    if (!raterId || !sessionId) return false
    return entries.every(e => e.testDocId && e.scores.every(s => s !== null))
  }

  async function handleSubmit() {
    setShowErrors(true)
    if (!validate() || !rater || !session) return

    setSubmitting(true)
    try {
      const testDocIds = entries.map(e => e.testDocId)

      const assignRef = await addDoc(collection(db, 'assignments'), {
        raterId,
        raterName: rater.name,
        sessionId,
        sessionName: session.name,
        testDocIds,
        status: 'submitted',
        notes: '',
        createdAt: serverTimestamp(),
      })

      await Promise.all(entries.map((e, idx) => {
        const test = tests.find(t => t.id === e.testDocId)!
        const [pronunciation, structure, vocabulary, fluency, comprehension, interactions] = e.scores as number[]
        return addDoc(collection(db, 'scores'), {
          assignmentId: assignRef.id,
          sessionId,
          sessionName: session.name,
          raterId,
          raterName: rater.name,
          testDocId: e.testDocId,
          testNumber: test.testId ?? null,
          candidateName: test.candidateName,
          testType: test.testType,
          pronunciation, structure, vocabulary, fluency, comprehension, interactions,
          overallLevel: Math.min(...(e.scores as number[])),
          published: false,
          notes: '',
          sequence: idx,
          createdAt: serverTimestamp(),
        })
      }))

      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      queryClient.invalidateQueries({ queryKey: ['scores'] })
      navigate(`/assignments/${assignRef.id}`)
    } finally {
      setSubmitting(false)
    }
  }

  const headerError = showErrors && (!raterId || !sessionId)

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/assignments')}>
          <ChevronLeft className="size-4" /> Assignments
        </Button>
        <h1 className="text-2xl font-semibold">Quick entry</h1>
      </div>

      {/* Rater + Event */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Rater</Label>
          <Select value={raterId} onValueChange={v => setRaterId(v ?? '')}>
            <SelectTrigger className={showErrors && !raterId ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select rater…">
                {rater?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {activePeople.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Event</Label>
          <Select value={sessionId} onValueChange={v => setSessionId(v ?? '')}>
            <SelectTrigger className={showErrors && !sessionId ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select event…">
                {session?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {openSessions.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {headerError && <p className="text-xs text-destructive -mt-4">Select a rater and event to continue.</p>}

      {/* Test cards */}
      <div className="space-y-4">
        {entries.map((entry, i) => {
          const test = tests.find(t => t.id === entry.testDocId)
          const allScored = entry.scores.every(s => s !== null)
          const overall = allScored ? Math.min(...(entry.scores as number[])) : null

          return (
            <div
              key={i}
              className={`rounded-lg border p-4 space-y-3 ${showErrors && (!entry.testDocId || !allScored) ? 'border-destructive' : ''}`}
            >
              {/* Test selector */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Test {i + 1}</span>
                <Select value={entry.testDocId} onValueChange={v => setTestDocId(i, v ?? '')}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select test…">
                      {test ? `#${test.testId} — ${test.candidateName} (${test.testType})` : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72 w-[32rem]">
                    {tests.map(t => (
                      <SelectItem
                        key={t.id}
                        value={t.id}
                        disabled={selectedTestIds.has(t.id) && t.id !== entry.testDocId}
                      >
                        #{t.testId} — {t.candidateName} ({t.testType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {overall !== null && (
                  <span className={`text-sm font-bold w-8 text-right shrink-0 ${
                    overall >= 5 ? 'text-green-700' : overall === 4 ? 'text-blue-700' : overall === 3 ? 'text-amber-700' : 'text-red-700'
                  }`}>
                    {overall}
                  </span>
                )}
              </div>

              {/* Score buttons */}
              {entry.testDocId && (
                <div className="grid grid-cols-[3rem_1fr] gap-y-1.5 items-center">
                  {DIMS.map((dim, di) => (
                    <Fragment key={di}>
                      <span className="text-xs text-muted-foreground">{dim.abbr}</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5, 6].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setScore(i, di, n)}
                            className={`w-9 h-8 rounded border text-sm transition-colors ${btnColour(n, entry.scores[di] === n)}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          Creates assignment + {entries.length} scores · status: submitted · unpublished
        </p>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : 'Submit all scores'}
        </Button>
      </div>
    </div>
  )
}
