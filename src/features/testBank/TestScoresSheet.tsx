import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Test, Score, Person } from '@/types'
import { formatTestNumber } from '@/lib/testNumber'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const DIMS = [
  { key: 'pronunciation', abbr: 'PRO' },
  { key: 'structure',     abbr: 'STR' },
  { key: 'vocabulary',    abbr: 'VOC' },
  { key: 'fluency',       abbr: 'FLU' },
  { key: 'comprehension', abbr: 'COM' },
  { key: 'interactions',  abbr: 'INT' },
] as const

const COLS = [...DIMS.map(d => d.key), 'overallLevel'] as const
type Col = (typeof COLS)[number]

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// A score a full level or more away from what most raters gave
function cellClass(value: number, med: number) {
  if (value - med >= 1) return 'bg-blue-100 text-blue-900 font-semibold'
  if (med - value >= 1) return 'bg-amber-100 text-amber-900 font-semibold'
  return ''
}

// Who gave what to one recording — opened from the Test Bank's Level column.
export function TestScoresSheet({ open, onClose, test }: { open: boolean; onClose: () => void; test?: Test }) {
  const { data: scores = [], isLoading } = useQuery({
    queryKey: ['scores', 'byTest', test?.id],
    enabled: open && !!test,
    queryFn: async () =>
      (await getDocs(query(collection(db, 'scores'), where('testDocId', '==', test!.id))))
        .docs.map(d => ({ id: d.id, ...d.data() }) as Score),
  })
  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    enabled: open,
    queryFn: async () =>
      (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person),
  })

  const seniorIds = useMemo(
    () => new Set(people.filter(p => p.role === 'senior_rater' || p.role === 'admin').map(p => p.id)),
    [people],
  )

  const medians = useMemo(() => {
    if (!scores.length) return null
    return Object.fromEntries(COLS.map(c => [c, median(scores.map(s => s[c]))])) as Record<Col, number>
  }, [scores])

  const seniorMedians = useMemo(() => {
    const senior = scores.filter(s => seniorIds.has(s.raterId))
    if (!senior.length) return null
    return { count: senior.length, values: Object.fromEntries(COLS.map(c => [c, median(senior.map(s => s[c]))])) as Record<Col, number> }
  }, [scores, seniorIds])

  const levelCounts = useMemo(() => {
    const counts = new Map<number, number>()
    scores.forEach(s => counts.set(s.overallLevel, (counts.get(s.overallLevel) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[0] - a[0])
  }, [scores])

  // Lowest overall first, seniors ahead of trainees within a level
  const rows = useMemo(() => [...scores].sort((a, b) =>
    a.overallLevel - b.overallLevel ||
    Number(seniorIds.has(b.raterId)) - Number(seniorIds.has(a.raterId)) ||
    a.raterName.localeCompare(b.raterName)), [scores, seniorIds])

  const disagree = !!test && ((test.calibratedInfit ?? 1) > 1.3 || (test.calibratedOutfit ?? 1) > 1.3)

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {test && <>Scores for {test.testId != null && <span className="font-mono">{formatTestNumber(test.testId, test.category)} </span>}{test.candidateName}</>}
          </SheetTitle>
        </SheetHeader>

        {test && (
          <div className="px-4 pb-6 space-y-4">
            <p className="text-xs text-muted-foreground">
              {test.testType}
              {test.calibratedLevel != null && (
                <> · calibrated level <span className="font-semibold text-foreground">{test.calibratedLevel}</span>
                  {' '}(fair avg {test.calibratedFairAvg?.toFixed(2)}, {test.calibratedRaters} raters)
                  {' '}· infit {test.calibratedInfit?.toFixed(2)} / outfit {test.calibratedOutfit?.toFixed(2)}
                  {disagree && <span className="text-red-700"> ⚠ disagree</span>}
                </>
              )}
            </p>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading scores…</p>
            ) : !scores.length ? (
              <p className="text-sm text-muted-foreground">No scores recorded for this test yet.</p>
            ) : (<>
              {/* Overall level spread */}
              <div className="space-y-1">
                <p className="text-sm font-medium">Overall level awarded ({scores.length} rating{scores.length !== 1 ? 's' : ''})</p>
                {levelCounts.map(([level, count]) => (
                  <div key={level} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0">Level {level}</span>
                    <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary/70" style={{ width: `${(count / scores.length) * 100}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-muted-foreground">{count} ({Math.round((count / scores.length) * 100)}%)</span>
                  </div>
                ))}
              </div>

              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground">
                      <th className="text-left px-2 py-1.5 font-medium">Rater</th>
                      <th className="text-left px-2 py-1.5 font-medium">Event</th>
                      {DIMS.map(d => <th key={d.key} className="text-center px-1.5 py-1.5 font-medium">{d.abbr}</th>)}
                      <th className="text-center px-2 py-1.5 font-medium">Overall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medians && (
                      <tr className="border-b bg-muted/20 font-medium">
                        <td className="px-2 py-1.5" colSpan={2}>Median, all raters</td>
                        {COLS.map(c => <td key={c} className="text-center px-1.5 py-1.5 font-mono">{medians[c]}</td>)}
                      </tr>
                    )}
                    {seniorMedians && (
                      <tr className="border-b bg-muted/20 font-medium">
                        <td className="px-2 py-1.5" colSpan={2}>Median, senior raters ({seniorMedians.count})</td>
                        {COLS.map(c => <td key={c} className="text-center px-1.5 py-1.5 font-mono">{seniorMedians.values[c]}</td>)}
                      </tr>
                    )}
                    {rows.map(s => (
                      <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {s.raterName}
                          {seniorIds.has(s.raterId) && <span className="ml-1.5 text-[10px] font-medium px-1 py-px rounded bg-primary/10 text-primary">Senior</span>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {s.sessionName}
                          {!s.published && <span className="ml-1 italic">(unpublished)</span>}
                        </td>
                        {COLS.map(c => (
                          <td key={c} className={`text-center px-1.5 py-1.5 font-mono ${medians ? cellClass(s[c], medians[c]) : ''}`}>{s[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                Highlighted scores are a full level or more away from the all-rater median for that column:{' '}
                <span className="px-1 rounded bg-blue-100 text-blue-900">higher</span>{' '}
                <span className="px-1 rounded bg-amber-100 text-amber-900">lower</span>.
                Unpublished scores only count towards the calibration when their event is included in a Rasch run.
              </p>
            </>)}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
