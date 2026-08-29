import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// One row of storyline_events, tolerant of both the current telemetry shape
// ({ event, runId, data, ... }) and the pre-2026-08-29 shape
// ({ type, subtype, details, ... }).
interface RawEvent {
  id: string
  event?: string
  type?: string
  subtype?: string
  details?: string
  runId?: string | null
  playerBuild?: string | null
  clientTs?: string | null
  testDisplayName?: string | null
  centreName?: string | null
  testNumber?: string | null
  examinerName?: string | null
  candidateName?: string | null
  ungated?: boolean | null
  hasLiveContent?: boolean | null
  data?: Record<string, unknown> | null
  createdAt?: { toDate: () => Date } | null
}

interface NormEvent {
  id: string
  event: string
  runId: string
  when: Date | null
  testDisplayName: string
  centreName: string
  testNumber: string
  examinerName: string
  candidateName: string
  detail: string
  playerBuild: string
}

// Events the server currently emails on (mirror of STORYLINE_EMAIL_RULES in
// functions/index.js) — flagged in the table so it's obvious which rows
// generated an alert.
const EMAILED = new Set([
  'test_finished',
  'test_rejected',
  'audio_replay_limit',
  'candidate_window_closed',
  'connectivity_online',
  'connectivity_dropped',
])

function normalize(e: RawEvent): NormEvent {
  const event =
    e.event ??
    (e.type === 'completed' ? 'test_finished' : e.subtype ?? e.type ?? 'unknown')
  const data = e.data ?? {}
  const detailBits: string[] = []
  if (typeof data.details === 'string') detailBits.push(data.details)
  else if (e.details) detailBits.push(e.details)
  for (const [k, v] of Object.entries(data)) {
    if (k === 'details') continue
    if (v === null || v === undefined || v === '') continue
    detailBits.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  }
  return {
    id: e.id,
    event,
    runId: e.runId ?? '(legacy)',
    when: e.createdAt?.toDate?.() ?? (e.clientTs ? new Date(e.clientTs) : null),
    testDisplayName: e.testDisplayName ?? '',
    centreName: e.centreName ?? '',
    testNumber: e.testNumber ?? '',
    examinerName: e.examinerName ?? '',
    candidateName: e.candidateName ?? '',
    detail: detailBits.join(' · '),
    playerBuild: e.playerBuild ?? '',
  }
}

async function fetchEvents(): Promise<NormEvent[]> {
  const snap = await getDocs(
    query(collection(db, 'storyline_events'), orderBy('createdAt', 'desc'), limit(500)),
  )
  return snap.docs.map(d => normalize({ ...(d.data() as RawEvent), id: d.id }))
}

async function fetchStorylineConfig(): Promise<{ notificationEmail: string; complianceEmail: string }> {
  const snap = await getDoc(doc(db, 'config', 'storyline'))
  const data = snap.data() ?? {}
  return {
    notificationEmail: data.notificationEmail ?? '',
    complianceEmail: data.complianceEmail ?? '',
  }
}

