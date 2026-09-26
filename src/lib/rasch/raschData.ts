import type { Score, Person } from '@/types'

// Builds the rating data for a Rasch run: all published scores plus the
// (unpublished) scores of the chosen event. Shared by the Facets export on the
// Scores page and the in-house analysis on the Reports page, so both number
// raters identically.
//
// Historical raters use their permanent people.raterNumber. Everyone scoring
// in the current event gets a fresh temp number (max permanent + 1, by name) —
// returnees included, so they appear as a separate element alongside their
// historical one.

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

  const currentSessionRaterIds = new Set(rows.filter(inEvent).map(s => s.raterId))
  const publishedRaterIds = new Set(rows.filter(s => s.published).map(s => s.raterId))
  const returneeIds = new Set([...currentSessionRaterIds].filter(id => publishedRaterIds.has(id)))
  const newRaterIds = new Set([...currentSessionRaterIds].filter(id => !publishedRaterIds.has(id)))

  const nameOf = (id: string) => rows.find(s => s.raterId === id)?.raterName ?? id

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
      : newRaterIds.has(id) ? 'new' : '',
  }))

  const raterNum = (s: Score) => (inEvent(s) ? tempNumById.get(s.raterId) : permNumById.get(s.raterId)) ?? 0

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
