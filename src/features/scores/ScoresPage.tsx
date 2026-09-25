import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { Plus, Download, ChevronUp, ChevronDown, ChevronsUpDown, Hash } from 'lucide-react'
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

// Output is Facets-ready as-is: comma-separated, and every non-data line
// (notes, rater key, column header) starts with ';' so Facets skips it
function buildRaschExport(scores: Score[], sessionId: string, people: Person[]) {
  const rows = scores.filter(s => {
    if (s.testNumber == null) return false
    if (s.published) return true
    return !!sessionId && s.sessionId === sessionId
  })

  const permNumById = new Map(people.filter(p => p.raterNumber).map(p => [p.id, p.raterNumber!]))

  // Current session raters always get a fresh temp number — even returnees
  // so they appear as a separate row in Facets Table 7 alongside their historical row
  const currentSessionRaterIds = sessionId
    ? new Set(rows.filter(s => !s.published && s.sessionId === sessionId).map(s => s.raterId))
    : new Set<string>()
  const publishedRaterIds = new Set(rows.filter(s => s.published).map(s => s.raterId))
  const returneeIds = new Set([...currentSessionRaterIds].filter(id => publishedRaterIds.has(id)))
  const newRaterIds  = new Set([...currentSessionRaterIds].filter(id => !publishedRaterIds.has(id)))

  let nextNum = Math.max(0, ...(permNumById.size ? permNumById.values() : [0])) + 1
  const tempNumById = new Map<string, number>()
  // Assign temp numbers to all current-session raters (sorted for stability)
  const currentRatersSorted = [...currentSessionRaterIds].sort((a, b) => {
    const nameA = rows.find(s => s.raterId === a)?.raterName ?? ''
    const nameB = rows.find(s => s.raterId === b)?.raterName ?? ''
    return nameA.localeCompare(nameB)
  })
  for (const id of currentRatersSorted) tempNumById.set(id, nextNum++)

  const sessionName = sessionId ? (scores.find(s => s.sessionId === sessionId)?.sessionName ?? sessionId) : null

  // Build rater key: historical raters first, then current (returnees appear twice)
  const historicalRaters = [...new Map(
    rows.filter(s => s.published).map(s => [s.raterId, s.raterName])
  ).entries()].sort((a, b) => (permNumById.get(a[0]) ?? 0) - (permNumById.get(b[0]) ?? 0))
  const currentRaters = currentRatersSorted.map(id => {
    const name = rows.find(s => s.raterId === id)?.raterName ?? id
    return [id, name] as [string, string]
  })

  const lines: string[] = [
    `; Rasch export — ${new Date().toISOString().split('T')[0]}`,
    `; ${rows.length} observations`,
    `; ${sessionName ? `Published + current event: ${sessionName}` : 'Published scores only'}`,
    `; Historical raters use permanent numbers · Current raters use temp numbers`,
    `; Returnees appear twice (permanent # for history, temp # for current event)`,
    `;`,
    `; Rater key — historical:`,
    ...historicalRaters.map(([id, name]) => {
      const tag = returneeIds.has(id) ? `returnee — now Rater ${tempNumById.get(id)} in this event` : ''
      return `; ${permNumById.get(id)},${name},${tag}`
    }),
    `;`,
    `; Rater key — current event (temp numbers):`,
    ...currentRaters.map(([id, name]) => {
      const tag = returneeIds.has(id) ? `returnee — previously Rater ${permNumById.get(id) ?? '(no number assigned yet)'}` : newRaterIds.has(id) ? 'new' : ''
      return `; ${tempNumById.get(id)},${name},${tag}`
    }),
    `;`,
    [';candidate', 'rater', '1-6a', 'varPronunciation', 'varStructure',
      'varVocabulary', 'varFluency', 'varComprehension', 'varInteraction'].join(','),
    ...[...rows].sort((a, b) => {
      const isCurrA = !a.published && !!sessionId && a.sessionId === sessionId
      const isCurrB = !b.published && !!sessionId && b.sessionId === sessionId
      const numA = isCurrA ? (tempNumById.get(a.raterId) ?? 0) : (permNumById.get(a.raterId) ?? 0)
      const numB = isCurrB ? (tempNumById.get(b.raterId) ?? 0) : (permNumById.get(b.raterId) ?? 0)
      return numA !== numB ? numA - numB : (a.testNumber ?? 0) - (b.testNumber ?? 0)
    }).map(s => {
      const isCurrent = !s.published && sessionId && s.sessionId === sessionId
      const num = isCurrent ? (tempNumById.get(s.raterId) ?? 0) : (permNumById.get(s.raterId) ?? 0)
      return [
        s.testNumber,
        num,
        '1-6a',
        s.pronunciation, s.structure, s.vocabulary,
        s.fluency, s.comprehension, s.interactions,
      ].join(',')
    }),
  ]

  const nums = rows.map(s => {
    const isCurrent = !s.published && sessionId && s.sessionId === sessionId
    return isCurrent ? (tempNumById.get(s.raterId) ?? 0) : (permNumById.get(s.raterId) ?? 0)
  })
  return {
    lines,
    maxCandidate: Math.max(1, ...rows.map(s => s.testNumber ?? 0)),
    maxRater: Math.max(1, ...nums),
    // Plain characters only — it's written into the spec's data= line
    fileName: sessionName ? `rasch-${sessionName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv` : 'rasch-published.csv',
  }
}

