import type { RaschRun } from '@/lib/parseFacets'
import { estimateMfrm, type MfrmObservation, type MfrmResult } from './mfrm'
import { CRITERIA, type RaschData } from './raschData'

// Facets reports everything to 2dp; storing the same keeps in-house and
// imported runs interchangeable (and the email/boxes free of long decimals)
const r2 = (n: number) => Math.round(n * 100) / 100

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
      measure: r2(e.measure),
      se: r2(e.se),
      infitMnSq: r2(e.infitMnSq),
      infitZStd: Math.round(e.infitZStd * 10) / 10, // Facets shows ZStd to 1dp
      outfitMnSq: r2(e.outfitMnSq),
      outfitZStd: Math.round(e.outfitZStd * 10) / 10,
      discrimination: r2(e.discrimination),
      ptMea: r2(e.ptMea),
      ptExp: r2(e.ptExp),
    })),
    criteria: [...criteria.elements]
      .sort((a, b) => b.measure - a.measure)
      .map(e => ({ name: CRITERIA[e.id - 1] ?? String(e.id), logit: r2(e.measure) })),
    candidateDensity: [...density].map(([logit, count]) => ({ logit, count })).sort((a, b) => b.logit - a.logit),
    candidateMeasures: candidates.elements.map(e => r2(e.measure)),
    scaleBoundaries: result.categories
      .filter(c => c.measureAtHalfBelow != null)
      .map(c => ({ level: c.category, logit: r2(c.measureAtHalfBelow!) })),
    meanMeasure: r2(raters.summary.meanMeasure),
    reliability: r2(raters.summary.reliabilityPop),
    separation: r2(raters.summary.separationPop),
    rmse: r2(raters.summary.rmse),
  }

  return { run, result, excludedRows: data.rows.length - usable.length }
}
