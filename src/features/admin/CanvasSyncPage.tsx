import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import type { Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle2, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, X } from 'lucide-react'

// ── types ──────────────────────────────────────────────────────────────────

interface CanvasConfig {
  apiToken: string
  courses: { id: string; name: string }[]
}

interface CanvasUser {
  canvasId: number
  name: string
  email: string
}

type MatchStatus = 'matched' | 'possible' | 'new'
type Decision = 'confirm' | 'skip' | 'add'

interface SyncRow {
  canvasUser: CanvasUser
  status: MatchStatus
  matchedPersonId?: string
  matchedPersonName?: string
  decision: Decision
  newRole: Person['role']
}

// ── helpers ────────────────────────────────────────────────────────────────

function normalizeName(n: string) {
  return n.toLowerCase().replace(/\s+/g, ' ').trim()
}

function nameSimilar(a: string, b: string) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na === nb) return true
  const wa = na.split(' ')
  const wb = nb.split(' ')
  const overlap = wa.filter(w => wb.includes(w)).length
  return overlap >= 2 || (overlap >= 1 && Math.min(wa.length, wb.length) === 1)
}

const canvasEnrollmentsFn = httpsCallable<{ courseId: string }, { users: CanvasUser[] }>(functions, 'canvasEnrollments')

async function fetchCanvasEnrollments(courseId: string): Promise<CanvasUser[]> {
  const result = await canvasEnrollmentsFn({ courseId })
  return result.data.users
}

function buildRows(canvasUsers: CanvasUser[], people: Person[]): SyncRow[] {
  return canvasUsers.map(cu => {
    const exact = people.find(p => p.email?.toLowerCase() === cu.email)
    if (exact) {
      return { canvasUser: cu, status: 'matched', matchedPersonId: exact.id, matchedPersonName: exact.name, decision: 'confirm', newRole: 'trainee' }
    }
    const fuzzy = people.find(p => nameSimilar(p.name, cu.name))
    if (fuzzy) {
      return { canvasUser: cu, status: 'possible', matchedPersonId: fuzzy.id, matchedPersonName: fuzzy.name, decision: 'skip', newRole: 'trainee' }
    }
    return { canvasUser: cu, status: 'new', decision: 'skip', newRole: 'trainee' }
  })
}

// ── CanvasSyncPage ──────────────────────────────────────────────────────────

