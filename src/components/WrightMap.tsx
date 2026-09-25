import { forwardRef } from 'react'
import type { RaschCriterion, ScaleBoundary } from '@/lib/parseFacets'

interface Props {
  raterName: string
  raterNumber: number
  measure: number
  se: number
  meanMeasure: number
  raterMeasures: number[]                 // every rater in the run — the population to compare against
  candidateMeasures?: number[]            // exact (Table 7.1.1); older runs only have candidateDensity
  candidateDensity: { logit: number; count: number }[]
  criteria: RaschCriterion[]
  scaleBoundaries?: ScaleBoundary[]
  previous?: { raterNumber: string; measure: number } // returning rater's earlier certification
}

const W = 690
const H = 680
const TOP = 62
const BOT = 44

const AXIS_X = 40
const CAND_X0 = 48, CAND_MAX = 100
const RATER_X0 = 176, RATER_MAX = 150
const MARK_X = 344, LABEL_X = 360
const CRIT_X0 = 530, CRIT_LABEL_X = 546
const SCALE_X0 = 630, SCALE_W = 56

const RATER_BIN = 0.25
const CAND_BIN = 0.5

// Fallback for runs imported before Table 8.1 was parsed
const DEFAULT_BOUNDARIES: ScaleBoundary[] = [
  { level: 3, logit: -1 }, { level: 4, logit: 1 }, { level: 5, logit: 3 }, { level: 6, logit: 5 },
]
const LEVEL_COLOUR: Record<number, string> = {
  1: '#fecaca', 2: '#fee2e2', 3: '#fef9c3', 4: '#dbeafe', 5: '#d1fae5', 6: '#bbf7d0',
}

function bin(values: number[], width: number): Map<number, number> {
  const m = new Map<number, number>()
  for (const v of values) {
    const i = Math.floor(v / width + 1e-9)
    m.set(i, (m.get(i) ?? 0) + 1)
  }
  return m
}

