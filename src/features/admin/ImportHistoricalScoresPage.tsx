import { useState, useCallback } from 'react'
import { collection, getDocs, addDoc, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Upload } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Person, Test } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// --- CSV parsing ---

interface ScoreRow {
  candidate: number
  rater: number
  pronunciation: number
  structure: number
  vocabulary: number
  fluency: number
  comprehension: number
  interactions: number
}

interface RaterEntry {
  num: number
  csvName: string
}

function splitLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ','
  return line.split(sep).map(c => c.trim())
}

function parseScoresCSV(text: string): ScoreRow[] {
  const lines = text.trim().split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim())
  if (lines.length < 2) return []
  const header = splitLine(lines[0]).map(h => h.replace(/^;/, '').toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const ci = idx('candidate'), ri = idx('rater')
  const pi = idx('varpronunciation'), si = idx('varstructure'), vi = idx('varvocabulary')
  const fi = idx('varfluency'), cpi = idx('varcomprehension'), ii = idx('varinteraction')
  if ([ci, ri, pi, si, vi, fi, cpi, ii].includes(-1)) return []
  const result: ScoreRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i])
    const row: ScoreRow = {
      candidate:     parseInt(cols[ci]),
      rater:         parseInt(cols[ri]),
      pronunciation: parseInt(cols[pi]),
      structure:     parseInt(cols[si]),
      vocabulary:    parseInt(cols[vi]),
      fluency:       parseInt(cols[fi]),
      comprehension: parseInt(cols[cpi]),
      interactions:  parseInt(cols[ii]),
    }
    if (Object.values(row).some(n => isNaN(n))) continue
    result.push(row)
  }
  return result
}

function parseRaterMapCSV(text: string): RaterEntry[] {
  const lines = text.trim().split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim())
  const result: RaterEntry[] = []
  for (const line of lines) {
    const cols = splitLine(line)
    const num = parseInt(cols[0])
    if (isNaN(num)) continue // skip header rows
    const csvName = (cols[1] ?? '').trim()
    if (csvName) result.push({ num, csvName })
  }
  return result
}

// --- data fetching ---

async function fetchPeople(): Promise<Person[]> {
  const snap = await getDocs(collection(db, 'people'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Person)
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchTests(): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Test)
}

// --- FileZone ---

interface FileZoneProps {
  label: string
  description: string
  filename: string
  count: number
  onFile: (f: File) => void
}

