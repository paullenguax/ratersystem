import type { Score, Person } from '@/types'
import type { AnalysisInput } from './analysis'

// Builds the rating data for a Rasch run: all published scores plus the
// (unpublished) scores of the chosen event. Shared by the Facets export on the
// Scores page and the in-house analysis on the Reports page, so both number
// raters identically.
//
// Historical raters use their permanent people.raterNumber. Everyone scoring
// in the current event gets a fresh temp number (max permanent + 1, by name) —
// returnees included, so they appear as a separate element alongside their
// historical one.
//
// A rater with more than one assignment in the event (a resit) is one element
// per attempt: the latest keeps the plain name, earlier ones are suffixed
// "(attempt N)" — see sessionAttempts/attemptName.

// Each rater's assignments within an event, oldest first (by earliest score).
// More than one means they resat; the last is their current attempt.
export function sessionAttempts(scores: Score[], sessionIds: string[]): Map<string, string[]> {
  const first = new Map<string, Map<string, number>>() // raterId → assignmentId → earliest score time
  for (const s of scores) {
    if (!sessionIds.includes(s.sessionId)) continue
    const t = s.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER
    const byAssignment = first.get(s.raterId) ?? new Map<string, number>()
    byAssignment.set(s.assignmentId ?? '', Math.min(t, byAssignment.get(s.assignmentId ?? '') ?? Infinity))
    first.set(s.raterId, byAssignment)
  }
  return new Map([...first].map(([raterId, m]) =>
    [raterId, [...m].sort((a, b) => a[1] - b[1]).map(([assignmentId]) => assignmentId)]))
}

// Name an attempt carries in a run: plain for the latest, suffixed for earlier ones
export function attemptName(name: string, index: number, total: number): string {
  return index === total - 1 ? name : `${name} (attempt ${index + 1})`
}

export interface RaschDataRow {
  candidate: number // test number
  rater: number
  scores: [number, number, number, number, number, number] // Pro, Str, Voc, Flu, Com, Int
}

export interface RaterKeyEntry {
  number: number | undefined
  name: string
  note: string
}

export interface RaschData {
  rows: RaschDataRow[]
  sessionName: string | null
  historicalKey: RaterKeyEntry[]
  currentKey: RaterKeyEntry[]
  raterNames: Map<number, string>
  maxCandidate: number
  maxRater: number
}

export const CRITERIA = ['Pronunciation', 'Structure', 'Vocabulary', 'Fluency', 'Comprehension', 'Interactions']

export function buildRaschData(scores: Score[], sessionIds: string[], people: Person[]): RaschData {
  const inEvent = (s: Score) => !s.published && sessionIds.includes(s.sessionId)
  const rows = scores.filter(s => s.testNumber != null && (s.published || inEvent(s)))

  const permNumById = new Map(people.filter(p => p.raterNumber).map(p => [p.id, p.raterNumber!]))

  // Event raters are keyed per attempt: the plain raterId for their latest
  // assignment in the event, `raterId#n` for an earlier one (0-based n).
  const attempts = sessionAttempts(scores, sessionIds)
  const attemptIndex = (s: Score) => (attempts.get(s.raterId) ?? []).indexOf(s.assignmentId ?? '')
  const attemptCount = (raterId: string) => attempts.get(raterId)?.length ?? 1
  const keyOf = (s: Score) => {
    const i = attemptIndex(s)
    return i < 0 || i === attemptCount(s.raterId) - 1 ? s.raterId : `${s.raterId}#${i}`
  }
  const raterIdOf = (key: string) => key.split('#')[0]
  const earlierAttempt = (key: string) => key.includes('#')

  const currentSessionRaterIds = new Set(rows.filter(inEvent).map(keyOf))
  const publishedRaterIds = new Set(rows.filter(s => s.published).map(s => s.raterId))
  const returneeIds = new Set([...currentSessionRaterIds].filter(id => !earlierAttempt(id) && publishedRaterIds.has(id)))
  const newRaterIds = new Set([...currentSessionRaterIds].filter(id => !earlierAttempt(id) && !publishedRaterIds.has(id)))

  const nameOf = (key: string) => {
    const id = raterIdOf(key)
    const name = rows.find(s => s.raterId === id)?.raterName ?? id
    return earlierAttempt(key) ? attemptName(name, Number(key.split('#')[1]), attemptCount(id)) : name
  }

  let nextNum = Math.max(0, ...(permNumById.size ? permNumById.values() : [0])) + 1
  const tempNumById = new Map<string, number>()
  const currentRatersSorted = [...currentSessionRaterIds].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  for (const id of currentRatersSorted) tempNumById.set(id, nextNum++)

  const sessionName = sessionIds.length
    ? (scores.find(s => sessionIds.includes(s.sessionId))?.sessionName ?? sessionIds[0])
    : null

  const historicalRaters = [...new Map(
    rows.filter(s => s.published).map(s => [s.raterId, s.raterName]),
  ).entries()].sort((a, b) => (permNumById.get(a[0]) ?? 0) - (permNumById.get(b[0]) ?? 0))

  const historicalKey = historicalRaters.map(([id, name]) => ({
    number: permNumById.get(id),
    name,
    note: returneeIds.has(id) ? `returnee — now Rater ${tempNumById.get(id)} in this event` : '',
  }))
  const currentKey = currentRatersSorted.map(id => ({
    number: tempNumById.get(id),
    name: nameOf(id),
    note: returneeIds.has(id)
      ? `returnee — previously Rater ${permNumById.get(id) ?? '(no number assigned yet)'}`
      : earlierAttempt(id) ? 'earlier attempt in this event (resat since)'
      : newRaterIds.has(id) ? 'new' : '',
  }))

  const raterNum = (s: Score) => (inEvent(s) ? tempNumById.get(keyOf(s)) : permNumById.get(s.raterId)) ?? 0

  const dataRows: RaschDataRow[] = [...rows]
    .sort((a, b) => raterNum(a) - raterNum(b) || (a.testNumber ?? 0) - (b.testNumber ?? 0))
    .map(s => ({
      candidate: s.testNumber!,
      rater: raterNum(s),
      scores: [s.pronunciation, s.structure, s.vocabulary, s.fluency, s.comprehension, s.interactions],
    }))

  const raterNames = new Map<number, string>()
  for (const k of [...historicalKey, ...currentKey]) if (k.number) raterNames.set(k.number, k.name)

  return {
    rows: dataRows,
    sessionName,
    historicalKey,
    currentKey,
    raterNames,
    maxCandidate: Math.max(1, ...dataRows.map(r => r.candidate)),
    maxRater: Math.max(1, ...dataRows.map(r => r.rater)),
  }
}

