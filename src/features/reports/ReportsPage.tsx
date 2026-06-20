import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Copy, Check } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Score, Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

// ── types ──────────────────────────────────────────────────────────────────

interface CandidateStat {
  label: string        // A, B, C…
  candidateName: string
  testDocId: string
  raterScore: Score
  allScores: Score[]
  avgOverall: number
  delta: number        // rater - average
}

// ── per-candidate auto-paragraph ───────────────────────────────────────────

function autoPara(stat: CandidateStat): string {
  const { label, candidateName: _, raterScore, allScores, avgOverall, delta } = stat
  const avg = avgOverall.toFixed(1)
  const their = raterScore.overallLevel
  const n = allScores.length
  const raters = `${n} rater${n !== 1 ? 's' : ''}`

  if (Math.abs(delta) < 0.3)
    return `Candidate ${label}: your overall score of ${their} is closely in line with the general consensus (average ${avg} across ${raters}).`
  if (delta >= 0.3 && delta < 0.8)
    return `Candidate ${label}: your overall score of ${their} is a little more generous than the average of ${avg} across ${raters}, though this is not unreasonable.`
  if (delta >= 0.8)
    return `Candidate ${label}: your overall score of ${their} is notably more generous than the average of ${avg} across ${raters}.`
  if (delta <= -0.3 && delta > -0.8)
    return `Candidate ${label}: your overall score of ${their} is a little stricter than the average of ${avg} across ${raters}.`
  return `Candidate ${label}: your overall score of ${their} is notably stricter than the average of ${avg} across ${raters}.`
}

// ── email builder ──────────────────────────────────────────────────────────

function buildEmail(params: {
  rater: Person
  candidateStats: CandidateStat[]
  paraOverrides: Record<string, string>
  measure: string
  infit: string
  outcome: 'pass' | 'advisory' | 'fail'
  advisoryText: string
}): string {
  const { rater, candidateStats, paraOverrides, measure, infit, outcome, advisoryText } = params
  const firstName = rater.name.split(' ')[0]
  const raterNum = rater.raterNumber ?? '[RATER NUMBER]'

  const measureVal = measure || '[MEASURE]'
  const infitVal   = infit   || '[INFIT MNSQ]'
  const measureNum = parseFloat(measure)
  const infitNum   = parseFloat(infit)
  const measureInRange = !isNaN(measureNum) && measureNum >= -1 && measureNum <= 1
  const infitInRange   = !isNaN(infitNum)   && infitNum   >= 0.7 && infitNum   <= 1.3

  const candidateParas = candidateStats
    .map(s => paraOverrides[s.label] ?? autoPara(s))
    .join('\n\n')

  // overall summary sentence
  const notable = candidateStats.filter(s => Math.abs(s.delta) >= 0.5)
  let overallLine: string
  if (notable.length === 0) {
    overallLine = 'Overall, your scores seem very close to the general consensus in each case.'
  } else {
    const parts = notable.map(s =>
      `${s.delta > 0 ? 'more generous' : 'stricter'} than the average rater to Candidate ${s.label}`
    )
    overallLine = `Overall, your scores seem very close to the general consensus in each case, although you were ${parts.join(', and ')}.`
  }

  // chart placement note
  const chartNote = !isNaN(measureNum) && Math.abs(measureNum) > 0.5
    ? 'You can see you are indeed somewhat to one side of the main group of raters.'
    : 'You can see where you sit relative to the main group of raters.'

  // outcome sentence
  const outcomeText =
    outcome === 'pass'     ? 'we are happy to award your certificate, with no real advisories.' :
    outcome === 'advisory' ? `we are happy to award your certificate. ${advisoryText || '[ADVISORY DETAIL]'}` :
                             `we are not yet in a position to award your certificate. ${advisoryText || '[REASON]'}`

  return [
    `Hi ${firstName}`,
    '',
    `Thanks for sending in your scores.`,
    '',
    `First, we'll look at the individual scoring, then some statistical analysis of the scores in general.`,
    '',
    candidateParas,
    '',
    overallLine,
    '',
    `Statistically (see attachment) this seems to be the case. If you find it difficult to understand, I invite you to look at Module 9 on the course, which explains the data I'm about to share.`,
    '',
    `You are Rater ${raterNum}, and the table shows a Rasch analysis of your scores. You can see in the column labelled "measure" an indication of how "strict" or "relaxed" your rating is. You can see it says ${measureVal}. A positive number means "strict" compared to the average, and a negative number means "relaxed".`,
    '',
    `We want our raters to be between +1 and -1 (that is, not too strict, not too generous) so you are ${measureInRange ? 'inside' : 'outside'} this range.`,
    '',
    `The chart below the table is a visualisation of your leniency as it compares to other raters who have rated the same recordings. ${chartNote}`,
    '',
    `Also in the table is a measurement of your "reliability" (that is, how predictably you rate). This is the Infit MnSq score of ${infitVal}. A high number means you are rating somewhat "randomly" and a lower number more "uniformly". A commonly accepted range here for high-stakes testing is 0.7 - 1.3, with a lower number being less problematic than a high number which indicates "wild" scoring. So, you are ${infitInRange ? 'inside' : 'outside'} this range.`,
    '',
    `With this in mind, ${outcomeText}`,
    '',
    `The certificate will follow separately.`,
    '',
    `Congratulations on passing the course!`,
    '',
    `If possible, could you leave us some feedback?`,
    '',
    `If you wish to do this in "public", so to speak, you can do so here:`,
    '',
    `https://www.lenguax.com/product/online-aviation-english-rater-course/`,
    '',
    `It would help us to help interest in the course grow.`,
    '',
    `However, I'd also be interested in any candid comments you want to offer about how we might improve, if you have any to share!`,
    '',
    `https://www.lenguax.com/?tripetto=43eb617b2f2bba28e8e6c89be82216a1a69f481b32a8614336fe03f2652e16b7`,
    '',
    '',
    `Thanks again, well done, and we'll be in touch soon.`,
    '',
    `Best wishes`,
  ].join('\n')
}