function download(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function exportRaschCSV(scores: Score[], sessionId: string, people: Person[]) {
  const { lines, fileName } = buildRaschExport(scores, sessionId, people)
  download(lines.join('\n'), fileName, 'text/csv;charset=utf-8;')
}

// Facets specification file matching the export — element ranges come from the
// data, so new candidates/raters are never silently dropped ("Responses not
// matched to any model are ignored" in Table 2)
function exportFacetsSpec(scores: Score[], sessionId: string, people: Person[]) {
  const { maxCandidate, maxRater, fileName } = buildRaschExport(scores, sessionId, people)
  const spec = [
    'Title = Lenguax Rating',
    'Facets = 3 \t; three facets, candidate, rater, and rating criteria',
    'Positive = 1\t; the first facet positively oriented',
    'Noncentered= 1\t; the first facet is a floating one',
    'Vertical = 1*, 2N, 3A\t; put the control for the "rulers" in Table 6 here, if not default',
    'Arrange = mN\t; put the order for the measure Table 7 here',
    '',
    'Models=?,?,?,R6 ; one shared 6-category rating scale',
    '*',
    '',
    'Labels=',
    '1,candidate',
    `1-${maxCandidate}`,
    '',
    '*',
    '2, rater',
    `1-${maxRater}`,
    '*',
    '',
    '3, criteria',
    '1= Pronunciation',
    '2= Structure',
    '3= Vocabulary',
    '4= Fluency',
    '5= Comprehension',
    '6= Interactions',
    '',
    '*',
    `data= ${fileName}`,
    '',
  ].join('\r\n')
  download(spec, 'lenguax rating.txt', 'text/plain;charset=utf-8;')
}

// ── Assign permanent rater numbers ─────────────────────────────────────────

async function assignPermanentRaterNumbers(scores: Score[], people: Person[]): Promise<number> {
  const publishedRaterIds = new Set(scores.filter(s => s.published).map(s => s.raterId))
  const permNums = new Map(people.filter(p => p.raterNumber).map(p => [p.id, p.raterNumber!]))
  const unassigned = people
    .filter(p => publishedRaterIds.has(p.id) && !p.raterNumber)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (unassigned.length === 0) return 0
  let next = Math.max(0, ...(permNums.size ? permNums.values() : [0])) + 1
  for (const person of unassigned) {
    await updateDoc(doc(db, 'people', person.id), { raterNumber: next++ })
  }
  return unassigned.length
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
  const [exportSessionId, setExportSessionId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const queryClient = useQueryClient()

  const { data: scores = [], isLoading } = useQuery({ queryKey: ['scores'], queryFn: fetchScores })
  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person),
  })

  const unassignedCount = useMemo(() => {
    const publishedRaterIds = new Set(scores.filter(s => s.published).map(s => s.raterId))
    return people.filter(p => publishedRaterIds.has(p.id) && !p.raterNumber).length
  }, [scores, people])

  async function handleAssignNumbers() {
    setAssigning(true)
    try {
      const n = await assignPermanentRaterNumbers(scores, people)
      if (n > 0) queryClient.invalidateQueries({ queryKey: ['people'] })
    } finally {
      setAssigning(false)
    }
  }

  const sessions = useMemo(() => {
    const seen = new Map<string, string>()
    scores.filter(s => s.sessionId && !s.published).forEach(s => seen.set(s.sessionId, s.sessionName))
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [scores])

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scores</h1>
        <div className="flex items-center gap-2">
          {unassignedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAssignNumbers}
              disabled={assigning}
              title={`${unassignedCount} rater${unassignedCount > 1 ? 's' : ''} with published scores have no permanent number`}
            >
              <Hash className="size-4 mr-2" />
              {assigning ? 'Assigning…' : `Assign numbers (${unassignedCount})`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportRaschCSV(scores, exportSessionId, people)}
            disabled={scores.length === 0}
          >
            <Download className="size-4 mr-2" />
            Export Rasch CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportFacetsSpec(scores, exportSessionId, people)}
            disabled={scores.length === 0}
            title="Facets specification file with candidate/rater ranges matching the export"
          >
            <Download className="size-4 mr-2" />
            Facets spec
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
        {sessions.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted-foreground whitespace-nowrap">Export includes:</label>
            <select
              value={exportSessionId}
              onChange={e => setExportSessionId(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="">Published scores only</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name} (+ unpublished)</option>
              ))}
            </select>
          </div>
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