// Plain, worker-cloneable input for analyze()
export function toAnalysisInput(data: RaschData, scores: Score[]): AnalysisInput {
  return {
    rows: data.rows,
    raterNames: [...data.raterNames],
    currentRaters: data.currentKey.map(k => k.number).filter((n): n is number => n != null),
    tests: testsOf(scores),
  }
}

// ── other data shapes ──────────────────────────────────────────────────────

type ScoreLike = Pick<Score, 'raterId' | 'raterName' | 'testNumber' | 'candidateName' | 'testType' | 'sessionName' | 'createdAt'
  | 'pronunciation' | 'structure' | 'vocabulary' | 'fluency' | 'comprehension' | 'interactions'>

const scoresOf = (s: ScoreLike): RaschDataRow['scores'] =>
  [s.pronunciation, s.structure, s.vocabulary, s.fluency, s.comprehension, s.interactions]

function testsOf(scores: ScoreLike[]): [number, { name: string; testType: string }][] {
  const tests = new Map<number, { name: string; testType: string }>()
  for (const s of scores) {
    if (s.testNumber != null && !tests.has(s.testNumber)) tests.set(s.testNumber, { name: s.candidateName, testType: s.testType })
  }
  return [...tests]
}

// One element per person, numbered by name — for pools with no permanent
// rater numbers (standardization)
export function simpleAnalysisInput(scores: ScoreLike[]): AnalysisInput {
  const usable = scores.filter(s => s.testNumber != null)
  const people = [...new Map(usable.map(s => [s.raterId, s.raterName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const num = new Map(people.map(([id], i) => [id, i + 1]))
  return {
    rows: usable.map(s => ({ candidate: s.testNumber!, rater: num.get(s.raterId)!, scores: scoresOf(s) })),
    raterNames: people.map(([, name], i) => [i + 1, name]),
    tests: testsOf(usable),
  }
}

// Drift: one element per (person, event), so a returnee's severity can be
// compared across certifications on the same scale
export interface DriftElement {
  raterId: string
  name: string
  session: string
  order: number // earliest score time in that event, for chronological display
}

export interface DriftInput {
  analysis: AnalysisInput
  elements: [number, DriftElement][]
}

export function buildDriftInput(scores: ScoreLike[]): DriftInput {
  const usable = scores.filter(s => s.testNumber != null && s.sessionName)
  const keyOf = (s: ScoreLike) => `${s.raterId}|${s.sessionName}`
  const first = new Map<string, { s: ScoreLike; order: number }>()
  for (const s of usable) {
    const t = s.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER
    const cur = first.get(keyOf(s))
    if (!cur || t < cur.order) first.set(keyOf(s), { s, order: t })
  }
  const keys = [...first.keys()].sort()
  const num = new Map(keys.map((k, i) => [k, i + 1]))
  const elements: [number, DriftElement][] = keys.map(k => {
    const { s, order } = first.get(k)!
    return [num.get(k)!, { raterId: s.raterId, name: s.raterName, session: s.sessionName, order }]
  })
  return {
    analysis: {
      rows: usable.map(s => ({ candidate: s.testNumber!, rater: num.get(keyOf(s))!, scores: scoresOf(s) })),
      raterNames: elements.map(([n, e]) => [n, e.name]),
      tests: testsOf(usable),
    },
    elements,
  }
}
