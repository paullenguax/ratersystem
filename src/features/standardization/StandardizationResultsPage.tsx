import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StandardizationScore } from '@/types'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const DIMS: { key: keyof StandardizationScore; abbr: string; label: string }[] = [
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

async function fetchStandardizationScores(): Promise<StandardizationScore[]> {
  const snap = await getDocs(collection(db, 'standardization_scores'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as StandardizationScore)
    .sort((a, b) => ((b.createdAt as any)?.seconds ?? 0) - ((a.createdAt as any)?.seconds ?? 0))
}

export function StandardizationResultsPage() {
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])

  const { data: scores = [], isLoading } = useQuery({
    queryKey: ['standardization-scores'],
    queryFn: fetchStandardizationScores,
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return scores
    return scores.filter(s =>
      s.raterName.toLowerCase().includes(q) ||
      s.candidateName.toLowerCase().includes(q) ||
      s.sessionName.toLowerCase().includes(q)
    )
  }, [scores, search])

  const columns: ColumnDef<StandardizationScore>[] = [
    {
      id: 'sessionName',
      accessorKey: 'sessionName',
      header: 'Event',
      cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{getValue() as string}</span>,
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
    } as ColumnDef<StandardizationScore>)),
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
      id: 'comments',
      accessorKey: 'comments',
      header: 'Comments',
      enableSorting: false,
      cell: ({ getValue }) => {
        const text = (getValue() as string) ?? ''
        return (
          <span className="text-muted-foreground text-sm truncate max-w-xs block" title={text}>
            {text}
          </span>
        )
      },
    },
  ]

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Standardization Results</h1>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search rater, candidate, event…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {scores.length} results
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-sm text-muted-foreground">No standardization results recorded yet.</p>
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
                    No results match your search.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map(row => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id} className="text-center first:text-left last:text-left [&:nth-child(-n+3)]:text-left">
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
    </div>
  )
}
