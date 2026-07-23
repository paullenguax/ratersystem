import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Plus, Pencil, Rocket, Copy, Archive as ArchiveIcon, Trash2, PauseCircle, PlayCircle, Shield, ShieldOff } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { StorylinePart, StorylinePartNumber } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchParts(): Promise<StorylinePart[]> {
  const snap = await getDocs(collection(db, 'storyline_parts'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePart)
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
  const [filter, setFilter] = useState<'all' | StorylinePartNumber>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | StorylinePart['status']>('all')
  const [backupFilter, setBackupFilter] = useState<'all' | 'backup' | 'normal'>('all')
  const [search, setSearch] = useState('')
  const [newPartNumber, setNewPartNumber] = useState<StorylinePartNumber>(1)

  const { data: parts = [], isLoading } = useQuery({ queryKey: ['storyline_parts'], queryFn: fetchParts })

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return parts
      .filter(p => filter === 'all' || p.partNumber === filter)
      .filter(p => statusFilter === 'all' || p.status === statusFilter)
      .filter(p => backupFilter === 'all' || (backupFilter === 'backup' ? !!p.isBackup : !p.isBackup))
      .filter(p => s === '' || p.label.toLowerCase().includes(s))
      .sort((a, b) => a.partNumber - b.partNumber || a.label.localeCompare(b.label))
  }, [parts, filter, statusFilter, backupFilter, search])

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
    if (!window.confirm(`Publish "${part.label}"? Published Parts are immutable — further edits require duplicating as a new draft.`)) return
    await updateDoc(doc(db, 'storyline_parts', part.id), { status: 'published', publishedAt: serverTimestamp() })
    queryClient.invalidateQueries({ queryKey: ['storyline_parts'] })
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {parts.length === 0 ? 'No Parts yet.' : 'No Parts match this filter.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(part => (
                  <TableRow key={part.id}>
                    <TableCell>Part {part.partNumber}</TableCell>
                    <TableCell>{part.label}</TableCell>
                    <TableCell><Badge variant={statusVariant(part.status)}>{part.status}</Badge></TableCell>
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
                        <Button variant="ghost" size="sm" onClick={() => handleDuplicate(part)}>
                          <Copy className="size-4 mr-1" /> Duplicate
                        </Button>
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
