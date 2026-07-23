import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { Plus, ListVideo, FileText, Blocks } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StorylineTest } from '@/types'
import { StorylineTestDrawer } from './StorylineTestDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

async function fetchStorylineTests(): Promise<StorylineTest[]> {
  const snap = await getDocs(collection(db, 'storyline_tests'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylineTest)
}

export function StorylineTestsPage() {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTest, setSelectedTest] = useState<StorylineTest | undefined>()

  const { data: tests = [], isLoading } = useQuery({ queryKey: ['storyline_tests'], queryFn: fetchStorylineTests })

  const columns: ColumnDef<StorylineTest>[] = [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => <span className="text-muted-foreground text-sm">{row.original.description || '—'}</span>,
    },
    {
      accessorKey: 'active',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.active ? 'default' : 'secondary'}>
          {row.original.active ? 'active' : 'inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/test-versions/${row.original.id}`)}
          >
            <ListVideo className="size-4 mr-1" /> Versions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedTest(row.original); setDrawerOpen(true) }}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ]

  const table = useReactTable({ data: tests, columns, getCoreRowModel: getCoreRowModel() })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Storyline Tests</h1>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/template" />}>
            <FileText className="size-4 mr-2" /> Script Template
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/parts" />}>
            <Blocks className="size-4 mr-2" /> Parts Library
          </Button>
          <Button onClick={() => { setSelectedTest(undefined); setDrawerOpen(true) }}>
            <Plus className="size-4 mr-2" /> Add test
          </Button>
        </div>
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
                    <TableHead key={h.id}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                    No storyline tests yet.
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

      <StorylineTestDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} test={selectedTest} />
    </div>
  )
}