function fmt(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString(undefined, {
    year: '2-digit', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function NotificationSettings() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['config_storyline'], queryFn: fetchStorylineConfig })
  const [ops, setOps] = useState<string | null>(null)
  const [compliance, setCompliance] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const opsValue = ops ?? data?.notificationEmail ?? ''
  const complianceValue = compliance ?? data?.complianceEmail ?? ''
  const dirty =
    (ops !== null && ops !== (data?.notificationEmail ?? '')) ||
    (compliance !== null && compliance !== (data?.complianceEmail ?? ''))

  async function save() {
    setSaving(true)
    try {
      await setDoc(
        doc(db, 'config', 'storyline'),
        { notificationEmail: opsValue.trim(), complianceEmail: complianceValue.trim() },
        { merge: true },
      )
      queryClient.invalidateQueries({ queryKey: ['config_storyline'] })
      setOps(null)
      setCompliance(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Violation email routing</h2>
        <p className="text-sm text-muted-foreground">
          Every reported event is stored regardless. These addresses only control
          which events also send an email — see <code>STORYLINE_EMAIL_RULES</code>{' '}
          in <code>functions/index.js</code>. Leave an address blank to send nothing there.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <div className="space-y-1">
          <Label htmlFor="ops-email">Ops address — every emailed event</Label>
          <Input
            id="ops-email"
            type="email"
            placeholder="ops@example.com"
            value={opsValue}
            onChange={e => setOps(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="compliance-email">Compliance address — integrity events only</Label>
          <Input
            id="compliance-email"
            type="email"
            placeholder="compliance@example.com"
            value={complianceValue}
            onChange={e => setCompliance(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </div>
  )
}

export function StorylineActivityPage() {
  const queryClient = useQueryClient()
  const { data: events = [], isLoading, isFetching } = useQuery({
    queryKey: ['storyline_events'],
    queryFn: fetchEvents,
  })

  const [eventFilter, setEventFilter] = useState('')
  const [text, setText] = useState('')
  const [groupByRun, setGroupByRun] = useState(false)

  const eventTypes = useMemo(
    () => [...new Set(events.map(e => e.event))].sort(),
    [events],
  )

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase()
    return events.filter(e => {
      if (eventFilter && e.event !== eventFilter) return false
      if (!needle) return true
      return [e.testDisplayName, e.centreName, e.testNumber, e.examinerName, e.candidateName, e.detail, e.runId]
        .some(v => v.toLowerCase().includes(needle))
    })
  }, [events, eventFilter, text])

  const runs = useMemo(() => {
    if (!groupByRun) return []
    const byRun = new Map<string, NormEvent[]>()
    for (const e of filtered) {
      const list = byRun.get(e.runId) ?? []
      list.push(e)
      byRun.set(e.runId, list)
    }
    return [...byRun.entries()]
      .map(([runId, evts]) => {
        const sorted = [...evts].sort((a, b) => (a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0))
        const first = sorted[0]
        return {
          runId,
          events: sorted,
          started: first?.when ?? null,
          test: sorted.find(e => e.testDisplayName)?.testDisplayName ?? '—',
          centre: sorted.find(e => e.centreName)?.centreName ?? '',
          examiner: sorted.find(e => e.examinerName)?.examinerName ?? '',
          candidate: sorted.find(e => e.candidateName)?.candidateName ?? '',
          flagged: sorted.filter(e => EMAILED.has(e.event) && e.event !== 'test_finished').length,
        }
      })
      .sort((a, b) => (b.started?.getTime() ?? 0) - (a.started?.getTime() ?? 0))
  }, [filtered, groupByRun])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Test activity</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['storyline_events'] })}
          disabled={isFetching}
        >
          <RefreshCw className={`size-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <NotificationSettings />

      <div className="rounded-lg border">
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <div className="space-y-1">
            <Label htmlFor="event-filter" className="text-xs">Event</Label>
            <select
              id="event-filter"
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={eventFilter}
              onChange={e => setEventFilter(e.target.value)}
            >
              <option value="">All events</option>
              {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label htmlFor="event-search" className="text-xs">Search (test / centre / examiner / candidate / detail)</Label>
            <Input
              id="event-search"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Filter…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" className="rounded" checked={groupByRun} onChange={e => setGroupByRun(e.target.checked)} />
            Group by test run
          </label>
        </div>

        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {events.length === 0 ? 'No events reported yet.' : 'No events match the filter.'}
          </p>
        ) : groupByRun ? (
          <div className="divide-y">
            {runs.map(run => (
              <details key={run.runId} className="group">
                <summary className="cursor-pointer list-none px-4 py-3 hover:bg-muted/40">
                  <span className="font-medium">{run.test}</span>
                  {run.centre && <span className="text-muted-foreground"> · {run.centre}</span>}
                  {run.candidate && <span className="text-muted-foreground"> · {run.candidate}</span>}
                  <span className="text-muted-foreground text-sm"> · {fmt(run.started)}</span>
                  <span className="text-muted-foreground text-sm"> · {run.events.length} events</span>
                  {run.flagged > 0 && (
                    <Badge variant="destructive" className="ml-2">{run.flagged} flagged</Badge>
                  )}
                </summary>
                <div className="overflow-x-auto">
                  <Table>
                    <TableBody>
                      {run.events.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground text-sm">{fmt(e.when)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <EventBadge event={e.event} />
                          </TableCell>
                          <TableCell className="text-sm">{e.detail || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Centre</TableHead>
                  <TableHead>Examiner</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-sm">{fmt(e.when)}</TableCell>
                    <TableCell className="whitespace-nowrap"><EventBadge event={e.event} /></TableCell>
                    <TableCell className="text-sm">{e.testDisplayName || '—'}</TableCell>
                    <TableCell className="text-sm">{e.centreName || '—'}</TableCell>
                    <TableCell className="text-sm">{e.examinerName || '—'}</TableCell>
                    <TableCell className="text-sm">{e.candidateName || '—'}</TableCell>
                    <TableCell className="text-sm">{e.detail || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Showing the most recent 500 events. Practice runs and Preview are never recorded.
      </p>
    </div>
  )
}

function EventBadge({ event }: { event: string }) {
  const emailed = EMAILED.has(event)
  return (
    <span className="inline-flex items-center gap-1">
      <code className="text-xs">{event}</code>
      {emailed && <Badge variant="outline" className="text-[10px]">emailed</Badge>}
    </span>
  )
}
