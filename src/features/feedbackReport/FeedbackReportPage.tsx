import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Score, Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PLACEHOLDER_TEXTS, FEEDBACK_AREAS, type FeedbackArea } from './placeholderTexts'

// ── types ──────────────────────────────────────────────────────────────────

type Overrides = Record<string, Partial<Record<FeedbackArea, string>>>

// ── compile ────────────────────────────────────────────────────────────────

function compileReport(
  candidateName: string,
  testNumber: number | null,
  raterScore: Score,
  overrides: Partial<Record<FeedbackArea, string>>,
): string {
  const sections = FEEDBACK_AREAS.map(({ key, label }) => {
    const score = raterScore[key] as number
    const text = overrides[key] ?? PLACEHOLDER_TEXTS[key][score] ?? `[No placeholder for ${label} Level ${score}]`
    return `${label.toUpperCase()} (Level ${score})\n\n${text}`
  })

  return [
    `${candidateName}${testNumber ? ` — Test ${testNumber}` : ''}`,
    '',
    sections.join('\n\n---\n\n'),
  ].join('\n')
}

// ── page ───────────────────────────────────────────────────────────────────

export function FeedbackReportPage() {
  const [sessionName, setSessionName] = useState('')
  const [raterId, setRaterId]         = useState('')
  const [candidateIdx, setCandidateIdx] = useState(0)
  const [overrides, setOverrides]     = useState<Overrides>({})
  const [copied, setCopied]           = useState(false)

  const { data: scores = [] } = useQuery({
    queryKey: ['scores'],
    queryFn: async () =>
      (await getDocs(collection(db, 'scores'))).docs.map(d => ({ id: d.id, ...d.data() }) as Score),
  })
  const { data: people = [] } = useQuery({
    queryKey: ['people'],
    queryFn: async () =>
      (await getDocs(collection(db, 'people'))).docs.map(d => ({ id: d.id, ...d.data() }) as Person),
  })

  const sessions = useMemo(() => {
    const seen = new Map<string, Set<string>>()
    scores.forEach(s => {
      if (!s.sessionId || !s.sessionName) return
      if (!seen.has(s.sessionName)) seen.set(s.sessionName, new Set())
      seen.get(s.sessionName)!.add(s.sessionId)
    })
    return [...seen.entries()]
      .map(([name, ids]) => ({ name, ids: [...ids] }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [scores])

  const sessionIds = useMemo(
    () => sessions.find(s => s.name === sessionName)?.ids ?? [],
    [sessions, sessionName],
  )

  const ratersInSession = useMemo(() => {
    if (!sessionIds.length) return []
    const seen = new Map<string, string>()
    scores.filter(s => sessionIds.includes(s.sessionId)).forEach(s => seen.set(s.raterId, s.raterName))
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [scores, sessionIds])

  const raterScores = useMemo(() => {
    if (!sessionIds.length || !raterId) return []
    return scores
      .filter(s => sessionIds.includes(s.sessionId) && s.raterId === raterId)
      .sort((a, b) => (a.testNumber ?? 0) - (b.testNumber ?? 0))
  }, [scores, sessionIds, raterId])

  const candidate = raterScores[candidateIdx] ?? null
  const label = String.fromCharCode(65 + candidateIdx)

  const candidateOverrides = candidate ? (overrides[candidate.testDocId] ?? {}) : {}

  function getAreaText(area: FeedbackArea): string {
    if (!candidate) return ''
    return candidateOverrides[area] ?? PLACEHOLDER_TEXTS[area][candidate[area] as number] ?? ''
  }

  function setAreaText(area: FeedbackArea, text: string) {
    if (!candidate) return
    setOverrides(prev => ({
      ...prev,
      [candidate.testDocId]: { ...prev[candidate.testDocId], [area]: text },
    }))
  }

  function resetArea(area: FeedbackArea) {
    if (!candidate) return
    setOverrides(prev => {
      const next = { ...prev[candidate.testDocId] }
      delete next[area]
      return { ...prev, [candidate.testDocId]: next }
    })
  }

  function changeSession(name: string) {
    setSessionName(name)
    setRaterId('')
    setCandidateIdx(0)
    setOverrides({})
  }

  function changeRater(id: string) {
    setRaterId(id)
    setCandidateIdx(0)
    setOverrides({})
  }

  const reportText = useMemo(() => {
    if (!candidate) return ''
    return compileReport(candidate.candidateName, candidate.testNumber ?? null, candidate, candidateOverrides)
  }, [candidate, candidateOverrides])

  async function handleCopy() {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Feedback Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">Write per-candidate ICAO feedback using auto-generated placeholder text.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

        {/* ── LEFT ───────────────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Event + Rater */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Event</label>
              <select
                value={sessionName}
                onChange={e => changeSession(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Select event…</option>
                {sessions.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Rater</label>
              <select
                value={raterId}
                onChange={e => changeRater(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                disabled={!sessionName}
              >
                <option value="">Select rater…</option>
                {ratersInSession.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          {raterScores.length > 0 && (<>

            {/* Candidate navigation */}
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline"
                disabled={candidateIdx === 0}
                onClick={() => setCandidateIdx(i => i - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="flex gap-1.5 flex-wrap">
                {raterScores.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setCandidateIdx(i)}
                    className={`px-2.5 py-0.5 rounded text-sm font-medium transition-colors ${
                      i === candidateIdx
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    }`}
                  >
                    {String.fromCharCode(65 + i)}
                  </button>
                ))}
              </div>
              <Button
                size="sm" variant="outline"
                disabled={candidateIdx === raterScores.length - 1}
                onClick={() => setCandidateIdx(i => i + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {candidate && (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Candidate {label} — {candidate.candidateName}
                  {candidate.testNumber != null && (
                    <span className="text-muted-foreground font-normal ml-1.5">Test {candidate.testNumber}</span>
                  )}
                </p>
              </div>
            )}

            {/* Per-area textareas */}
            {FEEDBACK_AREAS.map(({ key, label: areaLabel }) => {
              const score = candidate ? candidate[key] as number : null
              const isOverridden = key in candidateOverrides
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      {areaLabel}
                      {score != null && (
                        <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-mono font-normal ${
                          score >= 5 ? 'bg-green-100 text-green-700' :
                          score === 4 ? 'bg-blue-100 text-blue-700' :
                          score === 3 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          Level {score}
                        </span>
                      )}
                    </label>
                    {isOverridden && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => resetArea(key)}
                      >
                        ↺ Reset
                      </button>
                    )}
                  </div>
                  <Textarea
                    rows={7}
                    value={getAreaText(key)}
                    onChange={e => setAreaText(key, e.target.value)}
                    className="text-sm resize-none font-mono"
                  />
                </div>
              )
            })}

          </>)}
        </div>

        {/* ── RIGHT: compiled report ──────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Compiled report
              {candidate && <span className="text-muted-foreground font-normal ml-1.5">— Candidate {label}</span>}
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
              Select an event and rater to generate feedback.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
