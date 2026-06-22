import { Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { Copy, Check, ChevronRight, Download } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Score, Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WrightMap } from '@/components/WrightMap'
import type { RaschRun } from '@/lib/parseFacets'

// ── helpers ────────────────────────────────────────────────────────────────

const DIMS = [
  { key: 'pronunciation' as const, abbr: 'PRO' },
  { key: 'structure'     as const, abbr: 'STR' },
  { key: 'vocabulary'    as const, abbr: 'VOC' },
  { key: 'fluency'       as const, abbr: 'FLU' },
  { key: 'comprehension' as const, abbr: 'COM' },
  { key: 'interactions'  as const, abbr: 'INT' },
]

function mean(vals: number[]) {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}
function fmt(n: number | null) {
  return n == null ? '—' : n % 1 === 0 ? String(n) : n.toFixed(1)
}
function scoreColour(n: number) {
  if (n >= 5) return 'text-green-700'
  if (n === 4) return 'text-blue-700'
  if (n === 3) return 'text-amber-700'
  return 'text-red-700'
}

// ── types ──────────────────────────────────────────────────────────────────

interface CandidateStat {
  label: string
  candidateName: string
  testDocId: string
  raterScore: Score
  allScores: Score[]    // ALL scores for this test across all sessions
  avgOverall: number
  delta: number
}

// ── per-candidate auto-paragraph ───────────────────────────────────────────

