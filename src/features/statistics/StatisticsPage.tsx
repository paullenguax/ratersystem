import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Score, Person } from '@/types'

// ── helpers ────────────────────────────────────────────────────────────────

const DIMS = [
  { key: 'pronunciation' as const,  abbr: 'PRO', label: 'Pronunciation' },
  { key: 'structure'     as const,  abbr: 'STR', label: 'Structure' },
  { key: 'vocabulary'    as const,  abbr: 'VOC', label: 'Vocabulary' },
  { key: 'fluency'       as const,  abbr: 'FLU', label: 'Fluency' },
  { key: 'comprehension' as const,  abbr: 'COM', label: 'Comprehension' },
  { key: 'interactions'  as const,  abbr: 'INT', label: 'Interactions' },
]

function mean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}
function sd(vals: number[]): number {
  if (vals.length < 2) return 0
  const m = mean(vals)
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1))
}
function fmt1(n: number) { return n.toFixed(1) }
function fmt2(n: number) { return n.toFixed(2) }
function pct(n: number)  { return `${Math.round(n * 100)}%` }

function deltaColour(d: number) {
  if (Math.abs(d) < 0.2) return 'text-muted-foreground'
  return d > 0 ? 'text-amber-600' : 'text-blue-600'
}

// Pairwise agreement rate (within ±1) on overall level
function pairwiseAgreement(scores: Score[]): { rate: number; pairs: number; tests: number } {
  const byTest = new Map<string, number[]>()
  scores.forEach(s => {
    if (!byTest.has(s.testDocId)) byTest.set(s.testDocId, [])
    byTest.get(s.testDocId)!.push(s.overallLevel)
  })
  let agree = 0, total = 0, tests = 0
  for (const [, levels] of byTest) {
    if (levels.length < 2) continue
    tests++
    for (let i = 0; i < levels.length; i++) {
      for (let j = i + 1; j < levels.length; j++) {
        total++
        if (Math.abs(levels[i] - levels[j]) <= 1) agree++
      }
    }
  }
  return { rate: total > 0 ? agree / total : 0, pairs: total, tests }
}

