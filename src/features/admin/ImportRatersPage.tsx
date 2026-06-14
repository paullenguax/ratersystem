import { useState, useCallback, useEffect } from 'react'
import {
  collection, getDocs, writeBatch, doc, serverTimestamp,
} from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import { db } from '@/lib/firebase'
import { parseRaterCSV, type ParseResult, type ReviewRecord, type ParseFlag } from '@/lib/csvParser'
import type { Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ── types ──────────────────────────────────────────────────────────────────

type Role = Person['role']

interface Decision {
  name: string
  included: boolean
}

// ── helpers ────────────────────────────────────────────────────────────────

const FLAG_LABEL: Record<ParseFlag, string> = {
  all_caps:      'title-cased',
  annotation:    'annotation stripped',
  one_word:      'name incomplete',
  bad_email:     'invalid email',
  name_conflict: 'name conflict',
  dual_email:    'possible duplicate',
}

const FLAG_COLOUR: Record<ParseFlag, string> = {
  all_caps:      'bg-blue-50 text-blue-700 border-blue-200',
  annotation:    'bg-blue-50 text-blue-700 border-blue-200',
  one_word:      'bg-amber-50 text-amber-700 border-amber-200',
  bad_email:     'bg-red-50 text-red-700 border-red-200',
  name_conflict: 'bg-purple-50 text-purple-700 border-purple-200',
  dual_email:    'bg-amber-50 text-amber-700 border-amber-200',
}

// Sort order for review items
const FLAG_PRIORITY: Record<ParseFlag, number> = {
  bad_email: 0, one_word: 1, name_conflict: 2, dual_email: 3, annotation: 4, all_caps: 5,
}

function topPriority(flags: ParseFlag[]): number {
  return Math.min(...flags.map(f => FLAG_PRIORITY[f]))
}

// ── ReviewCard ─────────────────────────────────────────────────────────────

function ReviewCard({
  record,
  decision,
  onChange,
}: {
  record: ReviewRecord
  decision: Decision
  onChange: (d: Decision) => void
}) {
  const isBadEmail = record.flags.includes('bad_email')
  const isOneWord = record.flags.includes('one_word')

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${decision.included ? '' : 'bg-muted/30'}`}>
      {/* header: name input + action button */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-0.5">
          {isBadEmail ? (
            <p className="font-medium text-sm">{decision.name || '(no name)'}</p>
          ) : (
            <Input
              value={decision.name}
              onChange={e => onChange({ ...decision, name: e.target.value })}
              className="h-8 text-sm font-medium"
              placeholder="Enter full name…"
            />
          )}
          <p className="text-xs text-muted-foreground font-mono pl-0.5">{record.email}</p>
        </div>

        {isBadEmail ? (
          <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 shrink-0 mt-0.5">
            Cannot import
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={decision.included ? 'default' : 'outline'}
            className="shrink-0 mt-0.5"
            onClick={() => onChange({ ...decision, included: !decision.included })}
          >
            {decision.included ? '✓ Include' : 'Exclude'}
          </Button>
        )}
      </div>

      {/* flag badges */}
      <div className="flex gap-1 flex-wrap">
        {record.flags.map(f => (
          <span
            key={f}
            className={`text-xs px-1.5 py-0.5 rounded border font-medium ${FLAG_COLOUR[f]}`}
          >
            {FLAG_LABEL[f]}
          </span>
        ))}
      </div>

      {/* per-flag help text */}
      {isBadEmail && (
        <p className="text-xs text-red-600">
          Email is invalid (contains a slash or spaces). Add this person manually via the People page.
        </p>
      )}
      {isOneWord && !isBadEmail && (
        <p className="text-xs text-amber-700">
          Name looks incomplete — type a surname in the field above, then click <strong>Exclude → Include</strong> to add them.
        </p>
      )}

      {/* alt names for name_conflict */}
      {record.altNames.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also seen as:{' '}
          {record.altNames.map((n, i) => (
            <button
              key={i}
              type="button"
              className="underline font-medium text-foreground hover:text-primary mx-1"
              onClick={() => onChange({ ...decision, name: n })}
            >
              {n}
            </button>
          ))}
          — click to use that name instead.
        </p>
      )}

      {/* dual-email warning — only for non-bad-email items */}
      {!isBadEmail && record.dualEmails.length > 0 && (
        <div className="flex items-start gap-1 text-xs text-amber-700">
          <AlertTriangle className="size-3 mt-0.5 shrink-0" />
          <span>
            This name also appears at:{' '}
            {record.dualEmails.map((e, i) => (
              <span key={i} className="font-mono">
                {e}
                {i < record.dualEmails.length - 1 ? ', ' : ''}
              </span>
            ))}
            {' '}— if it's the same person, click <strong>Exclude</strong> on one of them.
          </span>
        </div>
      )}
    </div>
  )
}

// ── DropZone ───────────────────────────────────────────────────────────────

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) onFile(f)
    },
    [onFile],
  )

  return (
    <label
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 cursor-pointer transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
      }`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <Upload className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Drop a <strong>.csv</strong> file here, or click to browse
      </p>
      <p className="text-xs text-muted-foreground">
        Expects two sections: Name+Email (left) and Forename+Surname+Email (right)
      </p>
      <input
        type="file"
        accept=".csv"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </label>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

export function ImportRatersPage() {
  const queryClient = useQueryClient()

  const [result, setResult] = useState<ParseResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [defaultRole, setDefaultRole] = useState<Role>('senior_rater')
  const [showReady, setShowReady] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState<{ added: number; skipped: number } | null>(null)

  // Reset decisions when result changes
  useEffect(() => {
    if (!result) return
    const initial: Record<string, Decision> = {}
    for (const r of result.review) {
      initial[r.id] = { name: r.name, included: r.included }
    }
    setDecisions(initial)
    setImportDone(null)
  }, [result])

  async function handleFile(f: File) {
    const text = await f.text()
    setFileName(f.name)
    setResult(parseRaterCSV(text))
  }

  function updateDecision(id: string, d: Decision) {
    setDecisions(prev => ({ ...prev, [id]: d }))
  }

  const includedReview = result?.review.filter(r => decisions[r.id]?.included) ?? []
  const totalToImport = (result?.clean.length ?? 0) + includedReview.length

  async function handleImport() {
    if (!result) return
    setImporting(true)

    try {
      const toImport = [
        ...result.clean,
        ...includedReview.map(r => ({
          name: decisions[r.id]?.name?.trim() || r.name,
          email: r.email,
        })),
      ]

      // Check which emails already exist
      const existingSnap = await getDocs(collection(db, 'people'))
      const existingEmails = new Set(
        existingSnap.docs.map(d => (d.data().email as string | undefined)?.toLowerCase() ?? ''),
      )

      const newPeople = toImport.filter(p => !existingEmails.has(p.email))

      // Batch write in chunks of 499 (Firestore limit is 500)
      for (let i = 0; i < newPeople.length; i += 499) {
        const chunk = newPeople.slice(i, i + 499)
        const batch = writeBatch(db)
        for (const person of chunk) {
          const ref = doc(collection(db, 'people'))
          batch.set(ref, {
            name: person.name,
            email: person.email,
            role: defaultRole,
            status: 'active',
            notes: '',
            createdAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }

      queryClient.invalidateQueries({ queryKey: ['people'] })
      setImportDone({ added: newPeople.length, skipped: toImport.length - newPeople.length })
    } finally {
      setImporting(false)
    }
  }

  // Sort review items: bad first, then one_word, then name_conflict, dual_email, annotation, all_caps
  const sortedReview = result
    ? [...result.review].sort((a, b) => topPriority(a.flags) - topPriority(b.flags))
    : []

  const includedCount = Object.values(decisions).filter(d => d.included).length

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import Raters</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the certificate CSV to batch-import raters. Duplicates (by email) already in the database will be skipped.
        </p>
      </div>

      {!result && <DropZone onFile={handleFile} />}

      {result && (
        <>
          {/* summary bar */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm flex-wrap">
            <span className="text-muted-foreground">{fileName}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{result.totalRows} rows parsed</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium text-green-700">{result.clean.length} clean</span>
            <span className="font-medium text-amber-700">{result.review.length} to review</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => { setResult(null); setFileName('') }}
            >
              Change file
            </Button>
          </div>

          {/* review section */}
          {sortedReview.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-semibold text-sm">
                Review needed ({result.review.length})
                <span className="text-muted-foreground font-normal ml-2">
                  — {includedCount} currently included
                </span>
              </h2>
              <div className="space-y-2">
                {sortedReview.map(record => (
                  <ReviewCard
                    key={record.id}
                    record={record}
                    decision={decisions[record.id] ?? { name: record.name, included: record.included }}
                    onChange={d => updateDecision(record.id, d)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ready section (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-2 font-semibold text-sm"
              onClick={() => setShowReady(v => !v)}
            >
              {showReady ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              Ready to import ({result.clean.length} people)
            </button>

            {showReady && (
              <div className="rounded-lg border overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Name</th>
                        <th className="text-left px-3 py-2 font-medium">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.clean.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* import controls */}
          {!importDone && (
            <div className="flex items-center gap-3 pt-2 border-t">
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground whitespace-nowrap">Default role:</label>
                <Select value={defaultRole} onValueChange={v => setDefaultRole(v as Role)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="senior_rater">Senior rater</SelectItem>
                    <SelectItem value="trainee">Trainee</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleImport}
                disabled={importing || totalToImport === 0}
                className="ml-auto"
              >
                {importing ? 'Importing…' : `Import ${totalToImport} people`}
              </Button>
            </div>
          )}

          {/* success */}
          {importDone && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
              <CheckCircle2 className="size-5 text-green-600 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-green-800">
                  {importDone.added} {importDone.added === 1 ? 'person' : 'people'} added.
                </p>
                {importDone.skipped > 0 && (
                  <p className="text-green-700">
                    {importDone.skipped} skipped (already in database).
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => { setResult(null); setFileName(''); setImportDone(null) }}
              >
                Import another
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
