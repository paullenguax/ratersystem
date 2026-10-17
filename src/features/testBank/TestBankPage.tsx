import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Plus, Play, Square, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Test } from '@/types'
import { TestDrawer } from './TestDrawer'
import { TestScoresSheet } from './TestScoresSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CategoryBadge } from '@/components/CategoryBadge'
import { formatTestNumber } from '@/lib/testNumber'
import { CATEGORY_LABELS, LEGACY_COURSE_TAG_LABELS, testCategory } from '@/lib/testPool'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchTests(): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Test)
}

// Reads the legacy free-text day ("Day 3", "day3", "3") on a test tagged
// for the rater course, so moving it into Training can carry the day over.
function legacyRaterCourseDay(t: Test): number | null {
  if (t.courseTag !== 'rater_course') return null
  const n = Number(t.dayLabel?.match(/\d+/)?.[0])
  return n >= 1 && n <= 5 ? n : null
}

function matchesSetFilter(t: Test, f: string): boolean {
  if (f === 'all') return true
  if (f === 'none') return !t.raterCourseDay && !t.refresherNumber
  const [kind, n] = f.split(':')
  return kind === 'day' ? t.raterCourseDay === Number(n) : t.refresherNumber === Number(n)
}

function setFilterLabel(f: string): string {
  if (f === 'all') return 'Course set — any'
  if (f === 'none') return 'Not in any course set'
  const [kind, n] = f.split(':')
  return kind === 'day' ? `Rater Course Day ${n}` : `RC${n} set`
}

// Moves tests into a non-certification pool. Each gets the next number in
// that pool's own sequence (S/T), since its old number belongs to another
// namespace and would usually collide there.
async function moveTests(tests: Test[], allTests: Test[], target: 'standardization' | 'training') {
  const moving = new Set(tests.map(t => t.id))
  let next = Math.max(0, ...allTests
    .filter(t => !moving.has(t.id) && testCategory(t) === target)
    .map(t => t.testId ?? 0)) + 1
  const batch = writeBatch(db)
  for (const t of [...tests].sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))) {
    batch.update(doc(db, 'test_bank', t.id), {
      category: target,
      testId: next++,
      raterCourseDay: target === 'training' ? (t.raterCourseDay ?? legacyRaterCourseDay(t)) : null,
      refresherNumber: target === 'training' ? (t.refresherNumber ?? null) : null,
    })
  }
  await batch.commit()
}

