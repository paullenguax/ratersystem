import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, getDoc, doc, addDoc, setDoc, deleteDoc,
  updateDoc, orderBy, query, serverTimestamp,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken } from 'firebase/auth'
import { benchmarkDb as db, benchmarkAuth, benchmarkStorage, functions } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Trash2, Link2, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus, Upload, ExternalLink } from 'lucide-react'
import type { Person } from '@/types'
import {
  CONSTRUCTS, LEVEL_LABELS, LEVEL_COLOURS,
  type BenchmarkItem, type BenchmarkResult, type BenchmarkConstruct, type TrialScores,
  type TestSection, type TestSectionFilter, type SectionsConfig,
} from './types'

function pct(correct: number, total: number) {
  if (total === 0) return '—'
  return Math.round(correct / total * 100) + '%'
}

function isTrialScores(s: unknown): s is TrialScores {
  return !!s && typeof s === 'object' && 'totalCorrect' in s
}

type Tab = 'results' | 'analysis' | 'items' | 'sections' | 'centres'

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

  const visible = useMemo(() => {
    const level = (r: BenchmarkResult) =>
      String(isTrialScores(r.scores) ? r.scores.indicativeLevel : r.indicativeLevel)
    return filterLevel === 'all' ? results : results.filter(r => level(r) === filterLevel)
  }, [results, filterLevel])

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    results.forEach(r => {
      const k = String(isTrialScores(r.scores) ? r.scores.indicativeLevel : r.indicativeLevel)
      counts[k] = (counts[k] ?? 0) + 1
    })
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
                <th className="px-3 py-2 text-left font-medium">Centre</th>
                <th className="px-3 py-2 text-left font-medium">Form</th>
                <th className="px-3 py-2 text-left font-medium">Self-reported</th>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-left font-medium">Score</th>
                <th className="px-3 py-2 text-left font-medium">Flags</th>
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
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {res.centreId ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                      {res.form ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {res.selfReportedLevel ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const lvl = String(isTrialScores(res.scores) ? res.scores.indicativeLevel : res.indicativeLevel)
                        return (
                          <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${LEVEL_COLOURS[lvl] ?? ''}`}>
                            {LEVEL_LABELS[lvl] ?? lvl}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                      {isTrialScores(res.scores)
                        ? `${res.scores.totalCorrect}/${res.scores.totalItems}`
                        : `P1:${res.scores?.phase1 ?? '?'} P2:${res.scores?.phase2 ?? '?'} P3:${res.scores?.phase3 ?? '?'}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {(() => {
                        const n = (res.responses ?? []).filter(r => r.flagComment).length
                        return n > 0 ? <span className="text-amber-600 font-medium">{n}</span> : '—'
                      })()}
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
                      <td colSpan={11} className="px-4 py-3">
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
                      <td colSpan={11} className="px-4 py-3 space-y-3">
                        {isTrialScores(res.scores) && (
                          <div className="flex gap-6 text-xs text-muted-foreground">
                            <span>Band 4: {pct(res.scores.band4.correct, res.scores.band4.total)} ({res.scores.band4.correct}/{res.scores.band4.total})</span>
                            <span>Band 5: {pct(res.scores.band5.correct, res.scores.band5.total)} ({res.scores.band5.correct}/{res.scores.band5.total})</span>
                            <span>Band 6: {pct(res.scores.band6.correct, res.scores.band6.total)} ({res.scores.band6.correct}/{res.scores.band6.total})</span>
                            <span>Vocab: {pct(res.scores.vocabulary.correct, res.scores.vocabulary.total)}</span>
                            <span>Structure: {pct(res.scores.structure.correct, res.scores.structure.total)}</span>
                            {res.scores.comprehension && (
                              <span>Comprehension: {pct(res.scores.comprehension.correct, res.scores.comprehension.total)}</span>
                            )}
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">Responses ({res.responses?.length ?? 0} items)</p>
                          <div className="flex flex-wrap gap-1">
                            {(res.responses ?? []).map((r, i) => (
                              <span
                                key={i}
                                title={`${r.itemId}: selected ${r.selected}${r.flagComment ? ` | flagged: ${r.flagComment}` : ''}`}
                                className={`text-xs px-1.5 py-0.5 rounded font-mono ${r.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}${r.flagComment ? ' ring-1 ring-amber-400' : ''}`}
                              >
                                {r.itemId}:{r.selected}
                              </span>
                            ))}
                          </div>
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

// ── Item analysis tab ─────────────────────────────────────────────────────────

function ItemAnalysisTab() {
  const [filterForm, setFilterForm] = useState<'all' | 'A' | 'B'>('all')
  const [sortBy, setSortBy] = useState<'id' | 'difficulty' | 'flags'>('id')
  const queryClient = useQueryClient()

  const { data: results = [] } = useQuery({
    queryKey: ['benchmark_results'],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'benchmark_results'), orderBy('timestamp', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as BenchmarkResult)
    },
  })

  const { data: flagDocs = [] } = useQuery({
    queryKey: ['benchmark_flags'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'benchmark_flags'))
      return snap.docs.map(d => d.data() as { itemId: string; comment: string })
    },
  })

  const { data: items = [] } = useQuery({
    queryKey: ['benchmark_items'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'benchmark_items'))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as BenchmarkItem)
    },
  })
  const itemById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])

  async function handleMarkCorrected(itemId: string) {
    await setDoc(doc(db, 'benchmark_items', itemId), { correctedAt: serverTimestamp() }, { merge: true })
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
  }

  const analysis = useMemo(() => {
    type ItemStat = {
      id: string; form: string; band: number; construct: string
      attempts: number; correct: number; flagCount: number; flagComments: string[]
      sinceCorrection: { attempts: number; correct: number } | null
    }
    const stats: Record<string, ItemStat> = {}

    const filtered = filterForm === 'all' ? results : results.filter(r => r.form === filterForm)

    for (const result of filtered) {
      const resultSeconds = result.timestamp?.seconds ?? 0
      for (const resp of (result.responses ?? [])) {
        if (!stats[resp.itemId]) {
          stats[resp.itemId] = {
            id: resp.itemId,
            form: result.form ?? '?',
            band: resp.band ?? 0,
            construct: resp.construct ?? '?',
            attempts: 0, correct: 0, flagCount: 0, flagComments: [],
            sinceCorrection: null,
          }
        }
        const stat = stats[resp.itemId]
        stat.attempts++
        if (resp.correct) stat.correct++
        if (resp.flagComment) {
          stat.flagCount++
          stat.flagComments.push(resp.flagComment)
        }

        const correctedAtSeconds = itemById[resp.itemId]?.correctedAt?.seconds
        if (correctedAtSeconds && resultSeconds > correctedAtSeconds) {
          if (!stat.sinceCorrection) stat.sinceCorrection = { attempts: 0, correct: 0 }
          stat.sinceCorrection.attempts++
          if (resp.correct) stat.sinceCorrection.correct++
        }
      }
    }

    // Merge flags from flags collection
    for (const f of flagDocs) {
      if (stats[f.itemId] && !stats[f.itemId].flagComments.includes(f.comment)) {
        stats[f.itemId].flagComments.push(f.comment)
      }
    }

    return Object.values(stats).sort((a, b) => {
      if (sortBy === 'difficulty') {
        const pA = a.attempts > 0 ? a.correct / a.attempts : 1
        const pB = b.attempts > 0 ? b.correct / b.attempts : 1
        return pA - pB
      }
      if (sortBy === 'flags') return b.flagCount - a.flagCount
      return a.id.localeCompare(b.id)
    })
  }, [results, flagDocs, itemById, filterForm, sortBy])

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={filterForm}
          onChange={e => setFilterForm(e.target.value as 'all' | 'A' | 'B')}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">Both forms</option>
          <option value="A">Form A</option>
          <option value="B">Form B</option>
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'id' | 'difficulty' | 'flags')}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="id">Sort by item ID</option>
          <option value="difficulty">Hardest first</option>
          <option value="flags">Most flagged first</option>
        </select>
        <span className="text-xs text-muted-foreground">{analysis.length} items with data from {results.length} results</span>
      </div>

      {analysis.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          No trial data yet.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Form</th>
                <th className="px-3 py-2 text-left font-medium">Band</th>
                <th className="px-3 py-2 text-left font-medium">Construct</th>
                <th className="px-3 py-2 text-left font-medium">N</th>
                <th className="px-3 py-2 text-left font-medium">Correct</th>
                <th className="px-3 py-2 text-left font-medium">% correct</th>
                <th className="px-3 py-2 text-left font-medium">Flags</th>
                <th className="px-3 py-2 text-left font-medium">Flag comments</th>
                <th className="px-3 py-2 text-left font-medium">Corrected</th>
                <th className="px-3 py-2 text-left font-medium">Since correction</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {analysis.map(item => {
                const p = item.attempts > 0 ? Math.round(item.correct / item.attempts * 100) : null
                const pctClass = p === null ? 'text-muted-foreground'
                  : p < 30 ? 'text-red-600 font-semibold'
                  : p > 85 ? 'text-green-700 font-semibold'
                  : 'text-muted-foreground'
                const correctedAt = itemById[item.id]?.correctedAt
                return (
                  <tr key={item.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{item.id}</td>
                    <td className="px-3 py-1.5">{item.form}</td>
                    <td className="px-3 py-1.5">{item.band}</td>
                    <td className="px-3 py-1.5">{item.construct}</td>
                    <td className="px-3 py-1.5">{item.attempts}</td>
                    <td className="px-3 py-1.5">{item.correct}</td>
                    <td className={`px-3 py-1.5 ${pctClass}`}>{p !== null ? p + '%' : '—'}</td>
                    <td className="px-3 py-1.5">
                      {item.flagCount > 0
                        ? <span className="text-amber-600 font-semibold">{item.flagCount}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground max-w-xs truncate" title={item.flagComments.join(' / ')}>
                      {item.flagComments.length > 0 ? item.flagComments.join(' / ') : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {correctedAt ? new Date(correctedAt.seconds * 1000).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {item.sinceCorrection
                        ? `${item.sinceCorrection.correct}/${item.sinceCorrection.attempts} (${pct(item.sinceCorrection.correct, item.sinceCorrection.attempts)})`
                        : correctedAt ? 'No responses yet' : '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      {item.flagCount > 0 && (
                        <button
                          onClick={() => handleMarkCorrected(item.id)}
                          className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
                        >
                          Mark corrected
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Item form ─────────────────────────────────────────────────────────────────

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const

const BLANK: Omit<BenchmarkItem, 'id'> = {
  source: 'new', band: 4, construct: 'vocabulary',
  modality: 'reading', form: 'A', active: true, flagged: false,
  stem: '', stimulus: '', audioRef: '', maxPlays: 2,
  options: ['', '', '', ''], correct: 0, feedback: '', notes: '',
  pilot: false, pairKey: '',
}

function ItemForm({ initial, onSave, onCancel }: {
  initial?: BenchmarkItem | null
  onSave: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Omit<BenchmarkItem, 'id'>>(
    initial ? { ...initial, options: [...initial.options], stimulus: initial.stimulus ?? '', audioRef: initial.audioRef ?? '' }
            : { ...BLANK, options: [...BLANK.options] }
  )
  const [itemId, setItemId] = useState(initial?.id ?? '')
  const [editingId, setEditingId] = useState(false)
  const [idError, setIdError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }
  function setOption(i: number, v: string) {
    const opts = [...form.options]
    opts[i] = v
    setForm(f => ({ ...f, options: opts }))
  }
  function setOptionCount(n: 2 | 4) {
    setForm(f => {
      const opts = n > f.options.length
        ? [...f.options, ...Array(n - f.options.length).fill('')]
        : f.options.slice(0, n)
      return { ...f, options: opts, correct: Math.min(f.correct, n - 1) as 0 | 1 | 2 | 3 }
    })
  }

  function handleAudioUpload(file: File) {
    if (!benchmarkStorage) return
    const path = `benchmark-audio/${Date.now()}_${file.name}`
    const ref = storageRef(benchmarkStorage, path)
    const task = uploadBytesResumable(ref, file)
    setUploadProgress(0)
    task.on(
      'state_changed',
      snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => setUploadProgress(null),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        set('audioRef', url)
        setUploadProgress(null)
      },
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIdError(null)
    const trimmedId = itemId.trim()
    if (trimmedId.includes('/')) {
      setIdError('ID can\'t contain "/"')
      return
    }
    if (initial?.id && !trimmedId) {
      setIdError('ID can\'t be empty')
      return
    }

    setSaving(true)
    const item = {
      ...form, band: Number(form.band) as 4|5|6,
      stimulus: form.stimulus?.trim() || null, audioRef: form.audioRef?.trim() || null,
      pairKey: form.pilot ? (form.pairKey?.trim() || null) : null,
    }

    if (initial?.id && trimmedId !== initial.id) {
      // Renaming: Firestore has no rename op, so copy to the new ID then
      // drop the old doc. Any responses already recorded under the old ID
      // stay pointed at it — their stats will show up as a separate row in
      // Item Analysis rather than merging into the renamed item's history.
      const newRef = doc(db, 'benchmark_items', trimmedId)
      if ((await getDoc(newRef)).exists()) {
        setIdError(`"${trimmedId}" is already in use by another item`)
        setSaving(false)
        return
      }
      await setDoc(newRef, item)
      await deleteDoc(doc(db, 'benchmark_items', initial.id))
    } else if (initial?.id) {
      await setDoc(doc(db, 'benchmark_items', initial.id), item, { merge: true })
    } else if (trimmedId) {
      const newRef = doc(db, 'benchmark_items', trimmedId)
      if ((await getDoc(newRef)).exists()) {
        setIdError(`"${trimmedId}" is already in use by another item`)
        setSaving(false)
        return
      }
      await setDoc(newRef, { ...item, createdAt: serverTimestamp() })
    } else {
      await addDoc(collection(db, 'benchmark_items'), { ...item, createdAt: serverTimestamp() })
    }
    setSaving(false)
    onSave()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">ID</label>
        {!initial || editingId ? (
          <Input
            value={itemId} onChange={e => setItemId(e.target.value)}
            placeholder={initial ? undefined : 'optional — leave blank to auto-generate'}
            className="font-mono text-sm max-w-xs" autoFocus={editingId}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{itemId}</span>
            <button type="button" onClick={() => setEditingId(true)} className="text-xs text-muted-foreground hover:text-foreground underline">
              Change ID
            </button>
          </div>
        )}
        {initial && editingId && (
          <p className="text-[11px] text-muted-foreground">
            Renaming moves this item to a new document ID — any responses already recorded under the old ID
            stay filed under it separately in Item Analysis, rather than merging into the new one.
          </p>
        )}
        {idError && <p className="text-xs text-destructive">{idError}</p>}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Form</label>
          <select value={form.form} onChange={e => set('form', e.target.value as 'A'|'B')}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {['A','B'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Band</label>
          <select value={form.band} onChange={e => set('band', Number(e.target.value) as 4|5|6)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {[4,5,6].map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Construct</label>
          <select value={form.construct} onChange={e => set('construct', e.target.value as BenchmarkConstruct)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {CONSTRUCTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Modality</label>
          <select value={form.modality} onChange={e => set('modality', e.target.value as 'reading'|'listening')}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {['reading','listening'].map(v => <option key={v}>{v}</option>)}
          </select>
          {form.modality === 'reading' && (
            <p className="text-[11px] text-muted-foreground">Set to "listening" to attach audio</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.pilot ?? false} onChange={e => set('pilot', e.target.checked)} />
          Pilot (unscored field-test item)
        </label>
      </div>

      {form.pilot && (
        <div className="space-y-1 max-w-xs">
          <label className="text-xs text-muted-foreground">Pair key (groups related minimal-pair items so the sampler shows at most one per sitting)</label>
          <Input value={form.pairKey ?? ''} onChange={e => set('pairKey', e.target.value)} placeholder="e.g. l-r, ship-sheep" />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Stimulus / passage (optional — used by comprehension items)</label>
        <Textarea rows={3} value={form.stimulus ?? ''} onChange={e => set('stimulus', e.target.value)} placeholder="Passage, NOTAM, report…" className="text-sm" />
      </div>

      {form.modality === 'listening' && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Audio</label>
          <div className="flex gap-2">
            <Input value={form.audioRef ?? ''} onChange={e => set('audioRef', e.target.value)} placeholder="https://… or upload below" className="flex-1" />
            <Button
              type="button" variant="outline" size="icon" title="Upload audio file"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadProgress !== null}
            >
              <Upload className="size-4" />
            </Button>
            <input
              ref={fileInputRef} type="file" accept="audio/*" className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioUpload(f) }}
            />
          </div>
          {uploadProgress !== null && (
            <div className="w-full bg-muted rounded-full h-1.5 mt-1">
              <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
          {form.audioRef && <audio controls src={form.audioRef} className="w-full mt-1" />}
        </div>
      )}

      {form.modality === 'listening' && (
        <div className="space-y-1 max-w-[160px]">
          <label className="text-xs text-muted-foreground">Max plays</label>
          <Input
            type="number" min={1} value={form.maxPlays ?? 2}
            onChange={e => set('maxPlays', Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Question stem</label>
        <Textarea rows={2} value={form.stem} onChange={e => set('stem', e.target.value)} required className="text-sm" />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Number of options</label>
        <div className="flex gap-2">
          {([2, 4] as const).map(n => (
            <button
              key={n} type="button" onClick={() => setOptionCount(n)}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                form.options.length === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
              }`}
            >
              {n} (e.g. {n === 2 ? 'minimal pair' : 'standard MCQ'})
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {form.options.map((value, i) => (
          <div key={i} className="space-y-1">
            <label className="text-xs text-muted-foreground">Option {OPTION_LABELS[i]}</label>
            <Input value={value} onChange={e => setOption(i, e.target.value)} required />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Correct answer</label>
        <select value={form.correct} onChange={e => set('correct', Number(e.target.value) as 0|1|2|3)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          {form.options.map((_, i) => <option key={i} value={i}>{OPTION_LABELS[i]}</option>)}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Feedback / explanation</label>
        <Textarea rows={2} value={form.feedback} onChange={e => set('feedback', e.target.value)} className="text-sm" />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Notes (revision history)</label>
        <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Stem reworded 2026-07-18 after 3 flags" className="text-sm" />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : initial?.id ? 'Update item' : 'Create item'}</Button>
      </div>
    </form>
  )
}

// ── Items tab ─────────────────────────────────────────────────────────────────

function CoverageSummary({ items }: { items: BenchmarkItem[] }) {
  const rows = CONSTRUCTS.map(c => ({
    construct: c,
    A: items.filter(i => i.construct === c && i.form === 'A').length,
    B: items.filter(i => i.construct === c && i.form === 'B').length,
  }))
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {rows.map(r => (
        <span key={r.construct} className="capitalize">
          {r.construct}: A {r.A} / B {r.B}
        </span>
      ))}
    </div>
  )
}

function AnswerKeyBalance({ items }: { items: BenchmarkItem[] }) {
  const counts = [0, 0, 0, 0]
  items.forEach(i => { counts[i.correct]++ })
  const total = items.length
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Answer key balance:</span>
      {OPTION_LABELS.map((label, i) => {
        const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0
        // Flag anything well above the ~25% expected for 4 evenly-used options.
        const skewed = pct >= 35
        return (
          <span key={label} className={skewed ? 'text-amber-600 font-semibold' : ''}>
            {label}: {counts[i]} ({pct}%)
          </span>
        )
      })}
    </div>
  )
}

function ItemsTab() {
  const queryClient = useQueryClient()
  const [filterConstruct, setFilterConstruct] = useState<BenchmarkConstruct | 'all'>('all')
  const [view, setView] = useState<'list' | 'new' | 'edit'>('list')
  const [editTarget, setEditTarget] = useState<BenchmarkItem | null>(null)

  const { data: items = [] } = useQuery({
    queryKey: ['benchmark_items'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'benchmark_items'))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as BenchmarkItem)
    },
  })

  const visible = filterConstruct === 'all' ? items : items.filter(i => i.construct === filterConstruct)

  async function handleToggleActive(item: BenchmarkItem) {
    await setDoc(doc(db, 'benchmark_items', item.id), { active: !item.active }, { merge: true })
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
  }

  async function handleDelete(item: BenchmarkItem) {
    if (!confirm(`Delete item ${item.id}?`)) return
    await deleteDoc(doc(db, 'benchmark_items', item.id))
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
    setView('list')
    setEditTarget(null)
  }

  // Saves the item but stays on the edit screen, so Next/Previous can be used
  // right after saving without a round-trip back to the list.
  function refreshInPlace() {
    queryClient.invalidateQueries({ queryKey: ['benchmark_items'] })
  }

  function goToRelative(delta: number) {
    if (!editTarget) return
    const idx = visible.findIndex(i => i.id === editTarget.id)
    if (idx === -1) return
    const next = visible[idx + delta]
    if (next) setEditTarget(next)
  }

  if (view === 'new') return (
    <div className="space-y-4">
      <h2 className="font-medium">New item</h2>
      <ItemForm onSave={refresh} onCancel={() => setView('list')} />
    </div>
  )

  if (view === 'edit' && editTarget) {
    const idx = visible.findIndex(i => i.id === editTarget.id)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-medium">Edit — <span className="font-mono text-sm">{editTarget.id}</span></h2>
          <div className="flex items-center gap-2">
            {idx !== -1 && <span className="text-xs text-muted-foreground">{idx + 1} of {visible.length}</span>}
            <Button type="button" variant="outline" size="sm" onClick={() => goToRelative(-1)} disabled={idx <= 0}>
              <ChevronLeft className="size-4 mr-1" /> Previous
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => goToRelative(1)} disabled={idx === -1 || idx >= visible.length - 1}>
              Next <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
        <ItemForm key={editTarget.id} initial={editTarget} onSave={refreshInPlace} onCancel={() => setView('list')} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Coverage/balance describe the scored bank — pilot items aren't part of it yet */}
      <CoverageSummary items={items.filter(i => !i.pilot)} />
      <AnswerKeyBalance items={items.filter(i => !i.pilot)} />

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterConstruct}
          onChange={e => setFilterConstruct(e.target.value as BenchmarkConstruct | 'all')}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All constructs ({items.length})</option>
          {CONSTRUCTS.map(c => <option key={c} value={c}>{c} ({items.filter(i => i.construct === c).length})</option>)}
        </select>
        <div className="flex gap-2 ml-auto">
          <Button size="sm" onClick={() => setView('new')}>
            <Plus className="size-4 mr-1.5" /> New item
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          No items match this filter.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Form</th>
                <th className="px-3 py-2 text-left font-medium">Band</th>
                <th className="px-3 py-2 text-left font-medium">Modality</th>
                <th className="px-3 py-2 text-left font-medium">Construct</th>
                <th className="px-3 py-2 text-left font-medium">Correct</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Active</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, i) => (
                <tr
                  key={item.id}
                  className={`border-t hover:bg-muted/40 ${i % 2 === 1 ? 'bg-muted/20' : ''} ${!item.active ? 'opacity-50' : ''}`}
                >
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{item.id.slice(0,8)}…</td>
                  <td className="px-3 py-1.5">{item.form}</td>
                  <td className="px-3 py-1.5">{item.band}</td>
                  <td className="px-3 py-1.5">{item.modality}</td>
                  <td className="px-3 py-1.5">{item.construct}</td>
                  <td className="px-3 py-1.5 font-mono font-semibold">{OPTION_LABELS[item.correct]}</td>
                  <td className="px-3 py-1.5">
                    {item.pilot
                      ? <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200" title={item.pairKey ? `Pair key: ${item.pairKey}` : undefined}>
                          Pilot{typeof item.pilotAttempts === 'number' ? ` · ${item.pilotAttempts}` : ''}
                        </span>
                      : <span className="text-muted-foreground">Live</span>}
                  </td>
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

// ── Sections tab ──────────────────────────────────────────────────────────────

const SECTIONS_DOC_ID = 'sections'

// Matches today's live behavior exactly — used both as the query's fallback
// (if the config doc doesn't exist yet) and as the starting point for a
// first-time save.
const DEFAULT_SECTIONS_CONFIG: SectionsConfig = {
  pilotSampleCount: 5,
  sections: [
    {
      id: 'listening', order: 0, title: 'Listening section', showIntro: true,
      introBody: 'The next few questions include an audio clip. Each clip can only be played a '
        + 'limited number of times — check the counter under the player — so listen carefully. '
        + "There's no time limit to think it over.",
      filter: { modality: 'listening', construct: 'any', band: 'any' },
    },
    {
      id: 'reading', order: 1, title: 'Reading section', showIntro: true,
      introBody: "That's the listening section done. The rest of the questions are read on "
        + "screen, at your own pace — there's no time limit.",
      filter: { modality: 'reading', construct: 'any', band: 'any' },
    },
  ],
}

function emptySection(order: number): TestSection {
  return {
    id: `section-${Date.now()}`, order, title: '', introBody: '', showIntro: true,
    filter: { modality: 'any', construct: 'any', band: 'any' },
  }
}

function SectionsTab() {
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: ['benchmark_config_sections'],
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'benchmark_config', SECTIONS_DOC_ID))
      return snap.exists() ? (snap.data() as SectionsConfig) : DEFAULT_SECTIONS_CONFIG
    },
  })

  const [draft, setDraft] = useState<SectionsConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config && !draft) setDraft(config)
  }, [config, draft])

  if (isLoading || !draft) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }

  function updateSection(id: string, patch: Partial<TestSection>) {
    setDraft(d => d && { ...d, sections: d.sections.map(s => (s.id === id ? { ...s, ...patch } : s)) })
    setSaved(false)
  }
  function updateFilter(id: string, patch: Partial<TestSectionFilter>) {
    setDraft(d => d && {
      ...d,
      sections: d.sections.map(s => (s.id === id ? { ...s, filter: { ...s.filter, ...patch } } : s)),
    })
    setSaved(false)
  }
  function addSection() {
    setDraft(d => d && { ...d, sections: [...d.sections, emptySection(d.sections.length)] })
    setSaved(false)
  }
  function removeSection(id: string) {
    if (!confirm('Remove this section? Any items that only matched this section drop out of the sitting entirely.')) return
    setDraft(d => d && { ...d, sections: d.sections.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i })) })
    setSaved(false)
  }
  function moveSection(id: string, dir: -1 | 1) {
    setDraft(d => {
      if (!d) return d
      const sorted = [...d.sections].sort((a, b) => a.order - b.order)
      const idx = sorted.findIndex(s => s.id === id)
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= sorted.length) return d
      ;[sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]]
      return { ...d, sections: sorted.map((s, i) => ({ ...s, order: i })) }
    })
    setSaved(false)
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    await setDoc(doc(db, 'benchmark_config', SECTIONS_DOC_ID), draft)
    queryClient.invalidateQueries({ queryKey: ['benchmark_config_sections'] })
    setSaving(false)
    setSaved(true)
  }

  const sorted = [...draft.sections].sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-xl">
          Sections control the order candidates see items in, the transition copy shown before
          each, and which items (by modality/construct/band) belong to each. Every section pulls
          from the candidate's assigned Form A/B and counts toward their score — pilot items are
          sampled separately and woven into whichever section matches them.
        </p>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Pilot items per sitting</label>
          <Input
            type="number" min={0} value={draft.pilotSampleCount}
            onChange={e => {
              const n = Math.max(0, Number(e.target.value) || 0)
              setDraft(d => d && { ...d, pilotSampleCount: n })
              setSaved(false)
            }}
            className="w-24"
          />
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map((section, i) => (
          <div key={section.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <Input
                value={section.title} onChange={e => updateSection(section.id, { title: e.target.value })}
                placeholder="Section title" className="font-medium max-w-sm"
              />
              <div className="flex items-center gap-1 shrink-0">
                <Button type="button" variant="outline" size="icon" title="Move up"
                  onClick={() => moveSection(section.id, -1)} disabled={i === 0}>
                  <ChevronUp className="size-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" title="Move down"
                  onClick={() => moveSection(section.id, 1)} disabled={i === sorted.length - 1}>
                  <ChevronDown className="size-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" title="Remove section"
                  onClick={() => removeSection(section.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={section.showIntro} onChange={e => updateSection(section.id, { showIntro: e.target.checked })} />
              Show a transition screen before this section
            </label>

            {section.showIntro && (
              <Textarea
                rows={2} value={section.introBody}
                onChange={e => updateSection(section.id, { introBody: e.target.value })}
                placeholder="Intro copy shown before the first item in this section" className="text-sm"
              />
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Modality</label>
                <select
                  value={section.filter.modality}
                  onChange={e => updateFilter(section.id, { modality: e.target.value as TestSectionFilter['modality'] })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="any">Any</option>
                  <option value="reading">Reading</option>
                  <option value="listening">Listening</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Construct</label>
                <select
                  value={section.filter.construct}
                  onChange={e => updateFilter(section.id, { construct: e.target.value as TestSectionFilter['construct'] })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="any">Any</option>
                  {CONSTRUCTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Band</label>
                <select
                  value={section.filter.band}
                  onChange={e => updateFilter(section.id, { band: (e.target.value === 'any' ? 'any' : Number(e.target.value)) as TestSectionFilter['band'] })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="any">Any</option>
                  {[4, 5, 6].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={addSection}>
          <Plus className="size-4 mr-1.5" /> Add section
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {saved && <span className="text-xs text-green-700">Saved</span>}
      </div>
    </div>
  )
}

// ── Centres tab ───────────────────────────────────────────────────────────────

interface CentreAccount {
  id: string          // Firebase Auth uid — also the Firestore doc ID
  centreId: string
  centreName: string
}

const createCentreFn = httpsCallable<
  { email: string; password: string; centreId: string; centreName: string },
  { uid: string }
>(functions, 'createBenchmarkCentreAccount')

const deleteCentreFn = httpsCallable<{ uid: string }, { ok: true }>(functions, 'deleteBenchmarkCentreAccount')

function CentreForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [centreName, setCentreName] = useState('')
  const [centreId, setCentreId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createCentreFn({ email, password, centreId: centreId.trim(), centreName: centreName.trim() })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create centre account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Centre name</label>
        <Input value={centreName} onChange={e => setCentreName(e.target.value)} placeholder="Oxford Aviation Academy" required />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Centre ID (short slug — used in their link)</label>
        <Input
          value={centreId}
          onChange={e => setCentreId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          placeholder="oxford-aviation"
          required
        />
        {centreId && <p className="text-[11px] text-muted-foreground">Link: lenguax.com/benchmark/?centre={centreId}</p>}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Login email</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Login password</label>
        <Input type="text" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
        <p className="text-[11px] text-muted-foreground">Shown in plain text so you can copy it to send to the centre — at least 6 characters.</p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create centre account'}</Button>
      </div>
    </form>
  )
}

function CentresTab() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<'list' | 'new'>('list')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data: centres = [] } = useQuery({
    queryKey: ['centre_accounts'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'centre_accounts'))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as CentreAccount)
    },
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['centre_accounts'] })
    setView('list')
  }

  async function handleDelete(centre: CentreAccount) {
    if (!confirm(`Delete the login for "${centre.centreName}"? Their link will stop working.`)) return
    await deleteCentreFn({ uid: centre.id })
    queryClient.invalidateQueries({ queryKey: ['centre_accounts'] })
  }

  function copyLink(centreId: string) {
    const link = `https://lenguax.com/benchmark/?centre=${centreId}`
    navigator.clipboard.writeText(link)
    setCopiedId(centreId)
    setTimeout(() => setCopiedId(null), 1500)
  }

  if (view === 'new') return (
    <div className="space-y-4">
      <h2 className="font-medium">New centre</h2>
      <CentreForm onSave={refresh} onCancel={() => setView('list')} />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Each centre gets one shared login and a tagged link — they see only their own trainees' results at{' '}
          <span className="font-mono text-xs">lenguax.com/benchmark/centre</span>.
        </p>
        <Button size="sm" onClick={() => setView('new')}>
          <Plus className="size-4 mr-1.5" /> New centre
        </Button>
      </div>

      {centres.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          No centres yet.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Centre</th>
                <th className="px-3 py-2 text-left font-medium">Link</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {centres.map(centre => (
                <tr key={centre.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <p className="font-medium">{centre.centreName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{centre.centreId}</p>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => copyLink(centre.centreId)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {copiedId === centre.centreId ? 'Copied!' : 'Copy link'}
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => handleDelete(centre)} className="text-muted-foreground hover:text-red-600">
                      <Trash2 className="size-3.5" />
                    </button>
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

const mintBenchmarkAdminTokenFn = httpsCallable<Record<string, never>, { token: string }>(
  functions, 'mintBenchmarkAdminToken'
)

type AuthState = 'connecting' | 'ready' | 'error'

export function BenchmarkPage() {
  const [tab, setTab] = useState<Tab>('results')
  const [authState, setAuthState] = useState<AuthState>('connecting')

  useEffect(() => {
    let cancelled = false
    async function connect() {
      try {
        if (!benchmarkAuth) {
          throw new Error('Benchmark Firebase app did not initialize — check VITE_BENCHMARK_* env vars')
        }
        // Always mint a fresh token rather than reusing a cached session —
        // custom-token claims (e.g. admin: true) only apply from the moment
        // they're minted, and a persisted sign-in from before a claims
        // change would silently be missing them.
        const { data } = await mintBenchmarkAdminTokenFn()
        await signInWithCustomToken(benchmarkAuth, data.token)
        if (!cancelled) setAuthState('ready')
      } catch (err) {
        console.error('Failed to connect to Benchmark project:', err)
        if (!cancelled) setAuthState('error')
      }
    }
    connect()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Benchmark Check</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the ICAO comprehension screener — view candidate results and edit the item bank.
          </p>
        </div>
        <a
          href="https://lenguax.com/benchmark/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground whitespace-nowrap pt-1"
        >
          Open candidate app <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="flex gap-2 border-b pb-1">
        {([['results', 'Results'], ['analysis', 'Item analysis'], ['items', 'Item bank'], ['sections', 'Sections'], ['centres', 'Centres']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-t text-sm font-medium transition-colors ${
              tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {authState === 'connecting' && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          Connecting to Benchmark project…
        </div>
      )}
      {authState === 'error' && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-12 text-center text-sm text-destructive">
          Couldn't authenticate against the Benchmark project. Results and item analysis need this to load — try refreshing.
        </div>
      )}
      {authState === 'ready' && (
        <>
          {tab === 'results'  && <ResultsTab />}
          {tab === 'analysis' && <ItemAnalysisTab />}
          {tab === 'items'    && <ItemsTab />}
          {tab === 'sections' && <SectionsTab />}
          {tab === 'centres'  && <CentresTab />}
        </>
      )}
    </div>
  )
}
