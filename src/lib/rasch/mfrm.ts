// Many-facet Rasch model (rating scale variant), estimated by JMLE — the same
// model and estimation method as Facets' `Model = ?,?,...,R<max>`.
//
//   log(P_k / P_{k-1}) = Σ_f sign_f · measure_f(element) − F_k
//
// sign_f = +1 for positively oriented facets (candidates: higher = more able),
// −1 for the rest (raters: higher = more severe; criteria: higher = harder).
// Thresholds F_k are shared by all observations (one rating scale) and sum to 0.
// Non-centered facets float; centered facets have mean measure 0.

export interface MfrmFacetSpec {
  name: string
  positive: boolean
  centered: boolean
}

export interface MfrmObservation {
  elements: number[] // one element id per facet, in facet order
  score: number
}

export interface MfrmElement {
  id: number
  measure: number
  se: number
  totalScore: number
  count: number
  observedAvg: number
  fairAvg: number
  infitMnSq: number
  infitZStd: number
  outfitMnSq: number
  outfitZStd: number
  discrimination: number
  ptMea: number
  ptExp: number
  extreme: 'min' | 'max' | null
}

export interface MfrmFacetSummary {
  meanMeasure: number
  sdMeasurePop: number
  sdMeasureSample: number
  rmse: number
  adjSdPop: number
  separationPop: number
  reliabilityPop: number
  adjSdSample: number
  separationSample: number
  reliabilitySample: number
}

export interface MfrmFacetResult {
  spec: MfrmFacetSpec
  elements: MfrmElement[] // sorted by id
  summary: MfrmFacetSummary
}

export interface MfrmCategory {
  category: number
  count: number
  andrichThreshold: number | null // null for the bottom category
  thresholdSe: number | null
  expectedMeasureAtCategory: number | null // null at the extremes (reported in brackets by Facets)
  measureAtHalfBelow: number | null        // expected score = category − 0.5; the Table 6 Scale "---" marks
}

export interface MfrmResult {
  facets: MfrmFacetResult[]
  categories: MfrmCategory[]
  iterations: number
  converged: boolean
  observationsUsed: number
}

export interface MfrmOptions {
  maxIterations?: number
  convergenceLogit?: number     // max change in any measure/threshold
  convergenceScore?: number     // max |observed − expected| raw score for any element
  extremeAdjustment?: number    // Facets' Xtreme= (score points)
}

// ── scale helpers ─────────────────────────────────────────────────────────

// Category probabilities for linear predictor eta. thresholds[k] is F for step
// into category (minCat + k); thresholds[0] is unused (0).
function categoryProbs(eta: number, thresholds: number[], out: number[]): void {
  const m = thresholds.length
  let cum = 0
  let maxLog = 0
  const logs = out
  logs[0] = 0
  for (let k = 1; k < m; k++) {
    cum += eta - thresholds[k]
    logs[k] = cum
    if (cum > maxLog) maxLog = cum
  }
  let sum = 0
  for (let k = 0; k < m; k++) { logs[k] = Math.exp(logs[k] - maxLog); sum += logs[k] }
  for (let k = 0; k < m; k++) logs[k] /= sum
}

function expectedScore(eta: number, thresholds: number[], minCat: number, buf: number[]): number {
  categoryProbs(eta, thresholds, buf)
  let e = 0
  for (let k = 0; k < thresholds.length; k++) e += (minCat + k) * buf[k]
  return e
}

