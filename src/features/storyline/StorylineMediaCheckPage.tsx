import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { ArrowLeft, PlayCircle, Wrench, Upload } from 'lucide-react'
import { db, storage } from '@/lib/firebase'
import type { StorylinePart, StorylineVersion, StorylineTest, StorylineSlotContent, StorylineItem, StorylineTemplate } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// `slideLabelById` disambiguates *which* slide a Part's slot content
// belongs to — a Part 3 has 4 audio-bearing slides (Example, Set 1, Set 2,
// Set 3) all needing an "intro"/"recording 1/2/3", so without the slide's
// own label every one of those would report as indistinguishable "audio
// intro" / "recording 1" rows and there'd be no way to tell which Set is
// actually broken.
function partSourceLabel(part: StorylinePart, slideLabel: string | undefined, field: string): string {
  const tags = [part.retired && 'retired', part.isBackup && 'backup', part.status !== 'published' && part.status]
    .filter(Boolean)
    .join(', ')
  return `Part: ${part.label} (Part ${part.partNumber}${tags ? ` — ${tags}` : ''}) · ${slideLabel ?? 'unknown slide'} · ${field}`
}

function collectFromSlotContent(
  slotContent: Record<string, StorylineSlotContent> | undefined,
  slideLabelById: Map<string, string>,
  label: (slideLabel: string | undefined, field: string) => string,
  add: (url: string, source: string) => void,
) {
  for (const [slideId, slot] of Object.entries(slotContent ?? {})) {
    const slideLabel = slideLabelById.get(slideId)
    slot.images?.forEach((u, i) => u && add(u, label(slideLabel, `image ${i + 1}`)))
    if (slot.audio?.intro) add(slot.audio.intro, label(slideLabel, 'audio intro'))
    slot.audio?.recordings?.forEach((u, i) => u && add(u, label(slideLabel, `recording ${i + 1}`)))
    if (slot.audio?.volumeCheck) add(slot.audio.volumeCheck, label(slideLabel, 'volume check'))
  }
}

