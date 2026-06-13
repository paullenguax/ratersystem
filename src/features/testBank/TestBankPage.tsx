import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { Plus, Play, Square } from 'lucide-react'
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
  const [licenceFilter, setLicenceFilter] = useState<'all' | Test['licenceType']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Test['status']>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTest, setSelectedTest] = useState<Test | undefined>()
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)

  const { data: tests = [], isLoading } = useQuery({ queryKey: ['tests'], queryFn: fetchTests })

  const filtered = useMemo(() => tests.filter(t => {
    const s = search.toLowerCase()
    return (
      (s === '' || t.candidateName.toLowerCase().includes(s) || t.candidateNationality.toLowerCase().includes(s)) &&
      (licenceFilter === 'all' || t.licenceType === licenceFilter) &&
      (statusFilter === 'all' || t.status === statusFilter)
    )
  }), [tests, search, licenceFilter, statusFilter])

  const columns: ColumnDef<Test>[] = [
    { accessorKey: 'candidateName', header: 'Candidate' },
    { accessorKey: 'candidateNationality', header: 'Nationality' },
    {
      accessorKey: 'licenceType',
      header: 'Licence',
      cell: ({ row }) => <Badge variant="outline">{row.original.licenceType}</Badge>,
    },
    {
      accessorKey: 'promptType',
      header: 'Prompt',
      cell: ({ row }) => <span className="capitalize">{row.original.promptType}</span>,
    },
    {
      accessorKey: 'targetLevel',
      header: 'Level',
      cell: ({ row }) => <span>L{row.original.targetLevel}</span>,
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

  const table = useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() })

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
        <Select value={licenceFilter} onValueChange={v => setLicenceFilter(v as typeof licenceFilter)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All licences" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All licences</SelectItem>
            <SelectItem value="PPL">PPL</SelectItem>
            <SelectItem value="CPL">CPL</SelectItem>
            <SelectItem value="ATPL">ATPL</SelectItem>
            <SelectItem value="ATC">ATC</SelectItem>
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
                  {hg.headers.map(h => (
                    <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                  ))}
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
