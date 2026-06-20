export interface RaschRater {
  raterNumber: number
  raterName: string
  measure: number
  se: number
  infitMnSq: number
  infitZStd: number
  outfitMnSq: number
  outfitZStd: number
}

export interface RaschCriterion {
  name: string
  logit: number
}

export interface RaschRun {
  raters: RaschRater[]
  criteria: RaschCriterion[]
  candidateDensity: { logit: number; count: number }[]
  meanMeasure: number
  reliability: number
  separation: number
  rmse: number
}

function nums(s: string): number[] {
  return (s.match(/-?[\d]+\.?[\d]*/g) ?? []).map(Number)
}

function parseTable7(text: string): { raters: RaschRater[]; meanMeasure: number; reliability: number; separation: number; rmse: number } {
  const raters: RaschRater[] = []
  let meanMeasure = 0, reliability = 0, separation = 0, rmse = 0

  // Find Table 7 section
  const t7Start = text.search(/Table 7\.\d+\.\d+\s+rater Measurement Report/i)
  if (t7Start < 0) return { raters, meanMeasure, reliability, separation, rmse }

  const section = text.slice(t7Start, t7Start + 50000)
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
    // End of table
    if (line.trim().startsWith('+---') && i > headerIdx + 5) break
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
        const names = critSection.split(/\s{2,}/).map(n => n.trim()).filter(Boolean)
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

export function parseFacetsOutput(text: string): RaschRun {
  const { raters, meanMeasure, reliability, separation, rmse } = parseTable7(text)
  const { criteria, candidateDensity } = parseTable6(text)
  return { raters, criteria, candidateDensity, meanMeasure, reliability, separation, rmse }
}
