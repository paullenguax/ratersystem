import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, query, where, writeBatch, doc, updateDoc } from 'firebase/firestore'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { Plus, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Assignment, Person } from '@/types'
import { AssignmentDrawer } from './AssignmentDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const STATUS_VARIANT: Record<Assignment['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending:   'secondary',
  submitted: 'default',
  reviewed:  'outline',
  published: 'outline',
}

async function fetchAssignments(): Promise<Assignment[]> {
  const snap = await getDocs(collection(db, 'assignments'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Assignment)
}

async function fetchPeople(): Promise<Person[]> {
  const snap = await getDocs(collection(db, 'people'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Person)
}

export function AssignmentsPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Assignment | undefined>()
  const [publishing, setPublishing] = useState<string | null>(null)
  const [hidePublished, setHidePublished] = useState(true)
  const [seniorOnly, setSeniorOnly] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const queryClient = useQueryClient()

  const { data: assignments = [], isLoading } = useQuery({ queryKey: ['assignments'], queryFn: fetchAssignments })
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })

  const personRole = useMemo(() => {
    const map = new Map<string, Person['role']>()
    people.forEach(p => map.set(p.id, p.role))
    return map
  }, [people])

  function openAdd() { setSelected(undefined); setDrawerOpen(true) }
  function openEdit(a: Assignment) { setSelected(a); setDrawerOpen(true) }

  async function publishAssignment(a: Assignment) {
    if (!window.confirm(`Publish ${a.raterName}'s scores from "${a.sessionName}"?\n\nThis will add all their scores to the main pool. This cannot be undone.`)) return
    setPublishing(a.id)
    try {
      const snap = await getDocs(query(collection(db, 'scores'), where('assignmentId', '==', a.id)))
      for (let i = 0; i < snap.docs.length; i += 499) {
        const batch = writeBatch(db)
        snap.docs.slice(i, i + 499).forEach(d => batch.update(d.ref, { published: true }))
        await batch.commit()
      }
      await updateDoc(doc(db, 'assignments', a.id), { status: 'published' })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      queryClient.invalidateQueries({ queryKey: ['scores'] })
    } finally {
      setPublishing(null)
    }
  }

  const filtered = useMemo(() => {
    return assignments.filter(a => {
      if (hidePublished && a.status === 'published') return false
      if (seniorOnly && personRole.get(a.raterId) !== 'senior_rater') return false
      return true
    })
  }, [assignments, hidePublished, seniorOnly, personRole])

  const columns: ColumnDef<Assignment>[] = [
    {
      id: 'sessionName',
      accessorKey: 'sessionName',
      header: 'Session',
      cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{getValue() as string}</span>,
    },
    {
      id: 'raterName',
      accessorKey: 'raterName',
      header: 'Rater',
      cell: ({ row }) => {
        const role = personRole.get(row.original.raterId)
        return (
          <span className="font-medium">
            {row.original.raterName}
            {role === 'senior_rater' && (
              <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">SR</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'testCount',
      accessorFn: (a: Assignment) => a.testDocIds.length,
      header: 'Tests',
      sortingFn: 'alphanumeric',
      cell: ({ getValue }) => <span className="text-sm">{getValue() as number}</span>,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      sortingFn: (a, b) => {
        const order = { pending: 0, submitted: 1, reviewed: 2, published: 3 }
        return order[a.original.status] - order[b.original.status]
      },
      cell: ({ getValue }) => {
        const s = getValue() as Assignment['status']
        return <Badge variant={STATUS_VARIANT[s]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Badge>
      },
    },
    {
      id: 'notes',
      accessorKey: 'notes',
      header: 'Notes',
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-sm truncate max-w-xs block">{getValue() as string}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        const a = row.original
        return (
          <div className="flex items-center gap-2 justify-end">
            {a.status !== 'published' && (
              <Button
                variant="outline"
                size="sm"
                disabled={publishing === a.id}
                onClick={() => publishAssignment(a)}
              >
                {publishing === a.id ? 'Publishing…' : 'Publish'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>Edit</Button>
          </div>
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
  })

  const publishedCount = assignments.filter(a => a.status === 'published').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Assignments</h1>
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" /> New assignment
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hidePublished}
            onChange={e => setHidePublished(e.target.checked)}
            className="rounded"
          />
          Hide published
          {publishedCount > 0 && (
            <span className="text-muted-foreground">({publishedCount})</span>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={seniorOnly}
            onChange={e => setSeniorOnly(e.target.checked)}
            className="rounded"
          />
          Senior raters only
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {assignments.length} assignments
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments match the current filters.</p>
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
                          {canSort && (
                            sorted === 'asc'  ? <ChevronUp className="size-3" />
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
              {table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id} className="last:text-right">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AssignmentDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} assignment={selected} />
    </div>
  )
}
