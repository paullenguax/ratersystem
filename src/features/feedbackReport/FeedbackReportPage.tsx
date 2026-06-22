import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Copy, Check } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Test } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PLACEHOLDER_TEXTS, FEEDBACK_AREAS, type FeedbackArea } from './placeholderTexts'

type TestSource = 'bank' | 'manual'

const SCORE_COLOURS: Record<number, string> = {
  1: 'bg-red-600 text-white border-red-600',
  2: 'bg-red-600 text-white border-red-600',
  3: 'bg-amber-500 text-white border-amber-500',
  4: 'bg-blue-600 text-white border-blue-600',
  5: 'bg-green-600 text-white border-green-600',
  6: 'bg-green-600 text-white border-green-600',
}

export function FeedbackReportPage() {
  const [testSource, setTestSource]               = useState<TestSource>('bank')
  const [testDocId, setTestDocId]                 = useState('')
  const [manualCandidateName, setManualCandidateName] = useState('')
  const [manualTestNumber, setManualTestNumber]   = useState('')
  const [activeArea, setActiveArea]               = useState<FeedbackArea>('pronunciation')
  const [scores, setScores]                       = useState<Partial<Record<FeedbackArea, number>>>({})
  const [texts, setTexts]                         = useState<Partial<Record<FeedbackArea, string>>>({})
  const [copied, setCopied]                       = useState(false)

  const { data: tests = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: async () =>
      (await getDocs(collection(db, 'test_bank'))).docs.map(d => ({ id: d.id, ...d.data() }) as Test),
  })

  const sortedTests = useMemo(
    () => [...tests].filter(t => t.status === 'active').sort((a, b) => (a.testId ?? 0) - (b.testId ?? 0)),
    [tests],
  )

  const selectedTest = useMemo(() => tests.find(t => t.id === testDocId) ?? null, [tests, testDocId])

  const candidateName = testSource === 'bank' ? (selectedTest?.candidateName ?? '') : manualCandidateName
  const testNumber    = testSource === 'bank'
    ? (selectedTest?.testId ?? null)
    : (manualTestNumber ? parseInt(manualTestNumber) || null : null)

  const testReady = testSource === 'bank' ? !!testDocId : !!manualCandidateName

  function switchSource(src: TestSource) {
    setTestSource(src)
    setTestDocId('')
    setManualCandidateName('')
    setManualTestNumber('')
    setScores({})
    setTexts({})
    setActiveArea('pronunciation')
  }

  function selectTest(id: string) {
    setTestDocId(id)
    setScores({})
    setTexts({})
    setActiveArea('pronunciation')
  }

  function setScore(area: FeedbackArea, score: number) {
    setScores(prev => ({ ...prev, [area]: score }))
    setTexts(prev => { const n = { ...prev }; delete n[area]; return n })
  }

  function getAreaText(area: FeedbackArea): string {
    if (texts[area] !== undefined) return texts[area]!
    const score = scores[area]
    return score ? (PLACEHOLDER_TEXTS[area][score] ?? '') : ''
  }

  const completedCount = FEEDBACK_AREAS.filter(a => scores[a.key] != null).length

  const reportText = useMemo(() => {
    if (!candidateName || completedCount === 0) return ''
    const header = `${candidateName}${testNumber != null ? ` — Test ${testNumber}` : ''}`
    const sections = FEEDBACK_AREAS
      .filter(({ key }) => scores[key] != null)
      .map(({ key, label }) => {
        const score = scores[key]!
        const text  = texts[key] ?? PLACEHOLDER_TEXTS[key][score] ?? ''
        return `${label.toUpperCase()} (Level ${score})\n\n${text}`
      })
    return [header, '', sections.join('\n\n---\n\n')].join('\n')
  }, [candidateName, testNumber, scores, texts, completedCount])

  async function handleCopy() {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeScore = scores[activeArea]
  const activeText  = getAreaText(activeArea)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Feedback Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">Write per-candidate ICAO feedback with auto-generated placeholder text.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

        {/* ── LEFT ───────────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Source toggle + test selector */}
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['bank', 'manual'] as TestSource[]).map(src => (
                <button
                  key={src}
                  onClick={() => switchSource(src)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    testSource === src
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {src === 'bank' ? 'From test bank' : 'Manual entry'}
                </button>
              ))}
            </div>

            {testSource === 'bank' ? (
              <select
                value={testDocId}
                onChange={e => selectTest(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Select test…</option>
                {sortedTests.map(t => (
                  <option key={t.id} value={t.id}>#{t.testId} — {t.candidateName}</option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Candidate name</label>
                  <Input
                    placeholder="e.g. Jane Smith"
                    value={manualCandidateName}
                    onChange={e => setManualCandidateName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Test number (optional)</label>
                  <Input
                    placeholder="e.g. 23"
                    value={manualTestNumber}
                    onChange={e => setManualTestNumber(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {testReady && (<>

            {/* Area tabs */}
            <div className="flex gap-1.5">
              {FEEDBACK_AREAS.map(({ key, label }) => {
                const isComplete = scores[key] != null
                const isActive   = activeArea === key
                return (
                  <button
                    key={key}
                    onClick={() => setActiveArea(key)}
                    title={label}
                    className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isComplete
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {isComplete && !isActive ? '✓' : label.slice(0, 3).toUpperCase()}
                  </button>
                )
              })}
            </div>

            {/* Score buttons */}
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {FEEDBACK_AREAS.find(a => a.key === activeArea)?.label}
                {activeScore != null && (
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-mono ${SCORE_COLOURS[activeScore]}`}>
                    Level {activeScore}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => setScore(activeArea, n)}
                    className={`w-10 h-10 rounded border text-sm font-semibold transition-colors ${
                      activeScore === n
                        ? SCORE_COLOURS[n]
                        : 'bg-background border-input hover:bg-muted'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Editable textarea */}
            {activeScore != null && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Feedback text</label>
                  {texts[activeArea] !== undefined && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setTexts(prev => { const n = { ...prev }; delete n[activeArea]; return n })}
                    >
                      ↺ Reset to placeholder
                    </button>
                  )}
                </div>
                <Textarea
                  key={`${activeArea}-${activeScore}`}
                  rows={13}
                  value={activeText}
                  onChange={e => setTexts(prev => ({ ...prev, [activeArea]: e.target.value }))}
                  className="text-sm resize-none font-mono"
                />
              </div>
            )}

          </>)}
        </div>

        {/* ── RIGHT: compiled report ──────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Compiled report
              {completedCount > 0 && (
                <span className="text-muted-foreground font-normal ml-1.5">({completedCount}/6)</span>
              )}
            </p>
            {reportText && (
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied
                  ? <><Check className="size-4 mr-1.5" />Copied</>
                  : <><Copy className="size-4 mr-1.5" />Copy</>}
              </Button>
            )}
          </div>
          {reportText ? (
            <Textarea
              value={reportText}
              readOnly
              rows={52}
              className="font-mono text-xs resize-none bg-muted/30"
            />
          ) : (
            <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
              Select a test and score at least one area to see the report.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