export function TestBankPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setLicenceFilter] = useState<'all' | Test['testType']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Test['status']>('all')
  const [poolFilter, setPoolFilter] = useState<'all' | 'pool' | 'excluded'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | NonNullable<Test['category']>>('all')
  // 'all' | 'none' (in no set) | 'day:N' (Rater Course day) | 'rc:N' (refresher set)
  const [setFilter, setSetFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTest, setSelectedTest] = useState<Test | undefined>()
  const [scoresTest, setScoresTest] = useState<Test | undefined>()
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'testId', desc: false }])

  const { data: tests = [], isLoading } = useQuery({ queryKey: ['tests'], queryFn: fetchTests })

  const filtered = useMemo(() => tests.filter(t => {
    const s = search.toLowerCase()
    return (
      (s === '' || t.candidateName.toLowerCase().includes(s) || t.candidateNationality.toLowerCase().includes(s)) &&
      (typeFilter === 'all' || t.testType === typeFilter) &&
      (statusFilter === 'all' || t.status === statusFilter) &&
      (poolFilter === 'all' || (poolFilter === 'excluded' ? !!t.excludeFromPool : !t.excludeFromPool)) &&
      (categoryFilter === 'all' || testCategory(t) === categoryFilter) &&
      matchesSetFilter(t, setFilter)
    )
  }), [tests, search, typeFilter, statusFilter, poolFilter, categoryFilter, setFilter])

  const rcNumbers = useMemo(
    () => [...new Set(tests.map(t => t.refresherNumber).filter((n): n is number => !!n))].sort((a, b) => a - b),
    [tests],
  )

  // Bulk-tag the selection into a set. Only Training audio can be in a set.
  async function handleTag(field: 'refresherNumber' | 'raterCourseDay') {
    const isRc = field === 'refresherNumber'
    const input = prompt(isRc
      ? 'Tag the selected Training tests as which refresher set? (e.g. 6 for RC6 — leave blank to remove from any RC set)'
      : 'Put the selected Training tests on which Rater Course day (1–5)? Leave blank to remove them from the Rater Course set.')
    if (input === null) return
    const n = input.trim() === '' ? null : Number(input.replace(/\D/g, ''))
    if (n !== null && (!Number.isInteger(n) || n < 1 || (!isRc && n > 5))) { alert(isRc ? 'Enter a set number like 6.' : 'Enter a day from 1 to 5.'); return }
    const training = selectedTests.filter(t => t.category === 'training')
    const skipped = selectedTests.length - training.length
    if (training.length === 0) { alert('Only Training tests can be in a course set — move them to Training first.'); return }
    setMoving(true)
    try {
      const batch = writeBatch(db)
      training.forEach(t => batch.update(doc(db, 'test_bank', t.id), { [field]: n }))
      await batch.commit()
      await queryClient.invalidateQueries({ queryKey: ['tests'] })
      if (skipped) alert(`${skipped} selected test${skipped === 1 ? ' isn\'t' : 's aren\'t'} Training audio and ${skipped === 1 ? 'was' : 'were'} left alone.`)
    } finally {
      setMoving(false)
    }
  }

  const selectedTests = tests.filter(t => selectedIds.has(t.id))

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleMove(target: 'standardization' | 'training') {
    const n = selectedTests.length
    if (!confirm(`Move ${n} test${n === 1 ? '' : 's'} to ${CATEGORY_LABELS[target]}? They'll be renumbered in that pool (${target === 'training' ? 'T' : 'S'}1, ${target === 'training' ? 'T' : 'S'}2…).`)) return
    setMoving(true)
    try {
      await moveTests(selectedTests, tests, target)
      setSelectedIds(new Set())
      await queryClient.invalidateQueries({ queryKey: ['tests'] })
    } finally {
      setMoving(false)
    }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id))

  const columns: ColumnDef<Test>[] = [
    {
      id: 'select',
      enableSorting: false,
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all shown tests"
          checked={allFilteredSelected}
          onChange={() => setSelectedIds(allFilteredSelected ? new Set() : new Set(filtered.map(t => t.id)))}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.original.candidateName}`}
          checked={selectedIds.has(row.original.id)}
          onChange={() => toggleSelected(row.original.id)}
        />
      ),
    },
    {
      accessorKey: 'testId',
      header: '#',
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs font-mono">
          {formatTestNumber(row.original.testId, row.original.category)}
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
      accessorKey: 'calibratedLevel',
      header: 'Level',
      sortUndefined: 'last',
      cell: ({ row }) => {
        const t = row.original
        if (t.calibratedLevel == null) return <span className="text-muted-foreground/50 text-xs">—</span>
        const disagree = (t.calibratedInfit ?? 1) > 1.3 || (t.calibratedOutfit ?? 1) > 1.3
        return (
          <button
            type="button"
            onClick={() => setScoresTest(t)}
            className="text-sm hover:underline"
            title={`Rasch-calibrated: level an average rater would award (fair avg ${t.calibratedFairAvg?.toFixed(2)}, ${t.calibratedRaters} raters). Click to see every rater's scores.`}
          >
            <span className="font-semibold">{t.calibratedLevel}</span>
            {disagree && <span className="ml-1.5 text-[11px] text-red-700">⚠ disagree</span>}
          </button>
        )
      },
    },
    {
      id: 'category',
      header: 'Category',
      enableSorting: false,
      cell: ({ row }) => <CategoryBadge category={row.original.category} />,
    },
    {
      accessorKey: 'raterCourseDay',
      header: 'Course',
      sortUndefined: 'last',
      cell: ({ row }) => {
        const t = row.original
        if (t.raterCourseDay || t.refresherNumber) {
          return (
            <div className="flex gap-1 flex-wrap">
              {t.raterCourseDay && <Badge variant="outline">Rater Course · Day {t.raterCourseDay}</Badge>}
              {t.refresherNumber && <Badge variant="outline">RC{t.refresherNumber}</Badge>}
            </div>
          )
        }
        // Legacy tag, shown faintly as a hint while sorting tests into pools
        if (t.courseTag || t.dayLabel) {
          return (
            <span className="text-xs text-muted-foreground italic" title="Old tag — not used by Courses">
              {[t.courseTag && LEGACY_COURSE_TAG_LABELS[t.courseTag], t.dayLabel].filter(Boolean).join(' · ')}
            </span>
          )
        }
        return <span className="text-muted-foreground/50 text-xs">—</span>
      },
    },
    {
      id: 'excludeFromPool',
      accessorKey: 'excludeFromPool',
      header: 'Pool',
      enableSorting: false,
      cell: ({ row }) => row.original.excludeFromPool
        ? <span className="text-xs text-muted-foreground">Excluded</span>
        : <span className="text-xs text-green-700">In pool</span>,
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
        <div className="flex">
          <Button variant="ghost" size="sm" onClick={() => setScoresTest(row.original)}>
            Scores
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

      {/* Rater-course and standardization tests are really two separate
          pools — this is the primary way to switch between them, rather
          than burying it in the filter row below. */}
      <div className="flex gap-1">
        {([
          ['all', 'All'],
          ['rater_course', 'Certification'],
          ['standardization', 'In-session'],
          ['training', 'Training'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => { setCategoryFilter(value); setSelectedIds(new Set()) }}
            className={`px-3 py-1.5 text-sm rounded-md border font-medium transition-colors ${
              categoryFilter === value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-input text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
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
        <Select value={poolFilter} onValueChange={v => setPoolFilter(v as typeof poolFilter)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Pool status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tests</SelectItem>
            <SelectItem value="pool">In pool</SelectItem>
            <SelectItem value="excluded">Excluded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={setFilter} onValueChange={v => setSetFilter(v as string)}>
          <SelectTrigger className="w-48">
            <SelectValue>{(v: string) => setFilterLabel(v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{setFilterLabel('all')}</SelectItem>
            {['1', '2', '3', '4', '5'].map(d => <SelectItem key={d} value={`day:${d}`}>{setFilterLabel(`day:${d}`)}</SelectItem>)}
            {rcNumbers.map(n => <SelectItem key={n} value={`rc:${n}`}>{setFilterLabel(`rc:${n}`)}</SelectItem>)}
            <SelectItem value="none">{setFilterLabel('none')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedTests.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedTests.length} selected</span>
          <span className="text-muted-foreground">Move to:</span>
          <Button size="sm" variant="outline" disabled={moving} onClick={() => handleMove('training')}>Training</Button>
          <Button size="sm" variant="outline" disabled={moving} onClick={() => handleMove('standardization')}>In-session</Button>
          <span className="text-muted-foreground ml-2">Tag:</span>
          <Button size="sm" variant="outline" disabled={moving} onClick={() => handleTag('refresherNumber')}>RC set…</Button>
          <Button size="sm" variant="outline" disabled={moving} onClick={() => handleTag('raterCourseDay')}>Rater Course day…</Button>
          <Button size="sm" variant="ghost" disabled={moving} onClick={() => setSelectedIds(new Set())}>Clear</Button>
          <span className="text-xs text-muted-foreground">To make a test exam-eligible (Certification), edit it individually.</span>
        </div>
      )}

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
      <TestScoresSheet open={!!scoresTest} onClose={() => setScoresTest(undefined)} test={scoresTest} />
    </div>
  )
}
