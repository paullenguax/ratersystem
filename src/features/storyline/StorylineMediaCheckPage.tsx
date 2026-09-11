import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { ArrowLeft, PlayCircle } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StorylinePart, StorylineVersion, StorylineTest, StorylineSlotContent } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// One media URL to verify, with everywhere it's referenced from (the same
// upload is very often reused across multiple slides/roles, so a single
// broken URL can show several sources).
interface MediaRef {
  url: string
  sources: Set<string>
}

interface CheckResult {
  url: string
  sources: string[]
  ok: boolean
  detail: string
}

function partSourceLabel(part: StorylinePart, field: string): string {
  const tags = [part.retired && 'retired', part.isBackup && 'backup', part.status !== 'published' && part.status]
    .filter(Boolean)
    .join(', ')
  return `Part: ${part.label} (Part ${part.partNumber}${tags ? ` — ${tags}` : ''}) · ${field}`
}

function collectFromSlotContent(
  slotContent: Record<string, StorylineSlotContent> | undefined,
  label: (field: string) => string,
  add: (url: string, source: string) => void,
) {
  for (const slot of Object.values(slotContent ?? {})) {
    slot.images?.forEach((u, i) => u && add(u, label(`image ${i + 1}`)))
    if (slot.audio?.intro) add(slot.audio.intro, label('audio intro'))
    slot.audio?.recordings?.forEach((u, i) => u && add(u, label(`recording ${i + 1}`)))
    if (slot.audio?.volumeCheck) add(slot.audio.volumeCheck, label('volume check'))
  }
}

async function fetchAllRefs(): Promise<MediaRef[]> {
  const [partsSnap, versionsSnap, testsSnap] = await Promise.all([
    getDocs(collection(db, 'storyline_parts')),
    getDocs(collection(db, 'storyline_versions')),
    getDocs(collection(db, 'storyline_tests')),
  ])
  const parts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePart)
  const versions = versionsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylineVersion)
  const testNameById = new Map(testsSnap.docs.map(d => [d.id, (d.data() as StorylineTest).name]))

  const byUrl = new Map<string, MediaRef>()
  const add = (url: string, source: string) => {
    const ref = byUrl.get(url) ?? { url, sources: new Set() }
    ref.sources.add(source)
    byUrl.set(url, ref)
  }

  for (const part of parts) {
    collectFromSlotContent(part.slotContent, field => partSourceLabel(part, field), add)
  }

  for (const version of versions) {
    const testName = testNameById.get(version.testId) ?? version.testId
    const label = `Version: ${testName} — ${version.versionLabel} (${version.status})`
    for (const item of version.items ?? []) {
      item.media?.images?.forEach((u, i) => u && add(u, `${label} · image ${i + 1}`))
      item.media?.audioClips?.forEach(c => c.url && add(c.url, `${label} · ${c.label || 'audio'}`))
    }
  }

  return [...byUrl.values()]
}

// Ranged GET (not HEAD — less consistently supported on Storage's download
// endpoint, and this is the exact request shape bundleMedia() in
// exportStoryline.ts already relies on working cross-origin) asking for
// just the first byte, so checking a whole library doesn't download every
// audio file in full. 200 or 206 = reachable; anything else (403/404/...)
// or a thrown network error = broken.
async function checkUrl(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } })
    if (res.status === 200 || res.status === 206) return { ok: true, detail: `${res.status}` }
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error?.message) detail += ` — ${body.error.message}`
    } catch {
      /* body wasn't JSON, keep the plain status */
    }
    return { ok: false, detail }
  } catch (err) {
    return { ok: false, detail: `Network error — ${String(err)}` }
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onOne?: () => void): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
      onOne?.()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function StorylineMediaCheckPage() {
  const { data: refs = [], isLoading } = useQuery({ queryKey: ['storyline_media_refs'], queryFn: fetchAllRefs })
  const [running, setRunning] = useState(false)
  const [checked, setChecked] = useState(0)
  const [results, setResults] = useState<CheckResult[] | null>(null)

  async function runCheck() {
    setRunning(true)
    setChecked(0)
    setResults(null)
    const out = await runWithConcurrency(
      refs,
      6,
      async ref => {
        const { ok, detail } = await checkUrl(ref.url)
        return { url: ref.url, sources: [...ref.sources], ok, detail }
      },
      () => setChecked(c => c + 1),
    )
    setResults(out)
    setRunning(false)
  }

  const broken = results?.filter(r => !r.ok) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold">Check media links</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Verifies every image/audio URL referenced by a Part's content or a Version's published
        snapshot is still downloadable — catches a stale Storage download token or a deleted file
        before it breaks an export. A ranged request (first byte only), not a full download.
      </p>

      <div className="flex items-center gap-3">
        <Button onClick={runCheck} disabled={isLoading || running}>
          <PlayCircle className="size-4 mr-2" />
          {running ? `Checking… (${checked}/${refs.length})` : isLoading ? 'Loading…' : `Run check (${refs.length} links)`}
        </Button>
        {results && (
          <span className="text-sm text-muted-foreground">
            {broken.length === 0
              ? `All ${results.length} links OK.`
              : `${broken.length} of ${results.length} links broken.`}
          </span>
        )}
      </div>

      {broken.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referenced by</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead>URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {broken.map(r => (
                <TableRow key={r.url}>
                  <TableCell className="text-sm">
                    {r.sources.map(s => <div key={s}>{s}</div>)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="destructive">{r.detail}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                    <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.url}</a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
