import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Score, Person, Test, StandardizationScore } from '@/types'
import { buildRaschData, toAnalysisInput, simpleAnalysisInput, buildDriftInput } from '@/lib/rasch/raschData'
import { useRaschJob } from '@/lib/rasch/useRaschJob'
import { AnalysisStatus, RatersPanel, TestsPanel, ScalePanel, ReturningPanel } from './RaschPanels'
import { AnchorsPanel } from './AnchorsPanel'
import { useRaschBaseline } from '@/lib/rasch/baseline'

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
function pct(n: number)  { return `${Math.round(n * 100)}%` }


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

type Tab = 'overview' | 'raters' | 'tests' | 'scale' | 'returning' | 'anchors' | 'standardization'
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['raters', 'Raters'],
  ['tests', 'Tests'],
  ['scale', 'Scale & criteria'],
  ['returning', 'Returning raters'],
  ['anchors', 'Anchors'],
  ['standardization', 'Standardization'],
]

// ── page ───────────────────────────────────────────────────────────────────

export function StatisticsPage() {
  const [sessionName, setSessionName] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [calSaving, setCalSaving] = useState(false)
  const [calSaved, setCalSaved] = useState('')
  const queryClient = useQueryClient()

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

  // ── Rasch analyses (web worker) ─────────────────────────────────────────
  // Same data as the Facets export / Reports: published scores + the chosen event
  // When a baseline is frozen, runs are anchored to it (fixed scale over time)
  const { data: baseline = null, isLoading: baselineLoading } = useRaschBaseline()
  const raschData = useMemo(() => buildRaschData(scores, sessionIds, people), [scores, sessionIds, people])
  const mainJob = useMemo(
    () => (raschData.rows.length && !baselineLoading && tab !== 'overview' && tab !== 'standardization'
      ? { kind: 'analyze' as const, input: { ...toAnalysisInput(raschData, scores), baseline } }
      : null),
    [raschData, scores, baseline, baselineLoading, tab === 'overview' || tab === 'standardization'], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const main = useRaschJob(mainJob)

  const driftJob = useMemo(
    () => {
      if (tab !== 'returning' || !scores.length || baselineLoading) return null
      const input = buildDriftInput(scores)
      return { kind: 'drift' as const, input: { ...input, analysis: { ...input.analysis, baseline } } }
    },
    [scores, baseline, baselineLoading, tab === 'returning'], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const drift = useRaschJob(driftJob)

  const { data: stdScores = [] } = useQuery({
    queryKey: ['standardization_scores'],
    enabled: tab === 'standardization',
    queryFn: async () =>
      (await getDocs(collection(db, 'standardization_scores'))).docs.map(d => ({ id: d.id, ...d.data() }) as StandardizationScore),
  })
  const stdInput = useMemo(() => simpleAnalysisInput(stdScores), [stdScores])
  const stdTestNames = useMemo(() => new Map((stdInput.tests ?? []).map(([n, t]) => [n, t.name])), [stdInput])
  const stdViable = new Set(stdInput.rows.map(r => r.rater)).size >= 2 && new Set(stdInput.rows.map(r => r.candidate)).size >= 2
  const stdJob = useMemo(
    () => (tab === 'standardization' && stdViable ? { kind: 'analyze' as const, input: stdInput } : null),
    [stdInput, stdViable, tab],
  )
  const std = useRaschJob(stdJob)

  const seniorNumbers = useMemo(
    () => new Set(people.filter(p => (p.role === 'senior_rater' || p.role === 'admin') && p.raterNumber).map(p => p.raterNumber!)),
    [people],
  )
  const testNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of scores) if (s.testNumber != null && !m.has(s.testNumber)) m.set(s.testNumber, s.candidateName)
    return m
  }, [scores])
  const eventRaterIds = useMemo(
    () => new Set(scores.filter(s => sessionIds.includes(s.sessionId)).map(s => s.raterId)),
    [scores, sessionIds],
  )
  const scope = sessionName ? `Published scores + ${sessionName}` : 'Published scores'

  // Writes each rater-course test's calibration onto its test_bank doc (matched by test number)
  async function saveCalibration() {
    if (!main.data) return
    setCalSaving(true)
    setCalSaved('')
    try {
      const bank = (await getDocs(collection(db, 'test_bank'))).docs.map(d => ({ id: d.id, ...d.data() }) as Test)
      const byNumber = new Map(bank.filter(t => t.category !== 'standardization' && t.testId != null).map(t => [t.testId!, t.id]))
      const batch = writeBatch(db)
      let n = 0
      for (const t of main.data.tests) {
        const id = byNumber.get(t.number)
        if (!id) continue
        batch.update(doc(db, 'test_bank', id), {
          calibratedLevel: t.level,
          calibratedMeasure: t.measure,
          calibratedSE: t.se,
          calibratedFairAvg: t.fairAvg,
          calibratedInfit: t.infitMnSq,
          calibratedOutfit: t.outfitMnSq,
          calibratedRaters: t.raters,
          calibratedAt: serverTimestamp(),
          // Drives Auto-assign / self-serve easy-mid-hard tiers and the anchor choice
          canonicalDifficulty: t.ratingDifficulty,
          canonicalSE: t.ratingDifficulty == null ? null : t.se,
        })
        n++
      }
      await batch.commit()
      await queryClient.invalidateQueries({ queryKey: ['tests'] })
      setCalSaved(`Saved calibration for ${n} test${n !== 1 ? 's' : ''}.`)
    } catch (e) {
      setCalSaved(`Save failed: ${String(e)}`)
    } finally {
      setCalSaving(false)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Statistics</h1>
          <p className="text-muted-foreground text-sm mt-1">Score distribution, rater and test Rasch analysis.</p>
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

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setTab(val)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === val ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
      filtered.length === 0 ? (
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

      </>)
      )}

      {(tab === 'raters' || tab === 'tests' || tab === 'scale' || tab === 'anchors') && (
        <div className="space-y-4">
          <AnalysisStatus loading={main.loading} error={main.error} analysis={main.data} scope={scope} />
          {main.data && tab === 'raters' && (
            <RatersPanel key={sessionName} analysis={main.data} hasEvent={!!sessionName} seniorNumbers={seniorNumbers} testNames={testNames} />
          )}
          {main.data && tab === 'tests' && (
            <TestsPanel analysis={main.data} onSave={saveCalibration} saving={calSaving} savedAt={calSaved} canSave={!main.loading} />
          )}
          {main.data && tab === 'scale' && <ScalePanel analysis={main.data} />}
          {main.data && tab === 'anchors' && (
            <AnchorsPanel analysis={main.data} publishedOnly={!sessionName} baseline={baseline} scores={scores} people={people} />
          )}
        </div>
      )}

      {tab === 'returning' && (
        <div className="space-y-4">
          {drift.error && <p className="text-sm text-red-700">Analysis failed: {drift.error}</p>}
          {drift.loading && !drift.data && <p className="text-sm text-muted-foreground">Running Rasch analysis…</p>}
          {drift.data && <ReturningPanel drift={drift.data} highlight={sessionName ? eventRaterIds : new Set()} />}
        </div>
      )}

      {tab === 'standardization' && (
        <div className="space-y-4">
          {!stdViable ? (
            <p className="text-sm text-muted-foreground">
              Needs standardization scores from at least 2 examiners on at least 2 tests before an analysis is meaningful.
            </p>
          ) : (
            <>
              <AnalysisStatus loading={std.loading} error={std.error} analysis={std.data} scope="All standardization scores" />
              {std.data && (
                <>
                  <h2 className="text-base font-semibold">Examiners</h2>
                  <RatersPanel analysis={std.data} hasEvent={false} seniorNumbers={new Set()} testNames={stdTestNames} testPrefix="S" />
                  <h2 className="text-base font-semibold pt-4">Standardization tests</h2>
                  <TestsPanel analysis={std.data} testPrefix="S" />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
