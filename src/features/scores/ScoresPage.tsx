import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { Plus, Download, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Score, Person } from '@/types'
import { ScoreDrawer } from './ScoreDrawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// ── helpers ────────────────────────────────────────────────────────────────

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

// ── Rasch export ───────────────────────────────────────────────────────────

function exportRaschCSV(scores: Score[], includeUnpublished: boolean, people: Person[]) {
  const rows = scores.filter(s => {
    if (!includeUnpublished && !s.published) return false
    return s.testNumber != null
  })

  // Use permanent rater numbers where set; fall back to alphabetical index
  const permanentNum = new Map(people.filter(p => p.raterNumber).map(p => [p.id, p.raterNumber!]))
  const raterNames = [...new Set(rows.map(s => s.raterName))].sort((a, b) => a.localeCompare(b))
  let fallbackIdx = Math.max(0, ...permanentNum.values()) + 1
  const raterIdByName = new Map(rows.map(s => [s.raterName, s.raterId]))
  const raterNum = new Map(raterNames.map(name => {
    const id = raterIdByName.get(name) ?? ''
    const n = permanentNum.get(id) ?? fallbackIdx++
    return [name, n] as [string, number]
  }))

  const lines: string[] = [
    `! Rasch export — ${new Date().toISOString().split('T')[0]}`,
    `! ${rows.length} observations · ${raterNames.length} raters`,
    `! Published only: ${!includeUnpublished}`,
    `!`,
    `! Rater key:`,
    ...raterNames.map(name => `! ${raterNum.get(name)}\t${name}`),
    `!`,
    ['candidate', 'rater', '1-6a', 'varPronunciation', 'varStructure',
      'varVocabulary', 'varFluency', 'varComprehension', 'varInteraction'].join('\t'),
    ...rows.map(s => [
      s.testNumber,
      raterNum.get(s.raterName),
      '1-6a',
      s.pronunciation, s.structure, s.vocabulary,
      s.fluency, s.comprehension, s.interactions,
    ].join('\t')),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = includeUnpublished ? 'rasch-all.csv' : 'rasch.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── data ───────────────────────────────────────────────────────────────────

async function fetchScores(): Promise<Score[]> {
  const snap = await getDocs(collection(db, 'scores'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Score)
    .sort((a, b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0))
}

// ── page ───────────────────────────────────────────────────────────────────

export function ScoresPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Score | undefined>()
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [includeUnpublished, setIncludeUnpublished] = useState(false)

  const { data: scores = [], isLoading } = useQuery({ queryKey: ['scores'], queryFn: fetchScores })
  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person),
  })

  function openAdd() { setSelected(undefined); setDrawerOpen(true) }
  function openEdit(s: Score) { setSelected(s); setDrawerOpen(true) }

  const columns: ColumnDef<Score>[] = [
    {
      id: 'sessionName',
      accessorKey: 'sessionName',
      header: 'Event',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-sm">{getValue() as string}</span>
      ),
    },
    {
      id: 'raterName',
      accessorKey: 'raterName',
      header: 'Rater',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      id: 'testNumber',
      accessorKey: 'testNumber',
      header: 'Test',
      sortingFn: 'alphanumeric',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.testNumber
            ? <span className="font-mono text-xs mr-1">#{row.original.testNumber}</span>
            : null}
          {row.original.candidateName}
        </span>
      ),
    },
    ...DIMS.map(d => ({
      id: d.key,
      accessorKey: d.key,
      header: d.abbr,
      meta: { label: d.label },
      cell: ({ getValue }: { getValue: () => unknown }) => (
        <span className={`font-mono ${levelColour(getValue() as number)}`}>
          {getValue() as number}
        </span>
      ),
    } as ColumnDef<Score>)),
    {
      id: 'overallLevel',
      accessorKey: 'overallLevel',
      header: 'OVL',
      cell: ({ getValue }) => (
        <span className={`font-mono font-bold ${levelColour(getValue() as number)}`}>
          {getValue() as number}
        </span>
      ),
    },
    {
      id: 'published',
      accessorKey: 'published',
      header: 'Status',
      sortingFn: (a, b) => Number(a.original.published) - Number(b.original.published),
      cell: ({ getValue }) => (
        getValue()
          ? <span className="text-xs text-muted-foreground">Published</span>
          : <span className="text-xs text-amber-700">Unpublished</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        row.original.published
          ? null
          : <Button variant="ghost" size="sm" onClick={() => openEdit(row.original)}>Edit</Button>
      ),
    },
  ]

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return scores
    return scores.filter(s =>
      s.raterName.toLowerCase().includes(q) ||
      s.candidateName.toLowerCase().includes(q) ||
      s.sessionName.toLowerCase().includes(q)
    )
  }, [scores, search])

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const publishedCount = scores.filter(s => s.published).length
  const unpublishedCount = scores.length - publishedCount

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scores</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportRaschCSV(scores, includeUnpublished, people)}
            disabled={scores.length === 0}
          >
            <Download className="size-4 mr-2" />
            Export Rasch CSV
          </Button>
          <Button onClick={openAdd}>
            <Plus className="size-4 mr-2" /> Add score
          </Button>
        </div>
      </div>

      {/* Search + export options */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search rater, candidate, session…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {unpublishedCount > 0 && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeUnpublished}
              onChange={e => setIncludeUnpublished(e.target.checked)}
              className="rounded"
            />
            <span>
              Include unpublished in export
              <span className="text-muted-foreground ml-1">({unpublishedCount} scores)</span>
            </span>
          </label>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {scores.length} scores
          {' · '}{publishedCount} published
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scores recorded yet.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(hg => (
                <TableRow key={hg.id}>
                  {hg.headers.map(h => {
                    const canSort = h.column.getCanSort()
                    const sorted = h.column.getIsSorted()
                    return (
                      <TableHead
                        key={h.id}
                        onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                        className={canSort ? 'cursor-pointer select-none' : ''}
                        title={(h.column.columnDef.meta as any)?.label}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {canSort && (
                            sorted === 'asc' ? <ChevronUp className="size-3" />
                            : sorted === 'desc' ? <ChevronDown className="size-3" />
                            : <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                    No scores match your search.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map(row => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id} className="text-center first:text-left last:text-right [&:nth-child(-n+3)]:text-left">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <ScoreDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} score={selected} />
    </div>
  )
}
