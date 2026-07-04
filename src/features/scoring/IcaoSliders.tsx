import { useState } from 'react'
import { Info } from 'lucide-react'
import { ICAO_DESCRIPTIONS, LEVEL_LABELS } from '@/lib/icaoDescriptions'

export type DimScores = [number | null, number | null, number | null, number | null, number | null, number | null]

export const DIMENSIONS = [
  { key: 'pronunciation' as const, label: 'Pronunciation' },
  { key: 'structure'     as const, label: 'Structure' },
  { key: 'vocabulary'    as const, label: 'Vocabulary' },
  { key: 'fluency'       as const, label: 'Fluency' },
  { key: 'comprehension' as const, label: 'Comprehension' },
  { key: 'interactions'  as const, label: 'Interactions' },
]

function DimTooltip({ label, level }: { label: string; level: number }) {
  const [show, setShow] = useState(false)
  const desc = ICAO_DESCRIPTIONS[label]?.[level]
  if (!desc) return null
  return (
    <div className="relative inline-block ml-1">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground transition-colors align-middle"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <Info className="size-3.5" />
      </button>
      {show && (
        <div className="absolute z-50 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl -top-2 left-5 pointer-events-none leading-relaxed">
          <p className="font-semibold mb-1">Level {level} — {label}</p>
          {desc}
        </div>
      )}
    </div>
  )
}

interface Props {
  scores: DimScores
  onChange: (scores: DimScores) => void
  showErrors?: boolean
}

export function IcaoSliders({ scores, onChange, showErrors = false }: Props) {
  return (
    <div className="space-y-3">
      {DIMENSIONS.map((dim, i) => {
        const val = scores[i]
        const touched = val !== null
        const hasError = showErrors && !touched
        return (
          <div
            key={dim.key}
            className={`rounded-lg border-2 p-3 pb-5 transition-all ${
              hasError ? 'border-red-400 bg-red-50' : 'border-border hover:bg-muted/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">{dim.label}</span>
                {touched && val !== null && <DimTooltip label={dim.label} level={val} />}
              </div>
              <span className={`text-lg font-bold ${
                !touched       ? 'text-muted-foreground/30'
                : val! <= 3   ? 'text-red-600'
                : val! >= 5   ? 'text-green-700'
                : 'text-blue-700'
              }`}>
                {touched ? val : '—'}
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <input
                type="range"
                min="1"
                max="6"
                value={val ?? 4}
                onChange={e => {
                  const next = [...scores] as DimScores
                  next[i] = parseInt(e.target.value)
                  onChange(next)
                }}
                className="w-full h-2 rounded-lg cursor-pointer accent-primary"
              />
              <input
                type="number"
                min="1"
                max="6"
                value={touched ? val! : ''}
                onChange={e => {
                  const next = [...scores] as DimScores
                  next[i] = Math.min(6, Math.max(1, parseInt(e.target.value) || 1))
                  onChange(next)
                }}
                className="w-14 text-center border border-input rounded-md p-1 text-sm focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 mr-[3.75rem]">
              {LEVEL_LABELS.map(l => <span key={l}>{l}</span>)}
            </div>
            {hasError && (
              <p className="text-red-600 text-xs mt-2">Please rate this criterion</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
