import { useMemo, useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Plus, ListVideo, FileText, Blocks, Shuffle, FileEdit, Activity, Link2 as LinkIcon, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StorylineTest, StorylineTestType } from '@/types'
import { StorylineTestDrawer, TEST_TYPES, TEST_CATEGORIES } from './StorylineTestDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchStorylineTests(): Promise<StorylineTest[]> {
  const snap = await getDocs(collection(db, 'storyline_tests'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylineTest)
}

// Base UI's <Select.Value> displays the raw `value` unless given a render
// function — it does not look up the matching <SelectItem>'s children.
const CATEGORY_LABELS: Record<string, string> = {
  all: 'All categories',
  ...Object.fromEntries(TEST_CATEGORIES.map(c => [c.value, c.label])),
}

export function StorylineTestsPage() {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTest, setSelectedTest] = useState<StorylineTest | undefined>()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'testType', desc: false }])

  // Filters live in the URL, not plain useState — so navigating into a Test
  // Type and back restores exactly where you left off. replace: true so
  // toggling filters doesn't spam browser history.
  const [searchParams, setSearchParams] = useSearchParams()
  function setParam(key: string, value: string, isDefault: boolean) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (isDefault) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }

  const roleFilter = (searchParams.get('role') ?? 'all') as 'all' | StorylineTestType
  const setRoleFilter = (v: 'all' | StorylineTestType) => setParam('role', v, v === 'all')

  const categoryFilter = (searchParams.get('category') ?? 'all') as 'all' | NonNullable<StorylineTest['category']>
  const setCategoryFilter = (v: 'all' | NonNullable<StorylineTest['category']>) => setParam('category', v, v === 'all')

  const { data: tests = [], isLoading } = useQuery({ queryKey: ['storyline_tests'], queryFn: fetchStorylineTests })

  const filteredTests = useMemo(
    () => tests.filter(t =>
      (roleFilter === 'all' || t.testType === roleFilter) &&
      (categoryFilter === 'all' || t.category === categoryFilter),
    ),
    [tests, roleFilter, categoryFilter],
  )

  const columns: ColumnDef<StorylineTest>[] = [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'testType',
      header: 'Role',
      sortUndefined: 'last',
      cell: ({ row }) => row.original.testType
        ? <Badge variant="outline">{row.original.testType}</Badge>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      accessorKey: 'category',
      header: 'Category',
      sortUndefined: 'last',
      cell: ({ row }) => row.original.category
        ? <Badge variant="outline">{CATEGORY_LABELS[row.original.category]}</Badge>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
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
            onClick={() => navigate(`/test-versions/${row.original.id}/content`)}
          >
            <FileEdit className="size-4 mr-1" /> Content
          </Button>
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

  const table = useReactTable({
    data: filteredTests,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Test Types</h1>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/template" />}>
            <FileText className="size-4 mr-2" /> Script Template
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/parts" />}>
            <Blocks className="size-4 mr-2" /> Parts Library
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/themes" />}>
            <Shuffle className="size-4 mr-2" /> Unmixable Themes
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/activity" />}>
            <Activity className="size-4 mr-2" /> Test activity
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/test-versions/media-check" />}>
            <LinkIcon className="size-4 mr-2" /> Check media links
          </Button>
          <Button onClick={() => { setSelectedTest(undefined); setDrawerOpen(true) }}>
            <Plus className="size-4 mr-2" /> Add test type
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Select value={roleFilter} onValueChange={v => setRoleFilter(v as typeof roleFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All roles">{(v: string) => v === 'all' ? 'All roles' : v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {TEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={v => setCategoryFilter(v as typeof categoryFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All categories">{(v: string) => CATEGORY_LABELS[v] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {TEST_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
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
                    {tests.length === 0 ? 'No test types yet.' : 'No test types match these filters.'}
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
