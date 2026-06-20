import { forwardRef } from 'react'
import type { RaschCriterion } from '@/lib/parseFacets'

interface Props {
  raterName: string
  raterNumber: number
  measure: number
  se: number
  meanMeasure: number
  candidateDensity: { logit: number; count: number }[]
  criteria: RaschCriterion[]
}

const W = 340
const H = 520
const PAD_TOP = 24
const PAD_BOT = 24
const AXIS_X = 130       // x position of the logit axis line
const CAND_MAX_W = 60    // max candidate bar width (extends left from axis)
const DOT_X = 165        // x of rater dot
const CRIT_X = 185       // x of criteria labels

const MIN_LOGIT = -3
const MAX_LOGIT = 6

function logitToY(logit: number): number {
  const range = MAX_LOGIT - MIN_LOGIT
  const frac = (MAX_LOGIT - logit) / range
  return PAD_TOP + frac * (H - PAD_TOP - PAD_BOT)
}

// ICAO scale thresholds (approximate logit boundaries from typical Lenguax runs)
const ICAO_BANDS = [
  { level: 6, minLogit: 5,   colour: '#dcfce7' },
  { level: 5, minLogit: 3,   colour: '#f0fdf4' },
  { level: 4, minLogit: 1,   colour: '#eff6ff' },
  { level: 3, minLogit: -1,  colour: '#fefce8' },
  { level: 2, minLogit: -3,  colour: '#fef2f2' },
]

export const WrightMap = forwardRef<SVGSVGElement, Props>(function WrightMap(
  { raterName, raterNumber, measure, se, meanMeasure, candidateDensity, criteria },
  ref,
) {
  const maxDensity = Math.max(1, ...candidateDensity.map(d => d.count))

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ fontFamily: 'system-ui, sans-serif', background: '#ffffff' }}
    >
      {/* ICAO background bands */}
      {ICAO_BANDS.map((band, i) => {
        const yBot = logitToY(band.minLogit)
        const actualTop = logitToY(i === 0 ? MAX_LOGIT : ICAO_BANDS[i - 1].minLogit)
        return (
          <rect
            key={band.level}
            x={0} y={actualTop}
            width={W} height={yBot - actualTop}
            fill={band.colour}
          />
        )
      })}

      {/* Logit axis */}
      <line x1={AXIS_X} y1={PAD_TOP} x2={AXIS_X} y2={H - PAD_BOT} stroke="#94a3b8" strokeWidth={1.5} />

      {/* Tick marks and logit labels */}
      {Array.from({ length: MAX_LOGIT - MIN_LOGIT + 1 }, (_, i) => MIN_LOGIT + i).map(l => {
        const y = logitToY(l)
        const isMajor = l % 1 === 0
        return (
          <g key={l}>
            <line x1={AXIS_X - 4} y1={y} x2={AXIS_X + 4} y2={y} stroke="#64748b" strokeWidth={isMajor ? 1.5 : 0.5} />
            <text x={AXIS_X - 8} y={y + 4} textAnchor="end" fontSize={9} fill="#64748b">{l}</text>
          </g>
        )
      })}

      {/* Axis label */}
      <text x={AXIS_X} y={PAD_TOP - 10} textAnchor="middle" fontSize={9} fill="#64748b">logit</text>

      {/* Candidate density bars (extend left from axis) */}
      {candidateDensity.map(({ logit, count }) => {
        const y = logitToY(logit)
        const barW = (count / maxDensity) * CAND_MAX_W
        return (
          <rect
            key={logit}
            x={AXIS_X - barW} y={y - 4}
            width={barW} height={8}
            fill="#3b82f6" opacity={0.25} rx={2}
          />
        )
      })}

      {/* Candidate label */}
      <text x={AXIS_X - CAND_MAX_W / 2} y={PAD_TOP - 10} textAnchor="middle" fontSize={9} fill="#94a3b8">
        candidates
      </text>

      {/* Mean rater reference line */}
      <line
        x1={AXIS_X - 12} y1={logitToY(meanMeasure)}
        x2={DOT_X + 20}  y2={logitToY(meanMeasure)}
        stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3"
      />
      <text x={DOT_X + 22} y={logitToY(meanMeasure) + 4} fontSize={8} fill="#94a3b8">mean</text>

      {/* SE bar */}
      {(() => {
        const yMid  = logitToY(measure)
        const yHigh = logitToY(measure + se)
        const yLow  = logitToY(measure - se)
        return (
          <g>
            <line x1={DOT_X} y1={yHigh} x2={DOT_X} y2={yLow} stroke="#ef4444" strokeWidth={2} />
            <line x1={DOT_X - 6} y1={yHigh} x2={DOT_X + 6} y2={yHigh} stroke="#ef4444" strokeWidth={2} />
            <line x1={DOT_X - 6} y1={yLow}  x2={DOT_X + 6} y2={yLow}  stroke="#ef4444" strokeWidth={2} />
            {/* Dot */}
            <circle cx={DOT_X} cy={yMid} r={6} fill="#ef4444" />
            <text x={DOT_X} y={yMid + 4} textAnchor="middle" fontSize={8} fill="white" fontWeight="bold">
              {raterNumber}
            </text>
            {/* Name label */}
            <text x={DOT_X + 14} y={yMid - 8} fontSize={9} fill="#1e293b" fontWeight="bold">
              {raterName.split(' ')[0]}
            </text>
            <text x={DOT_X + 14} y={yMid + 4} fontSize={9} fill="#475569">
              {measure > 0 ? '+' : ''}{measure.toFixed(2)} ±{se.toFixed(2)}
            </text>
          </g>
        )
      })()}

      {/* Criteria labels */}
      {criteria.map(c => {
        const y = logitToY(c.logit)
        return (
          <g key={c.name}>
            <line x1={AXIS_X - 2} y1={y} x2={CRIT_X - 4} y2={y} stroke="#d1d5db" strokeWidth={0.5} strokeDasharray="2 2" />
            <text x={CRIT_X} y={y + 4} fontSize={8} fill="#6b7280">{c.name}</text>
          </g>
        )
      })}

      {/* ICAO level labels on right */}
      {ICAO_BANDS.map((band, i) => {
        const topLogit = i === 0 ? MAX_LOGIT : ICAO_BANDS[i - 1].minLogit
        const midLogit = (topLogit + band.minLogit) / 2
        const y = logitToY(midLogit)
        return (
          <text key={band.level} x={W - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af" fontWeight="bold">
            L{band.level}
          </text>
        )
      })}
    </svg>
  )
})
