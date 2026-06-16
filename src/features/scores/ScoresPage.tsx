import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Score } from '@/types'
import { ScoreDrawer } from './ScoreDrawer'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const DIMS: { key: keyof Score; abbr: string; label: string }[] = [
  { key: 'pronunciation',  abbr: 'PRO', label: 'Pronunciation' },
  { key: 'structure',      abbr: 'STR', label: 'Structure' },
  { key: 'vocabulary',     abbr: 'VOC', label: 'Vocabulary' },
  { key: 'fluency',        abbr: 'FLU', label: 'Fluency' },
  { key: 'comprehension',  abbr: 'COM', label: 'Comprehension' },
  { key: 'interactions',   abbr: 'INT', label: 'Interactions' },
]

function levelColour(n: number) {
  if (n >= 5) return 'text-green-700'
  if (n === 4) return 'text-blue-700'
  if (n === 3) return 'text-amber-700'
  return 'text-red-700'
}

async function fetchScores(): Promise<Score[]> {
  const snap = await getDocs(collection(db, 'scores'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Score)
    .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds)
}

export function ScoresPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Score | undefined>()

  const { data: scores = [], isLoading } = useQuery({ queryKey: ['scores'], queryFn: fetchScores })

  function openAdd() { setSelected(undefined); setDrawerOpen(true) }
  function openEdit(s: Score) { setSelected(s); setDrawerOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scores</h1>
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" /> Add score
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scores recorded yet.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Rater</TableHead>
                <TableHead>Test</TableHead>
                {DIMS.map(d => (
                  <TableHead key={d.key} title={d.label} className="text-center w-12">{d.abbr}</TableHead>
                ))}
                <TableHead className="text-center w-12">OVL</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scores.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="text-muted-foreground text-sm">{s.sessionName}</TableCell>
                  <TableCell className="font-medium">{s.raterName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.testNumber ? <span className="font-mono text-xs mr-1">#{s.testNumber}</span> : null}
                    {s.candidateName}
                  </TableCell>
                  {DIMS.map(d => (
                    <TableCell key={d.key} className={`text-center font-mono ${levelColour(s[d.key] as number)}`}>
                      {s[d.key] as number}
                    </TableCell>
                  ))}
                  <TableCell className={`text-center font-bold ${levelColour(s.overallLevel)}`}>
                    {s.overallLevel}
                  </TableCell>
                  <TableCell>
                    {s.published
                      ? <span className="text-xs text-muted-foreground px-2">Published</span>
                      : <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                    }
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ScoreDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} score={selected} />
    </div>
  )
}
