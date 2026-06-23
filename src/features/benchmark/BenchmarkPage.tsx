import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, doc, addDoc, setDoc, deleteDoc,
  updateDoc, orderBy, query, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Trash2, Link2, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Person } from '@/types'
import {
  POOLS, LEVEL_LABELS, LEVEL_COLOURS,
  type BenchmarkItem, type BenchmarkResult, type BenchmarkPool,
} from './types'
import { MOCK_ITEMS } from './mockItems'

type Tab = 'results' | 'items'

// ── Results tab ───────────────────────────────────────────────────────────────

function ResultsTab() {
  const queryClient = useQueryClient()
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [personSearch, setPersonSearch] = useState('')

  const { data: results = [] } = useQuery({
    queryKey: ['benchmark_results'],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'benchmark_results'), orderBy('timestamp', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as BenchmarkResult)
    },
  })

  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'people'))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Person)
    },
  })

  const visible = useMemo(() =>
    filterLevel === 'all' ? results : results.filter(r => String(r.indicativeLevel) === filterLevel),
    [results, filterLevel],
  )

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    results.forEach(r => { const k = String(r.indicativeLevel); counts[k] = (counts[k] ?? 0) + 1 })
    return counts
  }, [results])

  async function handleLinkPerson(resultId: string, person: Person) {
    await updateDoc(doc(db, 'benchmark_results', resultId), {
      linkedPersonId: person.id,
      linkedPersonName: person.name,
    })
    queryClient.invalidateQueries({ queryKey: ['benchmark_results'] })
    setLinking(null)
    setPersonSearch('')
  }

  async function handleUnlink(resultId: string) {
    await updateDoc(doc(db, 'benchmark_results', resultId), {
      linkedPersonId: null,
      linkedPersonName: null,
    })
    queryClient.invalidateQueries({ queryKey: ['benchmark_results'] })
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete result for ${name}?`)) return
    await deleteDoc(doc(db, 'benchmark_results', id))
    queryClient.invalidateQueries({ queryKey: ['benchmark_results'] })
  }

  const filteredPeople = people.filter(p =>
    p.name.toLowerCase().includes(personSearch.toLowerCase()) ||
    (p.email ?? '').toLowerCase().includes(personSearch.toLowerCase())
  ).slice(0, 8)

  return (
    <div className="space-y-4">
      {/* Level filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'below4', '4', '5', '6'].map(lvl => (
          <button
            key={lvl}
            onClick={() => setFilterLevel(lvl)}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              filterLevel === lvl ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
            }`}
          >
            {lvl === 'all' ? `All (${results.length})` : `${LEVEL_LABELS[lvl] ?? lvl} (${levelCounts[lvl] ?? 0})`}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          No results yet.
        </div>
      )}

      {visible.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-6"></th>
                <th className="px-3 py-2 text-left font-medium">Candidate</th>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-left font-medium">Scores</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Linked person</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(res => (
                <>
                  <tr key={res.id} className="border-t hover:bg-muted/20">
                    <td className="px-2 py-2">
                      <button onClick={() => setExpanded(expanded === res.id ? null : res.id)} className="text-muted-foreground hover:text-foreground">
                        {expanded === res.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{res.candidateName || '—'}</p>
                      <p className="text-xs text-muted-foreground font-mono">{res.candidateEmail || '—'}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${LEVEL_COLOURS[String(res.indicativeLevel)]}`}>
                        {LEVEL_LABELS[String(res.indicativeLevel)] ?? res.indicativeLevel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                      P1:{res.scores?.phase1 ?? '?'} P2:{res.scores?.phase2 ?? '?'} P3:{res.scores?.phase3 ?? '?'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {res.timestamp ? new Date(res.timestamp.seconds * 1000).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {res.linkedPersonName ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-green-700 font-medium">{res.linkedPersonName}</span>
                          <button onClick={() => handleUnlink(res.id)} className="text-xs text-muted-foreground hover:text-red-600">×</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setLinking(linking === res.id ? null : res.id); setPersonSearch('') }}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Link2 className="size-3" /> Link
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => handleDelete(res.id, res.candidateName)} className="text-muted-foreground hover:text-red-600">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>

                  {/* Link person panel */}
                  {linking === res.id && (
                    <tr key={`link-${res.id}`} className="border-t bg-muted/30">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="space-y-2 max-w-sm">
                          <p className="text-xs font-medium">Search people to link:</p>
                          <Input
                            autoFocus
                            placeholder="Name or email…"
                            value={personSearch}
                            onChange={e => setPersonSearch(e.target.value)}
                            className="h-7 text-xs"
                          />
                          {filteredPeople.map(p => (
                            <button
                              key={p.id}
                              onClick={() => handleLinkPerson(res.id, p)}
                              className="flex flex-col items-start w-full text-left px-2 py-1 rounded hover:bg-muted text-xs"
                            >
                              <span className="font-medium">{p.name}</span>
                              <span className="text-muted-foreground">{p.email}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Expanded responses */}
                  {expanded === res.id && (
                    <tr key={`exp-${res.id}`} className="border-t bg-muted/20">
                      <td colSpan={7} className="px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Responses ({res.responses?.length ?? 0} items)</p>
                        <div className="flex flex-wrap gap-1">
                          {(res.responses ?? []).map((r, i) => (
                            <span
                              key={i}
                              title={`${r.itemId}: selected ${r.selected}`}
                              className={`text-xs px-1.5 py-0.5 rounded font-mono ${r.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                            >
                              {r.itemId}:{r.selected}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Item form ─────────────────────────────────────────────────────────────────

const BLANK: Omit<BenchmarkItem, 'id'> = {
  pool: 'phase1', section: 'A', band: 4, construct: 'vocabulary',
  modality: 'reading', active: true,
  stimulus: '', audioRef: '', question: '',
  options: ['', '', '', ''], correct: 'A', feedback: '',
}

function ItemForm({ initial, onSave, onCancel }: {
  initial?: BenchmarkItem | null
  onSave: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Omit<BenchmarkItem, 'id'>>(
    initial ? { ...initial, options: [...initial.options] as [string,string,string,string], stimulus: initial.stimulus ?? '', audioRef: initial.audioRef ?? '' }
            : { ...BLANK, options: [...BLANK.options] as [string,string,string,string] }
  )
  const [saving, setSaving] = useState(false)

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }
  function setOption(i: number, v: string) {
    const opts = [...form.options] as [string,string,string,string]
    opts[i] = v
    setForm(f => ({ ...f, options: opts }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const item = { ...form, band: Number(form.band) as 4|5|6, stimulus: form.stimulus?.trim() || null, audioRef: form.audioRef?.trim() || null }
    if (initial?.id) {
      await setDoc(doc(db, 'benchmark_items', initial.id), item, { merge: true })
    } else {
      await addDoc(collection(db, 'benchmark_items'), { ...item, createdAt: serverTimestamp() })
    }
    setSaving(false)
    onSave()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-3 gap-3">
        {(['pool','section','band'] as const).map(field => (
          <div key={field} className="space-y-1">
            <label className="text-xs text-muted-foreground capitalize">{field}</label>
            <select value={String(form[field])} onChange={e => set(field, (field === 'band' ? Number(e.target.value) : e.target.value) as never)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {field === 'pool'    && POOLS.map(p => <option key={p} value={p}>{p}</option>)}
              {field === 'section' && ['A','B','C'].map(s => <option key={s} value={s}>{s}</option>)}
              {field === 'band'    && [4,5,6].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(['modality','construct'] as const).map(field => (
          <div key={field} className="space-y-1">
            <label className="text-xs text-muted-foreground capitalize">{field}</label>
            <select value={form[field]} onChange={e => set(field, e.target.value as never)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {field === 'modality'  && ['reading','listening'].map(v => <option key={v}>{v}</option>)}
              {field === 'construct' && ['vocabulary','structure','comprehension'].map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        ))}
        <div className="space-y-1 flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
      </div>

      {form.modality === 'reading' ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Stimulus (optional)</label>
          <Textarea rows={3} value={form.stimulus ?? ''} onChange={e => set('stimulus', e.target.value)} placeholder="Passage, NOTAM, report…" className="text-sm" />
        </div>
      ) : (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Audio file path</label>
          <Input value={form.audioRef ?? ''} onChange={e => set('audioRef', e.target.value)} placeholder="audio/filename.mp3" />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Question</label>
        <Textarea rows={2} value={form.question} onChange={e => set('question', e.target.value)} required className="text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(['A','B','C','D'] as const).map((label, i) => (
          <div key={label} className="space-y-1">
            <label className="text-xs text-muted-foreground">Option {label}</label>
            <Input value={form.options[i]} onChange={e => setOption(i, e.target.value)} required />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Correct answer</label>
        <select value={form.correct} onChange={e => set('correct', e.target.value as 'A'|'B'|'C'|'D')}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          {['A','B','C','D'].map(l => <option key={l}>{l}</option>)}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Feedback / explanation</label>
        <Textarea rows={2} value={form.feedback} onChange={e => set('feedback', e.target.value)} className="text-sm" />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : initial?.id ? 'Update item' : 'Create item'}</Button>
      </div>
    </form>
  )
}

// ── Items tab ─────────────────────────────────────────────────────────────────

function ItemsTab() {
  const queryClient = useQueryClient()
  const [filterPool, setFilterPool] = useState<BenchmarkPool | 'all'>('all')
  const [view, setView] = useState<'list' | 'new' | 'edit'>('list')
  const [editTarget, setEditTarget] = useState<BenchmarkItem | null>(null)
  const [seeding, setSeeding] = useState(false)

  const { data: items = [] } = useQuery({
    queryKey: ['benchmark_items'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'benchmark_items'))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as BenchmarkItem)
    },
  })

  const visible = filterPool === 'all' ? items : items.filter(i => i.pool === filterPool)

  async function handleToggleActive(item: BenchmarkItem) {
    await setDoc(doc(db, 'benchmark_items', item.id), { active: !item.active }, { merge: true })
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
  }

  async function handleDelete(item: BenchmarkItem) {
    if (!confirm(`Delete item ${item.id}?`)) return
    await deleteDoc(doc(db, 'benchmark_items', item.id))
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
  }

  async function handleSeed() {
    if (!confirm(`Seed ${MOCK_ITEMS.length} default items into Firestore? This will overwrite any existing items with the same IDs.`)) return
    setSeeding(true)
    try {
      const batch = writeBatch(db)
      for (const item of MOCK_ITEMS) {
        const { id, ...fields } = item
        batch.set(doc(db, 'benchmark_items', id), { ...fields, createdAt: serverTimestamp() })
      }
      await batch.commit()
      queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
    } finally {
      setSeeding(false)
    }
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
    setView('list')
    setEditTarget(null)
  }

  if (view === 'new') return (
    <div className="space-y-4">
      <h2 className="font-medium">New item</h2>
      <ItemForm onSave={refresh} onCancel={() => setView('list')} />
    </div>
  )

  if (view === 'edit' && editTarget) return (
    <div className="space-y-4">
      <h2 className="font-medium">Edit — <span className="font-mono text-sm">{editTarget.id}</span></h2>
      <ItemForm initial={editTarget} onSave={refresh} onCancel={() => setView('list')} />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterPool}
          onChange={e => setFilterPool(e.target.value as BenchmarkPool | 'all')}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All pools ({items.length})</option>
          {POOLS.map(p => <option key={p} value={p}>{p} ({items.filter(i => i.pool === p).length})</option>)}
        </select>
        <div className="flex gap-2 ml-auto">
          {items.length === 0 && (
            <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding…' : `Seed ${MOCK_ITEMS.length} default items`}
            </Button>
          )}
          <Button size="sm" onClick={() => setView('new')}>
            <Plus className="size-4 mr-1.5" /> New item
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          {items.length === 0 ? 'No items yet — seed the defaults to get started.' : 'No items in this pool.'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Pool</th>
                <th className="px-3 py-2 text-left font-medium">Band</th>
                <th className="px-3 py-2 text-left font-medium">Modality</th>
                <th className="px-3 py-2 text-left font-medium">Construct</th>
                <th className="px-3 py-2 text-left font-medium">Active</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(item => (
                <tr key={item.id} className={`border-t hover:bg-muted/20 ${!item.active ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{item.id.slice(0,8)}…</td>
                  <td className="px-3 py-1.5">{item.pool}</td>
                  <td className="px-3 py-1.5">{item.band}</td>
                  <td className="px-3 py-1.5">{item.modality}</td>
                  <td className="px-3 py-1.5">{item.construct}</td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`px-2 py-0.5 rounded text-xs font-medium border ${item.active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-muted text-muted-foreground border-input'}`}
                    >
                      {item.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-2">
                      <button onClick={() => { setEditTarget(item); setView('edit') }} className="text-muted-foreground hover:text-foreground text-xs">Edit</button>
                      <button onClick={() => handleDelete(item)} className="text-muted-foreground hover:text-red-600"><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page root ─────────────────────────────────────────────────────────────────

export function BenchmarkPage() {
  const [tab, setTab] = useState<Tab>('results')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Benchmark Check</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the ICAO comprehension screener — view candidate results and edit the item bank.
        </p>
      </div>

      <div className="flex gap-2 border-b pb-1">
        {(['results', 'items'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-t text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'results' && <ResultsTab />}
      {tab === 'items'   && <ItemsTab />}
    </div>
  )
}
