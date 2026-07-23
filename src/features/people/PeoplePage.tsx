import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Plus, UserPlus, ChevronUp, ChevronDown, ChevronsUpDown, Trash2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Person } from '@/types'
import { PersonDrawer } from './PersonDrawer'
import { InvitePersonDialog } from './InvitePersonDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ROLE_LABELS: Record<Person['role'], string> = {
  admin: 'Admin',
  senior_rater: 'Senior Rater',
  trainee: 'Trainee',
  interlocutor: 'Interlocutor',
}

const ROLE_ORDER: Record<Person['role'], number> = { admin: 0, senior_rater: 1, trainee: 2, interlocutor: 3 }

async function fetchPeople(): Promise<Person[]> {
  const snap = await getDocs(collection(db, 'people'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Person)
}

export function PeoplePage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Person['role']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Person['status']>('all')
  const [hideTrainees, setHideTrainees] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<Person | undefined>()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'role', desc: false }])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: people = [], isLoading } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })

  async function handleDelete(person: Person) {
    if (!confirm(`Delete ${person.name}? This permanently removes their record from the database — it does not touch any assignments or scores that might still reference them. This cannot be undone.`)) return
    setDeletingId(person.id)
    try {
      await deleteDoc(doc(db, 'people', person.id))
      queryClient.invalidateQueries({ queryKey: ['people'] })
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = useMemo(() => people.filter(p => {
    const s = search.toLowerCase()
    return (
      (s === '' || p.name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s)) &&
      (roleFilter === 'all' || p.role === roleFilter) &&
      (statusFilter === 'all' || p.status === statusFilter) &&
      !(hideTrainees && p.role === 'trainee')
    )
  }), [people, search, roleFilter, statusFilter, hideTrainees])

  const columns: ColumnDef<Person>[] = [
    {
      accessorKey: 'raterNumber',
      header: '#',
      sortingFn: 'alphanumeric',
      cell: ({ getValue }) => {
        const n = getValue() as number | undefined
        return n ? <span className="font-mono text-sm text-muted-foreground">{n}</span> : null
      },
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <span>
          {row.original.name}
          {row.original.createdVia === 'self_serve_auto' && (
            <span
              className="ml-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 font-normal"
              title="Auto-created on first self-serve login — Canvas Sync hadn't been run for this person yet"
            >
              auto
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
    },
    {
      accessorKey: 'role',
      header: 'Role',
      sortingFn: (a, b) => ROLE_ORDER[a.original.role] - ROLE_ORDER[b.original.role],
      cell: ({ row }) => <Badge variant="secondary">{ROLE_LABELS[row.original.role]}</Badge>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const colours = {
          active: 'bg-green-100 text-green-800',
          inactive: 'bg-gray-100 text-gray-600',
          suspended: 'bg-red-100 text-red-800',
        }
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colours[row.original.status]}`}>
            {row.original.status}
          </span>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedPerson(row.original); setDrawerOpen(true) }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={deletingId === row.original.id}
            onClick={() => handleDelete(row.original)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
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
        <h1 className="text-2xl font-semibold">People</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4 mr-2" /> Invite
          </Button>
          <Button onClick={() => { setSelectedPerson(undefined); setDrawerOpen(true) }}>
            <Plus className="size-4 mr-2" /> Add person
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={roleFilter} onValueChange={v => setRoleFilter(v as typeof roleFilter)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="senior_rater">Senior Rater</SelectItem>
            <SelectItem value="trainee">Trainee</SelectItem>
            <SelectItem value="interlocutor">Interlocutor</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setHideTrainees(h => !h)}
          className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${hideTrainees ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:text-foreground'}`}
        >
          {hideTrainees ? 'Showing seniors only' : 'Hide trainees'}
        </button>
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
                    No people found.
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

      <PersonDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} person={selectedPerson} />
      <InvitePersonDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
