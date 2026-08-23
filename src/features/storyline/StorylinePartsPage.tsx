import { Fragment, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, getDoc, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Plus, Pencil, Rocket, Copy, Archive as ArchiveIcon, Trash2, PauseCircle, PlayCircle, Shield, ShieldOff, Tag, Download } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { StorylinePart, StorylinePartNumber, StorylinePartTheme, StorylineTemplate, StorylineTestType } from '@/types'
import { missingPartContent } from './partCompleteness'
import { exportStorylinePart } from './exportStoryline'
import { TEST_TYPES } from './StorylineTestDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchParts(): Promise<StorylinePart[]> {
  const snap = await getDocs(collection(db, 'storyline_parts'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePart)
}

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', 'current'))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

async function fetchThemes(): Promise<StorylinePartTheme[]> {
  const snap = await getDocs(collection(db, 'storyline_themes'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePartTheme).sort((a, b) => a.label.localeCompare(b.label))
}

// Base UI's <Select.Value> displays the raw `value` unless given a render
// function — it does not look up the matching <SelectItem>'s children.
const STATUS_FILTER_LABELS: Record<string, string> = {
  all: 'All statuses', draft: 'Draft', published: 'Published', archived: 'Archived',
}
const BACKUP_FILTER_LABELS: Record<string, string> = {
  all: 'Normal + backup', normal: 'Normal only', backup: 'Backups only',
}

function statusVariant(status: StorylinePart['status']) {
  if (status === 'published') return 'default'
  if (status === 'archived') return 'secondary'
  return 'outline'
}

export function StorylinePartsPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Filters live in the URL, not plain useState — so clicking into a Part
  // to edit it and then going back (in-app arrow or the browser's own Back)
  // restores exactly where you left off, instead of resetting to defaults.
  // replace: true so toggling filters doesn't spam browser history — Back
  // should step between pages, not between individual filter clicks.
  const [searchParams, setSearchParams] = useSearchParams()
  function setParam(key: string, value: string, isDefault: boolean) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (isDefault) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }

  const filterParam = searchParams.get('part')
  const filter: 'all' | StorylinePartNumber = filterParam && ['1', '2', '3', '4'].includes(filterParam)
    ? (Number(filterParam) as StorylinePartNumber) : 'all'
  const setFilter = (v: 'all' | StorylinePartNumber) => setParam('part', String(v), v === 'all')

  const statusFilter = (searchParams.get('status') ?? 'all') as 'all' | StorylinePart['status']
  const setStatusFilter = (v: 'all' | StorylinePart['status']) => setParam('status', v, v === 'all')

  const backupFilter = (searchParams.get('backup') ?? 'all') as 'all' | 'backup' | 'normal'
  const setBackupFilter = (v: 'all' | 'backup' | 'normal') => setParam('backup', v, v === 'all')

  const showArchived = searchParams.get('archived') === '1'
  const setShowArchived = (v: boolean) => setParam('archived', '1', !v)

  const search = searchParams.get('q') ?? ''
  const setSearch = (v: string) => setParam('q', v, v.trim() === '')

  const testTypeFilter = (searchParams.get('testType') ?? 'all') as 'all' | StorylineTestType
  const setTestTypeFilter = (v: 'all' | StorylineTestType) => setParam('testType', v, v === 'all')

  // Not filters — transient, per-visit UI state, deliberately not persisted
  // to the URL (a tag-editor left stuck open, or a "create as Part 3" pick
  // that's no longer what you want, would be a confusing thing to restore).
  const [newPartNumber, setNewPartNumber] = useState<StorylinePartNumber>(1)
  const [editingTestTypesId, setEditingTestTypesId] = useState<string | null>(null)

  const { data: parts = [], isLoading } = useQuery({ queryKey: ['storyline_parts'], queryFn: fetchParts })
  const { data: template } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })
  const { data: themes = [] } = useQuery({ queryKey: ['storyline_themes'], queryFn: fetchThemes })

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return parts
      .filter(p => filter === 'all' || p.partNumber === filter)
      .filter(p => statusFilter === 'all' || p.status === statusFilter)
      // Archived Parts pile up and rarely matter day-to-day — hidden unless
      // explicitly shown, or explicitly filtered to "Archived" above.
      .filter(p => showArchived || statusFilter === 'archived' || p.status !== 'archived')
      .filter(p => backupFilter === 'all' || (backupFilter === 'backup' ? !!p.isBackup : !p.isBackup))
      // Untagged Parts (testTypes undefined/empty) are eligible for every
      // Test Type — the backward-compatible default, see StorylinePart.testTypes.
      .filter(p => testTypeFilter === 'all' || !p.testTypes?.length || p.testTypes.includes(testTypeFilter))
      .filter(p => s === '' || p.label.toLowerCase().includes(s))
      .sort((a, b) => a.partNumber - b.partNumber || a.label.localeCompare(b.label))
  }, [parts, filter, statusFilter, backupFilter, testTypeFilter, showArchived, search])

  async function handleNewPart() {
    await addDoc(collection(db, 'storyline_parts'), {
      partNumber: newPartNumber,
      label: `Part ${newPartNumber} draft`,
      status: 'draft',
      slotContent: {},
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
    })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  async function handleDuplicate(part: StorylinePart) {
    await addDoc(collection(db, 'storyline_parts'), {
      partNumber: part.partNumber,
      label: `${part.label} (copy)`,
      status: 'draft',
      slotContent: part.slotContent,
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
    })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  async function handlePublish(part: StorylinePart) {
    if (!template) {
      window.alert('No Script Template found — set one up first.')
      return
    }
    const missing = missingPartContent(template.slides, part.partNumber, part.slotContent)
    if (missing.length > 0) {
      window.alert(`Can't publish "${part.label}" — still missing:\n${missing.map(m => `- ${m}`).join('\n')}`)
      return
    }
    if (!window.confirm(`Publish "${part.label}"? Published Parts are immutable — further edits require duplicating as a new draft.`)) return
    await updateDoc(doc(db, 'storyline_parts', part.id), { status: 'published', publishedAt: serverTimestamp() })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  const [exportingId, setExportingId] = useState<string | null>(null)
  async function handleExport(part: StorylinePart) {
    setExportingId(part.id)
    try {
      await exportStorylinePart(part)
    } finally {
      setExportingId(null)
    }
  }

  async function handleArchive(part: StorylinePart) {
    if (!window.confirm(`Archive "${part.label}"?`)) return
    await updateDoc(doc(db, 'storyline_parts', part.id), { status: 'archived' })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  async function handleDelete(part: StorylinePart) {
    if (!window.confirm(`Delete "${part.label}"? This can't be undone. If any draft version currently references this Part, it'll need a different one selected.`)) return
    await deleteDoc(doc(db, 'storyline_parts', part.id))
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  async function handleToggleActive(part: StorylinePart) {
    const nextActive = part.active === false
    await updateDoc(doc(db, 'storyline_parts', part.id), { active: nextActive })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  async function handleToggleBackup(part: StorylinePart) {
    await updateDoc(doc(db, 'storyline_parts', part.id), { isBackup: !part.isBackup })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  // Label is just an organizational name, not test content, so renaming is
  // safe even on a published (otherwise-immutable) Part — mainly useful to
  // clean up a Duplicate's default "(copy)" name.
  async function handleRename(part: StorylinePart) {
    const next = window.prompt('Rename this Part (label only — does not affect its content):', part.label)
    if (next === null) return
    const trimmed = next.trim()
    if (trimmed === '' || trimmed === part.label) return
    await updateDoc(doc(db, 'storyline_parts', part.id), { label: trimmed })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  // Metadata for the one-off legacy exposure backfill (see /home/paul/
  // .claude/plans/encapsulated-drifting-corbato.md §6) — never read at
  // export/selection time, so safe to edit regardless of publish status,
  // same reasoning as label rename above.
  async function handleSetLegacyCode(part: StorylinePart) {
    const next = window.prompt(
      "Legacy content-pool code from TEAC_Test_Versions.xlsx (e.g. \"001-A-1-001\" for a Part 1, \"W001\" for a shared Part 2 pool). Leave blank if this Part has no legacy equivalent:",
      part.legacyCode ?? '',
    )
    if (next === null) return
    const trimmed = next.trim()
    if (trimmed === (part.legacyCode ?? '')) return
    await updateDoc(doc(db, 'storyline_parts', part.id), { legacyCode: trimmed || null })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  // Eligibility tagging, not test content — safe to edit regardless of
  // publish status, same reasoning as label rename above.
  async function handleToggleTestType(part: StorylinePart, type: StorylineTestType) {
    const current = part.testTypes ?? []
    const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type]
    await updateDoc(doc(db, 'storyline_parts', part.id), { testTypes: next })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  // Topic tagging, not test content — safe to edit regardless of publish
  // status, same reasoning as label rename / test-type tagging above.
  // Only meaningful for Part 1/4 (see StorylinePart.themeId).
  async function handleSetTheme(part: StorylinePart, themeId: string | null) {
    await updateDoc(doc(db, 'storyline_parts', part.id), { themeId: !themeId || themeId === 'none' ? null : themeId })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Parts Library</h1>
          <p className="text-sm text-muted-foreground">
            Reusable Part content, shared across tests. A version picks one Part per number.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex gap-1">
            {(['all', 1, 2, 3, 4] as const).map(n => (
              <Button key={n} variant={filter === n ? 'default' : 'outline'} size="sm" onClick={() => setFilter(n)}>
                {n === 'all' ? 'All' : `Part ${n}`}
              </Button>
            ))}
          </div>
          <Input
            placeholder="Search label…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-48"
          />
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All statuses">{(v: string) => STATUS_FILTER_LABELS[v] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={backupFilter} onValueChange={v => setBackupFilter(v as typeof backupFilter)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All Parts">{(v: string) => BACKUP_FILTER_LABELS[v] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Normal + backup</SelectItem>
              <SelectItem value="normal">Normal only</SelectItem>
              <SelectItem value="backup">Backups only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={testTypeFilter} onValueChange={v => setTestTypeFilter(v as typeof testTypeFilter)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All test types">{(v: string) => v === 'all' ? 'All test types' : v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All test types</SelectItem>
              {TEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="rounded"
            />
            <span>Show archived</span>
          </label>
        </div>
        <div className="flex gap-2">
          <div className="w-28">
            <Select value={String(newPartNumber)} onValueChange={v => setNewPartNumber(Number(v) as StorylinePartNumber)}>
              <SelectTrigger><SelectValue>{(v: string) => `Part ${v}`}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Part 1</SelectItem>
                <SelectItem value="2">Part 2</SelectItem>
                <SelectItem value="3">Part 3</SelectItem>
                <SelectItem value="4">Part 4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleNewPart}>
            <Plus className="size-4 mr-2" /> New Part
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Backup</TableHead>
                <TableHead>Test types</TableHead>
                <TableHead>Theme</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    {parts.length === 0 ? 'No Parts yet.' : 'No Parts match this filter.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(part => (
                  <Fragment key={part.id}>
                    <TableRow>
                      <TableCell>Part {part.partNumber}</TableCell>
                      <TableCell>{part.label}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={statusVariant(part.status)}>{part.status}</Badge>
                          {(() => {
                            // Checked against the *current* template, not
                            // the one live when this Part was published —
                            // a template requirement (e.g. Part 2's volume-
                            // check clip) added after a Part was already
                            // published never gets retroactively enforced
                            // (published Parts are immutable), so this is
                            // the only way to spot the gap short of
                            // duplicating every Part to check by hand.
                            if (!template) return null
                            const missing = missingPartContent(template.slides, part.partNumber, part.slotContent)
                            if (missing.length === 0) return null
                            return (
                              <Badge variant="destructive" title={`Missing:\n${missing.map(m => `- ${m}`).join('\n')}`}>
                                {missing.length} missing
                              </Badge>
                            )
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        {part.status === 'published' ? (
                          <Badge variant={part.active === false ? 'secondary' : 'default'}>
                            {part.active === false ? 'inactive' : 'active'}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {part.isBackup ? <Badge variant="outline">backup</Badge> : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-48">
                          {part.testTypes?.length
                            ? part.testTypes.map(t => <Badge key={t} variant="outline">{t}</Badge>)
                            : <span className="text-muted-foreground text-sm">All</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {part.partNumber === 1 || part.partNumber === 4 ? (
                          <Select value={part.themeId ?? 'none'} onValueChange={v => handleSetTheme(part, v)}>
                            <SelectTrigger className="w-36">
                              <SelectValue placeholder="No theme">
                                {(v: string) => v === 'none' ? 'No theme' : (themes.find(t => t.id === v)?.label ?? v)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No theme</SelectItem>
                              {themes.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          {part.status === 'draft' && (
                            <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/test-versions/parts/${part.id}/edit`} />}>
                              <Pencil className="size-4 mr-1" /> Edit
                            </Button>
                          )}
                          {part.status === 'draft' && (
                            <Button variant="ghost" size="sm" onClick={() => handlePublish(part)}>
                              <Rocket className="size-4 mr-1" /> Publish
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleRename(part)}>
                            <Tag className="size-4 mr-1" /> Rename
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleSetLegacyCode(part)}>
                            <Tag className="size-4 mr-1" /> {part.legacyCode ? `Legacy: ${part.legacyCode}` : 'Legacy code'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingTestTypesId(editingTestTypesId === part.id ? null : part.id)}>
                            <Tag className="size-4 mr-1" /> Test types
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDuplicate(part)}>
                            <Copy className="size-4 mr-1" /> Duplicate
                          </Button>
                          {part.status === 'published' && (
                            <Button variant="ghost" size="sm" onClick={() => handleExport(part)} disabled={exportingId === part.id}>
                              <Download className="size-4 mr-1" /> {exportingId === part.id ? 'Exporting…' : 'Export'}
                            </Button>
                          )}
                          {part.status === 'published' && (
                            <Button variant="ghost" size="sm" onClick={() => handleToggleActive(part)}>
                              {part.active === false
                                ? <><PlayCircle className="size-4 mr-1" /> Reactivate</>
                                : <><PauseCircle className="size-4 mr-1" /> Deactivate</>}
                            </Button>
                          )}
                          {part.status !== 'archived' && (
                            <Button variant="ghost" size="sm" onClick={() => handleToggleBackup(part)}>
                              {part.isBackup
                                ? <><ShieldOff className="size-4 mr-1" /> Unmark backup</>
                                : <><Shield className="size-4 mr-1" /> Mark as backup</>}
                            </Button>
                          )}
                          {part.status === 'published' && (
                            <Button variant="ghost" size="sm" onClick={() => handleArchive(part)}>
                              <ArchiveIcon className="size-4 mr-1" /> Archive
                            </Button>
                          )}
                          {part.status === 'draft' && (
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(part)}>
                              <Trash2 className="size-4 mr-1" /> Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {editingTestTypesId === part.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30">
                          <div className="flex flex-wrap gap-2 py-1">
                            {TEST_TYPES.map(t => {
                              const selected = part.testTypes?.includes(t) ?? false
                              return (
                                <Button
                                  key={t}
                                  type="button"
                                  size="sm"
                                  variant={selected ? 'default' : 'outline'}
                                  onClick={() => handleToggleTestType(part, t)}
                                >
                                  {t}
                                </Button>
                              )
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground pb-1">
                            None selected = eligible for every test type.
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
