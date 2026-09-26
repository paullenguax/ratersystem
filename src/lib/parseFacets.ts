export interface RaschRater {
  raterNumber: number
  raterName: string
  measure: number
  se: number
  infitMnSq: number
  infitZStd: number
  outfitMnSq: number
  outfitZStd: number
  discrimination: number
  ptMea: number
  ptExp: number
}

export interface RaschCriterion {
  name: string
  logit: number
}

// Lower edge of each ICAO level on the candidate logit scale (Table 8.1's
// "Expectation: Measure at -0.5" column — the "---" marks in Table 6.0's Scale)
export interface ScaleBoundary {
  level: number
  logit: number
}

export interface RaschRun {
  raters: RaschRater[]
  criteria: RaschCriterion[]
  candidateDensity: { logit: number; count: number }[]
  // Added later — absent on older rasch_runs docs
  candidateMeasures?: number[]
  scaleBoundaries?: ScaleBoundary[]
  // In-house runs only: individual unexpected scores and rater × criterion habits
  unexpected?: import('./rasch/analysis').UnexpectedScore[]
  tendencies?: import('./rasch/analysis').CriterionTendency[]
  meanMeasure: number
  reliability: number
  separation: number
  rmse: number
}

function nums(s: string): number[] {
  return (s.match(/-?\d*\.?\d+/g) ?? []).map(Number)
}

// Parses a "Table 7.x.1 <facet> Measurement Report" — same layout for
// candidates, raters and criteria; the last column is "Num name"
function parseTable7(text: string, facet: string): { raters: RaschRater[]; meanMeasure: number; reliability: number; separation: number; rmse: number } {
  const raters: RaschRater[] = []
  let meanMeasure = 0, reliability = 0, separation = 0, rmse = 0

  const t7Start = text.search(new RegExp(`Table 7\\.\\d+\\.\\d+\\s+${facet} Measurement Report`, 'i'))
  if (t7Start < 0) return { raters, meanMeasure, reliability, separation, rmse }

  // Stop at the next table so summary-line regexes can't match a later one
  const rest = text.slice(t7Start + 10)
  const nextTable = rest.search(/\nTable \d/)
  const section = text.slice(t7Start, nextTable < 0 ? t7Start + 100000 : t7Start + 10 + nextTable)
  const lines = section.split('\n')

  let inData = false
  for (const line of lines) {
    const trimmed = line.trim()

    // The separator between header and data rows
    if (trimmed.startsWith('|---') || trimmed.startsWith('|--------------------------------')) {
      inData = !inData
      continue
    }
    // Closing border
    if (trimmed.startsWith('+---') || trimmed.startsWith('+----')) {
      inData = false
      continue
    }

    if (inData && line.startsWith('|')) {
      const parts = line.split('|')
      if (parts.length < 7) continue

      // Last meaningful section has "Num rater" — check it has a numeric rater number
      const lastField = parts[parts.length - 2]?.trim() ?? ''
      const numNameMatch = lastField.match(/^(\d+)\s+(.+)$/)
      if (!numNameMatch) continue // skip Mean/SD rows

      const raterNumber = parseInt(numNameMatch[1])
      const raterName = numNameMatch[2].trim()

      // sections: [empty, score+count+obsvd+fair, measure+se, infit+outfit, discrim, ptmea+ptexp, num+name, empty]
      const s1 = nums(parts[1] ?? '') // score, count, obsvdAvg, fairAvg
      const s2 = nums(parts[2] ?? '') // measure, se
      const s3 = nums(parts[3] ?? '') // infitMnSq, infitZStd, outfitMnSq, outfitZStd
      const s4 = nums(parts[4] ?? '') // discrimination
      const s5 = nums(parts[5] ?? '') // ptMea, ptExp

      if (s2.length < 2 || s3.length < 4) continue

      raters.push({
        raterNumber,
        raterName,
        measure: s2[0],
        se: s2[1],
        infitMnSq: s3[0],
        infitZStd: s3[1],
        outfitMnSq: s3[2],
        outfitZStd: s3[3],
        discrimination: s4[0] ?? NaN,
        ptMea: s5[0] ?? NaN,
        ptExp: s5[1] ?? NaN,
      })
      void s1 // totalScore/count available if needed later
    }
  }

  // Parse summary stats line
  const rmseMatch   = section.match(/Model[^:]*:\s*RMSE\s+([\d.]+)/)
  const sepMatch    = section.match(/Separation\s+([\d.]+)/)
  const relMatch    = section.match(/Reliability\s+([\d.]+)/)
  const meanLine    = lines.find(l => l.includes('Mean (Count:'))
  if (meanLine) {
    const parts = meanLine.split('|')
    const s2 = nums(parts[2] ?? '')
    if (s2.length >= 1) meanMeasure = s2[0]
  }
  if (rmseMatch) rmse = parseFloat(rmseMatch[1])
  if (sepMatch)  separation = parseFloat(sepMatch[1])
  if (relMatch)  reliability = parseFloat(relMatch[1])

  return { raters, meanMeasure, reliability, separation, rmse }
}

