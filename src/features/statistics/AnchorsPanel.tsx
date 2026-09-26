import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Score, Person, Test, Session } from '@/types'
import type { RaschAnalysis, RaschBaseline, TestStat } from '@/lib/rasch/analysis'
import { CRITERIA } from '@/lib/rasch/raschData'
import { saveBaseline, clearBaseline } from '@/lib/rasch/baseline'
import { DifficultyBadge, DIFFICULTY_TIER } from './RaschPanels'

// Anchor workflow: shortlist → panel event → panel review + agreed scores →
// freeze a baseline. See README "Rasch anchors".

const DIMS = [
  { key: 'pronunciation', abbr: 'PRO', criterion: 'Pronunciation' },
  { key: 'structure', abbr: 'STR', criterion: 'Structure' },
  { key: 'vocabulary', abbr: 'VOC', criterion: 'Vocabulary' },
  { key: 'fluency', abbr: 'FLU', criterion: 'Fluency' },
  { key: 'comprehension', abbr: 'COM', criterion: 'Comprehension' },
  { key: 'interactions', abbr: 'INT', criterion: 'Interactions' },
] as const
type DimKey = typeof DIMS[number]['key']

// Suggested anchor: well established, consistent, clear-cut
const MIN_RATERS = 50
const MAX_SE = 0.10
const FIT_RANGE: [number, number] = [0.8, 1.2]
const MIN_ANCHORS = 4

