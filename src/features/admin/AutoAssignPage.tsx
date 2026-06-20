import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { Shuffle, Check } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Person, Test, Score, Session } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ── algorithm ──────────────────────────────────────────────────────────────

interface ProposedAssignment {
  rater: Person
  tests: Test[]
  anchorIdx: number   // index in tests[] that is the anchor (-1 if none)
}

function pickTests(params: {
  rater: Person
  pool: Test[]
  seenByRater: Set<string>           // testDocIds this rater has rated before
  assignFreq: Map<string, number>    // how many times each test is already assigned this run
  totalPerRater: number
}): { tests: Test[]; anchorIdx: number } {
  const { rater: _, pool, seenByRater, assignFreq, totalPerRater } = params
  const chosen: Test[] = []
  let anchorIdx = -1

  // Partition pool into seen/unseen, and by difficulty tier
  const seen   = pool.filter(t => seenByRater.has(t.id))
  const unseen = pool.filter(t => !seenByRater.has(t.id))

  // Calibrated = has canonicalDifficulty; sort by difficulty ascending
  const calibratedUnseen = unseen
    .filter(t => t.canonicalDifficulty != null)
    .sort((a, b) => (a.canonicalDifficulty ?? 0) - (b.canonicalDifficulty ?? 0))

  // Anchor: for returnees use a test they've seen (well-calibrated preferred); else best-calibrated unseen
  let anchor: Test | null = null
  const seenCalibrated = seen
    .filter(t => t.canonicalSE != null)
    .sort((a, b) => (a.canonicalSE ?? 99) - (b.canonicalSE ?? 99))

  if (seenCalibrated.length > 0) {
    anchor = seenCalibrated[0]
  } else {
    const bestCalibrated = [...pool]
      .filter(t => t.canonicalSE != null)
      .sort((a, b) => (a.canonicalSE ?? 99) - (b.canonicalSE ?? 99))
    if (bestCalibrated.length > 0) anchor = bestCalibrated[0]
  }

  if (anchor) {
    anchorIdx = 0
    chosen.push(anchor)
  }

  const excluded = new Set(chosen.map(t => t.id))

  // Helper: pick N tests from a candidate list, preferring lower assignment frequency
  function pickFrom(candidates: Test[], n: number): Test[] {
    return candidates
      .filter(t => !excluded.has(t.id))
      .sort((a, b) => (assignFreq.get(a.id) ?? 0) - (assignFreq.get(b.id) ?? 0))
      .slice(0, n)
  }

  const remaining = totalPerRater - chosen.length
  if (remaining <= 0) return { tests: chosen, anchorIdx }

  // Difficulty tiers from unseen calibrated tests
  const n = calibratedUnseen.length
  const third = Math.max(1, Math.floor(n / 3))
  const easy   = calibratedUnseen.slice(0, third)
  const mid    = calibratedUnseen.slice(third, 2 * third)
  const hard   = calibratedUnseen.slice(2 * third)
  const uncalibrated = unseen.filter(t => t.canonicalDifficulty == null)

  // Fill remaining slots cycling through tiers
  const tiers = [easy, mid, hard, uncalibrated, unseen]
  let filled = 0
  let attempt = 0
  while (filled < remaining && attempt < tiers.length * 4) {
    const tier = tiers[attempt % tiers.length]
    const [pick] = pickFrom(tier, 1)
    if (pick && !excluded.has(pick.id)) {
      chosen.push(pick)
      excluded.add(pick.id)
      filled++
    }
    attempt++
  }

  return { tests: chosen, anchorIdx }
}

function generateAssignments(params: {
  raters: Person[]
  pool: Test[]
  allScores: Score[]
  totalPerRater: number
}): ProposedAssignment[] {
  const { raters, pool, allScores, totalPerRater } = params

  // Build seen-by-rater maps
  const seenByRater = new Map<string, Set<string>>()
  allScores.forEach(s => {
    if (!seenByRater.has(s.raterId)) seenByRater.set(s.raterId, new Set())
    seenByRater.get(s.raterId)!.add(s.testDocId)
  })

  const assignFreq = new Map<string, number>()

  return raters.map(rater => {
    const { tests, anchorIdx } = pickTests({
      rater,
      pool,
      seenByRater: seenByRater.get(rater.id) ?? new Set(),
      assignFreq,
      totalPerRater,
    })
    tests.forEach(t => assignFreq.set(t.id, (assignFreq.get(t.id) ?? 0) + 1))
    return { rater, tests, anchorIdx }
  })
}

// ── difficulty badge ───────────────────────────────────────────────────────

