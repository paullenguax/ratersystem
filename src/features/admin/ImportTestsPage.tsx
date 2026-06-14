import { useState } from 'react'
import {
  collection, getDocs, writeBatch, doc, serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Upload } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Test } from '@/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ── types ──────────────────────────────────────────────────────────────────

type TestType = Test['testType']

const TEST_TYPES: TestType[] = [
  'PPL', 'Airline Pilot', 'Helicopter Pilot', 'Student Pilot',
  'Aerodrome ATC', 'Approach ATC', 'Area ATC', 'Student ATCO',
  'Airport Operations', 'ADP Driver',
]

interface ImportRow {
  _oldId: string
  testId: number
  recordingUrl: string
  candidateName: string
  candidateNationality: string
  testType: TestType
  status: 'active' | 'retired'
  durationSeconds: number | null
  canonicalDifficulty: null
  canonicalSE: null
  notes: string
}

// ── DropZone ───────────────────────────────────────────────────────────────

function DropZone({ onFile }: { onFile: (rows: ImportRow[]) => void }) {
  const [error, setError] = useState('')

  async function handle(f: File) {
    setError('')
    try {
      const text = await f.text()
      const rows = JSON.parse(text) as ImportRow[]
      if (!Array.isArray(rows)) throw new Error('Expected a JSON array')
      onFile(rows)
    } catch (e) {
      setError(`Could not parse file: ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-2">
      <label
        className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-14 cursor-pointer border-muted-foreground/30 hover:border-primary/50 transition-colors"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      >
        <Upload className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drop <strong>tests-export.json</strong> here, or click to browse
        </p>
        <input
          type="file"
          accept=".json"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handle(f) }}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

export function ImportTestsPage() {
  const queryClient = useQueryClient()

  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [types, setTypes] = useState<Record<number, TestType>>({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null)

  function handleFile(incoming: ImportRow[]) {
    setRows(incoming)
    const initial: Record<number, TestType> = {}
    incoming.forEach(r => { initial[r.testId] = r.testType })
    setTypes(initial)
    setResult(null)
  }

  function setType(testId: number, type: TestType) {
    setTypes(prev => ({ ...prev, [testId]: type }))
  }

  async function handleImport() {
    if (!rows) return
    setImporting(true)
    try {
      // Build a map of existing docs by recordingUrl
      const snap = await getDocs(collection(db, 'test_bank'))
      const urlToDocId = new Map(snap.docs.map(d => [d.data().recordingUrl as string, d.id]))

      const toAdd = rows.filter(r => !urlToDocId.has(r.recordingUrl))
      const toUpdate = rows.filter(r => urlToDocId.has(r.recordingUrl))

      // Patch existing records to add testId (and correct testType if changed)
      for (const row of toUpdate) {
        const docId = urlToDocId.get(row.recordingUrl)!
        await updateDoc(doc(db, 'test_bank', docId), {
          testId: row.testId,
          testType: types[row.testId] ?? row.testType,
        })
      }

      // Add new records
      for (let i = 0; i < toAdd.length; i += 499) {
        const chunk = toAdd.slice(i, i + 499)
        const batch = writeBatch(db)
        for (const row of chunk) {
          const ref = doc(collection(db, 'test_bank'))
          batch.set(ref, {
            testId: row.testId,
            recordingUrl: row.recordingUrl,
            candidateName: row.candidateName,
            candidateNationality: row.candidateNationality,
            testType: types[row.testId] ?? row.testType,
            status: row.status,
            durationSeconds: row.durationSeconds ?? null,
            canonicalDifficulty: null,
            canonicalSE: null,
            notes: row.notes,
            createdAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }

      queryClient.invalidateQueries({ queryKey: ['tests'] })
      setResult({ added: toAdd.length, skipped: toUpdate.length })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import Test Bank</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the <code>tests-export.json</code> file produced by the migration script.
          Review and correct test types before importing. Tests already in the database
          (matched by recording URL) will be skipped.
        </p>
      </div>

      {!rows && <DropZone onFile={handleFile} />}

      {rows && !result && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {rows.length} tests ready — review test types below, then import.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRows(null)}>
                Change file
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${rows.length} tests`}
              </Button>
            </div>
          </div>

          <div className="rounded-md border overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/90 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-10">#</th>
                    <th className="text-left px-3 py-2 font-medium">Candidate name</th>
                    <th className="text-left px-3 py-2 font-medium">Nationality</th>
                    <th className="text-left px-3 py-2 font-medium w-52">Test type</th>
                    <th className="text-left px-3 py-2 font-medium w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.testId} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{row.testId}</td>
                      <td className="px-3 py-2">{row.candidateName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.candidateNationality}</td>
                      <td className="px-3 py-1.5">
                        <Select
                          value={types[row.testId] ?? row.testType}
                          onValueChange={v => setType(row.testId, v as TestType)}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TEST_TYPES.map(t => (
                              <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium ${row.status === 'active' ? 'text-green-700' : 'text-muted-foreground'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle2 className="size-5 text-green-600 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-green-800">
              {result.added} {result.added === 1 ? 'test' : 'tests'} imported.
            </p>
            {result.skipped > 0 && (
              <p className="text-green-700">{result.skipped} existing records patched with test number.</p>
            )}
          </div>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => { setRows(null); setResult(null) }}>
            Import another
          </Button>
        </div>
      )}
    </div>
  )
}