function isSuggested(t: TestStat) {
  const lowest = Math.min(...t.criterionFair.map(c => c.fair))
  const borderline = Math.abs(lowest - (Math.floor(lowest) + 0.5)) < 0.15
  return t.raters >= MIN_RATERS && t.se <= MAX_SE &&
    t.infitMnSq >= FIT_RANGE[0] && t.infitMnSq <= FIT_RANGE[1] &&
    t.outfitMnSq >= FIT_RANGE[0] && t.outfitMnSq <= FIT_RANGE[1] &&
    (t.ratingDifficulty == null || t.ratingDifficulty <= DIFFICULTY_TIER) && !borderline
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`
const monthYear = () => new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

function Step({ n, title, children }: { n: number | string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-semibold"><span className="text-muted-foreground mr-1.5">{n}.</span>{title}</h3>
      {children}
    </section>
  )
}

export function AnchorsPanel({ analysis, publishedOnly, baseline, scores, people }: {
  analysis: RaschAnalysis
  publishedOnly: boolean
  baseline: RaschBaseline | null
  scores: Score[]
  people: Person[]
}) {
  const queryClient = useQueryClient()
  const { data: bank = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: async () => (await getDocs(collection(db, 'test_bank'))).docs.map(d => ({ id: d.id, ...d.data() }) as Test),
  })
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await getDocs(collection(db, 'sessions'))).docs
      .map(d => ({ id: d.id, ...d.data() }) as Session)
      .sort((a, b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0)),
  })

  const bankByNumber = useMemo(
    () => new Map(bank.filter(t => t.category !== 'standardization' && t.testId != null).map(t => [t.testId!, t])),
    [bank],
  )
  const statByNumber = useMemo(() => new Map(analysis.tests.map(t => [t.number, t])), [analysis])
  const confirmedAnchors = bank.filter(t => t.anchor && t.category !== 'standardization' && t.testId != null)

  // ── step 1: shortlist ──────────────────────────────────────────────────
  const [showAll, setShowAll] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const shortlist = useMemo(
    () => analysis.tests.filter(t => showAll || isSuggested(t)).sort((a, b) => b.level - a.level || a.number - b.number),
    [analysis, showAll],
  )
  const togglePick = (n: number) => setPicked(s => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })
  const pickedLevels = [...picked].map(n => statByNumber.get(n)?.level).filter(Boolean) as number[]
  const levelsWithoutSuggestion = [2, 3, 4, 5, 6].filter(l => !analysis.tests.some(t => t.level === l && isSuggested(t)))

  // ── step 2: panel event ────────────────────────────────────────────────
  const panelCandidates = people
    .filter(p => (p.role === 'senior_rater' || p.role === 'admin') && p.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name))
  const [panel, setPanel] = useState<Set<string>>(new Set())
  const [eventName, setEventName] = useState(`Anchor panel — ${monthYear()}`)
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState('')
  const togglePanel = (id: string) => setPanel(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x })
  const missingInBank = [...picked].filter(n => !bankByNumber.has(n))

  async function createEvent() {
    setCreating(true)
    setCreateMsg('')
    try {
      const testDocIds = [...picked].sort((a, b) => a - b).map(n => bankByNumber.get(n)!.id)
      const sessionRef = await addDoc(collection(db, 'sessions'), {
        name: eventName.trim(),
        type: 'calibration',
        status: 'open',
        notes: `Anchor panel: score each recording independently. Tests ${[...picked].sort((a, b) => a - b).map(n => '#' + n).join(', ')}.`,
        createdAt: serverTimestamp(),
      })
      for (const id of panel) {
        const person = people.find(p => p.id === id)!
        await addDoc(collection(db, 'assignments'), {
          sessionId: sessionRef.id,
          sessionName: eventName.trim(),
          raterId: person.id,
          raterName: person.name,
          testDocIds,
          status: 'pending',
          notes: 'Anchor panel — please score independently, without discussing with other panellists.',
          createdAt: serverTimestamp(),
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['assignments'] })
      setCreateMsg(`Created "${eventName.trim()}" with ${testDocIds.length} tests for ${panel.size} panellists. They'll find it in their Scoring page.`)
      setReviewEvent(sessionRef.id)
      setPicked(new Set())
      setPanel(new Set())
    } catch (e) {
      setCreateMsg(`Failed: ${String(e)}`)
    } finally {
      setCreating(false)
    }
  }

  // ── step 3: panel review ───────────────────────────────────────────────
  const calibrationEvents = sessions.filter(s => s.type === 'calibration')
  const [reviewEvent, setReviewEvent] = useState('')
  const eventScores = useMemo(() => scores.filter(s => s.sessionId === reviewEvent && s.testNumber != null), [scores, reviewEvent])
  const eventTests = useMemo(() => {
    const byTest = new Map<number, Score[]>()
    for (const s of eventScores) { if (!byTest.has(s.testNumber!)) byTest.set(s.testNumber!, []); byTest.get(s.testNumber!)!.push(s) }
    return [...byTest.entries()].sort((a, b) => a[0] - b[0])
  }, [eventScores])
  const eventMeta = sessions.find(s => s.id === reviewEvent)

  // ── step 4: freeze ─────────────────────────────────────────────────────
  const [baselineName, setBaselineName] = useState(`Baseline ${monthYear()}`)
  const [freezing, setFreezing] = useState(false)
  const [freezeMsg, setFreezeMsg] = useState('')
  const anchorsInRun = confirmedAnchors.filter(t => statByNumber.has(t.testId!))
  const canFreeze = publishedOnly && anchorsInRun.length >= MIN_ANCHORS && !freezing

  async function freeze() {
    setFreezing(true)
    setFreezeMsg('')
    try {
      const b: RaschBaseline = {
        name: baselineName.trim(),
        createdAt: new Date().toISOString(),
        tests: anchorsInRun.map(t => ({ number: t.testId!, measure: statByNumber.get(t.testId!)!.measure })),
        criteria: analysis.criteria.map(c => ({ id: CRITERIA.indexOf(c.name) + 1, measure: c.measure })),
        thresholds: analysis.categories
          .filter(c => c.andrichThreshold != null)
          .map(c => ({ category: c.category, value: Math.round(c.andrichThreshold! * 100) / 100 })),
      }
      await saveBaseline(b)
      await queryClient.invalidateQueries({ queryKey: ['raschBaseline'] })
      setFreezeMsg(`Frozen "${b.name}" on ${b.tests.length} anchors. Analyses now use it.`)
    } catch (e) {
      setFreezeMsg(`Failed: ${String(e)}`)
    } finally {
      setFreezing(false)
    }
  }

  // Removes a test from the confirmed anchor set; it's left out of the next freeze
  async function retire(number: number) {
    const t = bankByNumber.get(number)
    if (!t || !confirm(`Retire #${number} as an anchor? It stays in the current baseline until you re-freeze.`)) return
    await updateDoc(doc(db, 'test_bank', t.id), { anchor: false })
    await queryClient.invalidateQueries({ queryKey: ['tests'] })
  }

  async function stopUsing() {
    if (!confirm('Stop using the baseline? It will be archived, and analyses will go back to re-centring raters every run.')) return
    await clearBaseline()
    await queryClient.invalidateQueries({ queryKey: ['raschBaseline'] })
  }

  return (
    <div className="space-y-5">
      {/* Status */}
      <section className="rounded-lg border p-4 space-y-3 bg-muted/20">
        {baseline ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">
                <strong>{baseline.name}</strong> is active — {baseline.tests.length} anchor tests, frozen{' '}
                {new Date(baseline.createdAt).toLocaleDateString('en-GB')}. Rater measures are on this fixed scale
                (0 = the average rater when it was frozen), so drift across the whole rater population shows up.
              </p>
              <button onClick={stopUsing} className="text-xs text-muted-foreground underline">Stop using baseline</button>
            </div>
            <table className="text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left pr-6 font-medium">Anchor</th>
                  <th className="text-right pr-6 font-medium">Frozen at</th>
                  <th className="text-right pr-6 font-medium" title="How far the current data would move this anchor. Beyond ±0.5, retire it from the anchor set.">Displacement</th>
                  <th className="text-left font-medium" />
                </tr>
              </thead>
              <tbody>
                {analysis.anchorChecks.map(a => (
                  <tr key={a.number}>
                    <td className="pr-6">#{a.number} {bankByNumber.get(a.number)?.candidateName ?? ''}</td>
                    <td className="pr-6 text-right font-mono">{signed(a.anchorMeasure)}</td>
                    <td className={`pr-6 text-right font-mono ${a.drifted ? 'text-red-700 font-semibold' : ''}`}>{signed(a.displacement)}</td>
                    <td className="text-xs">
                      {a.drifted ? <span className="text-red-700">drifted — consider retiring</span> : <span className="text-green-700">✓ stable</span>}
                      {bankByNumber.get(a.number)?.anchor && (
                        <button onClick={() => retire(a.number)} className="ml-3 underline text-muted-foreground">Retire</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analysis.scaleDisplacement > 0.3 && (
              <p className="text-xs text-amber-800">Criteria have shifted by up to {analysis.scaleDisplacement.toFixed(2)} logits since the baseline — worth a look before the next yearly re-freeze.</p>
            )}
          </>
        ) : (
          <p className="text-sm">
            <strong>No baseline yet.</strong> Every analysis re-centres raters on the current average, so a drift across the whole
            rater population would be invisible. Work through the steps below to freeze one.
          </p>
        )}
      </section>

      <Step n={1} title="Shortlist anchor candidates">
        <p className="text-xs text-muted-foreground">
          Suggested: {MIN_RATERS}+ raters, S.E. ≤ {MAX_SE.toFixed(2)}, fit {FIT_RANGE[0]}–{FIT_RANGE[1]}, not hard to rate, not on a level boundary.
          Aim for 2–3 per level.
          {levelsWithoutSuggestion.length > 0 && (
            <span className="text-amber-800"> No suggestion at level {levelsWithoutSuggestion.join(', ')} — the bank may need recordings there.</span>
          )}
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show all tests, not just suggestions
        </label>
        <div className="rounded-md border overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b text-muted-foreground sticky top-0">
              <tr>
                <th className="w-8" />
                <th className="text-left px-2 py-1.5 font-medium">Test</th>
                <th className="text-left px-2 py-1.5 font-medium">Candidate</th>
                <th className="text-center px-2 py-1.5 font-medium">Level</th>
                <th className="text-center px-2 py-1.5 font-medium">Raters</th>
                <th className="text-center px-2 py-1.5 font-medium">S.E.</th>
                <th className="text-center px-2 py-1.5 font-medium">Infit / Outfit</th>
                <th className="text-center px-2 py-1.5 font-medium">To rate</th>
                <th className="text-left px-2 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shortlist.map(t => {
                const b = bankByNumber.get(t.number)
                return (
                  <tr key={t.number} className="border-t">
                    <td className="text-center">
                      <input type="checkbox" checked={picked.has(t.number)} onChange={() => togglePick(t.number)} disabled={!b} />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">#{t.number}</td>
                    <td className="px-2 py-1.5">{t.name}</td>
                    <td className="px-2 py-1.5 text-center font-bold">{t.level}</td>
                    <td className="px-2 py-1.5 text-center text-xs">{t.raters}</td>
                    <td className="px-2 py-1.5 text-center font-mono text-xs">{t.se.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-center font-mono text-xs">{t.infitMnSq.toFixed(2)} / {t.outfitMnSq.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-center"><DifficultyBadge value={t.ratingDifficulty} /></td>
                    <td className="px-2 py-1.5 text-xs">
                      {!b ? <span className="text-muted-foreground">not in Test Bank</span>
                        : b.anchor ? <span className="text-green-700">anchor ✓</span>
                        : b.benchmark ? <span>benchmark agreed</span>
                        : isSuggested(t) ? <span className="text-muted-foreground">suggested</span> : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Selected: {picked.size}
          {picked.size > 0 && ` (levels ${[...new Set(pickedLevels)].sort().join(', ')})`}
        </p>
      </Step>

      <Step n={2} title="Create the panel event">
        <p className="text-xs text-muted-foreground">
          Creates a Calibration event and assigns the selected recordings to each panellist. They score them in the normal
          Scoring page, independently — ideally without discussing or seeing the calibrated levels first.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {panelCandidates.map(p => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={panel.has(p.id)} onChange={() => togglePanel(p.id)} />
              {p.name}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input value={eventName} onChange={e => setEventName(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm w-72" />
          <button
            onClick={createEvent}
            disabled={creating || picked.size === 0 || panel.size < 2 || !eventName.trim() || missingInBank.length > 0}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {creating ? 'Creating…' : `Create event (${picked.size} tests × ${panel.size} panellists)`}
          </button>
        </div>
        {panel.size === 1 && <p className="text-xs text-amber-800">Choose at least 2 panellists.</p>}
        {createMsg && <p className="text-xs text-green-700">{createMsg}</p>}
      </Step>

      <Step n={3} title="Review the panel's scores and agree benchmarks">
        <div className="flex flex-wrap items-center gap-3">
          <select value={reviewEvent} onChange={e => setReviewEvent(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            <option value="">Choose a calibration event…</option>
            {calibrationEvents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {reviewEvent && (
            <span className="text-xs text-muted-foreground">
              {new Set(eventScores.map(s => s.raterId)).size} panellists have scored so far
            </span>
          )}
        </div>
        {reviewEvent && eventTests.length === 0 && (
          <p className="text-sm text-muted-foreground">No scores yet for this event.</p>
        )}
        {eventTests.map(([number, list]) => (
          <PanelTest
            key={`${reviewEvent}-${number}`}
            number={number}
            scores={list}
            stat={statByNumber.get(number)}
            test={bankByNumber.get(number)}
            eventName={eventMeta?.name ?? ''}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ['tests'] })}
          />
        ))}
      </Step>

      <Step n={4} title={baseline ? 'Re-freeze the baseline (e.g. yearly)' : 'Freeze the baseline'}>
        <p className="text-xs text-muted-foreground">
          Freezes the confirmed anchors' current measures, plus the criteria and rating-scale steps, as the fixed frame of reference.
          {baseline && ' Because the current analysis is already anchored to the active baseline, a re-freeze continues the same scale.'}
        </p>
        <p className="text-sm">
          Confirmed anchors: {confirmedAnchors.length === 0 ? 'none yet' : confirmedAnchors
            .sort((a, b) => (a.testId ?? 0) - (b.testId ?? 0))
            .map(t => `#${t.testId}${t.benchmark ? ` (L${t.benchmark.overall})` : ''}`).join(', ')}
        </p>
        {!publishedOnly && <p className="text-xs text-amber-800">Choose "All sessions" at the top of the page — a baseline must come from published scores only.</p>}
        {publishedOnly && anchorsInRun.length < MIN_ANCHORS && (
          <p className="text-xs text-amber-800">Needs at least {MIN_ANCHORS} confirmed anchors.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input value={baselineName} onChange={e => setBaselineName(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm w-60" />
          <button onClick={freeze} disabled={!canFreeze || !baselineName.trim()}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50">
            {freezing ? 'Freezing…' : 'Freeze baseline'}
          </button>
        </div>
        {freezeMsg && <p className="text-xs text-green-700">{freezeMsg}</p>}
      </Step>
    </div>
  )
}

// ── one recording in the panel review ───────────────────────────────────────

function PanelTest({ number, scores, stat, test, eventName, onSaved }: {
  number: number
  scores: Score[]
  stat: TestStat | undefined
  test: Test | undefined
  eventName: string
  onSaved: () => void
}) {
  const med = Object.fromEntries(DIMS.map(d => [d.key, median(scores.map(s => s[d.key]))])) as Record<DimKey, number>
  const overallMed = median(scores.map(s => s.overallLevel))
  const fair = new Map(stat?.criterionFair.map(c => [c.criterion, c.fair]) ?? [])

  const split = Math.max(...scores.map(s => s.overallLevel)) - Math.min(...scores.map(s => s.overallLevel)) >= 2 ||
    DIMS.some(d => Math.max(...scores.map(s => s[d.key])) - Math.min(...scores.map(s => s[d.key])) >= 2)
  const differs = !!stat && (
    Math.round(overallMed) !== stat.level ||
    DIMS.some(d => Math.abs(med[d.key] - (fair.get(d.criterion) ?? med[d.key])) > 0.5))
  const agrees = scores.length >= 2 && !split && !differs

  const existing = test?.benchmark
  const [agreed, setAgreed] = useState<Record<DimKey, number>>(() =>
    Object.fromEntries(DIMS.map(d => [d.key, existing?.[d.key] ?? Math.round(med[d.key])])) as Record<DimKey, number>)
  const [useAsAnchor, setUseAsAnchor] = useState(test?.anchor ?? agrees)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const overall = Math.min(...DIMS.map(d => agreed[d.key]))

  async function save() {
    if (!test) return
    setSaving(true)
    setMsg('')
    try {
      await updateDoc(doc(db, 'test_bank', test.id), {
        benchmark: { ...agreed, overall, eventName, panel: [...new Set(scores.map(s => s.raterName))], agreedAt: serverTimestamp() },
        anchor: useAsAnchor,
      })
      onSaved()
      setMsg(useAsAnchor ? 'Saved — confirmed as an anchor.' : 'Saved benchmark (not an anchor).')
    } catch (e) {
      setMsg(`Failed: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b bg-muted/20">
        <span className="font-mono text-xs">#{number}</span>
        <span className="text-sm font-medium">{test?.candidateName ?? stat?.name}</span>
        {agrees && <span className="text-[11px] border rounded px-1.5 bg-green-50 text-green-800 border-green-200">Panel agrees with calibration</span>}
        {split && <span className="text-[11px] border rounded px-1.5 bg-red-50 text-red-800 border-red-200">Panel split — discuss</span>}
        {!split && differs && <span className="text-[11px] border rounded px-1.5 bg-amber-50 text-amber-900 border-amber-200">Panel differs from calibration — discuss</span>}
        {scores.length < 2 && <span className="text-[11px] text-muted-foreground">waiting for more panellists</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium" />
              {DIMS.map(d => <th key={d.key} className="text-center px-2 py-1.5 font-medium">{d.abbr}</th>)}
              <th className="text-center px-2 py-1.5 font-medium">Overall</th>
            </tr>
          </thead>
          <tbody>
            {scores.map(s => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-1">{s.raterName}</td>
                {DIMS.map(d => <td key={d.key} className="text-center font-mono">{s[d.key]}</td>)}
                <td className="text-center font-mono font-semibold">{s.overallLevel}</td>
              </tr>
            ))}
            <tr className="border-t bg-muted/10">
              <td className="px-3 py-1 text-xs font-medium">Panel median</td>
              {DIMS.map(d => (
                <td key={d.key} className={`text-center font-mono ${med[d.key] % 1 ? 'text-amber-800' : ''}`}>{med[d.key]}</td>
              ))}
              <td className="text-center font-mono font-semibold">{overallMed}</td>
            </tr>
            {stat && (
              <tr className="border-t bg-muted/10">
                <td className="px-3 py-1 text-xs font-medium" title="Expected score from an average rater, from all published ratings">Rasch calibration</td>
                {DIMS.map(d => {
                  const f = fair.get(d.criterion)
                  const off = f != null && Math.abs(med[d.key] - f) > 0.5
                  return <td key={d.key} className={`text-center font-mono text-xs ${off ? 'text-amber-800 font-semibold' : 'text-muted-foreground'}`}>{f?.toFixed(1)}</td>
                })}
                <td className="text-center font-mono font-semibold">{stat.level}</td>
              </tr>
            )}
            <tr className="border-t">
              <td className="px-3 py-1.5 text-xs font-medium">Agreed benchmark</td>
              {DIMS.map(d => (
                <td key={d.key} className="text-center py-1">
                  <select
                    value={agreed[d.key]}
                    onChange={e => setAgreed(a => ({ ...a, [d.key]: Number(e.target.value) }))}
                    className="rounded border border-input bg-background px-1 py-0.5 text-sm font-mono"
                  >
                    {[1, 2, 3, 4, 5, 6].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </td>
              ))}
              <td className="text-center font-mono font-bold">{overall}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 px-3 py-2 border-t">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={useAsAnchor} onChange={e => setUseAsAnchor(e.target.checked)} />
          Use as an anchor
        </label>
        <button onClick={save} disabled={saving || !test || scores.length < 2}
          className="rounded-md border px-3 py-1 text-sm font-medium hover:bg-muted disabled:opacity-50">
          {saving ? 'Saving…' : existing ? 'Update benchmark' : 'Save benchmark'}
        </button>
        {existing && !msg && <span className="text-xs text-muted-foreground">Saved from {existing.eventName}</span>}
        {msg && <span className="text-xs text-green-700">{msg}</span>}
        {Object.values(med).some(v => v % 1) && (
          <span className="text-xs text-amber-800">Amber medians are ties between panellists — decide in discussion.</span>
        )}
      </div>
    </div>
  )
}