// Measure at which the expected score equals `target` (monotonic → bisection)
function measureForExpected(target: number, thresholds: number[], minCat: number): number {
  const buf = new Array<number>(thresholds.length)
  let lo = -50, hi = 50
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (expectedScore(mid, thresholds, minCat, buf) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Wilson-Hilferty standardisation of a mean-square with model variance q2,
// capped at ±9 as Facets reports it
function wilsonHilferty(mnsq: number, q2: number): number {
  if (!(q2 > 0) || !(mnsq > 0)) return 0
  const q = Math.sqrt(q2)
  return Math.max(-9, Math.min(9, (Math.cbrt(mnsq) - 1) * (3 / q) + q / 3))
}

function summarise(measures: number[], ses: number[]): MfrmFacetSummary {
  const n = measures.length
  const mean = measures.reduce((a, b) => a + b, 0) / Math.max(1, n)
  const ss = measures.reduce((a, b) => a + (b - mean) ** 2, 0)
  const sdPop = Math.sqrt(ss / Math.max(1, n))
  const sdSample = Math.sqrt(ss / Math.max(1, n - 1))
  const rmse = Math.sqrt(ses.reduce((a, b) => a + b * b, 0) / Math.max(1, n))
  const adj = (sd: number) => Math.sqrt(Math.max(0, sd * sd - rmse * rmse))
  const adjPop = adj(sdPop), adjSample = adj(sdSample)
  return {
    meanMeasure: mean,
    sdMeasurePop: sdPop,
    sdMeasureSample: sdSample,
    rmse,
    adjSdPop: adjPop,
    separationPop: rmse > 0 ? adjPop / rmse : 0,
    reliabilityPop: sdPop > 0 ? (adjPop * adjPop) / (sdPop * sdPop) : 0,
    adjSdSample: adjSample,
    separationSample: rmse > 0 ? adjSample / rmse : 0,
    reliabilitySample: sdSample > 0 ? (adjSample * adjSample) / (sdSample * sdSample) : 0,
  }
}

// ── estimation ────────────────────────────────────────────────────────────

export function estimateMfrm(
  specs: MfrmFacetSpec[],
  observations: MfrmObservation[],
  options: MfrmOptions = {},
): MfrmResult {
  const {
    maxIterations = 2000,
    convergenceLogit = 1e-6,
    convergenceScore = 1e-4,
    extremeAdjustment = 0.3,
  } = options
  const F = specs.length
  const sign = specs.map(s => (s.positive ? 1 : -1))
  const obs = observations
  const N = obs.length

  const minCat = Math.min(...obs.map(o => o.score))
  const maxCat = Math.max(...obs.map(o => o.score))
  const M = maxCat - minCat + 1

  // Dense element indexing per facet
  const ids: number[][] = specs.map((_, f) => [...new Set(obs.map(o => o.elements[f]))].sort((a, b) => a - b))
  const index: Map<number, number>[] = ids.map(list => new Map(list.map((id, i) => [id, i])))
  const el: Int32Array[] = specs.map((_, f) => Int32Array.from(obs, o => index[f].get(o.elements[f])!))
  const x = Float64Array.from(obs, o => o.score)

  // Raw scores, counts, extreme flags + adjusted targets
  const raw = ids.map(list => new Float64Array(list.length))
  const cnt = ids.map(list => new Float64Array(list.length))
  for (let n = 0; n < N; n++) for (let f = 0; f < F; f++) { raw[f][el[f][n]] += x[n]; cnt[f][el[f][n]]++ }
  const extreme: ('min' | 'max' | null)[][] = ids.map((list, f) =>
    list.map((_, i) => raw[f][i] <= cnt[f][i] * minCat ? 'min' : raw[f][i] >= cnt[f][i] * maxCat ? 'max' : null))
  const target = raw.map((r, f) => Float64Array.from(r, (v, i) =>
    extreme[f][i] === 'min' ? v + extremeAdjustment : extreme[f][i] === 'max' ? v - extremeAdjustment : v))

  // Category counts
  const catCount = new Array<number>(M).fill(0)
  for (let n = 0; n < N; n++) catCount[x[n] - minCat]++
  const obsAtOrAbove = catCount.map((_, k) => catCount.slice(k).reduce((a, b) => a + b, 0))

  // Initial values: thresholds from adjacent category frequencies, measures 0
  const measure = ids.map(list => new Float64Array(list.length))
  const thr = new Array<number>(M).fill(0)
  for (let k = 1; k < M; k++) thr[k] = Math.log(Math.max(0.5, catCount[k - 1]) / Math.max(0.5, catCount[k]))
  centreThresholds(thr)

  const eta = new Float64Array(N)
  const probs = new Array<number>(M)
  const expScore = ids.map(list => new Float64Array(list.length))
  const variance = ids.map(list => new Float64Array(list.length))

  const computeEta = () => {
    for (let n = 0; n < N; n++) {
      let s = 0
      for (let f = 0; f < F; f++) s += sign[f] * measure[f][el[f][n]]
      eta[n] = s
    }
  }

  let iterations = 0
  let converged = false
  for (; iterations < maxIterations; iterations++) {
    let maxChange = 0
    let maxResidual = 0

    // Facet measures, one facet at a time (Gauss-Seidel over facets)
    for (let f = 0; f < F; f++) {
      computeEta()
      expScore[f].fill(0); variance[f].fill(0)
      for (let n = 0; n < N; n++) {
        categoryProbs(eta[n], thr, probs)
        let e = 0, e2 = 0
        for (let k = 0; k < M; k++) { const c = minCat + k; e += c * probs[k]; e2 += c * c * probs[k] }
        const i = el[f][n]
        expScore[f][i] += e
        variance[f][i] += e2 - e * e
      }
      for (let i = 0; i < ids[f].length; i++) {
        const resid = target[f][i] - expScore[f][i]
        if (Math.abs(resid) > maxResidual) maxResidual = Math.abs(resid)
        let step = sign[f] * resid / Math.max(variance[f][i], 1e-9)
        step = Math.max(-1, Math.min(1, step))
        measure[f][i] += step
        if (Math.abs(step) > maxChange) maxChange = Math.abs(step)
      }
      if (specs[f].centered) {
        const mean = measure[f].reduce((a, b) => a + b, 0) / measure[f].length
        for (let i = 0; i < measure[f].length; i++) measure[f][i] -= mean
      }
    }

    // Thresholds: Newton step on each F_k using counts at or above k
    computeEta()
    const expAbove = new Array<number>(M).fill(0)
    const infoAbove = new Array<number>(M).fill(0)
    for (let n = 0; n < N; n++) {
      categoryProbs(eta[n], thr, probs)
      let tail = 0
      for (let k = M - 1; k >= 1; k--) {
        tail += probs[k]
        expAbove[k] += tail
        infoAbove[k] += tail * (1 - tail)
      }
    }
    for (let k = 1; k < M; k++) {
      const resid = expAbove[k] - obsAtOrAbove[k]
      let step = resid / Math.max(infoAbove[k], 1e-9)
      step = Math.max(-1, Math.min(1, step))
      thr[k] += step
      if (Math.abs(step) > maxChange) maxChange = Math.abs(step)
    }
    centreThresholds(thr)

    if (maxChange < convergenceLogit && maxResidual < convergenceScore) { converged = true; iterations++; break }
  }

  // ── final statistics ──────────────────────────────────────────────────
  computeEta()
  const E = new Float64Array(N), W = new Float64Array(N), C = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    categoryProbs(eta[n], thr, probs)
    let e = 0
    for (let k = 0; k < M; k++) e += (minCat + k) * probs[k]
    let w = 0, c4 = 0
    for (let k = 0; k < M; k++) { const d = minCat + k - e; w += d * d * probs[k]; c4 += d ** 4 * probs[k] }
    E[n] = e; W[n] = w; C[n] = c4
  }

  const facetMeans = measure.map(m => m.reduce((a, b) => a + b, 0) / m.length)
  const buf = new Array<number>(M)

  const facets: MfrmFacetResult[] = specs.map((spec, f) => {
    const nEl = ids[f].length
    const sumW = new Float64Array(nEl), sumY2 = new Float64Array(nEl), sumZ2 = new Float64Array(nEl)
    const sumCw = new Float64Array(nEl), sumCw2 = new Float64Array(nEl)
    const members: number[][] = Array.from({ length: nEl }, () => [])
    for (let n = 0; n < N; n++) {
      const i = el[f][n]
      const y = x[n] - E[n]
      sumW[i] += W[n]
      sumY2[i] += y * y
      sumZ2[i] += (y * y) / W[n]
      sumCw[i] += C[n] - W[n] * W[n]
      sumCw2[i] += C[n] / (W[n] * W[n])
      members[i].push(n)
    }

    const elements: MfrmElement[] = ids[f].map((id, i) => {
      const count = cnt[f][i]
      const outfit = sumZ2[i] / count
      const infit = sumY2[i] / sumW[i]
      const qOut2 = sumCw2[i] / (count * count) - 1 / count
      const qIn2 = sumCw[i] / (sumW[i] * sumW[i])

      // Fair average: this element's measure, every other facet at its mean
      let fairEta = 0
      for (let g = 0; g < F; g++) fairEta += sign[g] * (g === f ? measure[g][i] : facetMeans[g])
      const fairAvg = expectedScore(fairEta, thr, minCat, buf)

      // "Rest" measure: the combined location of the other facets in each observation,
      // oriented so that higher = higher expected score
      const rest = members[i].map(n => eta[n] - sign[f] * measure[f][i])

      // Estimated discrimination: one Newton step from a = 1 for a slope on
      // (eta − F_k) in log(P_k/P_k−1) = a(eta − F_k). Matches Facets to ±0.006.
      let num = 0, den = 0
      for (const n of members[i]) {
        categoryProbs(eta[n], thr, buf)
        let s = 0, es = 0, es2 = 0, sObs = 0
        for (let c = 0; c < M; c++) {
          if (c > 0) s += eta[n] - thr[c]
          es += buf[c] * s; es2 += buf[c] * s * s
          if (minCat + c === x[n]) sObs = s
        }
        num += sObs - es
        den += es2 - es * es
      }
      const discrimination = den > 0 ? 1 + num / den : NaN

      // Point-measure correlation (observed and model-expected)
      const k = members[i].length
      const mr = rest.reduce((a, b) => a + b, 0) / k
      const mx = members[i].reduce((a, n) => a + x[n], 0) / k
      const me = members[i].reduce((a, n) => a + E[n], 0) / k
      let sxr = 0, sxx = 0, srr = 0, ser = 0, see = 0, sw = 0
      members[i].forEach((n, j) => {
        const dr = rest[j] - mr
        sxr += (x[n] - mx) * dr; sxx += (x[n] - mx) ** 2; srr += dr * dr
        ser += (E[n] - me) * dr; see += (E[n] - me) ** 2; sw += W[n]
      })
      const ptMea = sxx > 0 && srr > 0 ? sxr / Math.sqrt(sxx * srr) : NaN
      const ptExp = srr > 0 ? ser / Math.sqrt((see + sw) * srr) : NaN

      return {
        id,
        measure: measure[f][i],
        se: 1 / Math.sqrt(sumW[i]),
        totalScore: raw[f][i],
        count,
        observedAvg: raw[f][i] / count,
        fairAvg,
        infitMnSq: infit,
        infitZStd: wilsonHilferty(infit, qIn2),
        outfitMnSq: outfit,
        outfitZStd: wilsonHilferty(outfit, qOut2),
        discrimination,
        ptMea,
        ptExp,
        extreme: extreme[f][i],
      }
    })

    return {
      spec,
      elements,
      summary: summarise(elements.map(e => e.measure), elements.map(e => e.se)),
    }
  })

  // Rating scale: threshold SEs and expectation landmarks
  const thrInfo = new Array<number>(M).fill(0)
  for (let n = 0; n < N; n++) {
    categoryProbs(eta[n], thr, probs)
    let tail = 0
    for (let k = M - 1; k >= 1; k--) { tail += probs[k]; thrInfo[k] += tail * (1 - tail) }
  }
  const categories: MfrmCategory[] = thr.map((t, k) => ({
    category: minCat + k,
    count: catCount[k],
    andrichThreshold: k === 0 ? null : t,
    thresholdSe: k === 0 ? null : 1 / Math.sqrt(thrInfo[k]),
    expectedMeasureAtCategory: k === 0 || k === M - 1 ? null : measureForExpected(minCat + k, thr, minCat),
    measureAtHalfBelow: k === 0 ? null : measureForExpected(minCat + k - 0.5, thr, minCat),
  }))

  return { facets, categories, iterations, converged, observationsUsed: N }
}

function centreThresholds(thr: number[]) {
  const m = thr.length - 1
  if (m <= 0) return
  const mean = thr.slice(1).reduce((a, b) => a + b, 0) / m
  for (let k = 1; k < thr.length; k++) thr[k] -= mean
}
