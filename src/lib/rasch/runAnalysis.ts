import type { RaschRun } from '@/lib/parseFacets'
import { estimateMfrm, type MfrmObservation, type MfrmResult } from './mfrm'
import { CRITERIA, type RaschData } from './raschData'

export interface InHouseRun {
  run: RaschRun
  result: MfrmResult
  excludedRows: number // rows with no rater number (historical rater never assigned one)
}

// Runs the same analysis as our Facets spec (candidates positive + floating,
// raters and criteria centred, one shared rating scale) and returns it in the
// shape a parsed Facets .out produces, so the Reports page treats both alike.
export function runRaschAnalysis(data: RaschData): InHouseRun {
  const usable = data.rows.filter(r => r.rater > 0)
  const observations: MfrmObservation[] = usable.flatMap(r =>
    r.scores.map((score, c) => ({ elements: [r.candidate, r.rater, c + 1], score })))

  const result = estimateMfrm([
    { name: 'candidate', positive: true, centered: false },
    { name: 'rater', positive: false, centered: true },
    { name: 'criteria', positive: false, centered: true },
  ], observations)

  const [candidates, raters, criteria] = result.facets

  const density = new Map<number, number>()
  for (const c of candidates.elements) {
    const l = Math.round(c.measure)
    density.set(l, (density.get(l) ?? 0) + 1)
  }

  const run: RaschRun = {
    raters: raters.elements.map(e => ({
      raterNumber: e.id,
      raterName: data.raterNames.get(e.id) ?? String(e.id),
      measure: e.measure,
      se: e.se,
      infitMnSq: e.infitMnSq,
      infitZStd: e.infitZStd,
      outfitMnSq: e.outfitMnSq,
      outfitZStd: e.outfitZStd,
      discrimination: e.discrimination,
      ptMea: e.ptMea,
      ptExp: e.ptExp,
    })),
    criteria: [...criteria.elements]
      .sort((a, b) => b.measure - a.measure)
      .map(e => ({ name: CRITERIA[e.id - 1] ?? String(e.id), logit: e.measure })),
    candidateDensity: [...density].map(([logit, count]) => ({ logit, count })).sort((a, b) => b.logit - a.logit),
    candidateMeasures: candidates.elements.map(e => e.measure),
    scaleBoundaries: result.categories
      .filter(c => c.measureAtHalfBelow != null)
      .map(c => ({ level: c.category, logit: c.measureAtHalfBelow! })),
    meanMeasure: raters.summary.meanMeasure,
    reliability: raters.summary.reliabilityPop,
    separation: raters.summary.separationPop,
    rmse: raters.summary.rmse,
  }

  return { run, result, excludedRows: data.rows.length - usable.length }
}
