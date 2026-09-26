import { Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, query, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore'
import { Copy, Check, ChevronRight, Download, BarChart2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Score, Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WrightMap } from '@/components/WrightMap'
import { parseFacetsOutput, type RaschRun } from '@/lib/parseFacets'
import { buildRaschData } from '@/lib/rasch/raschData'
import { runRaschAnalysis } from '@/lib/rasch/runAnalysis'

// ── helpers ────────────────────────────────────────────────────────────────

const DIMS = [
  { key: 'pronunciation' as const, abbr: 'PRO', label: 'Pronunciation' },
  { key: 'structure'     as const, abbr: 'STR', label: 'Structure' },
  { key: 'vocabulary'    as const, abbr: 'VOC', label: 'Vocabulary' },
  { key: 'fluency'       as const, abbr: 'FLU', label: 'Fluency' },
  { key: 'comprehension' as const, abbr: 'COM', label: 'Comprehension' },
  { key: 'interactions'  as const, abbr: 'INT', label: 'Interactions' },
]

const SUBTLE_DELTA = 0.3
const NOTABLE_DELTA = 0.8

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

function exportSeniorScoresCsv(candidateStats: CandidateStat[], srScoresByTest: Map<string, Score[]>, raterName: string) {
  const header = ['Candidate', 'Candidate Name', 'Test', 'Senior Rater', 'Pronunciation', 'Structure', 'Vocabulary', 'Fluency', 'Comprehension', 'Interactions', 'Overall']
  const rows = candidateStats.flatMap(stat =>
    (srScoresByTest.get(stat.testDocId) ?? []).map(s => [
      stat.label,
      stat.candidateName,
      s.testNumber ?? '',
      s.raterName,
      s.pronunciation, s.structure, s.vocabulary,
      s.fluency, s.comprehension, s.interactions,
      s.overallLevel,
    ]),
  )
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `senior-scores-${raterName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
}

// ── types ──────────────────────────────────────────────────────────────────

interface CandidateStat {
  label: string
  candidateName: string
  testDocId: string
  raterScore: Score
  allScores: Score[]      // ALL scores for this test across all sessions
  avgOverall: number
  delta: number
  srScores: Score[]       // senior-rater (+ admin) scores only, same test — the reliable comparison
  srAvgOverall: number | null
  srDelta: number | null
}

// ── per-candidate auto-paragraph ───────────────────────────────────────────
// Anchored to senior-rater consensus, not the full trainee-inclusive average —
// the bulk of scores are from trainees and are less reliable as a benchmark.

function criterionBreakdown(stat: CandidateStat): string {
  let worst: { label: string; srMean: number; delta: number } | null = null
  for (const d of DIMS) {
    const srMean = mean(stat.srScores.map(s => s[d.key] as number))
    if (srMean == null) continue
    const delta = (stat.raterScore[d.key] as number) - srMean
    if (Math.abs(delta) >= NOTABLE_DELTA && (!worst || Math.abs(delta) > Math.abs(worst.delta))) {
      worst = { label: d.label, srMean, delta }
    }
  }
  if (!worst) return ''
  return worst.delta > 0
    ? ` This is mainly driven by ${worst.label}, where senior raters averaged ${worst.srMean.toFixed(1)} against your score.`
    : ` This is mainly driven by ${worst.label}, where senior raters averaged ${worst.srMean.toFixed(1)}, higher than your score.`
}

function autoPara(stat: CandidateStat, handWaved = false): string {
  const { label, raterScore, srScores, srAvgOverall, srDelta } = stat
  const their = raterScore.overallLevel

  if (srDelta == null) {
    const avgAll = stat.avgOverall.toFixed(1)
    const nAll = stat.allScores.length
    return `Candidate ${label}: your overall score of ${their} — no senior-rater scores are available for this candidate yet, so this compares against all ${nAll} rater${nAll !== 1 ? 's' : ''} (average ${avgAll}).`
  }

  const avg = srAvgOverall!.toFixed(1)
  const n = srScores.length
  const raters = `${n} senior rater${n !== 1 ? 's' : ''}`
  const criterionNote = handWaved ? '' : criterionBreakdown(stat)

  if (Math.abs(srDelta) < SUBTLE_DELTA)
    return `Candidate ${label}: your overall score of ${their} is closely in line with the general consensus (average ${avg} across ${raters}).`
  if (srDelta >= SUBTLE_DELTA && srDelta < NOTABLE_DELTA)
    return `Candidate ${label}: your overall score of ${their} is a little more generous than the average of ${avg} across ${raters}, though this is not unreasonable.`
  if (srDelta >= NOTABLE_DELTA)
    return `Candidate ${label}: your overall score of ${their} is notably more generous than the average of ${avg} across ${raters}.${criterionNote}`
  if (srDelta <= -SUBTLE_DELTA && srDelta > -NOTABLE_DELTA)
    return `Candidate ${label}: your overall score of ${their} is a little stricter than the average of ${avg} across ${raters}.`
  return `Candidate ${label}: your overall score of ${their} is notably stricter than the average of ${avg} across ${raters}.${criterionNote}`
}

// ── email builder ──────────────────────────────────────────────────────────

function buildEmail(params: {
  rater: Person
  candidateStats: CandidateStat[]
  paraOverrides: Record<string, string>
  handWave: Record<string, boolean>
  isRefresher: boolean
  measure: string
  infit: string
  outcome: 'pass' | 'advisory' | 'fail'
  advisoryText: string
  isRepeater: boolean
  prevRaterNumber: string
  prevMeasure: string
  raterNumberField: string
}): string {
  const { rater, candidateStats, paraOverrides, handWave, isRefresher, measure, infit, outcome, advisoryText,
          isRepeater, prevRaterNumber, prevMeasure, raterNumberField } = params
  const courseLink = isRefresher
    ? 'https://www.lenguax.com/product/online-aviation-english-rater-refresher-course/'
    : 'https://www.lenguax.com/product/online-aviation-english-rater-course/'
  const firstName = rater.name.split(' ')[0]
  const raterNum = raterNumberField || (rater.raterNumber ?? '[RATER NUMBER]')

  const measureVal = measure || '[MEASURE]'
  const infitVal   = infit   || '[INFIT MNSQ]'
  const measureNum = parseFloat(measure)
  const infitNum   = parseFloat(infit)
  const measureInRange = !isNaN(measureNum) && measureNum >= -1 && measureNum <= 1
  const infitInRange   = !isNaN(infitNum)   && infitNum   >= 0.7 && infitNum   <= 1.3

  const candidateParas = candidateStats
    .map(s => paraOverrides[s.label] ?? autoPara(s, handWave[s.label]))
    .join('\n\n')

  const notable = candidateStats.filter(s => s.srDelta != null && Math.abs(s.srDelta) >= 0.5 && !handWave[s.label])
  let overallLine: string
  if (notable.length === 0) {
    overallLine = 'Overall, your scores seem very close to the general consensus in each case.'
  } else {
    const parts = notable.map(s =>
      `${s.srDelta! > 0 ? 'more generous' : 'stricter'} than the average rater to Candidate ${s.label}`
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
    courseLink,
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

// Wraps bare URLs as clickable <a> tags so pasting into a rich-text email
// compose window (Gmail, Outlook) renders them as real hyperlinks.
function emailTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const linked = escaped.replace(
    /(https?:\/\/[^\s]+)/g,
    url => `<a href="${url}">${url}</a>`,
  )
  return linked.split('\n').map(line => line || '&nbsp;').join('<br>')
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
  const [handWave, setHandWave] = useState<Record<string, boolean>>({})
  const [isRefresher, setIsRefresher] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [copied, setCopied]             = useState(false)
  const [isRepeater, setIsRepeater]     = useState(false)
  const [raterNumberField, setRaterNumberField] = useState('')
  const [prevRaterNumber, setPrevRaterNumber] = useState('')
  const [prevMeasure, setPrevMeasure]   = useState('')

  const [importOpen, setImportOpen]     = useState(false)
  const [importText, setImportText]     = useState('')
  const [importParsed, setImportParsed] = useState<RaschRun | null>(null)
  const [importError, setImportError]   = useState('')
  const [importSaving, setImportSaving] = useState(false)
  const [importSaved, setImportSaved]   = useState(false)
  const [importMode, setImportMode]     = useState<'inhouse' | 'facets'>('inhouse')
  const [analysisEvent, setAnalysisEvent] = useState('')
  const [analysisInfo, setAnalysisInfo] = useState<{
    source: 'in-house' | 'facets'; observations?: number; iterations?: number; converged?: boolean; excludedRows?: number
  } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const queryClient = useQueryClient()

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

  // Try people lookup first; fall back to a synthetic record built from score data
  // so the email generates even for raters whose people doc ID differs from their raterId in scores
  const rater = useMemo((): Person | undefined => {
    if (!raterId) return undefined
    const found = people.find(p => p.id === raterId)
    if (found) return found
    const nameFromScores = scores.find(s => s.raterId === raterId)?.raterName
    if (!nameFromScores) return undefined
    return { id: raterId, name: nameFromScores, email: '', role: 'trainee', status: 'active' }
  }, [people, raterId, scores])

  // The Rater number field drives the lookup. It's prefilled from the people
  // doc's stored raterNumber, but a returning rater gets a new number per
  // rating event (e.g. 235 → 412), so whatever's typed there wins.
  const raschData = useMemo(() => {
    if (!latestRun) return null
    const num = raterNumberField ? parseInt(raterNumberField, 10) : (rater?.raterNumber ?? NaN)
    if (num == null || isNaN(num)) return null
    return latestRun.raters.find(r => r.raterNumber === num) ?? null
  }, [latestRun, rater, raterNumberField])

  // Auto-fill measure/infit whenever the looked-up rater changes (overwriting
  // values from a previous number); manual edits stick until it changes again
  useEffect(() => {
    if (!raschData) return
    setMeasure(String(raschData.measure))
    setInfit(String(raschData.infitMnSq))
  }, [raschData])

  // Same for a returning rater's previous number, if it's in the run
  const prevRaschData = useMemo(() => {
    if (!latestRun || !prevRaterNumber) return null
    const num = parseInt(prevRaterNumber, 10)
    return latestRun.raters.find(r => r.raterNumber === num) ?? null
  }, [latestRun, prevRaterNumber])

  useEffect(() => {
    if (prevRaschData) setPrevMeasure(String(prevRaschData.measure))
  }, [prevRaschData])

  function toggleRepeater(checked: boolean) {
    setIsRepeater(checked)
    // Suggest the stored number as the previous one when it differs from this event's
    const stored = rater?.raterNumber
    if (checked && !prevRaterNumber && stored && String(stored) !== raterNumberField) {
      setPrevRaterNumber(String(stored))
    }
  }

  const srRaterIds = useMemo(
    () => new Set(people.filter(p => p.role === 'senior_rater' || p.role === 'admin').map(p => p.id)),
    [people],
  )

  // Scores for this rater in this session, sorted by entry order so A/B/C matches the rater's test sequence
  const raterScores = useMemo(() => {
    if (!sessionIds.length || !raterId) return []
    return scores
      .filter(s => sessionIds.includes(s.sessionId) && s.raterId === raterId)
      .sort((a, b) => {
        const aSeq = (a as any).sequence
        const bSeq = (b as any).sequence
        if (aSeq != null && bSeq != null) return aSeq - bSeq
        return ((a.createdAt as any)?.seconds ?? 0) - ((b.createdAt as any)?.seconds ?? 0)
      })
  }, [scores, sessionIds, raterId])

  // Senior-rater scores per test — used both for the expanded table rows and
  // as the comparison basis for auto-generated candidate commentary
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

  // Per-candidate stats — allScores drawn from ALL sessions for that test
  const candidateStats = useMemo((): CandidateStat[] => {
    return raterScores.map((rs, i) => {
      const allScores = scores.filter(s => s.testDocId === rs.testDocId)
      const avgOverall = allScores.reduce((sum, s) => sum + s.overallLevel, 0) / allScores.length
      const srScores = srScoresByTest.get(rs.testDocId) ?? []
      const srAvgOverall = mean(srScores.map(s => s.overallLevel))
      return {
        label: String.fromCharCode(65 + i),
        candidateName: rs.candidateName,
        testDocId: rs.testDocId,
        raterScore: rs,
        allScores,
        avgOverall,
        delta: rs.overallLevel - avgOverall,
        srScores,
        srAvgOverall,
        srDelta: srAvgOverall == null ? null : rs.overallLevel - srAvgOverall,
      }
    })
  }, [scores, raterScores, srScoresByTest])

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
    return buildEmail({ rater, candidateStats, paraOverrides, handWave, isRefresher, measure, infit, outcome, advisoryText,
                        isRepeater, raterNumberField, prevRaterNumber, prevMeasure })
  }, [rater, candidateStats, paraOverrides, handWave, isRefresher, measure, infit, outcome, advisoryText,
      isRepeater, raterNumberField, prevRaterNumber, prevMeasure])

  function toggleExpanded(testDocId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(testDocId) ? next.delete(testDocId) : next.add(testDocId)
      return next
    })
  }

  function changeSession(name: string) {
    setSessionName(name)
    setAnalysisEvent(name)
    setRaterId('')
    setParaOverrides({})
    setHandWave({})
    setExpanded(new Set())
    setMeasure('')
    setInfit('')
    setOutcome('pass')
    setAdvisoryText('')
    setIsRefresher(false)
  }

  function changeRater(id: string) {
    setRaterId(id)
    setParaOverrides({})
    setHandWave({})
    setExpanded(new Set())
    setIsRepeater(false)
    setPrevRaterNumber('')
    setPrevMeasure('')
    setMeasure('')
    setInfit('')
    const found = people.find(p => p.id === id)
    setRaterNumberField(found?.raterNumber ? String(found.raterNumber) : '')
  }

  function handleImportParse() {
    setImportError('')
    setImportSaved(false)
    try {
      const result = parseFacetsOutput(importText)
      if (result.raters.length === 0) {
        setImportError('No rater rows found. Make sure the text includes Table 7 from the Facets output.')
        setImportParsed(null)
      } else {
        setImportParsed(result)
        setAnalysisInfo({ source: 'facets' })
      }
    } catch (e) {
      setImportError(String(e))
      setImportParsed(null)
    }
  }

  // In-house analysis: same data and rater numbering as the Facets export on the
  // Scores page (all published scores + the chosen event), estimated in-browser
  function handleRunAnalysis() {
    setImportError('')
    setImportSaved(false)
    setImportParsed(null)
    try {
      const ids = sessions.find(s => s.name === analysisEvent)?.ids ?? []
      const data = buildRaschData(scores, ids, people)
      if (data.rows.length === 0) {
        setImportError('No scores to analyse.')
        return
      }
      const { run, result, excludedRows } = runRaschAnalysis(data)
      setImportParsed(run)
      setAnalysisInfo({
        source: 'in-house',
        observations: result.observationsUsed,
        iterations: result.iterations,
        converged: result.converged,
        excludedRows,
      })
    } catch (e) {
      setImportError(String(e))
    }
  }

  async function handleImportSave() {
    if (!importParsed) return
    setImportSaving(true)
    try {
      await addDoc(collection(db, 'rasch_runs'), {
        importedAt: serverTimestamp(),
        raterCount: importParsed.raters.length,
        meanMeasure: importParsed.meanMeasure,
        reliability: importParsed.reliability,
        separation: importParsed.separation,
        rmse: importParsed.rmse,
        raters: importParsed.raters,
        criteria: importParsed.criteria,
        candidateDensity: importParsed.candidateDensity,
        candidateMeasures: importParsed.candidateMeasures ?? [],
        scaleBoundaries: importParsed.scaleBoundaries ?? [],
        source: analysisInfo?.source ?? 'facets',
        ...(analysisInfo?.source === 'in-house' ? { event: analysisEvent || null } : {}),
      })
      setImportSaved(true)
      setImportText('')
      setImportParsed(null)
      await queryClient.invalidateQueries({ queryKey: ['rasch_runs', 'latest'] })
    } catch (e) {
      setImportError(String(e))
    } finally {
      setImportSaving(false)
    }
  }

  function handleDownloadMap() {
    const svg = svgRef.current
    if (!svg) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svg)
    const canvas = document.createElement('canvas')
    const { width, height } = svg.viewBox.baseVal
    canvas.width = width * 2
    canvas.height = height * 2
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
        a.download = `wright-map-${raschData?.raterNumber ?? 'rater'}.png`
        a.click()
      }, 'image/png')
    }
    img.src = url
  }

  async function handleCopy() {
    try {
      const html = emailTextToHtml(emailText)
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([emailText], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
    } catch {
      // Fallback for browsers without ClipboardItem support (plain text only)
      await navigator.clipboard.writeText(emailText)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const measureNum = parseFloat(measure)
  const infitNum   = parseFloat(infit)
  const measureInRange = !isNaN(measureNum) && measureNum >= -1  && measureNum <= 1
  const infitInRange   = !isNaN(infitNum)   && infitNum   >= 0.7 && infitNum   <= 1.3
  const hasSeniorScores = candidateStats.some(s => (srScoresByTest.get(s.testDocId)?.length ?? 0) > 0)

  // Additional fit indicators — parsed from Facets but not yet used to drive any
  // wording, just surfaced so a trainer (or later, a synthesis tool) can see them.
  // Thresholds are a starting convention, not house policy — adjust if needed.
  const outfitNum = raschData?.outfitMnSq
  const outfitInRange = outfitNum != null && !isNaN(outfitNum) && outfitNum >= 0.7 && outfitNum <= 1.3
  const outfitTooHigh = outfitNum != null && !isNaN(outfitNum) && outfitNum > 1.3
  const discrimNum = raschData?.discrimination
  const discrimOk = discrimNum != null && !isNaN(discrimNum) && discrimNum >= 0.5
  const ptMeaNum = raschData?.ptMea
  const ptExpNum = raschData?.ptExp
  const correlationOk = ptMeaNum != null && ptExpNum != null && !isNaN(ptMeaNum) && !isNaN(ptExpNum)
    && ptMeaNum >= 0 && (ptExpNum - ptMeaNum) < 0.15

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">Generate a feedback email for a rater.</p>
      </div>

      <div className="rounded-lg border">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium"
          onClick={() => setImportOpen(o => !o)}
        >
          <span className="flex items-center gap-2">
            <BarChart2 className="size-4" />
            Rasch analysis
          </span>
          <ChevronRight className={`size-4 text-muted-foreground transition-transform ${importOpen ? 'rotate-90' : ''}`} />
        </button>
        {importOpen && (
          <div className="border-t px-4 py-4 space-y-3">
            <div className="flex gap-4 text-sm">
              {([['inhouse', 'Run analysis'], ['facets', 'Import from Facets']] as const).map(([val, label]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="raschMode"
                    checked={importMode === val}
                    onChange={() => { setImportMode(val); setImportParsed(null); setImportSaved(false); setImportError('') }}
                  />
                  {label}
                </label>
              ))}
            </div>

            {importMode === 'inhouse' ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Runs the same many-facet Rasch analysis as Facets on all published scores plus the chosen event's scores,
                  numbering raters exactly as the Facets export does. Results become the active run once saved.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={analysisEvent}
                    onChange={e => { setAnalysisEvent(e.target.value); setImportParsed(null); setImportSaved(false) }}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Published scores only</option>
                    {sessions.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                  <Button size="sm" onClick={handleRunAnalysis} disabled={scores.length === 0}>
                    Run analysis
                  </Button>
                  {importParsed && (
                    <Button size="sm" variant="outline" onClick={handleImportSave} disabled={importSaving}>
                      {importSaving ? 'Saving…' : 'Save as active run'}
                    </Button>
                  )}
                  {importSaved && <span className="text-xs text-green-700">Saved — this run is now active.</span>}
                </div>
                {importParsed && analysisInfo?.source === 'in-house' && (
                  <p className={`text-xs ${analysisInfo.converged ? 'text-muted-foreground' : 'text-red-600'}`}>
                    {analysisInfo.observations?.toLocaleString()} ratings ·{' '}
                    {analysisInfo.converged ? `converged in ${analysisInfo.iterations} iterations` : 'did not converge — treat with caution'}
                    {!!analysisInfo.excludedRows && (
                      <span className="text-amber-700">
                        {' '}· {analysisInfo.excludedRows} score rows skipped because their rater has no permanent number (use "Assign numbers" on the Scores page)
                      </span>
                    )}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Paste the full Facets <code>.out</code> file. Table 7 (rater measures) and Table 6 (Wright map) will be extracted and become the active run as soon as it's saved.
                </p>
                <textarea
                  value={importText}
                  onChange={e => { setImportText(e.target.value); setImportParsed(null); setImportSaved(false); setImportError('') }}
                  placeholder="Paste the full contents of the .out file here…"
                  rows={8}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y"
                />
                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={handleImportParse} disabled={!importText.trim()}>
                    Parse file
                  </Button>
                  {importParsed && (
                    <Button size="sm" variant="outline" onClick={handleImportSave} disabled={importSaving}>
                      {importSaving ? 'Saving…' : 'Save to Firestore'}
                    </Button>
                  )}
                  {importSaved && <span className="text-xs text-green-700">Saved — this run is now active.</span>}
                </div>
              </>
            )}
            {importError && <p className="text-xs text-red-600">{importError}</p>}
            {importParsed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Raters</span>
                  <span className="font-mono font-semibold">{importParsed.raters.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Criteria</span>
                  <span className="font-mono font-semibold">{importParsed.criteria.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reliability</span>
                  <span className="font-mono">{importParsed.reliability.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RMSE</span>
                  <span className="font-mono">{importParsed.rmse.toFixed(2)}</span>
                </div>
              </div>
            )}
            {importParsed && importParsed.criteria.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Criteria ({importParsed.criteria.length}) — check this matches the 6 ICAO dimensions
                </p>
                <div className="flex flex-wrap gap-2">
                  {importParsed.criteria.map(c => (
                    <span key={c.name} className="text-xs border rounded px-2 py-0.5 font-mono">
                      {c.name} {c.logit > 0 ? '+' : ''}{c.logit.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isRefresher}
              onChange={e => setIsRefresher(e.target.checked)}
            />
            Refresher course (links to the refresher course page, not the initial one)
          </label>

          {candidateStats.length > 0 && (<>

            {/* Score comparison table — AssignmentReview style */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Score comparison</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasSeniorScores}
                  onClick={() => exportSeniorScoresCsv(candidateStats, srScoresByTest, rater?.name ?? 'rater')}
                >
                  <Download className="size-4 mr-1.5" />
                  Export senior scores
                </Button>
              </div>
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
                    value={paraOverrides[stat.label] ?? autoPara(stat, handWave[stat.label])}
                    onChange={e => setParaOverrides(p => ({ ...p, [stat.label]: e.target.value }))}
                    className="text-sm resize-none"
                  />
                  <div className="flex items-center gap-3">
                    {paraOverrides[stat.label] !== undefined && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setParaOverrides(p => { const n = { ...p }; delete n[stat.label]; return n })}
                      >
                        ↺ Reset to auto
                      </button>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={handWave[stat.label] ?? false}
                        onChange={e => setHandWave(h => ({ ...h, [stat.label]: e.target.checked }))}
                      />
                      Hand-wave (skip criterion detail)
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {/* Rasch inputs */}
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Rasch results{' '}
                <span className="text-muted-foreground font-normal text-xs">(leave blank for placeholders)</span>
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Rater number</label>
                  <Input
                    placeholder="e.g. 48"
                    value={raterNumberField}
                    onChange={e => setRaterNumberField(e.target.value)}
                  />
                </div>
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

              {raschData && (
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Outfit MnSq</label>
                    <p className="font-mono text-sm">{raschData.outfitMnSq.toFixed(2)}</p>
                    <p className={`text-xs ${outfitInRange ? 'text-green-700' : 'text-red-600'}`}>
                      {outfitInRange
                        ? '✓ inside 0.7–1.3'
                        : outfitTooHigh
                          ? '✗ outside 0.7–1.3 — more erratic than expected'
                          : '✗ outside 0.7–1.3 — more rigid/uniform than expected'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Discrimination</label>
                    <p className="font-mono text-sm">{raschData.discrimination.toFixed(2)}</p>
                    <p className={`text-xs ${discrimOk ? 'text-green-700' : 'text-red-600'}`}>
                      {discrimOk
                        ? '✓ typical'
                        : (discrimNum ?? 0) < 0
                          ? '✗ negative — check for reversed scoring'
                          : '✗ low — may not be discriminating between candidates'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">PtMea / PtExp</label>
                    <p className="font-mono text-sm">{raschData.ptMea.toFixed(2)} / {raschData.ptExp.toFixed(2)}</p>
                    <p className={`text-xs ${correlationOk ? 'text-green-700' : 'text-red-600'}`}>
                      {correlationOk ? '✓ close to expected' : '✗ observed correlation notably below expected'}
                    </p>
                  </div>
                </div>
              )}
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
                    raterNumber={raschData.raterNumber}
                    measure={raschData.measure}
                    se={raschData.se}
                    meanMeasure={latestRun.meanMeasure}
                    raterMeasures={latestRun.raters.map(r => r.measure)}
                    candidateMeasures={latestRun.candidateMeasures}
                    candidateDensity={latestRun.candidateDensity}
                    criteria={latestRun.criteria}
                    scaleBoundaries={latestRun.scaleBoundaries}
                    previous={isRepeater && prevRaterNumber && !isNaN(parseFloat(prevMeasure))
                      ? { raterNumber: prevRaterNumber, measure: parseFloat(prevMeasure) }
                      : undefined}
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
                  onChange={e => toggleRepeater(e.target.checked)}
                />
                Returning rater (has previous certification)
              </label>
              {isRepeater && (
                <div className="grid grid-cols-2 gap-3 pl-6">
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

      <div className="rounded-lg border">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium"
          onClick={() => setGlossaryOpen(o => !o)}
        >
          <span>What do these stats mean?</span>
          <ChevronRight className={`size-4 text-muted-foreground transition-transform ${glossaryOpen ? 'rotate-90' : ''}`} />
        </button>
        {glossaryOpen && (
          <div className="border-t px-4 py-4 space-y-3 text-xs">
            <p className="text-muted-foreground">
              "Rater" here means a single rater's estimate from this Facets run — "senior raters" and "candidates" are a
              separate comparison (the score comparison table above), not part of this glossary.
            </p>
            <dl className="space-y-2.5">
              <div>
                <dt className="font-semibold">Measure</dt>
                <dd className="text-muted-foreground">
                  Severity/leniency in logits, relative to the group mean (0). Positive = stricter than average,
                  negative = more lenient. Target band ±1.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">S.E. (Standard Error)</dt>
                <dd className="text-muted-foreground">
                  Precision of the Measure estimate — smaller is more precise. Mostly driven by how many ratings
                  that rater has contributed.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Infit MnSq / ZStd</dt>
                <dd className="text-muted-foreground">
                  "Information-weighted" fit — sensitive to unexpected ratings on candidates near this rater's own
                  typical severity. Ideal is 1.0. A commonly used general-purpose range is 0.5–1.5 ("productive for
                  measurement"); this page uses a tighter 0.7–1.3 band, which is a convention specifically used for
                  high-stakes rater panels. Above the band reads as more erratic/unpredictable than expected — above
                  roughly 2.0 is where it's generally treated as seriously distorting rather than just "watch it."
                  Below the band reads as more rigid/uniform than expected (over-predictable) — this direction is
                  usually considered less threatening to fairness than the high-erratic direction, since it means
                  duller discrimination between candidates rather than actively wrong decisions. ZStd is the
                  standardized version — beyond roughly ±2 is a statistically meaningful misfit even if MnSq
                  looks borderline.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Outfit MnSq / ZStd</dt>
                <dd className="text-muted-foreground">
                  "Outlier-sensitive" fit — picks up rare, surprising individual ratings that Infit's information
                  weighting can smooth over. Same 0.7–1.3 band and erratic/rigid direction reading as Infit is used
                  here as a working convention, not a settled rule — adjust if it doesn't hold up in practice.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Discrimination</dt>
                <dd className="text-muted-foreground">
                  How sharply this rater's scores differentiate between candidates of different ability, relative to
                  what the model expects. Ideal/expected is 1.0. Below 1.0 (but still positive) means flatter than
                  expected — the rater isn't spreading candidates out as much as their real ability differences
                  warrant (central tendency / restricted range — mostly giving the same one or two scores regardless
                  of who's actually better). Near zero means essentially no relationship between this rater's scores
                  and candidate ability. <strong>Negative</strong> is the real alarm: it means this rater's ranking
                  of candidates runs opposite the panel's — worth checking it isn't a data-entry or reversed-scale
                  error before treating it as genuine rater behaviour. <strong>Above 1.0</strong> means sharper/more
                  decisive differentiation than the panel norm — not automatically a problem: it can mean genuinely
                  picking up on real distinctions others are softening, or it can mean a narrower, more binary mental
                  model of the scale than intended (not using the full granularity), or with only ~24 observations it
                  can just be this particular batch of candidates spanning an unusually wide ability range. High
                  discrimination mechanically tends to pair with <em>low</em> Infit/Outfit (the overfit/rigid
                  direction above), not high — that's the same underlying pattern showing up twice, not two separate
                  problems. Unlike Infit/Outfit, there's no widely agreed symmetric "in-band" range for this in the
                  measurement literature — the sign (negative vs. positive) matters more than the exact number.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">PtMea / PtExp</dt>
                <dd className="text-muted-foreground">
                  Observed vs. expected point-measure correlation — how well this rater's scores track overall
                  candidate ability. This mostly serves as a secondary confirmation of misfit already visible in
                  Infit/Outfit, rather than an independent hard rule — there's no standard numeric gap size in the
                  literature the way there is for MnSq bands. The one genuinely independent strong signal is
                  <strong> PtMea itself being negative</strong>, regardless of PtExp: this rater's scores don't even
                  positively track candidate ability. A gap where PtMea sits notably below PtExp (this page flags a
                  gap ≥ 0.15) is worth a look but is best read alongside Infit/Outfit, not on its own.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Reliability (top of the import panel)</dt>
                <dd className="text-muted-foreground">
                  A cohort-level number, not per-rater — how reliably the model can tell raters apart by severity.
                  0–1, higher means the spread of strict-to-lenient raters is real, not noise.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">RMSE (top of the import panel)</dt>
                <dd className="text-muted-foreground">
                  Also cohort-level — the average precision of severity estimates across every rater in this run.
                  Smaller is tighter overall; roughly tracks the typical S.E. you'll see per rater.
                </dd>
              </div>
            </dl>
            <div className="border-t pt-3 mt-1">
              <p className="font-semibold mb-1.5">Common combinations, for deciding what feedback to give</p>
              <ul className="text-muted-foreground space-y-1.5 list-disc pl-4">
                <li>
                  <strong>Severity/leniency only</strong> — Measure outside ±1, everything else normal. A
                  consistent, well-behaved rater whose scale is just shifted. Feedback: recalibrate the anchor,
                  not the method.
                </li>
                <li>
                  <strong>Central tendency / restricted range</strong> — Discrimination well below 1, Infit/Outfit
                  possibly low too. Avoids the extremes of the scale. Feedback: encourage fuller use of the scale,
                  point to specific candidates who deserved a more extreme score.
                </li>
                <li>
                  <strong>Randomness / inconsistency</strong> — Infit and/or Outfit MnSq above the band (worse
                  above ~2), often with positive ZStd. Scores don't follow a stable pattern. Feedback: this is the
                  one to take most seriously — the rater's judgement isn't predictable even to itself.
                </li>
                <li>
                  <strong>Reversal</strong> — Discrimination negative and/or PtMea negative. Ranks candidates
                  opposite the consensus. Feedback: verify the data first (reversed scale, mis-entry), then treat
                  as a priority conversation if it's confirmed genuine.
                </li>
                <li>
                  <strong>Overfit / rigid</strong> — Infit and Outfit both notably below 1.0, Discrimination often
                  above 1.0 (this is one pattern showing up in two stats, not two problems). Unusually predictable
                  or decisive. Not necessarily wrong, but worth checking whether they're using the scale's
                  intended granularity or defaulting to a narrower internal rubric.
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