function DiffBadge({ test }: { test: Test }) {
  if (test.canonicalDifficulty == null) {
    return <span className="text-[10px] text-muted-foreground">uncal.</span>
  }
  const d = test.canonicalDifficulty
  const [label, colour] =
    d < -1   ? ['easy',   'text-green-700 bg-green-50']  :
    d < 1    ? ['mid',    'text-blue-700  bg-blue-50']   :
               ['hard',   'text-red-700   bg-red-50']
  return (
    <span className={`text-[10px] font-medium px-1 rounded ${colour}`}>{label}</span>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export function AutoAssignPage() {
  const [sessionId, setSessionId]       = useState('')
  const [selectedRaters, setSelectedRaters] = useState<Set<string>>(new Set())
  const [perRater, setPerRater]         = useState(4)
  const [preview, setPreview]           = useState<ProposedAssignment[] | null>(null)
  const [committing, setCommitting]     = useState(false)
  const [done, setDone]                 = useState(false)

  const queryClient = useQueryClient()

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await getDocs(collection(db, 'sessions'))).docs
      .map(d => ({ id: d.id, ...d.data() }) as Session)
      .filter(s => s.status !== 'published')
      .sort((a, b) => a.name.localeCompare(b.name)),
  })
  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => (await getDocs(collection(db, 'people'))).docs
      .map(d => ({ id: d.id, ...d.data() }) as Person)
      .filter(p => p.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name)),
  })
  const { data: tests = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: async () => (await getDocs(collection(db, 'test_bank'))).docs
      .map(d => ({ id: d.id, ...d.data() }) as Test)
      .filter(t => t.status === 'active' && !t.excludeFromPool),
  })
  const { data: allScores = [] } = useQuery({
    queryKey: ['scores'],
    queryFn: async () => (await getDocs(collection(db, 'scores'))).docs
      .map(d => ({ id: d.id, ...d.data() }) as Score),
  })

  const session = useMemo(() => sessions.find(s => s.id === sessionId), [sessions, sessionId])

  // Raters already assigned in this session (to avoid duplicates)
  const alreadyAssigned = useMemo(() => {
    // We'd need assignments collection — for now check scores
    return new Set(allScores.filter(s => s.sessionId === sessionId).map(s => s.raterId))
  }, [allScores, sessionId])

  function toggleRater(id: string) {
    setSelectedRaters(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setPreview(null)
    setDone(false)
  }

  function selectAll() {
    setSelectedRaters(new Set(people.map(p => p.id)))
    setPreview(null)
    setDone(false)
  }
  function selectNone() {
    setSelectedRaters(new Set())
    setPreview(null)
    setDone(false)
  }

  function handleGenerate() {
    const raters = people.filter(p => selectedRaters.has(p.id))
    const result = generateAssignments({ raters, pool: tests, allScores, totalPerRater: perRater })
    setPreview(result)
    setDone(false)
  }

  async function handleCommit() {
    if (!preview || !session) return
    setCommitting(true)
    try {
      for (const { rater, tests } of preview) {
        if (tests.length === 0) continue
        await addDoc(collection(db, 'assignments'), {
          sessionId,
          sessionName: session.name,
          raterId:    rater.id,
          raterName:  rater.name,
          testDocIds: tests.map(t => t.id),
          status:     'pending',
          createdAt:  serverTimestamp(),
        })
      }
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      setDone(true)
      setPreview(null)
    } finally {
      setCommitting(false)
    }
  }

  const canGenerate = sessionId && selectedRaters.size > 0 && perRater >= 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Auto-assign Tests</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Generate balanced test assignments — one anchor, difficulty spread, minimal cohort overlap.
        </p>
      </div>

      {done && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
          <Check className="size-4 shrink-0" />
          Assignments created. Go to the Assignments page to review them.
        </div>
      )}

      {/* Config */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Session</label>
          <select
            value={sessionId}
            onChange={e => { setSessionId(e.target.value); setPreview(null); setDone(false) }}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Select session…</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Tests per rater</label>
          <Input
            type="number"
            min={1}
            max={20}
            value={perRater}
            onChange={e => { setPerRater(Number(e.target.value)); setPreview(null) }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Pool</label>
          <p className="text-sm text-muted-foreground pt-1.5">
            {tests.length} active tests · {tests.filter(t => t.canonicalDifficulty != null).length} calibrated
          </p>
        </div>
      </div>

      {/* Rater picker */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            Raters <span className="text-muted-foreground font-normal">({selectedRaters.size} selected)</span>
          </label>
          <div className="flex gap-2">
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={selectAll}>All</button>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={selectNone}>None</button>
          </div>
        </div>
        <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
          {people.map(p => {
            const isAssigned = alreadyAssigned.has(p.id)
            return (
              <label
                key={p.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 ${isAssigned ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedRaters.has(p.id)}
                  onChange={() => toggleRater(p.id)}
                  disabled={isAssigned}
                />
                <span className="text-sm flex-1">{p.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{p.role.replace('_', ' ')}</span>
                {isAssigned && <span className="text-xs text-amber-600">already assigned</span>}
              </label>
            )
          })}
        </div>
      </div>

      <Button onClick={handleGenerate} disabled={!canGenerate}>
        <Shuffle className="size-4 mr-2" />
        Generate preview
      </Button>

      {/* Preview */}
      {preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Proposed assignments</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleGenerate}>Reshuffle</Button>
              <Button onClick={handleCommit} disabled={committing}>
                {committing ? 'Creating…' : 'Create assignments'}
              </Button>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rater</th>
                  {Array.from({ length: perRater }, (_, i) => (
                    <th key={i} className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Test {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map(({ rater, tests, anchorIdx }) => (
                  <tr key={rater.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{rater.name}</td>
                    {Array.from({ length: perRater }, (_, i) => {
                      const test = tests[i]
                      const isAnchor = i === anchorIdx
                      return (
                        <td key={i} className="px-3 py-2">
                          {test ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-muted-foreground">#{test.testId ?? '?'}</span>
                                <span className="text-xs">{test.candidateName}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <DiffBadge test={test} />
                                {isAnchor && (
                                  <span className="text-[10px] font-medium text-purple-700 bg-purple-50 px-1 rounded">
                                    anchor
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">no test available</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-muted-foreground space-y-0.5">
            <p><span className="text-purple-700 font-medium">anchor</span> = well-calibrated test (low measurement error); returnees get one they've heard before</p>
            <p>Difficulty: <span className="text-green-700">easy</span> / <span className="text-blue-700">mid</span> / <span className="text-red-700">hard</span> based on Rasch canonical difficulty · <span>uncal.</span> = not yet calibrated</p>
            <p>Tests are distributed to minimise how many raters in this cohort share the same recording.</p>
          </div>
        </div>
      )}
    </div>
  )
}
