import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Person } from '@/types'
import { PersonDrawer } from './PersonDrawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ROLE_LABELS: Record<Person['role'], string> = {
  admin: 'Admin',
  senior_rater: 'Senior Rater',
  trainee: 'Trainee',
}

async function fetchPeople(): Promise<Person[]> {
  const snap = await getDocs(collection(db, 'people'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Person)
}

export function PeoplePage() {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Person['role']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Person['status']>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<Person | undefined>()

  const { data: people = [], isLoading } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })

  const filtered = useMemo(() => people.filter(p => {
    const s = search.toLowerCase()
    return (
      (s === '' || p.name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s)) &&
      (roleFilter === 'all' || p.role === roleFilter) &&
      (statusFilter === 'all' || p.status === statusFilter)
    )
  }), [people, search, roleFilter, statusFilter])

  const columns: ColumnDef<Person>[] = [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
    },
    {
      accessorKey: 'role',
      header: 'Role',
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSelectedPerson(row.original); setDrawerOpen(true) }}
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
        <h1 className="text-2xl font-semibold">People</h1>
        <Button onClick={() => { setSelectedPerson(undefined); setDrawerOpen(true) }}>
          <Plus className="size-4 mr-2" /> Add person
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
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
    </div>
  )
}
