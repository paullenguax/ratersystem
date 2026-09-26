import type { RaschRun } from '@/lib/parseFacets'
import { estimateMfrm, estimateBias, type MfrmCategory, type MfrmObservation } from './mfrm'
import { CRITERIA, type RaschDataRow } from './raschData'

// Everything the app derives from one in-house Rasch run: the RaschRun shape
// saved to Firestore (and shared with Facets imports), plus the richer
// per-rater / per-test detail the Statistics page shows.

// A frozen frame of reference: anchor tests' measures plus the criteria and
// rating-scale steps at the time it was frozen. Runs anchored to it keep "0"
// meaning the same thing over time, so population-wide drift becomes visible.
export interface RaschBaseline {
  name: string
  createdAt: string // ISO date
  tests: { number: number; measure: number }[]
  criteria: { id: number; measure: number }[]
  thresholds: { category: number; value: number }[]
}

export interface AnchorCheck {
  number: number
  anchorMeasure: number
  displacement: number
  ratings: number
  drifted: boolean // |displacement| > ANCHOR_DRIFT
}

export const ANCHOR_DRIFT = 0.5

export interface AnalysisInput {
  baseline?: RaschBaseline | null
  rows: RaschDataRow[]
  raterNames: [number, string][]
  currentRaters?: number[]                       // rater numbers belonging to the selected event
  tests?: [number, { name: string; testType: string }][]
}

export interface UnexpectedScore {
  candidate: number
  rater: number
  criterion: string
  score: number
  expected: number
  z: number // standardised residual; |z| ≥ 3 is Facets' default cut-off
}

// A rater's habit on one criterion, relative to their own overall severity
export interface CriterionTendency {
  rater: number
  criterion: string
  count: number
  avgDiff: number // observed − expected, per rating (score points): + = more generous
  bias: number    // logits
  se: number
  t: number
}

export interface RaterStat {
  number: number
  name: string
  isCurrent: boolean
  count: number
  observedAvg: number
  fairAvg: number
  measure: number
  se: number
  infitMnSq: number
  outfitMnSq: number
  infitZStd: number
  outfitZStd: number
  discrimination: number
  ptMea: number
  ptExp: number
  unexpected: UnexpectedScore[]
  tendencies: CriterionTendency[]
}

export interface TestStat {
  number: number
  name: string
  testType: string
  count: number
  raters: number
  measure: number
  se: number
  fairAvg: number
  criterionFair: { criterion: string; fair: number }[]
  level: number // ICAO overall: lowest criterion level at an average rater
  infitMnSq: number
  outfitMnSq: number
  unexpected: number
  // How hard the recording is to rate correctly (null when too few raters to
  // judge): standardised mix of closeness to a level boundary and rater
  // disagreement. Written to test_bank.canonicalDifficulty for the
  // easy/mid/hard tiers in Auto-assign and the self-serve exam.
  ratingDifficulty: number | null
}

export const MIN_RATERS_FOR_DIFFICULTY = 10

export interface CriterionStat {
  name: string
  measure: number
  se: number
  fairAvg: number
  infitMnSq: number
  outfitMnSq: number
}

export interface RaschAnalysis {
  run: RaschRun
  raters: RaterStat[]
  tests: TestStat[]
  criteria: CriterionStat[]
  categories: MfrmCategory[]
  thresholdsOrdered: boolean
  observations: number
  iterations: number
  converged: boolean
  excludedRows: number
  raterSummary: { reliability: number; separation: number; rmse: number }
  testSummary: { reliability: number; separation: number; rmse: number }
  baselineName: string | null
  anchorChecks: AnchorCheck[]
  // Criteria and scale steps are anchored too; their largest displacement
  scaleDisplacement: number
}

// Tendencies worth mentioning: statistically clear AND at least half a level per rating
export const TENDENCY_MIN_T = 2
export const TENDENCY_MIN_DIFF = 0.5