function parseTable6(text: string): { criteria: RaschCriterion[]; candidateDensity: { logit: number; count: number }[] } {
  const criteria: RaschCriterion[] = []
  const densityMap = new Map<number, number>()

  const t6Start = text.search(/Table 6\.0\s+All Facet Vertical/i)
  if (t6Start < 0) return { criteria, candidateDensity: [] }

  const section = text.slice(t6Start, t6Start + 200000)
  const lines = section.split('\n')

  // Find header row to get column positions
  const headerIdx = lines.findIndex(l => l.includes('|Measr|') && (l.includes('-rater') || l.includes('rater')))
  if (headerIdx < 0) return { criteria, candidateDensity: [] }

  const header = lines[headerIdx]

  // Column positions
  const measrEnd    = Math.max(header.indexOf('|+candidate'), header.indexOf('| candidate'))
  const candEnd     = Math.max(header.indexOf('|-rater'), header.indexOf('| rater'))
  // criteria col: last |-criteria or |−criteria (em-dash) before |Scale|
  const scaleStart  = header.lastIndexOf('|Scale|')
  const critEnd     = scaleStart > 0 ? scaleStart : header.length - 7
  // rater col ends where criteria col starts
  const raterEnd    = header.lastIndexOf('|-criter') !== -1
    ? header.lastIndexOf('|-criter')
    : header.lastIndexOf('|−criter') !== -1
      ? header.lastIndexOf('|−criter')
      : critEnd - 35 // fallback estimate

  if (measrEnd < 0 || candEnd < 0) return { criteria, candidateDensity: [] }

  const criteriaSet = new Set<string>()
  let currentLogit = 0

  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    // End of table: the closing border, or the footer separator/repeated header
    // (|-----+----- then |Measr| * = 2 |-rater ...) that Facets prints before it
    const t = line.trim()
    if (t.startsWith('+---') && i > headerIdx + 5) break
    if (/^\|-{3,}\+/.test(t) || t.startsWith('|Measr|')) break
    if (!line.startsWith('|') && !line.startsWith('*') && !line.startsWith(':')) continue

    // Extract logit measure (first column)
    const measrSection = line.slice(0, Math.min(measrEnd + 1, line.length))
    const measrMatch = measrSection.match(/-?\d+/)
    if (measrMatch) currentLogit = parseInt(measrMatch[0])

    // Candidate density (count asterisks in candidate column)
    if (candEnd <= line.length && measrEnd < candEnd) {
      const candSection = line.slice(measrEnd + 1, candEnd)
      const stars = (candSection.match(/\*/g) ?? []).length
      if (stars > 0) densityMap.set(currentLogit, (densityMap.get(currentLogit) ?? 0) + stars)
    }

    // Criteria names (from criteria column)
    if (raterEnd > 0 && critEnd > raterEnd && critEnd <= line.length) {
      const critSection = line.slice(raterEnd + 1, critEnd).replace(/[|+*:]/g, ' ').trim()
      if (critSection) {
        // Split on 2+ spaces to separate multiple criteria on same row
        const names = critSection.split(/\s{2,}/).map(n => n.trim())
          .filter(n => n && !/^[-−]+$/.test(n) && !/^[-−]?criteri/i.test(n))
        for (const name of names) {
          if (!criteriaSet.has(name)) {
            criteriaSet.add(name)
            criteria.push({ name, logit: currentLogit })
          }
        }
      }
    }
  }

  const candidateDensity = [...densityMap.entries()]
    .map(([logit, count]) => ({ logit, count }))
    .sort((a, b) => b.logit - a.logit)

  return { criteria, candidateDensity }
}

function parseScaleBoundaries(text: string): ScaleBoundary[] {
  const start = text.search(/Table 8\.1\s+Category Statistics/i)
  if (start < 0) return []
  const lines = text.slice(start, start + 5000).split('\n')
  const out: ScaleBoundary[] = []
  for (const line of lines) {
    // |  3    3470      3470   20%  22%|   .42 ... | -2.68    .06|   -.91   -2.73| ...
    const m = line.match(/^\|\s*(\d+)\s+\d+\s+\d+\s+\d+%/)
    if (!m) continue
    const parts = line.split('|')
    const expectation = nums(parts[4] ?? '') // [measure at category, measure at -0.5]
    if (expectation.length >= 2) out.push({ level: parseInt(m[1]), logit: expectation[1] })
  }
  return out
}

export function parseFacetsOutput(text: string): RaschRun {
  const { raters, meanMeasure, reliability, separation, rmse } = parseTable7(text, 'rater')
  const { criteria: rulerCriteria, candidateDensity } = parseTable6(text)
  const candidateMeasures = parseTable7(text, 'candidate').raters.map(c => c.measure)
  const scaleBoundaries = parseScaleBoundaries(text)

  // Table 7.3.1 has exact criteria measures; Table 6.0 only gives whole-logit rows
  const exactCriteria = parseTable7(text, 'criteria').raters
  const criteria = exactCriteria.length
    ? exactCriteria.map(c => ({ name: c.raterName, logit: c.measure }))
    : rulerCriteria

  return { raters, criteria, candidateDensity, candidateMeasures, scaleBoundaries, meanMeasure, reliability, separation, rmse }
}
