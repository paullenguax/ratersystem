import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { ChevronLeft } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { CourseAttendee } from '@/types'
import { fetchCourses, mergeAttendees, setForCourse } from '@/lib/courses'
import {
  buildImport, COLUMN_LABELS, guessColumns, parseTable, type ColumnRole, type ImportGroup,
} from '@/lib/courseImport'
import { fetchAllTests, fetchPeople, formatDateRange } from './CoursesPage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const ROLES: ColumnRole[] = ['name', 'surname', 'course', 'startDate', 'endDate', 'number', 'email']
const REQUIRED: ColumnRole[] = ['name', 'course']

export function ImportCoursesPage() {
  const queryClient = useQueryClient()
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchAllTests })

  const [text, setText] = useState('')
  const [table, setTable] = useState<string[][] | null>(null)
  const [cols, setCols] = useState<Partial<Record<ColumnRole, number>>>({})
  // Per-row person choice, overriding the automatic match: key → personId or '' (not linked)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<{ created: number; updated: number; attendees: number } | null>(null)
  const [error, setError] = useState('')

  function read(source: string) {
    const rows = parseTable(source)
    if (rows.length < 2) { setError('Need a header row plus at least one row of data.'); return }
    setError('')
    setTable(rows)
    setCols(guessColumns(rows[0]))
    setOverrides({})
    setDone(null)
  }

  async function readFile(file: File) {
    const content = await file.text()
    setText(content)
    read(content)
  }

  const headers = table?.[0] ?? []
  const ready = !!table && REQUIRED.every(r => cols[r] != null)
  const { groups, problems } = useMemo(
    () => (ready ? buildImport(table!.slice(1), cols, people, courses) : { groups: [], problems: [] }),
    [ready, table, cols, people, courses],
  )

  const rowKey = (g: ImportGroup, line: number) => `${g.key}:${line}`
  const chosenPerson = (g: ImportGroup, r: ImportGroup['rows'][number]) => {
    const o = overrides[rowKey(g, r.line)]
    return o !== undefined ? (o || null) : r.personId
  }

  const totalAttendees = groups.reduce((n, g) => n + g.rows.length, 0)
  const newCount = groups.filter(g => !g.existing).length

  async function runImport() {
    setImporting(true); setError('')
    try {
      let created = 0, updated = 0
      for (const g of groups) {
        const incoming: CourseAttendee[] = g.rows.map(r => {
          const pid = chosenPerson(g, r)
          const person = pid ? people.find(p => p.id === pid) : undefined
          return { personId: person?.id ?? null, name: person?.name ?? r.name, email: r.email ?? person?.email ?? null }
        })
        if (g.existing) {
          await updateDoc(doc(db, 'courses', g.existing.id), {
            attendees: mergeAttendees(g.existing.attendees ?? [], incoming, people),
            // Fill in dates only where the course has none yet
            ...(!g.existing.startDate && g.startDate && { startDate: g.startDate }),
            ...(!g.existing.endDate && g.endDate && { endDate: g.endDate }),
          })
          updated++
        } else {
          await addDoc(collection(db, 'courses'), {
            kind: g.kind,
            number: g.number,
            name: g.name,
            startDate: g.startDate,
            endDate: g.endDate,
            trainerIds: [],
            canvasSections: [],
            attendees: mergeAttendees([], incoming, people),
            // The run's set if it's tagged yet; if not, "Re-sync from sets"
            // on the Courses page fills it later.
            testDocIds: setForCourse(tests, g).map(t => t.id),
            notes: 'Imported from spreadsheet',
            createdAt: serverTimestamp(),
          })
          created++
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      setDone({ created, updated, attendees: totalAttendees })
      setTable(null); setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed part-way — check Courses before retrying (re-importing won\'t duplicate attendees).')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="space-y-2">
        <Link to="/courses" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Courses
        </Link>
        <h1 className="text-2xl font-semibold">Import past courses</h1>
        <p className="text-sm text-muted-foreground">
          One row per attendee per course. Needs a name and the course type (“Initial”, “RC3”, “RC1 (2022) & RC2 (2023)”, “Refresher 3”…);
          a date is strongly recommended — each date becomes its own course run. Recordings come from each course's set in Test Bank.
        </p>
      </div>

      {done && (
        <div className="rounded-md border border-green-200 bg-green-50 text-green-900 px-3 py-2 text-sm">
          Imported {done.attendees} attendee{done.attendees === 1 ? '' : 's'}: {done.created} new course{done.created === 1 ? '' : 's'}, {done.updated} existing updated.{' '}
          <Link to="/courses" className="underline">View courses</Link>
        </div>
      )}

      {!table && (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder={'Paste from the spreadsheet, including the header row — e.g.\nName\tCourse\tDate\nBob Smith\tRefresher 3\t12/03/2025'}
          />
          <div className="flex gap-2 items-center flex-wrap">
            <Button onClick={() => read(text)} disabled={!text.trim()}>Read</Button>
            <span className="text-sm text-muted-foreground">or</span>
            <label className="text-sm underline cursor-pointer">
              choose a .csv file
              <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />
            </label>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {table && (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Columns</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {ROLES.map(role => (
                <label key={role} className="text-sm space-y-1">
                  <span className="block">{COLUMN_LABELS[role]}{REQUIRED.includes(role) && ' *'}</span>
                  <select
                    value={cols[role] ?? ''}
                    onChange={e => setCols(c => ({ ...c, [role]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    className="w-full border border-input rounded-md px-2 py-1.5 bg-background"
                  >
                    <option value="">— none —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setTable(null); setDone(null) }}>Start again</Button>
          </section>

          {ready && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">
                  Preview <span className="text-muted-foreground font-normal text-base">
                    {groups.length} course{groups.length === 1 ? '' : 's'} ({newCount} new), {totalAttendees} attendees
                  </span>
                </h2>
                <Button onClick={runImport} disabled={importing || groups.length === 0}>
                  {importing ? 'Importing…' : 'Import'}
                </Button>
              </div>

              {problems.length > 0 && (
                <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" open>
                  <summary className="cursor-pointer">
                    {problems.length} note{problems.length === 1 ? '' : 's'}
                    {problems.some(p => p.skipped) && ` — ${problems.filter(p => p.skipped).length} row(s) skipped`}
                  </summary>
                  <ul className="mt-1 space-y-0.5 max-h-64 overflow-y-auto">
                    {problems.map((p, i) => (
                      <li key={i} className={p.skipped ? 'font-medium' : ''}>Row {p.line}: {p.message}</li>
                    ))}
                  </ul>
                </details>
              )}

              {groups.map(g => (
                <div key={g.key} className="rounded-md border">
                  <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b bg-muted/40">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-sm text-muted-foreground">{formatDateRange(g)}</span>
                    {g.existing
                      ? <Badge variant="outline">Adds to existing course</Badge>
                      : <Badge variant="secondary">New</Badge>}
                    <span className="text-sm text-muted-foreground ml-auto">{g.rows.length} attendee{g.rows.length === 1 ? '' : 's'}</span>
                  </div>
                  <ul className="divide-y">
                    {g.rows.map(r => {
                      const pid = chosenPerson(g, r)
                      const options = [
                        ...(r.personId ? [people.find(p => p.id === r.personId)!] : []),
                        ...r.suggestions,
                      ].filter((p, i, arr) => p && arr.findIndex(x => x.id === p.id) === i)
                      return (
                        <li key={r.line} className="flex items-center gap-2 px-3 py-1.5 text-sm flex-wrap">
                          <span className="flex-1 min-w-40">
                            {r.name}
                            {r.email && <span className="text-xs text-muted-foreground ml-2">{r.email}</span>}
                          </span>
                          <select
                            value={pid ?? ''}
                            onChange={e => setOverrides(o => ({ ...o, [rowKey(g, r.line)]: e.target.value }))}
                            className={`border rounded-md px-2 py-1 bg-background text-sm ${pid ? 'border-green-300' : r.suggestions.length ? 'border-amber-300' : 'border-input'}`}
                            aria-label={`Link ${r.name} to a person`}
                          >
                            <option value="">Name only (not in People)</option>
                            {options.map(p => <option key={p.id} value={p.id}>{p.id === r.personId ? '✓ ' : 'Maybe: '}{p.name} — {p.email}</option>)}
                          </select>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