const r2 = (n: number) => Math.round(n * 100) / 100

const SPECS = [
  { name: 'candidate', positive: true, centered: false },
  { name: 'rater', positive: false, centered: true },
  { name: 'criteria', positive: false, centered: true },
]
// Anchored runs: the anchors fix the origin, so raters float
const ANCHORED_SPECS = SPECS.map(s => ({ ...s, centered: false }))

export function analyze(input: AnalysisInput): RaschAnalysis {
  const usable = input.rows.filter(r => r.rater > 0)
  const observations: MfrmObservation[] = usable.flatMap(r =>
    r.scores.map((score, c) => ({ elements: [r.candidate, r.rater, c + 1], score })))

  const baseline = input.baseline ?? null
  const specs = baseline ? ANCHORED_SPECS : SPECS
  const result = estimateMfrm(specs, observations, baseline ? {
    anchors: new Map([
      [0, new Map(baseline.tests.map(t => [t.number, t.measure]))],
      [2, new Map(baseline.criteria.map(c => [c.id, c.measure]))],
    ]),
    anchorThresholds: new Map(baseline.thresholds.map(t => [t.category, t.value])),
  } : {})
  const [candF, raterF, critF] = result.facets
  const names = new Map(input.raterNames)
  const current = new Set(input.currentRaters ?? [])
  const testInfo = new Map(input.tests ?? [])
  const crit = (id: number) => CRITERIA[id - 1] ?? String(id)

  // Unexpected individual scores
  const unexpected: UnexpectedScore[] = []
  observations.forEach((o, i) => {
    const z = (o.score - result.expected[i]) / Math.sqrt(result.variance[i])
    if (Math.abs(z) >= 3) unexpected.push({
      candidate: o.elements[0], rater: o.elements[1], criterion: crit(o.elements[2]),
      score: o.score, expected: r2(result.expected[i]), z: Math.round(z * 10) / 10,
    })
  })
  unexpected.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))

  // Rater × criterion habits
  const tendencies: CriterionTendency[] = estimateBias(specs, observations, result, 1, 2)
    .map(b => ({
      rater: b.a, criterion: crit(b.b), count: b.count,
      avgDiff: r2((b.observedScore - b.expectedScore) / b.count),
      bias: r2(b.bias), se: r2(b.se), t: Math.round(b.t * 10) / 10,
    }))
    .filter(t => Math.abs(t.t) >= TENDENCY_MIN_T && Math.abs(t.avgDiff) >= TENDENCY_MIN_DIFF)

  const byRater = <T extends { rater: number }>(list: T[]) => {
    const m = new Map<number, T[]>()
    for (const x of list) { if (!m.has(x.rater)) m.set(x.rater, []); m.get(x.rater)!.push(x) }
    return m
  }
  const unexpectedByRater = byRater(unexpected)
  const tendenciesByRater = byRater(tendencies)

  const raters: RaterStat[] = raterF.elements.map(e => ({
    number: e.id,
    name: names.get(e.id) ?? String(e.id),
    isCurrent: current.has(e.id),
    count: e.count,
    observedAvg: r2(e.observedAvg),
    fairAvg: r2(e.fairAvg),
    measure: r2(e.measure),
    se: r2(e.se),
    infitMnSq: r2(e.infitMnSq),
    outfitMnSq: r2(e.outfitMnSq),
    infitZStd: Math.round(e.infitZStd * 10) / 10,
    outfitZStd: Math.round(e.outfitZStd * 10) / 10,
    discrimination: r2(e.discrimination),
    ptMea: r2(e.ptMea),
    ptExp: r2(e.ptExp),
    unexpected: unexpectedByRater.get(e.id) ?? [],
    tendencies: tendenciesByRater.get(e.id) ?? [],
  }))

  // Tests: fair score per criterion at an average rater; ICAO overall = lowest
  const thr = result.thresholds
  const minCat = result.minCategory
  const raterMean = raterF.summary.meanMeasure
  const expectedAt = (eta: number) => {
    let cum = 0, max = 0
    const logs = [0]
    for (let k = 1; k < thr.length; k++) { cum += eta - thr[k]; logs.push(cum); if (cum > max) max = cum }
    const ex = logs.map(l => Math.exp(l - max))
    const sum = ex.reduce((a, b) => a + b, 0)
    return ex.reduce((acc, p, k) => acc + (minCat + k) * p / sum, 0)
  }
  const ratersPerTest = new Map<number, Set<number>>()
  for (const r of usable) {
    if (!ratersPerTest.has(r.candidate)) ratersPerTest.set(r.candidate, new Set())
    ratersPerTest.get(r.candidate)!.add(r.rater)
  }
  const unexpectedPerTest = new Map<number, number>()
  for (const u of unexpected) unexpectedPerTest.set(u.candidate, (unexpectedPerTest.get(u.candidate) ?? 0) + 1)

  const tests: TestStat[] = candF.elements.map(e => {
    const criterionFair = critF.elements.map(c => ({
      criterion: crit(c.id),
      fair: r2(expectedAt(e.measure - raterMean - c.measure)),
    }))
    const level = Math.min(...criterionFair.map(c => Math.min(6, Math.max(1, Math.floor(c.fair + 0.5)))))
    const info = testInfo.get(e.id)
    return {
      number: e.id,
      name: info?.name ?? '',
      testType: info?.testType ?? '',
      count: e.count,
      raters: ratersPerTest.get(e.id)?.size ?? 0,
      measure: r2(e.measure),
      se: r2(e.se),
      fairAvg: r2(e.fairAvg),
      criterionFair,
      level,
      infitMnSq: r2(e.infitMnSq),
      outfitMnSq: r2(e.outfitMnSq),
      unexpected: unexpectedPerTest.get(e.id) ?? 0,
      ratingDifficulty: null,
    }
  })

  // Rating difficulty, among tests with enough raters to judge:
  //  boundary: 1 when the deciding criterion sits exactly on a level boundary (x.5), 0 mid-level
  //  disagreement: the larger of infit/outfit
  // Each is standardised across those tests, summed, then standardised again.
  const judged = tests.filter(t => t.raters >= MIN_RATERS_FOR_DIFFICULTY)
  if (judged.length >= 3) {
    const z = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1
      return xs.map(x => (x - m) / sd)
    }
    const boundary = judged.map(t => {
      const lowest = Math.min(...t.criterionFair.map(c => c.fair))
      return 1 - Math.min(1, Math.abs(lowest - (Math.floor(lowest) + 0.5)) / 0.5)
    })
    const disagreement = judged.map(t => Math.max(t.infitMnSq, t.outfitMnSq))
    const zb = z(boundary), zd = z(disagreement)
    const combined = z(judged.map((_, i) => zb[i] + zd[i]))
    judged.forEach((t, i) => { t.ratingDifficulty = r2(combined[i]) })
  }

  const criteria: CriterionStat[] = critF.elements.map(e => ({
    name: crit(e.id), measure: r2(e.measure), se: r2(e.se), fairAvg: r2(e.fairAvg),
    infitMnSq: r2(e.infitMnSq), outfitMnSq: r2(e.outfitMnSq),
  }))

  const andrich = result.categories.slice(1).map(c => c.andrichThreshold!)
  const thresholdsOrdered = andrich.every((t, i) => i === 0 || t > andrich[i - 1])

  const density = new Map<number, number>()
  for (const c of candF.elements) {
    const l = Math.round(c.measure)
    density.set(l, (density.get(l) ?? 0) + 1)
  }

  const run: RaschRun = {
    raters: raters.map(r => ({
      raterNumber: r.number, raterName: r.name, measure: r.measure, se: r.se,
      infitMnSq: r.infitMnSq, infitZStd: r.infitZStd, outfitMnSq: r.outfitMnSq, outfitZStd: r.outfitZStd,
      discrimination: r.discrimination, ptMea: r.ptMea, ptExp: r.ptExp,
    })),
    criteria: [...criteria].sort((a, b) => b.measure - a.measure).map(c => ({ name: c.name, logit: c.measure })),
    candidateDensity: [...density].map(([logit, count]) => ({ logit, count })).sort((a, b) => b.logit - a.logit),
    candidateMeasures: tests.map(t => t.measure),
    scaleBoundaries: result.categories
      .filter(c => c.measureAtHalfBelow != null)
      .map(c => ({ level: c.category, logit: r2(c.measureAtHalfBelow!) })),
    meanMeasure: r2(raterF.summary.meanMeasure),
    reliability: r2(raterF.summary.reliabilityPop),
    separation: r2(raterF.summary.separationPop),
    rmse: r2(raterF.summary.rmse),
    unexpected,
    tendencies,
    baselineName: baseline?.name ?? null,
  }

  const summ = (s: typeof raterF.summary) => ({
    reliability: r2(s.reliabilityPop), separation: r2(s.separationPop), rmse: r2(s.rmse),
  })

  const anchorChecks: AnchorCheck[] = candF.elements.filter(e => e.anchored).map(e => ({
    number: e.id,
    anchorMeasure: r2(e.measure),
    displacement: r2(e.displacement),
    ratings: e.count,
    drifted: Math.abs(e.displacement) > ANCHOR_DRIFT,
  }))
  const scaleDisplacement = r2(Math.max(0, ...critF.elements.filter(e => e.anchored).map(e => Math.abs(e.displacement))))

  return {
    run, raters, tests, criteria,
    baselineName: baseline?.name ?? null,
    anchorChecks,
    scaleDisplacement,
    categories: result.categories,
    thresholdsOrdered,
    observations: result.observationsUsed,
    iterations: result.iterations,
    converged: result.converged,
    excludedRows: input.rows.length - usable.length,
    raterSummary: summ(raterF.summary),
    testSummary: summ(candF.summary),
  }
}

