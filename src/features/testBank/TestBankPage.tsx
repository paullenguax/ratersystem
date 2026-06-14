import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Plus, Play, Square, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Test } from '@/types'
import { TestDrawer } from './TestDrawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchTests(): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Test)
}

export function TestBankPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setLicenceFilter] = useState<'all' | Test['testType']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Test['status']>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTest, setSelectedTest] = useState<Test | undefined>()
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'testId', desc: false }])

  const { data: tests = [], isLoading } = useQuery({ queryKey: ['tests'], queryFn: fetchTests })

  const filtered = useMemo(() => tests.filter(t => {
    const s = search.toLowerCase()
    return (
      (s === '' || t.candidateName.toLowerCase().includes(s) || t.candidateNationality.toLowerCase().includes(s)) &&
      (typeFilter === 'all' || t.testType === typeFilter) &&
      (statusFilter === 'all' || t.status === statusFilter)
    )
  }), [tests, search, typeFilter, statusFilter])

  const columns: ColumnDef<Test>[] = [
    {
      accessorKey: 'testId',
      header: '#',
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs font-mono">
          {row.original.testId ?? '—'}
        </span>
      ),
    },
    { accessorKey: 'candidateName', header: 'Candidate' },
    { accessorKey: 'candidateNationality', header: 'Nationality' },
    {
      accessorKey: 'testType',
      header: 'Test type',
      cell: ({ row }) => <Badge variant="outline">{row.original.testType}</Badge>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'audio',
      cell: ({ row }) => {
        const isPlaying = playingUrl === row.original.recordingUrl
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPlayingUrl(isPlaying ? null : row.original.recordingUrl)}
          >
            {isPlaying ? <Square className="size-4" /> : <Play className="size-4" />}
          </Button>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSelectedTest(row.original); setDrawerOpen(true) }}
        >
          Edit
        </Button>
      ),
    },
  ]

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Test Bank</h1>
        <Button onClick={() => { setSelectedTest(undefined); setDrawerOpen(true) }}>
          <Plus className="size-4 mr-2" /> Add test
        </Button>
      </div>

      {playingUrl && (
        <audio controls autoPlay src={playingUrl} className="w-full" onEnded={() => setPlayingUrl(null)} />
      )}

      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search candidate or nationality…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={typeFilter} onValueChange={v => setLicenceFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="PPL">PPL</SelectItem>
            <SelectItem value="Airline Pilot">Airline Pilot</SelectItem>
            <SelectItem value="Helicopter Pilot">Helicopter Pilot</SelectItem>
            <SelectItem value="Student Pilot">Student Pilot</SelectItem>
            <SelectItem value="Aerodrome ATC">Aerodrome ATC</SelectItem>
            <SelectItem value="Approach ATC">Approach ATC</SelectItem>
            <SelectItem value="Area ATC">Area ATC</SelectItem>
            <SelectItem value="Student ATCO">Student ATCO</SelectItem>
            <SelectItem value="Airport Operations">Airport Operations</SelectItem>
            <SelectItem value="ADP Driver">ADP Driver</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-md border">
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
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {canSort && (sorted === 'asc' ? <ChevronUp className="size-3" /> : sorted === 'desc' ? <ChevronDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />)}
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
                    No tests found.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map(row => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <TestDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} test={selectedTest} />
    </div>
  )
}