// Nudges label positions apart (min `gap` px) while keeping each cluster
// centred on where its labels actually belong
function spread(desired: number[], gap: number, minY: number, maxY: number): number[] {
  const order = desired.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  type Cluster = { idx: number[]; start: number }
  const clusters: Cluster[] = []
  for (const { y, i } of order) {
    clusters.push({ idx: [i], start: y })
    while (clusters.length > 1) {
      const cur = clusters[clusters.length - 1]
      const prev = clusters[clusters.length - 2]
      if (prev.start + prev.idx.length * gap <= cur.start) break
      const idx = [...prev.idx, ...cur.idx]
      const centre = idx.reduce((s, k) => s + desired[k], 0) / idx.length
      clusters.splice(-2, 2, { idx, start: centre - ((idx.length - 1) * gap) / 2 })
    }
  }
  const out = new Array<number>(desired.length)
  for (const c of clusters) {
    const start = Math.min(Math.max(c.start, minY), maxY - (c.idx.length - 1) * gap)
    c.idx.forEach((k, j) => { out[k] = start + j * gap })
  }
  return out
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`

export const WrightMap = forwardRef<SVGSVGElement, Props>(function WrightMap(
  { raterName, raterNumber, measure, se, meanMeasure, raterMeasures, candidateMeasures,
    candidateDensity, criteria, scaleBoundaries, previous },
  ref,
) {
  const hasExactCandidates = !!candidateMeasures?.length
  const candValues = hasExactCandidates ? candidateMeasures! : candidateDensity.map(d => d.logit)

  const all = [
    ...candValues, ...raterMeasures, ...criteria.map(c => c.logit),
    measure + se, measure - se, ...(previous ? [previous.measure] : []),
  ]
  const lo = Math.floor(Math.min(...all))
  const hi = Math.ceil(Math.max(...all))
  const y = (logit: number) => TOP + ((hi - logit) / (hi - lo)) * (H - TOP - BOT)

  // Histograms
  const raterBins = bin(raterMeasures, RATER_BIN)
  const raterMax = Math.max(1, ...raterBins.values())
  const ownBin = Math.floor(measure / RATER_BIN + 1e-9)

  const candBars: { top: number; bottom: number; count: number }[] = hasExactCandidates
    ? [...bin(candidateMeasures!, CAND_BIN)].map(([i, count]) => ({ top: (i + 1) * CAND_BIN, bottom: i * CAND_BIN, count }))
    : candidateDensity.map(d => ({ top: d.logit + 0.25, bottom: d.logit - 0.25, count: d.count }))
  const candMax = Math.max(1, ...candBars.map(b => b.count))

  // ICAO level bands (Scale column), clipped to the visible range
  const bounds = [...(scaleBoundaries?.length ? scaleBoundaries : DEFAULT_BOUNDARIES)].sort((a, b) => a.level - b.level)
  const bands = [{ level: bounds[0].level - 1, logit: -Infinity }, ...bounds].map((b, i, arr) => ({
    level: b.level,
    from: Math.max(b.logit, lo),
    to: Math.min(arr[i + 1]?.logit ?? Infinity, hi),
  })).filter(b => b.to > b.from)

  // Label placement
  const critLabelY = spread(criteria.map(c => y(c.logit)), 13, TOP + 6, H - BOT - 4)
  const markers = [
    { key: 'you', logit: measure },
    ...(previous ? [{ key: 'prev', logit: previous.measure }] : []),
  ]
  const markerLabelY = spread(markers.map(m => y(m.logit)), 30, TOP + 10, H - BOT - 16)

  const pct = Math.round((raterMeasures.filter(m => m < measure).length / Math.max(1, raterMeasures.length)) * 100)

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ fontFamily: 'system-ui, sans-serif', background: '#ffffff' }}
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />

      {/* Column headers */}
      <text x={CAND_X0 + CAND_MAX / 2} y={22} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#334155">Candidates</text>
      <text x={CAND_X0 + CAND_MAX / 2} y={38} textAnchor="middle" fontSize={9} fill="#94a3b8">↑ stronger</text>
      <text x={RATER_X0 + 120} y={22} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#334155">Raters ({raterMeasures.length})</text>
      <text x={RATER_X0 + 120} y={38} textAnchor="middle" fontSize={9} fill="#94a3b8">↑ stricter</text>
      <text x={CRIT_X0 + 40} y={22} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#334155">Criteria</text>
      <text x={CRIT_X0 + 40} y={38} textAnchor="middle" fontSize={9} fill="#94a3b8">↑ harder</text>
      <text x={SCALE_X0 + SCALE_W / 2} y={22} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#334155">ICAO</text>
      <text x={AXIS_X - 6} y={38} textAnchor="end" fontSize={9} fill="#94a3b8">logit</text>
      <text x={RATER_X0 + 120} y={H - BOT + 16} textAnchor="middle" fontSize={9} fill="#94a3b8">↓ more lenient</text>

      {/* Gridlines + axis */}
      {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map(l => (
        <g key={l}>
          <line x1={AXIS_X} y1={y(l)} x2={SCALE_X0} y2={y(l)} stroke="#f1f5f9" strokeWidth={1} />
          <line x1={AXIS_X - 4} y1={y(l)} x2={AXIS_X} y2={y(l)} stroke="#64748b" strokeWidth={1} />
          <text x={AXIS_X - 8} y={y(l) + 3.5} textAnchor="end" fontSize={10} fill="#64748b">{l}</text>
        </g>
      ))}
      <line x1={AXIS_X} y1={TOP} x2={AXIS_X} y2={H - BOT} stroke="#94a3b8" strokeWidth={1.5} />
      {[RATER_X0 - 12, CRIT_X0 - 8].map(x => (
        <line key={x} x1={x} y1={TOP} x2={x} y2={H - BOT} stroke="#e2e8f0" strokeWidth={1} />
      ))}

      {/* Candidates */}
      {candBars.map(b => (
        <rect
          key={b.bottom}
          x={CAND_X0} y={y(b.top) + 0.5}
          width={Math.max(2, (b.count / candMax) * CAND_MAX)} height={Math.max(1, y(b.bottom) - y(b.top) - 1)}
          fill="#64748b" opacity={0.35} rx={1.5}
        />
      ))}

      {/* Raters */}
      {[...raterBins].map(([i, count]) => (
        <rect
          key={i}
          x={RATER_X0} y={y((i + 1) * RATER_BIN) + 0.5}
          width={Math.max(2, (count / raterMax) * RATER_MAX)} height={Math.max(1, y(i * RATER_BIN) - y((i + 1) * RATER_BIN) - 1)}
          fill={i === ownBin ? '#fca5a5' : '#93c5fd'} rx={1.5}
        />
      ))}

      {/* Average rater */}
      <line x1={RATER_X0 - 6} y1={y(meanMeasure)} x2={MARK_X + 8} y2={y(meanMeasure)} stroke="#475569" strokeWidth={1} strokeDasharray="4 3" />
      <text x={RATER_X0 - 14} y={y(meanMeasure) + 3} textAnchor="end" fontSize={8} fill="#475569">avg</text>

      {/* Previous certification (hollow) */}
      {previous && (() => {
        const ly = markerLabelY[1]
        return (
          <g>
            <circle cx={MARK_X - 8} cy={y(previous.measure)} r={5} fill="#ffffff" stroke="#64748b" strokeWidth={2} />
            <line x1={MARK_X - 2} y1={y(previous.measure)} x2={LABEL_X - 4} y2={ly} stroke="#cbd5e1" strokeWidth={0.75} />
            <text x={LABEL_X} y={ly - 2} fontSize={10} fill="#475569">Previously Rater {previous.raterNumber}</text>
            <text x={LABEL_X} y={ly + 11} fontSize={10} fill="#64748b">{signed(previous.measure)}</text>
          </g>
        )
      })()}

      {/* This rater, with ±1 S.E. */}
      {(() => {
        const cy = y(measure), yHi = y(measure + se), yLo = y(measure - se)
        const ly = markerLabelY[0]
        return (
          <g>
            <line x1={MARK_X} y1={yHi} x2={MARK_X} y2={yLo} stroke="#dc2626" strokeWidth={2} />
            <line x1={MARK_X - 5} y1={yHi} x2={MARK_X + 5} y2={yHi} stroke="#dc2626" strokeWidth={2} />
            <line x1={MARK_X - 5} y1={yLo} x2={MARK_X + 5} y2={yLo} stroke="#dc2626" strokeWidth={2} />
            <circle cx={MARK_X} cy={cy} r={5.5} fill="#dc2626" />
            <line x1={MARK_X + 6} y1={cy} x2={LABEL_X - 4} y2={ly} stroke="#fca5a5" strokeWidth={0.75} />
            <text x={LABEL_X} y={ly - 2} fontSize={11} fontWeight="bold" fill="#0f172a">
              {raterName.split(' ')[0]} · Rater {raterNumber}
            </text>
            <text x={LABEL_X} y={ly + 11} fontSize={10} fill="#475569">
              {signed(measure)} ± {se.toFixed(2)} · stricter than {pct}%
            </text>
          </g>
        )
      })()}

      {/* Criteria */}
      {criteria.map((c, i) => (
        <g key={c.name}>
          <circle cx={CRIT_X0} cy={y(c.logit)} r={2.5} fill="#64748b" />
          <line x1={CRIT_X0 + 3} y1={y(c.logit)} x2={CRIT_LABEL_X - 3} y2={critLabelY[i]} stroke="#cbd5e1" strokeWidth={0.75} />
          <text x={CRIT_LABEL_X} y={critLabelY[i] + 3.5} fontSize={10} fill="#475569">{c.name}</text>
        </g>
      ))}

      {/* ICAO level bands */}
      {bands.map(b => (
        <g key={b.level}>
          <rect x={SCALE_X0} y={y(b.to)} width={SCALE_W} height={y(b.from) - y(b.to)} fill={LEVEL_COLOUR[b.level] ?? '#f1f5f9'} />
          <line x1={SCALE_X0} y1={y(b.to)} x2={SCALE_X0 + SCALE_W} y2={y(b.to)} stroke="#ffffff" strokeWidth={1.5} />
          {y(b.from) - y(b.to) > 14 && (
            <text x={SCALE_X0 + SCALE_W / 2} y={(y(b.from) + y(b.to)) / 2 + 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#475569">
              {b.level}
            </text>
          )}
        </g>
      ))}

      {/* Key */}
      <text x={W / 2} y={H - 10} textAnchor="middle" fontSize={9} fill="#94a3b8">
        Rater bars: raters per ¼ logit · dashed line: average rater · red bar: ±1 standard error · ICAO: level expected for an average rater
      </text>
    </svg>
  )
})