// ── returning raters over time ────────────────────────────────────────────

export interface DriftPoint {
  session: string
  order: number
  measure: number
  se: number
  count: number
  infitMnSq: number
}

export interface DriftRater {
  raterId: string
  name: string
  points: DriftPoint[] // chronological
  // Largest change between consecutive events that exceeds 2 combined S.E.s
  notableChange: number | null
}

export function analyzeDrift(input: import('./raschData').DriftInput): DriftRater[] {
  const a = analyze(input.analysis)
  const stat = new Map(a.raters.map(r => [r.number, r]))
  const byPerson = new Map<string, { name: string; points: DriftPoint[] }>()
  for (const [n, el] of input.elements) {
    const r = stat.get(n)
    if (!r) continue
    if (!byPerson.has(el.raterId)) byPerson.set(el.raterId, { name: el.name, points: [] })
    byPerson.get(el.raterId)!.points.push({
      session: el.session, order: el.order, measure: r.measure, se: r.se, count: r.count, infitMnSq: r.infitMnSq,
    })
  }
  return [...byPerson.entries()]
    .filter(([, p]) => p.points.length > 1)
    .map(([raterId, p]) => {
      const points = p.points.sort((x, y) => x.order - y.order)
      let notableChange: number | null = null
      for (let i = 1; i < points.length; i++) {
        const d = points[i].measure - points[i - 1].measure
        const se = Math.sqrt(points[i].se ** 2 + points[i - 1].se ** 2)
        if (Math.abs(d) > 2 * se && (notableChange == null || Math.abs(d) > Math.abs(notableChange))) notableChange = r2(d)
      }
      return { raterId, name: p.name, points, notableChange }
    })
    .sort((x, y) => x.name.localeCompare(y.name))
}