async function fetchAllRefs(): Promise<MediaRef[]> {
  const [partsSnap, versionsSnap, testsSnap, templateSnap] = await Promise.all([
    getDocs(collection(db, 'storyline_parts')),
    getDocs(collection(db, 'storyline_versions')),
    getDocs(collection(db, 'storyline_tests')),
    getDoc(doc(db, 'storyline_template', 'current')),
  ])
  const parts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePart)
  const versions = versionsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylineVersion)
  const testNameById = new Map(testsSnap.docs.map(d => [d.id, (d.data() as StorylineTest).name]))
  const template = templateSnap.exists() ? (templateSnap.data() as StorylineTemplate) : undefined
  const slideLabelById = new Map((template?.slides ?? []).map(s => [s.id, s.label]))

  const byUrl = new Map<string, MediaRef>()
  const add = (url: string, source: string) => {
    const ref = byUrl.get(url) ?? { url, sources: new Set() }
    ref.sources.add(source)
    byUrl.set(url, ref)
  }

  for (const part of parts) {
    collectFromSlotContent(part.slotContent, slideLabelById, (slideLabel, field) => partSourceLabel(part, slideLabel, field), add)
  }

  for (const version of versions) {
    const testName = testNameById.get(version.testId) ?? version.testId
    const label = `Version: ${testName} — ${version.versionLabel} (${version.status})`
    for (const item of version.items ?? []) {
      item.media?.images?.forEach((u, i) => u && add(u, `${label} · ${item.label} · image ${i + 1}`))
      item.media?.audioClips?.forEach(c => c.url && add(c.url, `${label} · ${item.label} · ${c.label || 'audio'}`))
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

// Whole-field replace (not a targeted array-index update — Firestore has no
// clean way to patch one string inside a nested array/map, and we already
// have the full field loaded, so rebuilding it in JS and writing it back
// whole is simpler and just as safe) of every occurrence of `oldUrl` with
// `newUrl` across a Part's slotContent.
function replaceUrlInSlotContent(
  slotContent: Record<string, StorylineSlotContent>,
  oldUrl: string,
  newUrl: string,
): { changed: boolean; result: Record<string, StorylineSlotContent> } {
  let changed = false
  const result: Record<string, StorylineSlotContent> = {}
  for (const [slideId, slot] of Object.entries(slotContent)) {
    const next: StorylineSlotContent = { ...slot }
    if (next.images?.includes(oldUrl)) {
      next.images = next.images.map(u => (u === oldUrl ? newUrl : u))
      changed = true
    }
    if (next.audio) {
      const audio = { ...next.audio }
      let audioChanged = false
      if (audio.intro === oldUrl) { audio.intro = newUrl; audioChanged = true }
      if (audio.volumeCheck === oldUrl) { audio.volumeCheck = newUrl; audioChanged = true }
      if (audio.recordings?.includes(oldUrl)) {
        audio.recordings = audio.recordings.map(u => (u === oldUrl ? newUrl : u))
        audioChanged = true
      }
      if (audioChanged) { next.audio = audio; changed = true }
    }
    result[slideId] = next
  }
  return { changed, result }
}

// Same idea for a Version's frozen `items[].media` — used when the fix
// target is a published/archived Version's own snapshot rather than (or as
// well as) a Part's editable slotContent.
function replaceUrlInItems(
  items: StorylineItem[],
  oldUrl: string,
  newUrl: string,
): { changed: boolean; result: StorylineItem[] } {
  let changed = false
  const result = items.map(item => {
    if (!item.media) return item
    const media = { ...item.media }
    let itemChanged = false
    if (media.images?.includes(oldUrl)) {
      media.images = media.images.map(u => (u === oldUrl ? newUrl : u))
      itemChanged = true
    }
    if (media.audioClips?.some(c => c.url === oldUrl)) {
      media.audioClips = media.audioClips.map(c => (c.url === oldUrl ? { ...c, url: newUrl } : c))
      itemChanged = true
    }
    if (!itemChanged) return item
    changed = true
    return { ...item, media }
  })
  return { changed, result }
}

interface FixPreview {
  oldUrl: string
  newUrl: string
  parts: { id: string; label: string; slotContent: Record<string, StorylineSlotContent> }[]
  versions: { id: string; label: string; items: StorylineItem[] }[]
}

export function StorylineMediaCheckPage() {
  const queryClient = useQueryClient()
  const { data: refs = [], isLoading } = useQuery({ queryKey: ['storyline_media_refs'], queryFn: fetchAllRefs })
  const [running, setRunning] = useState(false)
  const [checked, setChecked] = useState(0)
  const [results, setResults] = useState<CheckResult[] | null>(null)

  const [fixingUrl, setFixingUrl] = useState<string | null>(null)
  const [newUrlInput, setNewUrlInput] = useState('')
  const [preview, setPreview] = useState<FixPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [fixMessage, setFixMessage] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The panel renders below the whole broken-links table, which can easily
  // run to 50+ rows — without this, clicking "Fix" on an early row opens a
  // panel that's completely off-screen and looks like the click did nothing.
  useEffect(() => {
    if (fixingUrl) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [fixingUrl])

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

  function startFix(url: string) {
    setFixingUrl(url)
    setNewUrlInput('')
    setPreview(null)
    setFixMessage(null)
  }

  // Uploaded to a dedicated shared-media location, deliberately not any one
  // Part's own folder — this fix is for URLs that got reused across many
  // Parts/Versions in the first place (no single Part "owns" it any more),
  // so a future Part deletion elsewhere should never be able to take this
  // replacement out from under everything that now depends on it too.
  function handleReplacementUpload(file: File) {
    const path = `storylines/shared-media/${Date.now()}_${file.name}`
    const task = uploadBytesResumable(storageRef(storage, path), file)
    setUploadProgress(0)
    task.on(
      'state_changed',
      snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => setUploadProgress(null),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        setNewUrlInput(url)
        setUploadProgress(null)
      },
    )
  }

  // Read-only scan — no writes yet. Finds every Part/Version that would
  // change, so the admin sees the blast radius before anything is touched.
  async function previewFix() {
    if (!fixingUrl || !newUrlInput.trim()) return
    setPreviewing(true)
    setFixMessage(null)
    try {
      const oldUrl = fixingUrl
      const newUrl = newUrlInput.trim()
      const [partsSnap, versionsSnap] = await Promise.all([
        getDocs(collection(db, 'storyline_parts')),
        getDocs(collection(db, 'storyline_versions')),
      ])
      const parts: FixPreview['parts'] = []
      for (const d of partsSnap.docs) {
        const part = { id: d.id, ...d.data() } as StorylinePart
        const { changed, result } = replaceUrlInSlotContent(part.slotContent, oldUrl, newUrl)
        if (changed) parts.push({ id: part.id, label: `${part.label} (Part ${part.partNumber})`, slotContent: result })
      }
      const versions: FixPreview['versions'] = []
      for (const d of versionsSnap.docs) {
        const version = { id: d.id, ...d.data() } as StorylineVersion
        const { changed, result } = replaceUrlInItems(version.items ?? [], oldUrl, newUrl)
        if (changed) versions.push({ id: version.id, label: `${version.versionLabel} (${version.status})`, items: result })
      }
      setPreview({ oldUrl, newUrl, parts, versions })
    } finally {
      setPreviewing(false)
    }
  }

  async function applyFix() {
    if (!preview) return
    setApplying(true)
    try {
      const batch = writeBatch(db)
      preview.parts.forEach(p => batch.update(doc(db, 'storyline_parts', p.id), { slotContent: p.slotContent }))
      preview.versions.forEach(v => batch.update(doc(db, 'storyline_versions', v.id), { items: v.items }))
      await batch.commit()
      setFixMessage(`Updated ${preview.parts.length} Part(s) and ${preview.versions.length} Version(s).`)
      setPreview(null)
      setFixingUrl(null)
      queryClient.invalidateQueries({ queryKey: ['storyline_media_refs'] })
      setResults(r => (r ? r.filter(x => x.url !== preview.oldUrl) : r))
    } finally {
      setApplying(false)
    }
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
                <TableHead />
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
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => startFix(r.url)}>
                      <Wrench className="size-4 mr-1" /> Fix
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {fixingUrl && (
        <div ref={panelRef} className="rounded-md border p-4 space-y-3 max-w-2xl scroll-mt-4">
          <h2 className="font-semibold">Replace a broken URL</h2>
          <div className="space-y-1">
            <Label>Old (broken) URL</Label>
            <p className="text-xs text-muted-foreground break-all">{fixingUrl}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-url">Replacement file</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress !== null}
              >
                <Upload className="size-4 mr-2" />
                {uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Upload replacement'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,image/*"
                className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleReplacementUpload(f) }}
              />
              <span className="text-sm text-muted-foreground">or paste a URL you already have:</span>
            </div>
            <Input id="new-url" value={newUrlInput} onChange={e => setNewUrlInput(e.target.value)} placeholder="https://firebasestorage.googleapis.com/…" />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={previewFix} disabled={previewing || !newUrlInput.trim()}>
              {previewing ? 'Scanning…' : 'Preview changes'}
            </Button>
            <Button variant="ghost" onClick={() => setFixingUrl(null)}>Cancel</Button>
          </div>

          {preview && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm">
                This will update <strong>{preview.parts.length}</strong> Part(s) and{' '}
                <strong>{preview.versions.length}</strong> Version(s) — including any published or
                archived ones, whose frozen snapshot will be edited directly.
              </p>
              {preview.parts.length + preview.versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matches found — check the old URL is exact.</p>
              ) : (
                <>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 max-h-48 overflow-y-auto">
                    {preview.parts.map(p => <li key={p.id}>Part: {p.label}</li>)}
                    {preview.versions.map(v => <li key={v.id}>Version: {v.label}</li>)}
                  </ul>
                  <Button onClick={applyFix} disabled={applying}>
                    {applying ? 'Applying…' : `Apply fix to ${preview.parts.length + preview.versions.length} doc(s)`}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {fixMessage && <p className="text-sm text-green-600">{fixMessage}</p>}
    </div>
  )
}