export function CanvasSyncPage() {
  const [config, setConfig] = useState<CanvasConfig | null>(null)
  const [tokenDraft, setTokenDraft] = useState('')
  const [coursesDraft, setCoursesDraft] = useState<{ id: string; name: string }[]>([])
  const [newCourseId, setNewCourseId] = useState('')
  const [newCourseName, setNewCourseName] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [rows, setRows] = useState<SyncRow[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ added: number; linked: number } | null>(null)

  useEffect(() => {
    getDoc(doc(db, 'config', 'canvas')).then(snap => {
      if (snap.exists()) {
        const data = snap.data() as CanvasConfig
        setConfig(data)
        setTokenDraft(data.apiToken ?? '')
        setCoursesDraft(data.courses ?? [])
        if (data.courses?.length) setSelectedCourseId(data.courses[0].id)
      } else {
        setConfig({ apiToken: '', courses: [] })
        setShowSettings(true)
      }
    })
  }, [])

  async function saveConfig() {
    setSavingConfig(true)
    try {
      const next: CanvasConfig = { apiToken: tokenDraft, courses: coursesDraft }
      await setDoc(doc(db, 'config', 'canvas'), next)
      setConfig(next)
      if (!selectedCourseId && coursesDraft.length) setSelectedCourseId(coursesDraft[0].id)
    } finally {
      setSavingConfig(false)
    }
  }

  function addCourse() {
    if (!newCourseId || !newCourseName) return
    setCoursesDraft(prev => [...prev, { id: newCourseId.trim(), name: newCourseName.trim() }])
    setNewCourseId('')
    setNewCourseName('')
  }

  async function fetchEnrollments() {
    if (!config?.apiToken || !selectedCourseId) return
    setFetching(true)
    setFetchError('')
    setRows([])
    setApplyResult(null)
    try {
      const [canvasUsers, snap] = await Promise.all([
        fetchCanvasEnrollments(selectedCourseId),
        getDocs(collection(db, 'people')),
      ])
      const people = snap.docs.map(d => ({ id: d.id, ...d.data() } as Person))
      setRows(buildRows(canvasUsers, people))
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch Canvas enrollments')
    } finally {
      setFetching(false)
    }
  }

  function updateRow(i: number, patch: Partial<SyncRow>) {
    setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r))
  }

  async function applyChanges() {
    setApplying(true)
    try {
      let added = 0
      let linked = 0
      const batch = writeBatch(db)

      for (const row of rows) {
        if (row.status === 'possible' && row.decision === 'confirm' && row.matchedPersonId) {
          batch.update(doc(db, 'people', row.matchedPersonId), { email: row.canvasUser.email })
          linked++
        } else if (row.status === 'new' && row.decision === 'add') {
          batch.set(doc(collection(db, 'people')), {
            name: row.canvasUser.name,
            email: row.canvasUser.email,
            role: row.newRole,
            status: 'active',
            notes: '',
            createdAt: serverTimestamp(),
          })
          added++
        }
      }

      await batch.commit()
      setApplyResult({ added, linked })
    } finally {
      setApplying(false)
    }
  }

  const matched = rows.filter(r => r.status === 'matched').length
  const possible = rows.filter(r => r.status === 'possible').length
  const newCount = rows.filter(r => r.status === 'new').length
  const pending = rows.filter(r =>
    (r.status === 'possible' && r.decision === 'confirm') ||
    (r.status === 'new' && r.decision === 'add'),
  ).length

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Canvas Sync</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Match Canvas course enrollments to people in RaterSystem.
        </p>
      </div>

      {/* Settings */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
          onClick={() => setShowSettings(v => !v)}
        >
          <span className="flex items-center gap-2">
            Settings
            {config !== null && !config.apiToken && (
              <span className="text-xs text-amber-600 font-normal">— API token not set</span>
            )}
          </span>
          {showSettings ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {showSettings && (
          <div className="border-t px-4 py-4 space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Canvas API Token</label>
              <Input
                type="password"
                value={tokenDraft}
                onChange={e => setTokenDraft(e.target.value)}
                placeholder="Paste your Canvas personal access token"
              />
              <p className="text-xs text-muted-foreground">
                Canvas → Account → Settings → Approved Integrations → New Access Token
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Courses</label>
              {coursesDraft.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={c.name}
                    onChange={e => setCoursesDraft(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="Course name"
                    className="flex-1"
                  />
                  <Input
                    value={c.id}
                    onChange={e => setCoursesDraft(prev => prev.map((x, j) => j === i ? { ...x, id: e.target.value } : x))}
                    placeholder="ID"
                    className="w-24"
                  />
                  <button
                    type="button"
                    onClick={() => setCoursesDraft(prev => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={newCourseName}
                  onChange={e => setNewCourseName(e.target.value)}
                  placeholder="Course name"
                  className="flex-1"
                  onKeyDown={e => e.key === 'Enter' && addCourse()}
                />
                <Input
                  value={newCourseId}
                  onChange={e => setNewCourseId(e.target.value)}
                  placeholder="ID"
                  className="w-24"
                  onKeyDown={e => e.key === 'Enter' && addCourse()}
                />
                <Button type="button" variant="outline" size="sm" onClick={addCourse} disabled={!newCourseId || !newCourseName}>
                  Add
                </Button>
              </div>
            </div>

            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        )}
      </div>

      {/* Fetch */}
      {config?.apiToken && (
        <div className="flex items-center gap-3">
          <Select value={selectedCourseId} onValueChange={v => setSelectedCourseId(v ?? '')}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select course…" />
            </SelectTrigger>
            <SelectContent>
              {(config.courses ?? []).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={fetchEnrollments} disabled={fetching || !selectedCourseId}>
            {fetching
              ? <><RefreshCw className="size-4 mr-2 animate-spin" />Fetching…</>
              : 'Fetch enrollments'}
          </Button>
        </div>
      )}

      {fetchError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />
          {fetchError}
        </div>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <>
          <div className="flex gap-4 text-sm">
            <span className="text-green-700 font-medium">{matched} matched</span>
            {possible > 0 && <span className="text-amber-700 font-medium">{possible} need review</span>}
            {newCount > 0 && <span className="text-muted-foreground">{newCount} not in system</span>}
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Canvas user</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.canvasUser.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{row.canvasUser.email}</p>
                    </td>
                    <td className="px-3 py-2">
                      {row.status === 'matched' && (
                        <div className="flex items-center gap-1.5 text-green-700 text-xs">
                          <CheckCircle2 className="size-3.5 shrink-0" />
                          {row.matchedPersonName}
                        </div>
                      )}
                      {row.status === 'possible' && (
                        <div className="flex items-center gap-1.5 text-amber-700 text-xs">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          Possible: {row.matchedPersonName}
                        </div>
                      )}
                      {row.status === 'new' && (
                        <span className="text-xs text-muted-foreground">Not in system</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === 'matched' && (
                        <span className="text-xs text-green-700">Canvas login ready</span>
                      )}
                      {row.status === 'possible' && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant={row.decision === 'confirm' ? 'default' : 'outline'}
                            className="h-7 text-xs"
                            onClick={() => updateRow(i, { decision: row.decision === 'confirm' ? 'skip' : 'confirm' })}
                          >
                            {row.decision === 'confirm' ? '✓ Link' : 'Link'}
                          </Button>
                        </div>
                      )}
                      {row.status === 'new' && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={row.decision === 'add' ? 'default' : 'outline'}
                            className="h-7 text-xs"
                            onClick={() => updateRow(i, { decision: row.decision === 'add' ? 'skip' : 'add' })}
                          >
                            {row.decision === 'add' ? '✓ Add' : '+ Add'}
                          </Button>
                          {row.decision === 'add' && (
                            <Select value={row.newRole} onValueChange={v => updateRow(i, { newRole: v as Person['role'] })}>
                              <SelectTrigger className="h-7 w-36 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="trainee">Trainee</SelectItem>
                                <SelectItem value="senior_rater">Senior rater</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!applyResult && (
            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                {pending} change{pending !== 1 ? 's' : ''} pending
              </p>
              <Button onClick={applyChanges} disabled={applying || pending === 0}>
                {applying ? 'Applying…' : 'Apply changes'}
              </Button>
            </div>
          )}

          {applyResult && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
              <CheckCircle2 className="size-5 text-green-600 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-green-800">Done.</p>
                {applyResult.added > 0 && <p className="text-green-700">{applyResult.added} people added to RaterSystem.</p>}
                {applyResult.linked > 0 && <p className="text-green-700">{applyResult.linked} people linked to their Canvas email.</p>}
                {applyResult.added === 0 && applyResult.linked === 0 && <p className="text-green-700">No changes needed.</p>}
              </div>
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => { setRows([]); setApplyResult(null) }}>
                Sync again
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