function FileZone({ label, description, filename, count, onFile }: FileZoneProps) {
  const [dragging, setDragging] = useState(false)
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])
  const loaded = !!filename

  return (
    <label
      className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed py-8 cursor-pointer transition-colors ${
        dragging ? 'border-primary bg-primary/5'
          : loaded ? 'border-green-400 bg-green-50'
          : 'border-muted-foreground/30 hover:border-primary/50'
      }`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <Upload className={`size-6 ${loaded ? 'text-green-600' : 'text-muted-foreground'}`} />
      <div className="text-center px-4">
        <p className="text-sm font-medium">{label}</p>
        {loaded
          ? <p className="text-xs text-green-700 mt-0.5">{filename} — {count} rows</p>
          : <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        }
      </div>
      <input
        type="file"
        accept=".csv,.txt,.tsv"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </label>
  )
}

// --- main page ---

type Step = 'upload' | 'map' | 'confirm'

export function ImportHistoricalScoresPage() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('upload')

  const [scoresRows, setScoresRows] = useState<ScoreRow[]>([])
  const [scoreFile, setScoreFile] = useState('')
  const [raterEntries, setRaterEntries] = useState<RaterEntry[]>([])
  const [raterFile, setRaterFile] = useState('')

  // rater num → person ID, 'skip', or '' (undecided)
  const [raterMapping, setRaterMapping] = useState<Record<number, string>>({})

  const [sessionName, setSessionName] = useState('Historical Import')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ scores: number; raters: number } | null>(null)

  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchTests })

  const testByTestId = new Map(tests.filter(t => t.testId != null).map(t => [t.testId!, t]))

  // All rater numbers from scores, merged with rater map (extras shown at end)
  const raterNumsInScores = [...new Set(scoresRows.map(r => r.rater))].sort((a, b) => a - b)
  const allRaters: RaterEntry[] = [
    ...raterEntries,
    ...raterNumsInScores
      .filter(n => !raterEntries.some(r => r.num === n))
      .map(n => ({ num: n, csvName: '' })),
  ].sort((a, b) => a.num - b.num)

  function autoSuggest(csvName: string): string {
    if (!csvName) return ''
    const lower = csvName.toLowerCase()
    const parts = lower.split(/\s+/).filter(p => p.length > 2)
    const match = people.find(p => {
      const pLower = p.name.toLowerCase()
      return pLower.includes(lower) || parts.some(part => pLower.includes(part))
    })
    return match?.id ?? ''
  }

  async function handleScoresFile(f: File) {
    const text = await f.text()
    const rows = parseScoresCSV(text)
    setScoresRows(rows)
    setScoreFile(f.name)
  }

  async function handleRaterFile(f: File) {
    const text = await f.text()
    const entries = parseRaterMapCSV(text)
    setRaterEntries(entries)
    setRaterFile(f.name)
  }

  function proceedToMap() {
    // Re-derive allRaters with fresh state before auto-suggesting
    const raterNumsNow = [...new Set(scoresRows.map(r => r.rater))].sort((a, b) => a - b)
    const ratersNow: RaterEntry[] = [
      ...raterEntries,
      ...raterNumsNow
        .filter(n => !raterEntries.some(r => r.num === n))
        .map(n => ({ num: n, csvName: '' })),
    ].sort((a, b) => a.num - b.num)

    const initial: Record<number, string> = {}
    for (const r of ratersNow) {
      initial[r.num] = autoSuggest(r.csvName)
    }
    setRaterMapping(initial)
    setStep('map')
  }

  const matchedRaterNums = new Set(
    allRaters.filter(r => raterMapping[r.num] && raterMapping[r.num] !== 'skip').map(r => r.num)
  )
  // Unique person IDs — multiple rater numbers mapping to the same person collapse to one
  const matchedPersonIds = new Set(
    allRaters
      .map(r => raterMapping[r.num])
      .filter((id): id is string => !!id && id !== 'skip')
  )
  const scoresToImport = scoresRows.filter(
    r => matchedRaterNums.has(r.rater) && testByTestId.has(r.candidate)
  )
  const unknownCandidates = [...new Set(
    scoresRows.filter(r => matchedRaterNums.has(r.rater) && !testByTestId.has(r.candidate)).map(r => r.candidate)
  )].sort((a, b) => a - b)

  async function handleImport() {
    setImporting(true)
    try {
      const sessionRef = await addDoc(collection(db, 'sessions'), {
        name: sessionName.trim(),
        type: 'historical',
        status: 'published',
        notes: 'Bulk imported from historical records.',
        createdAt: serverTimestamp(),
      })
      const sessionId = sessionRef.id
      const sessionNameTrimmed = sessionName.trim()

      // Group scores by person ID — multiple rater numbers for the same person merge into one assignment
      const byPerson = new Map<string, ScoreRow[]>()
      for (const row of scoresToImport) {
        const personId = raterMapping[row.rater]
        if (!personId || personId === 'skip') continue
        if (!byPerson.has(personId)) byPerson.set(personId, [])
        byPerson.get(personId)!.push(row)
      }

      // Create one assignment per person, accumulate score payloads
      const scorePayloads: Record<string, unknown>[] = []

      for (const [personId, personScores] of byPerson) {
        const person = people.find(p => p.id === personId)
        if (!person || personScores.length === 0) continue

        const testDocIds = [...new Set(personScores.map(s => testByTestId.get(s.candidate)!.id))]

        const assignRef = await addDoc(collection(db, 'assignments'), {
          sessionId,
          sessionName: sessionNameTrimmed,
          raterId: personId,
          raterName: person.name,
          testDocIds,
          status: 'published',
          notes: 'Historical import',
          createdAt: serverTimestamp(),
        })

        for (const s of personScores) {
          const test = testByTestId.get(s.candidate)!
          scorePayloads.push({
            assignmentId: assignRef.id,
            sessionId,
            sessionName: sessionNameTrimmed,
            raterId: personId,
            raterName: person.name,
            testDocId: test.id,
            testNumber: test.testId ?? null,
            candidateName: test.candidateName,
            testType: test.testType,
            pronunciation: s.pronunciation,
            structure: s.structure,
            vocabulary: s.vocabulary,
            fluency: s.fluency,
            comprehension: s.comprehension,
            interactions: s.interactions,
            overallLevel: Math.min(
              s.pronunciation, s.structure, s.vocabulary,
              s.fluency, s.comprehension, s.interactions,
            ),
            published: true,
            notes: '',
            createdAt: serverTimestamp(),
          })
        }
      }

      // Batch-write scores in 499-doc chunks
      for (let i = 0; i < scorePayloads.length; i += 499) {
        const batch = writeBatch(db)
        scorePayloads.slice(i, i + 499).forEach(payload => {
          batch.set(doc(collection(db, 'scores')), payload)
        })
        await batch.commit()
      }

      queryClient.invalidateQueries({ queryKey: ['scores'] })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setImportResult({ scores: scorePayloads.length, raters: byPerson.size })
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep('upload')
    setScoresRows([])
    setScoreFile('')
    setRaterEntries([])
    setRaterFile('')
    setRaterMapping({})
    setSessionName('Historical Import')
    setImportResult(null)
  }

  // --- success ---
  if (importResult) {
    return (
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">Import Historical Scores</h1>
        <div className="flex items-start gap-4 p-6 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle2 className="size-8 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-green-800">Import complete</p>
            <p className="text-sm text-green-700 mt-1">
              {importResult.scores} scores from {importResult.raters} raters added to "{sessionName.trim()}".
              All scores are published and in the main pool.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={reset}>Import another file</Button>
      </div>
    )
  }

  const stepLabels: Record<Step, string> = {
    upload: '1. Upload files',
    map:    '2. Match raters',
    confirm:'3. Import',
  }
  const stepOrder: Step[] = ['upload', 'map', 'confirm']

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import Historical Scores</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import legacy scores from two CSVs: a scores sheet and a rater number-to-name map.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {stepOrder.map((s, i) => {
          const active = s === step
          const done = stepOrder.indexOf(step) > i
          return (
            <span
              key={s}
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                active ? 'bg-primary text-primary-foreground'
                  : done ? 'bg-green-100 text-green-800'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {stepLabels[s]}
            </span>
          )
        })}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Scores CSV</Label>
              <FileZone
                label="Scores sheet"
                description="Columns: candidate, rater, varPronunciation…"
                filename={scoreFile}
                count={scoresRows.length}
                onFile={handleScoresFile}
              />
            </div>
            <div className="space-y-2">
              <Label>Rater map CSV</Label>
              <FileZone
                label="Rater names"
                description="Two columns: rater number, name"
                filename={raterFile}
                count={raterEntries.length}
                onFile={handleRaterFile}
              />
            </div>
          </div>

          {scoresRows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Parsed {scoresRows.length} score rows · {[...new Set(scoresRows.map(r => r.candidate))].length} candidates · {[...new Set(scoresRows.map(r => r.rater))].length} raters
              {raterFile === '' && <span className="text-amber-600"> · Rater map not loaded — you can still proceed and match manually</span>}
            </p>
          )}

          {scoresRows.length === 0 && scoreFile && (
            <p className="text-sm text-destructive">
              Could not parse scores CSV — check the file has the expected column headers (candidate, rater, varPronunciation, etc.)
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={proceedToMap} disabled={scoresRows.length === 0}>
              Next: Match raters →
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Rater disambiguation ── */}
      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Match each rater number to a person in the database. Auto-suggested where names matched — please verify.
            Set any rater to "Skip" to exclude their scores.
          </p>

          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-12">#</th>
                  <th className="text-left px-3 py-2 font-medium">CSV name</th>
                  <th className="text-right px-3 py-2 font-medium w-20">Scores</th>
                  <th className="text-left px-3 py-2 font-medium">Person in database</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allRaters.map(r => {
                  const count = scoresRows.filter(s => s.rater === r.num).length
                  const val = raterMapping[r.num] ?? ''
                  const personName = val && val !== 'skip'
                    ? people.find(p => p.id === val)?.name
                    : undefined

                  return (
                    <tr key={r.num} className={val === 'skip' ? 'bg-muted/30 text-muted-foreground' : ''}>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.num}</td>
                      <td className="px-3 py-2">
                        {r.csvName || <span className="italic text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{count}</td>
                      <td className="px-3 py-2 min-w-[220px]">
                        <Select
                          value={val}
                          onValueChange={v => setRaterMapping(prev => ({ ...prev, [r.num]: v } as Record<number, string>))}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="— unmatched —">
                              {val === 'skip' ? 'Skip'
                                : personName ?? undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">Skip this rater</SelectItem>
                            {people.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {matchedRaterNums.size} of {allRaters.length} rater numbers matched → {matchedPersonIds.size} {matchedPersonIds.size === 1 ? 'person' : 'people'} ·{' '}
            {scoresToImport.length} scores will be imported
          </p>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('upload')}>← Back</Button>
            <Button onClick={() => setStep('confirm')} disabled={matchedRaterNums.size === 0}>
              Next: Preview →
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Confirm & import ── */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Session name</Label>
            <Input
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              className="max-w-sm"
              placeholder="e.g. Historical Import"
            />
            <p className="text-xs text-muted-foreground">This will create a new session of type "historical".</p>
          </div>

          <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
            <p className="text-sm font-medium">What will be imported</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                {matchedPersonIds.size} rater assignment{matchedPersonIds.size !== 1 ? 's' : ''}
                {matchedRaterNums.size > matchedPersonIds.size && (
                  <span className="text-muted-foreground ml-1">
                    ({matchedRaterNums.size} rater numbers collapsed into {matchedPersonIds.size} {matchedPersonIds.size === 1 ? 'person' : 'people'})
                  </span>
                )}
              </li>
              <li>{scoresToImport.length} scores · all published immediately</li>
              <li>Session type: Historical · Status: Published</li>
            </ul>
            {unknownCandidates.length > 0 && (
              <p className="text-sm text-amber-700 mt-2">
                ⚠ {unknownCandidates.length} candidate number{unknownCandidates.length !== 1 ? 's' : ''} not found in test bank (#{unknownCandidates.join(', #')}) — those rows will be skipped.
              </p>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep('map')}>← Back</Button>
            <Button
              onClick={handleImport}
              disabled={importing || scoresToImport.length === 0 || !sessionName.trim()}
            >
              {importing ? 'Importing…' : `Import ${scoresToImport.length} scores`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
