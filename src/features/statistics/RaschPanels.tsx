import { Fragment, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { RaschAnalysis, RaterStat, TestStat, DriftRater } from '@/lib/rasch/analysis'

// ── shared bits ────────────────────────────────────────────────────────────

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`

const FIT_HIGH = 1.3
const FIT_LOW = 0.7

export function raterFlags(r: RaterStat): { label: string; tone: 'bad' | 'warn' | 'info' }[] {
  const flags: { label: string; tone: 'bad' | 'warn' | 'info' }[] = []
  if (r.measure > 1) flags.push({ label: 'Strict', tone: 'bad' })
  if (r.measure < -1) flags.push({ label: 'Lenient', tone: 'bad' })
  if (r.infitMnSq > FIT_HIGH || r.outfitMnSq > FIT_HIGH) flags.push({ label: 'Inconsistent', tone: 'bad' })
  else if (r.infitMnSq < FIT_LOW && r.outfitMnSq < FIT_LOW) flags.push({ label: 'Very uniform', tone: 'info' })
  if (r.discrimination < 0) flags.push({ label: 'Reversed?', tone: 'bad' })
  else if (r.discrimination < 0.5) flags.push({ label: 'Low discrimination', tone: 'warn' })
  if (r.tendencies.length) flags.push({ label: 'Criterion habit', tone: 'warn' })
  return flags
}

const TONE = {
  bad: 'bg-red-50 text-red-800 border-red-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  info: 'bg-slate-50 text-slate-700 border-slate-200',
}

function Chip({ label, tone }: { label: string; tone: keyof typeof TONE }) {
  return <span className={`inline-block text-[11px] leading-4 border rounded px-1.5 py-px mr-1 mb-0.5 ${TONE[tone]}`}>{label}</span>
}

function fitClass(v: number) {
  return v > FIT_HIGH ? 'text-red-700 font-semibold' : v < FIT_LOW ? 'text-slate-500' : ''
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3" title={hint}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

export function AnalysisStatus({ loading, error, analysis, scope }: {
  loading: boolean; error: string; analysis: RaschAnalysis | null; scope: string
}) {
  if (error) return <p className="text-sm text-red-700">Analysis failed: {error}</p>
  if (loading && !analysis) return <p className="text-sm text-muted-foreground">Running Rasch analysis…</p>
  if (!analysis) return null
  return (
    <p className="text-xs text-muted-foreground">
      {scope} · {analysis.observations.toLocaleString()} ratings ·{' '}
      {analysis.converged
        ? `converged in ${analysis.iterations} iterations`
        : <span className="text-red-700">did not converge — treat with caution</span>}
      {!!analysis.excludedRows && (
        <span className="text-amber-800">
          {' '}· {analysis.excludedRows} score rows skipped (rater has no permanent number — use "Assign numbers" on Scores)
        </span>
      )}
      {loading && ' · updating…'}
    </p>
  )
}

// ── raters ─────────────────────────────────────────────────────────────────

type RaterFilter = 'event' | 'all' | 'senior' | 'flagged'
type RaterSort = 'number' | 'strict' | 'lenient' | 'fit'

export function RatersPanel({ analysis, hasEvent, seniorNumbers, testNames, testPrefix = '#' }: {
  analysis: RaschAnalysis
  hasEvent: boolean
  seniorNumbers: Set<number>
  testNames: Map<number, string>
  testPrefix?: string
}) {
  const [filter, setFilter] = useState<RaterFilter>(hasEvent ? 'event' : 'flagged')
  const [sort, setSort] = useState<RaterSort>('number')
  const [open, setOpen] = useState<Set<number>>(new Set())

  const rows = useMemo(() => {
    const list = analysis.raters.filter(r =>
      filter === 'event' ? r.isCurrent :
      filter === 'senior' ? seniorNumbers.has(r.number) :
      filter === 'flagged' ? raterFlags(r).some(f => f.tone !== 'info') :
      true)
    const fitOf = (r: RaterStat) => Math.max(r.infitMnSq, r.outfitMnSq)
    return list.sort((a, b) =>
      sort === 'strict' ? b.measure - a.measure :
      sort === 'lenient' ? a.measure - b.measure :
      sort === 'fit' ? fitOf(b) - fitOf(a) :
      a.number - b.number)
  }, [analysis, filter, sort, seniorNumbers])

  const toggle = (n: number) => setOpen(s => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Raters in the analysis" value={String(analysis.raters.length)} />
        <Stat label="Rater separation reliability" value={analysis.raterSummary.reliability.toFixed(2)}
          hint="How reliably raters differ in strictness. High = real differences in severity exist between raters (which training aims to reduce)." />
        <Stat label="Outside ±1 strictness" value={String(analysis.raters.filter(r => Math.abs(r.measure) > 1).length)} />
        <Stat label="Inconsistent (fit > 1.3)" value={String(analysis.raters.filter(r => r.infitMnSq > FIT_HIGH || r.outfitMnSq > FIT_HIGH).length)} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex flex-wrap gap-3">
          {([
            ...(hasEvent ? [['event', "This event's raters"]] : []),
            ['flagged', 'Flagged only'],
            ['senior', 'Senior raters & admins'],
            ['all', 'Everyone'],
          ] as [RaterFilter, string][]).map(([val, label]) => (
            <label key={val} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="raterFilter" checked={filter === val} onChange={() => setFilter(val)} />
              {label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 ml-auto">
          <span className="text-muted-foreground">Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value as RaterSort)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm">
            <option value="number">Rater number</option>
            <option value="strict">Strictest first</option>
            <option value="lenient">Most lenient first</option>
            <option value="fit">Least consistent first</option>
          </select>
        </label>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b text-muted-foreground">
            <tr>
              <th className="w-6" />
              <th className="text-left px-2 py-2 font-medium">#</th>
              <th className="text-left px-2 py-2 font-medium">Rater</th>
              <th className="text-center px-2 py-2 font-medium" title="Number of individual criterion ratings">Ratings</th>
              <th className="text-center px-2 py-2 font-medium" title="Rasch measure (logits): + = stricter, − = more lenient. Target ±1.">Strictness</th>
              <th className="text-center px-2 py-2 font-medium" title="Infit / outfit mean-square: 1 = as expected; > 1.3 erratic; < 0.7 very uniform">Infit / Outfit</th>
              <th className="text-center px-2 py-2 font-medium" title="Estimated discrimination: ≈1 typical; low = not separating strong and weak candidates">Discr.</th>
              <th className="text-left px-2 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No raters match this filter.</td></tr>
            )}
            {rows.map(r => {
              const flags = raterFlags(r)
              const hasDetail = r.unexpected.length > 0 || r.tendencies.length > 0
              const isOpen = open.has(r.number)
              return (
                <Fragment key={r.number}>
                  <tr className={`border-t ${hasDetail ? 'cursor-pointer hover:bg-muted/20' : ''}`} onClick={() => hasDetail && toggle(r.number)}>
                    <td className="pl-2">
                      {hasDetail && <ChevronRight className={`size-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{r.number}</td>
                    <td className="px-2 py-2">{r.name}</td>
                    <td className="px-2 py-2 text-center text-xs text-muted-foreground">{r.count}</td>
                    <td className={`px-2 py-2 text-center font-mono ${Math.abs(r.measure) > 1 ? 'text-red-700 font-semibold' : ''}`}>
                      {signed(r.measure)} <span className="text-xs text-muted-foreground">±{r.se.toFixed(2)}</span>
                    </td>
                    <td className="px-2 py-2 text-center font-mono text-xs">
                      <span className={fitClass(r.infitMnSq)}>{r.infitMnSq.toFixed(2)}</span>
                      {' / '}
                      <span className={fitClass(r.outfitMnSq)}>{r.outfitMnSq.toFixed(2)}</span>
                    </td>
                    <td className={`px-2 py-2 text-center font-mono text-xs ${r.discrimination < 0.5 ? 'text-red-700 font-semibold' : ''}`}>
                      {r.discrimination.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5">
                      {flags.map(f => <Chip key={f.label} {...f} />)}
                      {r.unexpected.length > 0 && <Chip label={`${r.unexpected.length} unexpected`} tone="info" />}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/10">
                      <td />
                      <td colSpan={7} className="px-2 py-3 space-y-3">
                        {r.tendencies.length > 0 && (
                          <div>
                            <p className="text-xs font-medium mb-1">Criterion habits (compared with this rater's own overall strictness)</p>
                            <ul className="text-sm space-y-0.5">
                              {r.tendencies.map(t => (
                                <li key={t.criterion}>
                                  <strong>{t.criterion}</strong>: about {Math.abs(t.avgDiff).toFixed(1)} level{Math.abs(t.avgDiff) >= 1.05 ? 's' : ''}{' '}
                                  {t.avgDiff > 0 ? 'more generous' : 'stricter'} than expected across {t.count} rating{t.count !== 1 ? 's' : ''}
                                  <span className="text-xs text-muted-foreground"> (t = {t.t.toFixed(1)})</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {r.unexpected.length > 0 && (
                          <div>
                            <p className="text-xs font-medium mb-1">Unexpected individual scores</p>
                            <table className="text-sm">
                              <thead className="text-xs text-muted-foreground">
                                <tr>
                                  <th className="text-left pr-4 font-medium">Test</th>
                                  <th className="text-left pr-4 font-medium">Criterion</th>
                                  <th className="text-center pr-4 font-medium">Gave</th>
                                  <th className="text-center pr-4 font-medium">Expected</th>
                                  <th className="text-center font-medium" title="Standardised residual: |z| ≥ 3 is very unlikely under the model">z</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.unexpected.map((u, i) => (
                                  <tr key={i}>
                                    <td className="pr-4">{testPrefix}{u.candidate} {testNames.get(u.candidate) ?? ''}</td>
                                    <td className="pr-4">{u.criterion}</td>
                                    <td className="pr-4 text-center font-mono font-semibold">{u.score}</td>
                                    <td className="pr-4 text-center font-mono">{u.expected.toFixed(1)}</td>
                                    <td className="text-center font-mono text-xs">{u.z.toFixed(1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Strictness is on a common scale regardless of which tests each rater happened to score — unlike raw averages.
        Criterion habits are only shown when they're both statistically clear and at least half a level per rating.
        Click a row with ▸ for details.
      </p>
    </div>
  )
}

// ── tests ──────────────────────────────────────────────────────────────────

const CRIT_ABBR: Record<string, string> = {
  Pronunciation: 'PRO', Structure: 'STR', Vocabulary: 'VOC', Fluency: 'FLU', Comprehension: 'COM', Interactions: 'INT',
}

// Tiers split the pool into roughly thirds (±0.43 on a standardised score)
export const DIFFICULTY_TIER = 0.43

export function DifficultyBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[11px] text-muted-foreground">uncal.</span>
  const [label, cls] =
    value < -DIFFICULTY_TIER ? ['easy', 'text-green-800 bg-green-50'] :
    value > DIFFICULTY_TIER ? ['hard', 'text-red-800 bg-red-50'] :
    ['mid', 'text-blue-800 bg-blue-50']
  return <span className={`text-[11px] font-medium px-1.5 py-px rounded ${cls}`} title={`Rating difficulty ${value > 0 ? '+' : ''}${value.toFixed(2)}`}>{label}</span>
}

export function testFlags(t: TestStat): { label: string; tone: 'bad' | 'warn' | 'info' }[] {
  const flags: { label: string; tone: 'bad' | 'warn' | 'info' }[] = []
  if (t.infitMnSq > FIT_HIGH || t.outfitMnSq > FIT_HIGH) flags.push({ label: 'Raters disagree', tone: 'bad' })
  if (t.raters < 10) flags.push({ label: 'Few ratings', tone: 'info' })
  // The deciding (lowest) criterion sits within 0.15 of a level boundary (x.5)
  const lowest = Math.min(...t.criterionFair.map(c => c.fair))
  if (Math.abs(lowest - (Math.floor(lowest) + 0.5)) < 0.15) flags.push({ label: 'Borderline level', tone: 'warn' })
  return flags
}

export function TestsPanel({ analysis, onSave, saving, savedAt, canSave, testPrefix = '#' }: {
  analysis: RaschAnalysis
  testPrefix?: string
  onSave?: () => void
  saving?: boolean
  savedAt?: string
  canSave?: boolean
}) {
  const [sort, setSort] = useState<'number' | 'level' | 'fit'>('level')
  const tests = useMemo(() => [...analysis.tests].sort((a, b) =>
    sort === 'number' ? a.number - b.number :
    sort === 'fit' ? Math.max(b.infitMnSq, b.outfitMnSq) - Math.max(a.infitMnSq, a.outfitMnSq) :
    b.measure - a.measure), [analysis, sort])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Tests calibrated" value={String(analysis.tests.length)} />
        <Stat label="Test separation reliability" value={analysis.testSummary.reliability.toFixed(2)}
          hint="How reliably the recordings are distinguished by level. Near 1 = the bank spans clearly different levels." />
        <Stat label="Raters disagree (fit > 1.3)" value={String(analysis.tests.filter(t => t.infitMnSq > FIT_HIGH || t.outfitMnSq > FIT_HIGH).length)} />
        <Stat label="Levels covered" value={[...new Set(analysis.tests.map(t => t.level))].sort().join(', ')} />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {onSave && (
          <>
            <button
              onClick={onSave}
              disabled={!canSave || saving}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save calibration to Test Bank'}
            </button>
            {savedAt && <span className="text-xs text-green-700">{savedAt}</span>}
          </>
        )}
        <label className="flex items-center gap-2 ml-auto">
          <span className="text-muted-foreground">Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm">
            <option value="level">Highest level first</option>
            <option value="number">Test number</option>
            <option value="fit">Most rater disagreement first</option>
          </select>
        </label>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-2 font-medium">Test</th>
              <th className="text-left px-2 py-2 font-medium">Candidate</th>
              <th className="text-center px-2 py-2 font-medium">Raters</th>
              <th className="text-center px-2 py-2 font-medium" title="ICAO overall level an average rater would give: the lowest criterion">Level</th>
              <th className="text-center px-2 py-2 font-medium" title="Expected score per criterion from an average rater">
                {Object.values(CRIT_ABBR).join(' · ')}
              </th>
              <th className="text-center px-2 py-2 font-medium" title="Candidate ability (logits)">Measure</th>
              <th className="text-center px-2 py-2 font-medium" title="How hard this recording is to rate correctly: closeness of the deciding criterion to a level boundary + rater disagreement. Drives the easy/mid/hard tiers when tests are assigned. Needs 10+ raters.">To rate</th>
              <th className="text-center px-2 py-2 font-medium" title="How much raters disagree about this recording, beyond what the model expects">Infit / Outfit</th>
              <th className="text-left px-2 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {tests.map(t => {
              const lowest = Math.min(...t.criterionFair.map(c => c.fair))
              return (
                <tr key={t.number} className="border-t">
                  <td className="px-2 py-2 font-mono text-xs">{testPrefix}{t.number}</td>
                  <td className="px-2 py-2">
                    {t.name || <span className="text-muted-foreground">—</span>}
                    {t.testType && <span className="block text-xs text-muted-foreground">{t.testType}</span>}
                  </td>
                  <td className="px-2 py-2 text-center text-xs text-muted-foreground">{t.raters}</td>
                  <td className="px-2 py-2 text-center text-base font-bold">{t.level}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs whitespace-nowrap">
                    {t.criterionFair.map((c, i) => (
                      <Fragment key={c.criterion}>
                        {i > 0 && <span className="text-muted-foreground"> · </span>}
                        <span className={c.fair === lowest ? 'font-semibold underline' : 'text-muted-foreground'}>{c.fair.toFixed(1)}</span>
                      </Fragment>
                    ))}
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-xs">
                    {signed(t.measure)} <span className="text-muted-foreground">±{t.se.toFixed(2)}</span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <DifficultyBadge value={t.ratingDifficulty} />
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-xs">
                    <span className={fitClass(t.infitMnSq)}>{t.infitMnSq.toFixed(2)}</span>
                    {' / '}
                    <span className={fitClass(t.outfitMnSq)}>{t.outfitMnSq.toFixed(2)}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {testFlags(t).map(f => <Chip key={f.label} {...f} />)}
                    {t.unexpected > 0 && <Chip label={`${t.unexpected} unexpected`} tone="info" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Level is what an average-strictness rater would be expected to award (ICAO overall = lowest criterion, underlined),
        after removing the effect of which raters happened to score each recording. "Raters disagree" marks recordings
        that are scored less consistently than the model expects — worth reviewing for ambiguity or audio problems.
        "Borderline level" means the deciding criterion sits close to a level boundary.
      </p>
    </div>
  )
}

// ── scale & criteria ───────────────────────────────────────────────────────

export function ScalePanel({ analysis }: { analysis: RaschAnalysis }) {
  const total = analysis.categories.reduce((a, c) => a + c.count, 0)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Criteria</h3>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Criterion</th>
                <th className="text-center px-2 py-2 font-medium" title="Logits: + = harder to score highly on">Difficulty</th>
                <th className="text-center px-2 py-2 font-medium" title="Average score an average rater gives an average candidate">Fair avg</th>
                <th className="text-center px-2 py-2 font-medium">Infit / Outfit</th>
              </tr>
            </thead>
            <tbody>
              {[...analysis.criteria].sort((a, b) => b.measure - a.measure).map(c => (
                <tr key={c.name} className="border-t">
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-2 py-2 text-center font-mono">{signed(c.measure)} <span className="text-xs text-muted-foreground">±{c.se.toFixed(2)}</span></td>
                  <td className="px-2 py-2 text-center font-mono">{c.fairAvg.toFixed(2)}</td>
                  <td className="px-2 py-2 text-center font-mono text-xs">
                    <span className={fitClass(c.infitMnSq)}>{c.infitMnSq.toFixed(2)}</span>{' / '}
                    <span className={fitClass(c.outfitMnSq)}>{c.outfitMnSq.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          A criterion with high misfit is being interpreted less consistently by raters than the others — a candidate for extra training material.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">How the 6 levels are used</h3>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b text-muted-foreground">
              <tr>
                <th className="text-center px-2 py-2 font-medium">Level</th>
                <th className="text-right px-2 py-2 font-medium">Ratings</th>
                <th className="text-right px-2 py-2 font-medium">%</th>
                <th className="text-center px-2 py-2 font-medium" title="Andrich threshold: where this level becomes as likely as the one below. Should increase level by level.">Threshold</th>
                <th className="text-center px-2 py-2 font-medium" title="Candidate measure from which an average rater would be expected to award this level">Starts at</th>
              </tr>
            </thead>
            <tbody>
              {analysis.categories.map(c => (
                <tr key={c.category} className="border-t">
                  <td className="px-2 py-2 text-center font-bold">{c.category}</td>
                  <td className="px-2 py-2 text-right font-mono">{c.count.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs text-muted-foreground">{((c.count / total) * 100).toFixed(1)}%</td>
                  <td className="px-2 py-2 text-center font-mono">{c.andrichThreshold != null ? signed(c.andrichThreshold) : '—'}</td>
                  <td className="px-2 py-2 text-center font-mono">{c.measureAtHalfBelow != null ? signed(c.measureAtHalfBelow) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {analysis.thresholdsOrdered
            ? '✓ Thresholds increase level by level — raters are using the scale in the intended order.'
            : '✗ Thresholds are disordered — some adjacent levels are not being distinguished reliably.'}
          {' '}Levels with very few ratings (under ~10) have unstable thresholds.
        </p>
      </div>
    </div>
  )
}

// ── returning raters ───────────────────────────────────────────────────────

export function ReturningPanel({ drift, highlight }: { drift: DriftRater[]; highlight: Set<string> }) {
  const [onlyNotable, setOnlyNotable] = useState(false)
  const rows = drift.filter(d => !onlyNotable || d.notableChange != null)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {drift.length} rater{drift.length !== 1 ? 's have' : ' has'} scored in more than one event.
          Each event is measured separately on one common scale.
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyNotable} onChange={e => setOnlyNotable(e.target.checked)} />
          Only notable changes
        </label>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Rater</th>
              <th className="text-left px-3 py-2 font-medium">Strictness by event (oldest → newest)</th>
              <th className="text-center px-3 py-2 font-medium" title="Largest change between consecutive events that exceeds 2 combined standard errors">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Nothing to show.</td></tr>
            )}
            {rows.map(d => (
              <tr key={d.raterId} className={`border-t ${highlight.has(d.raterId) ? 'bg-blue-50/50' : ''}`}>
                <td className="px-3 py-2 align-top">{d.name}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {d.points.map(p => (
                      <span key={p.session} className="whitespace-nowrap">
                        <span className="text-xs text-muted-foreground">{p.session}: </span>
                        <span className={`font-mono ${Math.abs(p.measure) > 1 ? 'text-red-700 font-semibold' : ''}`}>{signed(p.measure)}</span>
                        <span className="text-xs text-muted-foreground"> ±{p.se.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-center align-top">
                  {d.notableChange != null
                    ? <Chip label={`${d.notableChange > 0 ? 'Stricter' : 'More lenient'} (${signed(d.notableChange)})`} tone="warn" />
                    : <span className="text-xs text-muted-foreground">within error</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        With only a few tests per event, standard errors are wide (often ±0.3–0.4), so small shifts are expected noise.
        "Change" only flags shifts larger than twice the combined error.
        {highlight.size > 0 && ' Highlighted rows are raters in the selected event.'}
      </p>
    </div>
  )
}