// Simple horizontal bar
function Bar({ value, max, colour = 'bg-primary' }: { value: number; max: number; colour?: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export function StatisticsPage() {
  const [sessionName, setSessionName] = useState('')

  const { data: scores = [], isLoading } = useQuery({
    queryKey: ['scores'],
    queryFn: async () =>
      (await getDocs(collection(db, 'scores'))).docs.map(d => ({ id: d.id, ...d.data() }) as Score),
  })
  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () =>
      (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person),
  })

  // Sessions deduplicated by name
  const sessions = useMemo(() => {
    const seen = new Map<string, Set<string>>()
    scores.forEach(s => {
      if (!s.sessionId || !s.sessionName) return
      if (!seen.has(s.sessionName)) seen.set(s.sessionName, new Set())
      seen.get(s.sessionName)!.add(s.sessionId)
    })
    return [...seen.entries()]
      .map(([name, ids]) => ({ name, ids: [...ids] }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [scores])

  const sessionIds = useMemo(
    () => sessions.find(s => s.name === sessionName)?.ids ?? [],
    [sessions, sessionName],
  )

  const filtered = useMemo(
    () => sessionName ? scores.filter(s => sessionIds.includes(s.sessionId)) : scores,
    [scores, sessionIds, sessionName],
  )

  const srIds = useMemo(
    () => new Set(people.filter(p => p.role === 'senior_rater' || p.role === 'admin').map(p => p.id)),
    [people],
  )

  // Overview
  const raterCount  = useMemo(() => new Set(filtered.map(s => s.raterId)).size,  [filtered])
  const testCount   = useMemo(() => new Set(filtered.map(s => s.testDocId)).size, [filtered])

  // Score distribution (overall level 1-6)
  const distribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0]
    filtered.forEach(s => { if (s.overallLevel >= 1 && s.overallLevel <= 6) counts[s.overallLevel - 1]++ })
    return counts
  }, [filtered])
  const distMax = Math.max(...distribution)
  const LEVEL_COLOURS = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-blue-500', 'bg-green-500', 'bg-green-700']

  // Dimension stats
  const dimStats = useMemo(() => DIMS.map(d => {
    const vals = filtered.map(s => s[d.key] as number)
    return { ...d, mean: mean(vals), sd: sd(vals) }
  }), [filtered])
  // Agreement rate
  const agreement = useMemo(() => pairwiseAgreement(filtered), [filtered])

  // Per-rater stats (exclude admins/SRs for trainee view, but show all)
  const sessionMean = mean(filtered.map(s => s.overallLevel))
  const raterStats = useMemo(() => {
    const byRater = new Map<string, Score[]>()
    filtered.forEach(s => {
      if (!byRater.has(s.raterId)) byRater.set(s.raterId, [])
      byRater.get(s.raterId)!.push(s)
    })
    return [...byRater.entries()]
      .map(([raterId, scores]) => {
        const raterMean = mean(scores.map(s => s.overallLevel))
        const dimMeans  = Object.fromEntries(DIMS.map(d => [d.key, mean(scores.map(s => s[d.key] as number))]))
        return {
          raterId,
          name: scores[0].raterName,
          n: scores.length,
          mean: raterMean,
          delta: raterMean - sessionMean,
          dimMeans,
          isSR: srIds.has(raterId),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered, sessionMean, srIds])

  // Returnee detection: raters appearing in >1 named session
  const returneeStats = useMemo(() => {
    const byRater = new Map<string, Map<string, number[]>>() // raterId → sessionName → overallLevels
    scores.forEach(s => {
      if (!byRater.has(s.raterId)) byRater.set(s.raterId, new Map())
      const sessions = byRater.get(s.raterId)!
      if (!sessions.has(s.sessionName)) sessions.set(s.sessionName, [])
      sessions.get(s.sessionName)!.push(s.overallLevel)
    })
    return [...byRater.entries()]
      .filter(([, sessions]) => sessions.size > 1)
      .map(([raterId, sessions]) => ({
        raterId,
        name: scores.find(s => s.raterId === raterId)?.raterName ?? raterId,
        sessions: [...sessions.entries()]
          .map(([name, levels]) => ({ name, mean: mean(levels), n: levels.length }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [scores])

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Statistics</h1>
          <p className="text-muted-foreground text-sm mt-1">Inter-rater reliability and score distribution.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">Session</label>
          <select
            value={sessionName}
            onChange={e => setSessionName(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm min-w-48"
          >
            <option value="">All sessions</option>
            {sessions.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scores found.</p>
      ) : (<>

        {/* Overview */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Scores',  value: filtered.length },
            { label: 'Raters',  value: raterCount },
            { label: 'Tests',   value: testCount },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-sm text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Score distribution */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Overall level distribution</h2>
            <div className="space-y-2">
              {distribution.map((count, i) => (
                <div key={i} className="grid grid-cols-[2rem_1fr_3rem_3rem] items-center gap-3">
                  <span className="text-sm font-mono font-bold text-right">{i + 1}</span>
                  <Bar value={count} max={distMax} colour={LEVEL_COLOURS[i]} />
                  <span className="text-sm font-mono text-right">{count}</span>
                  <span className="text-xs text-muted-foreground text-right">
                    {filtered.length > 0 ? pct(count / filtered.length) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Dimension means */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Dimension means</h2>
            <div className="space-y-2.5">
              {dimStats.map(d => (
                <div key={d.key} className="grid grid-cols-[3rem_1fr_5rem] items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">{d.abbr}</span>
                  <Bar value={d.mean} max={6} colour="bg-primary/70" />
                  <span className="text-sm font-mono text-right">
                    {fmt1(d.mean)} <span className="text-muted-foreground text-xs">±{fmt1(d.sd)}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">mean ± SD across all raters in selection</p>
          </div>
        </div>

        {/* Agreement */}
        <div className="rounded-lg border p-5 space-y-2">
          <h2 className="text-base font-semibold">Inter-rater agreement</h2>
          {agreement.tests === 0 ? (
            <p className="text-sm text-muted-foreground">No tests were rated by more than one rater in this selection.</p>
          ) : (
            <div className="flex flex-wrap gap-8">
              <div>
                <p className="text-3xl font-bold">{pct(agreement.rate)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">pairs within ±1 on overall level</p>
              </div>
              <div>
                <p className="text-3xl font-bold">{agreement.pairs}</p>
                <p className="text-xs text-muted-foreground mt-0.5">rater pairs compared</p>
              </div>
              <div>
                <p className="text-3xl font-bold">{agreement.tests}</p>
                <p className="text-xs text-muted-foreground mt-0.5">tests with ≥2 raters</p>
              </div>
            </div>
          )}
        </div>

        {/* Rater summary table */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Rater summary</h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rater</th>
                  <th className="text-center px-2 py-2 font-medium text-muted-foreground w-10">N</th>
                  <th className="text-center px-2 py-2 font-medium w-16">OVL avg</th>
                  <th className="text-center px-2 py-2 font-medium w-16">vs mean</th>
                  {DIMS.map(d => (
                    <th key={d.key} className="text-center px-2 py-2 font-medium text-muted-foreground text-xs w-10">
                      {d.abbr}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {raterStats.map(r => (
                  <tr key={r.raterId} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2">
                      {r.name}
                      {r.isSR && <span className="ml-1.5 text-[10px] text-muted-foreground border rounded px-1">SR</span>}
                    </td>
                    <td className="px-2 py-2 text-center text-muted-foreground text-xs">{r.n}</td>
                    <td className="px-2 py-2 text-center font-mono font-semibold">{fmt1(r.mean)}</td>
                    <td className={`px-2 py-2 text-center font-mono text-sm font-medium ${deltaColour(r.delta)}`}>
                      {r.delta > 0 ? '+' : ''}{fmt2(r.delta)}
                    </td>
                    {DIMS.map(d => (
                      <td key={d.key} className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
                        {fmt1(r.dimMeans[d.key] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="border-t-2 bg-muted/20">
                  <tr>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-medium">Session mean</td>
                    <td className="px-2 py-2 text-center text-xs text-muted-foreground">{filtered.length}</td>
                    <td className="px-2 py-2 text-center font-mono font-bold">{fmt1(sessionMean)}</td>
                    <td />
                    {DIMS.map(d => (
                      <td key={d.key} className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
                        {fmt1(mean(filtered.map(s => s[d.key] as number)))}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="text-amber-600">amber = generous</span> · <span className="text-blue-600">blue = strict</span> vs session mean
          </p>
        </div>

        {/* Returnees */}
        {returneeStats.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Returnee mean scores across sessions</h2>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rater</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Session</th>
                    <th className="text-center px-2 py-2 font-medium text-muted-foreground w-10">N</th>
                    <th className="text-center px-2 py-2 font-medium w-20">Mean OVL</th>
                  </tr>
                </thead>
                <tbody>
                  {returneeStats.flatMap(r =>
                    r.sessions.map((s, i) => (
                      <tr key={`${r.raterId}-${s.name}`} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2">{i === 0 ? r.name : ''}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{s.name}</td>
                        <td className="px-2 py-2 text-center text-xs text-muted-foreground">{s.n}</td>
                        <td className="px-2 py-2 text-center font-mono font-semibold">{fmt1(s.mean)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </>)}
    </div>
  )
}