// ── page ───────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [sessionId, setSessionId]     = useState('')
  const [raterId, setRaterId]         = useState('')
  const [measure, setMeasure]         = useState('')
  const [infit, setInfit]             = useState('')
  const [outcome, setOutcome]         = useState<'pass' | 'advisory' | 'fail'>('pass')
  const [advisoryText, setAdvisoryText] = useState('')
  const [paraOverrides, setParaOverrides] = useState<Record<string, string>>({})
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
    const seen = new Map<string, string>()
    scores.forEach(s => { if (s.sessionId) seen.set(s.sessionId, s.sessionName) })
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [scores])

  const ratersInSession = useMemo(() => {
    if (!sessionId) return []
    const seen = new Map<string, string>()
    scores.filter(s => s.sessionId === sessionId).forEach(s => seen.set(s.raterId, s.raterName))
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [scores, sessionId])

  const rater = useMemo(() => people.find(p => p.id === raterId), [people, raterId])

  const candidateStats = useMemo((): CandidateStat[] => {
    if (!sessionId || !raterId) return []
    const raterScores = scores
      .filter(s => s.sessionId === sessionId && s.raterId === raterId)
      .sort((a, b) => (a.testNumber ?? 0) - (b.testNumber ?? 0))
    return raterScores.map((rs, i) => {
      const allScores = scores.filter(s => s.sessionId === sessionId && s.testDocId === rs.testDocId)
      const avgOverall = allScores.reduce((sum, s) => sum + s.overallLevel, 0) / allScores.length
      return {
        label: String.fromCharCode(65 + i),
        candidateName: rs.candidateName,
        testDocId: rs.testDocId,
        raterScore: rs,
        allScores,
        avgOverall,
        delta: rs.overallLevel - avgOverall,
      }
    })
  }, [scores, sessionId, raterId])

  const emailText = useMemo(() => {
    if (!rater || candidateStats.length === 0) return ''
    return buildEmail({ rater, candidateStats, paraOverrides, measure, infit, outcome, advisoryText })
  }, [rater, candidateStats, paraOverrides, measure, infit, outcome, advisoryText])

  function changeSession(id: string) {
    setSessionId(id)
    setRaterId('')
    setParaOverrides({})
    setMeasure('')
    setInfit('')
    setOutcome('pass')
    setAdvisoryText('')
  }

  function changeRater(id: string) {
    setRaterId(id)
    setParaOverrides({})
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(emailText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const measureNum = parseFloat(measure)
  const infitNum   = parseFloat(infit)
  const measureInRange = !isNaN(measureNum) && measureNum >= -1  && measureNum <= 1
  const infitInRange   = !isNaN(infitNum)   && infitNum   >= 0.7 && infitNum   <= 1.3

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">Generate a feedback email for a rater.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

        {/* ── LEFT: controls ─────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Event + Rater selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Event</label>
              <select
                value={sessionId}
                onChange={e => changeSession(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Select event…</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Rater</label>
              <select
                value={raterId}
                onChange={e => changeRater(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                disabled={!sessionId}
              >
                <option value="">Select rater…</option>
                {ratersInSession.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          {candidateStats.length > 0 && (<>

            {/* Score comparison table */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Score comparison</p>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Candidate</th>
                      <th className="px-2 py-2 text-center font-medium">OVL</th>
                      <th className="px-2 py-2 text-center font-medium">Avg</th>
                      <th className="px-2 py-2 text-center font-medium">Δ</th>
                      <th className="px-2 py-2 text-center font-medium">PRO</th>
                      <th className="px-2 py-2 text-center font-medium">STR</th>
                      <th className="px-2 py-2 text-center font-medium">VOC</th>
                      <th className="px-2 py-2 text-center font-medium">FLU</th>
                      <th className="px-2 py-2 text-center font-medium">COM</th>
                      <th className="px-2 py-2 text-center font-medium">INT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateStats.map(stat => (
                      <tr key={stat.label} className="border-t">
                        <td className="px-3 py-1.5">
                          <span className="font-mono font-bold mr-1.5">{stat.label}</span>
                          <span className="text-muted-foreground">{stat.candidateName}</span>
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono font-bold">
                          {stat.raterScore.overallLevel}
                        </td>
                        <td className="px-2 py-1.5 text-center text-muted-foreground font-mono">
                          {stat.avgOverall.toFixed(1)}
                        </td>
                        <td className={`px-2 py-1.5 text-center font-mono font-medium ${
                          stat.delta >  0.3 ? 'text-amber-600' :
                          stat.delta < -0.3 ? 'text-blue-600'  : 'text-muted-foreground'
                        }`}>
                          {stat.delta > 0 ? '+' : ''}{stat.delta.toFixed(1)}
                        </td>
                        {(['pronunciation','structure','vocabulary','fluency','comprehension','interactions'] as const).map(dim => (
                          <td key={dim} className="px-2 py-1.5 text-center font-mono">{stat.raterScore[dim]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Δ = rater vs session average · <span className="text-amber-600">amber = generous</span> · <span className="text-blue-600">blue = strict</span>
              </p>
            </div>

            {/* Editable candidate paragraphs */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Candidate commentary</p>
              {candidateStats.map(stat => (
                <div key={stat.label} className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Candidate {stat.label} — {stat.candidateName}
                  </label>
                  <Textarea
                    rows={3}
                    value={paraOverrides[stat.label] ?? autoPara(stat)}
                    onChange={e => setParaOverrides(p => ({ ...p, [stat.label]: e.target.value }))}
                    className="text-sm resize-none"
                  />
                  {paraOverrides[stat.label] !== undefined && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setParaOverrides(p => { const n = { ...p }; delete n[stat.label]; return n })}
                    >
                      ↺ Reset to auto
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Rasch inputs */}
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Rasch results{' '}
                <span className="text-muted-foreground font-normal text-xs">(from Facets output — leave blank for placeholders)</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Measure (leniency)</label>
                  <Input placeholder="-0.98" value={measure} onChange={e => setMeasure(e.target.value)} />
                  {measure && (
                    <p className={`text-xs ${measureInRange ? 'text-green-700' : 'text-red-600'}`}>
                      {measureInRange ? '✓ inside ±1' : '✗ outside ±1'}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Infit MnSq (reliability)</label>
                  <Input placeholder="0.65" value={infit} onChange={e => setInfit(e.target.value)} />
                  {infit && (
                    <p className={`text-xs ${infitInRange ? 'text-green-700' : 'text-red-600'}`}>
                      {infitInRange ? '✓ inside 0.7–1.3' : '✗ outside 0.7–1.3'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Outcome */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Outcome</p>
              <div className="flex flex-wrap gap-4">
                {([
                  ['pass',     'Certificate awarded'],
                  ['advisory', 'Certificate with advisory'],
                  ['fail',     'Not yet'],
                ] as const).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="outcome" value={val} checked={outcome === val} onChange={() => setOutcome(val)} />
                    {label}
                  </label>
                ))}
              </div>
              {outcome !== 'pass' && (
                <Textarea
                  placeholder={outcome === 'advisory' ? 'Describe the advisory…' : 'Explain why not yet…'}
                  value={advisoryText}
                  onChange={e => setAdvisoryText(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              )}
            </div>

          </>)}
        </div>

        {/* ── RIGHT: email preview ────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Email draft</p>
            {emailText && (
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied
                  ? <><Check className="size-4 mr-1.5" />Copied</>
                  : <><Copy className="size-4 mr-1.5" />Copy to clipboard</>}
              </Button>
            )}
          </div>
          {emailText ? (
            <Textarea
              value={emailText}
              readOnly
              rows={48}
              className="font-mono text-xs resize-none bg-muted/30"
            />
          ) : (
            <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
              Select an event and rater to generate the email draft.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