function autoPara(stat: CandidateStat): string {
  const { label, raterScore, allScores, avgOverall, delta } = stat
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
  isRepeater: boolean
  prevRaterNumber: string
  prevMeasure: string
  currentRaterNumber: string
}): string {
  const { rater, candidateStats, paraOverrides, measure, infit, outcome, advisoryText,
          isRepeater, prevRaterNumber, prevMeasure, currentRaterNumber } = params
  const firstName = rater.name.split(' ')[0]
  const raterNum = (isRepeater && currentRaterNumber) ? currentRaterNumber : (rater.raterNumber ?? '[RATER NUMBER]')

  const measureVal = measure || '[MEASURE]'
  const infitVal   = infit   || '[INFIT MNSQ]'
  const measureNum = parseFloat(measure)
  const infitNum   = parseFloat(infit)
  const measureInRange = !isNaN(measureNum) && measureNum >= -1 && measureNum <= 1
  const infitInRange   = !isNaN(infitNum)   && infitNum   >= 0.7 && infitNum   <= 1.3

  const candidateParas = candidateStats
    .map(s => paraOverrides[s.label] ?? autoPara(s))
    .join('\n\n')

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

  const chartNote = !isNaN(measureNum) && Math.abs(measureNum) > 0.5
    ? 'You can see you are indeed somewhat to one side of the main group of raters.'
    : 'You can see where you sit relative to the main group of raters.'

  const outcomeText =
    outcome === 'pass'     ? 'we are happy to award your certificate, with no real advisories.' :
    outcome === 'advisory' ? `we are happy to award your certificate. ${advisoryText || '[ADVISORY DETAIL]'}` :
                             `we are not yet in a position to award your certificate. ${advisoryText || '[REASON]'}`

  let repeaterSentence = ''
  if (isRepeater && prevRaterNumber) {
    const prevM = parseFloat(prevMeasure)
    const currM = parseFloat(measure)
    let severityClause = ''
    if (!isNaN(prevM) && !isNaN(currM)) {
      const diff = currM - prevM
      const word = diff > 0.3 ? 'more severe (stricter)' : diff < -0.3 ? 'less severe (more generous)' : 'similarly severe'
      severityClause = ` Your current scores are ${word} compared to that previous certification.`
    }
    repeaterSentence = `As a returning rater, your previous scores with us (as Rater ${prevRaterNumber}) had a severity measure of ${prevMeasure || '[PREVIOUS MEASURE]'}.${severityClause}`
  }

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
    ...(repeaterSentence ? [repeaterSentence, ''] : []),
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
  const [sessionName, setSessionName]   = useState('')   // deduplicated by name
  const [raterId, setRaterId]           = useState('')
  const [measure, setMeasure]           = useState('')
  const [infit, setInfit]               = useState('')
  const [outcome, setOutcome]           = useState<'pass' | 'advisory' | 'fail'>('pass')
  const [advisoryText, setAdvisoryText] = useState('')
  const [paraOverrides, setParaOverrides] = useState<Record<string, string>>({})
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [copied, setCopied]             = useState(false)
  const [isRepeater, setIsRepeater]     = useState(false)
  const [currentRaterNumber, setCurrentRaterNumber] = useState('')
  const [prevRaterNumber, setPrevRaterNumber] = useState('')
  const [prevMeasure, setPrevMeasure]   = useState('')

  const svgRef = useRef<SVGSVGElement>(null)

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
  const { data: latestRun } = useQuery({
    queryKey: ['rasch_runs', 'latest'],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'rasch_runs'), orderBy('importedAt', 'desc'), limit(1)))
      if (snap.empty) return null
      return snap.docs[0].data() as RaschRun & { meanMeasure: number; reliability: number; separation: number; rmse: number }
    },
  })

  // Sessions deduplicated by name (multiple import runs → one entry)
  const sessions = useMemo(() => {
    const seen = new Map<string, Set<string>>() // name → set of sessionIds
    scores.forEach(s => {
      if (!s.sessionId || !s.sessionName) return
      if (!seen.has(s.sessionName)) seen.set(s.sessionName, new Set())
      seen.get(s.sessionName)!.add(s.sessionId)
    })
    return [...seen.entries()]
      .map(([name, ids]) => ({ name, ids: [...ids] }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [scores])

  // All sessionIds for the selected session name
  const sessionIds = useMemo(
    () => sessions.find(s => s.name === sessionName)?.ids ?? [],
    [sessions, sessionName],
  )

  const ratersInSession = useMemo(() => {
    if (!sessionIds.length) return []
    const seen = new Map<string, string>()
    scores
      .filter(s => sessionIds.includes(s.sessionId))
      .forEach(s => seen.set(s.raterId, s.raterName))
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [scores, sessionIds])

  const rater = useMemo(() => people.find(p => p.id === raterId), [people, raterId])

  const raschData = useMemo(() => {
    if (!latestRun || !rater?.raterNumber) return null
    return latestRun.raters.find(r => r.raterNumber === rater.raterNumber) ?? null
  }, [latestRun, rater])

  // Auto-fill measure/infit when rasch data is available for this rater
  useEffect(() => {
    if (raschData && !measure) setMeasure(String(raschData.measure))
    if (raschData && !infit)   setInfit(String(raschData.infitMnSq))
  }, [raschData]) // eslint-disable-line react-hooks/exhaustive-deps

  const srRaterIds = useMemo(
    () => new Set(people.filter(p => p.role === 'senior_rater' || p.role === 'admin').map(p => p.id)),
    [people],
  )

  // Scores for this rater in this session, sorted by entry order so A/B/C matches the rater's test sequence
  const raterScores = useMemo(() => {
    if (!sessionIds.length || !raterId) return []
    return scores
      .filter(s => sessionIds.includes(s.sessionId) && s.raterId === raterId)
      .sort((a, b) => ((a.createdAt as any)?.seconds ?? 0) - ((b.createdAt as any)?.seconds ?? 0))
  }, [scores, sessionIds, raterId])

  // Per-candidate stats — allScores drawn from ALL sessions for that test
  const candidateStats = useMemo((): CandidateStat[] => {
    return raterScores.map((rs, i) => {
      const allScores = scores.filter(s => s.testDocId === rs.testDocId)
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
  }, [scores, raterScores])

  // Senior-rater scores per test for expanded rows
  const srScoresByTest = useMemo(() => {
    const m = new Map<string, Score[]>()
    const testDocIds = new Set(raterScores.map(s => s.testDocId))
    scores
      .filter(s => testDocIds.has(s.testDocId) && srRaterIds.has(s.raterId))
      .forEach(s => {
        if (!m.has(s.testDocId)) m.set(s.testDocId, [])
        m.get(s.testDocId)!.push(s)
      })
    for (const [id, arr] of m) {
      m.set(id, arr.sort((a, b) => {
        // current rater first, then alphabetical
        if (a.raterId === raterId) return -1
        if (b.raterId === raterId) return 1
        return a.raterName.localeCompare(b.raterName)
      }))
    }
    return m
  }, [scores, raterScores, srRaterIds, raterId])

  // Summary means
  const raterMeans = useMemo(() => {
    if (!raterScores.length) return null
    const dims: Record<string, number | null> = {}
    DIMS.forEach(d => { dims[d.key] = mean(raterScores.map(s => s[d.key] as number)) })
    return { dims, overall: mean(raterScores.map(s => s.overallLevel)) }
  }, [raterScores])

  const globalMeans = useMemo(() => {
    const allForTests = scores.filter(s => raterScores.some(r => r.testDocId === s.testDocId))
    if (!allForTests.length) return null
    const dims: Record<string, number | null> = {}
    DIMS.forEach(d => { dims[d.key] = mean(allForTests.map(s => s[d.key] as number)) })
    return { dims, overall: mean(allForTests.map(s => s.overallLevel)), n: allForTests.length }
  }, [scores, raterScores])

  const emailText = useMemo(() => {
    if (!rater || candidateStats.length === 0) return ''
    return buildEmail({ rater, candidateStats, paraOverrides, measure, infit, outcome, advisoryText,
                        isRepeater, currentRaterNumber, prevRaterNumber, prevMeasure })
  }, [rater, candidateStats, paraOverrides, measure, infit, outcome, advisoryText,
      isRepeater, currentRaterNumber, prevRaterNumber, prevMeasure])

  function toggleExpanded(testDocId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(testDocId) ? next.delete(testDocId) : next.add(testDocId)
      return next
    })
  }

  function changeSession(name: string) {
    setSessionName(name)
    setRaterId('')
    setParaOverrides({})
    setExpanded(new Set())
    setMeasure('')
    setInfit('')
    setOutcome('pass')
    setAdvisoryText('')
  }

  function changeRater(id: string) {
    setRaterId(id)
    setParaOverrides({})
    setExpanded(new Set())
    setIsRepeater(false)
    setCurrentRaterNumber('')
    setPrevRaterNumber('')
    setPrevMeasure('')
  }

  function handleDownloadMap() {
    const svg = svgRef.current
    if (!svg) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svg)
    const canvas = document.createElement('canvas')
    canvas.width = 340 * 2
    canvas.height = 520 * 2
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    const blob = new Blob([svgStr], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(png => {
        if (!png) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(png)
        a.download = `wright-map-${rater?.raterNumber ?? 'rater'}.png`
        a.click()
      }, 'image/png')
    }
    img.src = url
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

          {candidateStats.length > 0 && (<>

            {/* Score comparison table — AssignmentReview style */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Score comparison</p>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="w-5" />
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground text-xs w-6">#</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground text-xs">Candidate</th>
                      {DIMS.map(d => (
                        <th key={d.key} className="px-1.5 py-1.5 font-medium text-center text-xs text-muted-foreground w-8">
                          {d.abbr}
                        </th>
                      ))}
                      <th className="px-1.5 py-1.5 font-medium text-center text-xs w-8">OVL</th>
                      <th className="px-1 py-1.5 text-center text-xs text-muted-foreground/40 w-4">|</th>
                      {DIMS.map(d => (
                        <th key={`m-${d.key}`} className="px-1.5 py-1.5 font-medium text-center text-xs text-muted-foreground w-8">
                          {d.abbr}
                        </th>
                      ))}
                      <th className="px-1.5 py-1.5 font-medium text-center text-xs text-muted-foreground w-8">OVL</th>
                      <th className="px-1.5 py-1.5 font-medium text-center text-xs text-muted-foreground w-6">n</th>
                    </tr>
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th colSpan={3} />
                      <th colSpan={7} className="text-center py-0.5 font-normal">{rater?.name}</th>
                      <th />
                      <th colSpan={7} className="text-center py-0.5 font-normal">All raters (mean)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {candidateStats.map(stat => {
                      const { raterScore, allScores, label, testDocId } = stat
                      const allMeans = {
                        dims: Object.fromEntries(DIMS.map(d => [d.key, mean(allScores.map(s => s[d.key] as number))])),
                        overall: mean(allScores.map(s => s.overallLevel)),
                        n: allScores.length,
                      }
                      const srScores = srScoresByTest.get(testDocId) ?? []
                      const isExpanded = expanded.has(testDocId)

                      return (
                        <Fragment key={testDocId}>
                          <tr className={`border-b transition-colors ${isExpanded ? 'bg-muted/30' : 'hover:bg-muted/20'}`}>
                            <td className="pl-1.5 py-1.5 w-5">
                              {srScores.length > 0 && (
                                <button
                                  onClick={() => toggleExpanded(testDocId)}
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title={isExpanded ? 'Collapse' : `Show ${srScores.length} senior rater score${srScores.length !== 1 ? 's' : ''}`}
                                >
                                  <ChevronRight className={`size-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                </button>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                              <span className="font-bold text-foreground mr-1">{label}</span>
                              {raterScore.testNumber ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-xs">{stat.candidateName}</td>
                            {DIMS.map(d => (
                              <td key={d.key} className="px-1.5 py-1.5 text-center font-mono text-xs">
                                <span className={`font-semibold ${scoreColour(raterScore[d.key] as number)}`}>
                                  {raterScore[d.key] as number}
                                </span>
                              </td>
                            ))}
                            <td className="px-1.5 py-1.5 text-center font-mono text-xs">
                              <span className={`font-bold ${scoreColour(raterScore.overallLevel)}`}>
                                {raterScore.overallLevel}
                              </span>
                            </td>
                            <td className="px-1 py-1.5 text-center text-muted-foreground/30 text-xs">|</td>
                            {DIMS.map(d => (
                              <td key={`m-${d.key}`} className="px-1.5 py-1.5 text-center font-mono text-xs text-muted-foreground">
                                {fmt(allMeans.dims[d.key] ?? null)}
                              </td>
                            ))}
                            <td className={`px-1.5 py-1.5 text-center font-mono text-xs font-medium ${
                              stat.delta >  0.3 ? 'text-amber-600' :
                              stat.delta < -0.3 ? 'text-blue-600'  : 'text-muted-foreground'
                            }`}>
                              {fmt(allMeans.overall)}
                            </td>
                            <td className="px-1.5 py-1.5 text-center text-xs text-muted-foreground">
                              {allMeans.n}
                            </td>
                          </tr>

                          {isExpanded && srScores.map(s => (
                            <tr key={s.id} className={`border-b text-xs ${s.raterId === raterId ? 'bg-blue-50/60' : 'bg-muted/10 hover:bg-muted/20'}`}>
                              <td /><td />
                              <td className="px-2 py-1 text-muted-foreground pl-5">
                                {s.raterName}
                                {s.raterId === raterId && (
                                  <span className="ml-1.5 text-[10px] text-primary font-medium">this rater</span>
                                )}
                              </td>
                              {DIMS.map(d => (
                                <td key={d.key} className="px-1.5 py-1 text-center font-mono">
                                  <span className={scoreColour(s[d.key] as number)}>{s[d.key] as number}</span>
                                </td>
                              ))}
                              <td className="px-1.5 py-1 text-center font-mono">
                                <span className={`font-semibold ${scoreColour(s.overallLevel)}`}>{s.overallLevel}</span>
                              </td>
                              <td colSpan={9} />
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}

                    {/* Summary row */}
                    {(raterMeans || globalMeans) && (
                      <tr className="border-t-2 bg-muted/20 font-medium">
                        <td /><td />
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">Average</td>
                        {DIMS.map(d => (
                          <td key={d.key} className="px-1.5 py-1.5 text-center font-mono text-xs">
                            {raterMeans ? fmt(raterMeans.dims[d.key] ?? null) : '—'}
                          </td>
                        ))}
                        <td className="px-1.5 py-1.5 text-center font-mono text-xs font-bold">
                          {raterMeans ? fmt(raterMeans.overall) : '—'}
                        </td>
                        <td className="px-1 py-1.5 text-center text-muted-foreground/30 text-xs">|</td>
                        {DIMS.map(d => (
                          <td key={`m-${d.key}`} className="px-1.5 py-1.5 text-center font-mono text-xs text-muted-foreground">
                            {globalMeans ? fmt(globalMeans.dims[d.key] ?? null) : '—'}
                          </td>
                        ))}
                        <td className="px-1.5 py-1.5 text-center font-mono text-xs text-muted-foreground font-bold">
                          {globalMeans ? fmt(globalMeans.overall) : '—'}
                        </td>
                        <td className="px-1.5 py-1.5 text-center text-xs text-muted-foreground">
                          {globalMeans?.n ?? 0}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                OVL avg: <span className="text-amber-600">amber = rater generous</span> · <span className="text-blue-600">blue = rater strict</span>
                {' · '}chevron shows senior rater scores
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
                <span className="text-muted-foreground font-normal text-xs">(leave blank for placeholders)</span>
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

            {/* Wright map */}
            {raschData && latestRun && rater && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Wright map</p>
                  <Button size="sm" variant="outline" onClick={handleDownloadMap}>
                    <Download className="size-4 mr-1.5" />
                    Download PNG
                  </Button>
                </div>
                <div className="border rounded-md p-2 inline-block bg-white">
                  <WrightMap
                    ref={svgRef}
                    raterName={rater.name}
                    raterNumber={rater.raterNumber!}
                    measure={raschData.measure}
                    se={raschData.se}
                    meanMeasure={latestRun.meanMeasure}
                    candidateDensity={latestRun.candidateDensity}
                    criteria={latestRun.criteria}
                  />
                </div>
              </div>
            )}

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

            {/* Repeater */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRepeater}
                  onChange={e => setIsRepeater(e.target.checked)}
                />
                Returning rater (has previous certification)
              </label>
              {isRepeater && (
                <div className="grid grid-cols-3 gap-3 pl-6">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Current rater number <span className="text-foreground">(this event)</span></label>
                    <Input
                      placeholder="e.g. 48"
                      value={currentRaterNumber}
                      onChange={e => setCurrentRaterNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Previous rater number</label>
                    <Input
                      placeholder="e.g. 5"
                      value={prevRaterNumber}
                      onChange={e => setPrevRaterNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Previous measure (logit)</label>
                    <Input
                      placeholder="e.g. -0.45"
                      value={prevMeasure}
                      onChange={e => setPrevMeasure(e.target.value)}
                    />
                  </div>
                </div>
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
