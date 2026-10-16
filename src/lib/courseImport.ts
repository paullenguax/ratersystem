import type { Course, Person } from '@/types'
import { normName } from '@/lib/courses'

// Parses CSV, or tab-separated text pasted straight from a spreadsheet.
// Handles quoted fields, including commas/newlines inside quotes.
export function parseTable(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuote = false
      else field += ch
    } else if (ch === '"' && field === '') {
      inQuote = true
    } else if (ch === delim) {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
    .map(r => r.map(c => c.replace(/ /g, ' ').trim()))
    .filter(r => r.some(c => c !== ''))
}

export type ColumnRole = 'name' | 'email' | 'course' | 'number' | 'startDate' | 'endDate'

export const COLUMN_LABELS: Record<ColumnRole, string> = {
  name: 'Attendee name',
  course: 'Course type',
  number: 'Refresher number',
  startDate: 'Date / start date',
  endDate: 'End date',
  email: 'Email',
}

// Best guess at which header is which, so most sheets need no mapping
export function guessColumns(headers: string[]): Partial<Record<ColumnRole, number>> {
  const h = headers.map(x => x.toLowerCase())
  const find = (re: RegExp, exclude: number[] = []) => {
    const i = h.findIndex((x, idx) => re.test(x) && !exclude.includes(idx))
    return i >= 0 ? i : undefined
  }
  const email = find(/e-?mail/)
  const endDate = find(/end|finish|\bto\b/)
  const startDate = find(/date|start|from|when|month/, [endDate ?? -1])
  const number = find(/\bno\b|num|#/)
  const course = find(/course|type|refresher|kind/, [number ?? -1])
  const name = find(/name|attendee|rater|person|participant|student/, [email ?? -1, course ?? -1])
  return { name, email, course, number, startDate, endDate }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

// Reads the date formats a hand-kept sheet tends to have, UK order first:
// 2025-03-12, 12/03/2025, 12.3.25, 12 March 2025, March 2025 (→ 1st), and
// Excel serial numbers. Returns YYYY-MM-DD, or null if unreadable.
export function parseDate(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/)
  if (m && MONTHS.includes(m[2].slice(0, 3))) return iso(+m[3], MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1])
  m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)
  if (m && MONTHS.includes(m[1].slice(0, 3))) return iso(+m[3], MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2])
  m = s.match(/^([a-z]+)\.?\s+(\d{4})$/)
  if (m && MONTHS.includes(m[1].slice(0, 3))) return iso(+m[2], MONTHS.indexOf(m[1].slice(0, 3)) + 1, 1)
  if (/^\d{5}$/.test(s)) {
    // Excel serial day (1900 date system)
    const dt = new Date(Date.UTC(1899, 11, 30) + +s * 86400000)
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  return null
}

// "Refresher 3", "RC3", "Refresher Course 3", "Initial", "Rater course"…
export function parseCourseType(raw: string, numberRaw?: string): { kind: Course['kind']; number: number | null } | null {
  const s = raw.trim().toLowerCase()
  const number = Number((numberRaw ?? '').match(/\d+/)?.[0] ?? s.match(/\d+/)?.[0]) || null
  if (/refresh|^rc\s*\d|^r\s*\d/.test(s)) return { kind: 'refresher', number }
  if (/rater|initial|^ir?c$/.test(s)) return { kind: 'rater', number: null }
  return null
}

export interface ImportRow {
  line: number           // 1-based spreadsheet row, for error messages
  name: string
  email: string | null
  startDate: string | null
  endDate: string | null
  rawDate: string
  // Person to link, chosen by default from an exact match; editable in the preview
  personId: string | null
  suggestions: Person[]  // likely-but-not-certain matches
}

export interface ImportGroup {
  key: string
  kind: Course['kind']
  number: number | null
  name: string
  startDate: string | null
  endDate: string | null
  existing: Course | null
  rows: ImportRow[]
}

export interface ImportProblem { line: number; message: string }

function likelySamePerson(a: string, b: string): boolean {
  const wa = normName(a).split(' ').filter(Boolean)
  const wb = normName(b).split(' ').filter(Boolean)
  const overlap = wa.filter(w => w.length > 1 && wb.includes(w)).length
  return overlap >= 2 || (overlap >= 1 && Math.min(wa.length, wb.length) === 1)
}

function matchPerson(people: Person[], name: string, email: string | null): { personId: string | null; suggestions: Person[] } {
  const byEmail = email ? people.find(p => p.email?.toLowerCase().trim() === email.toLowerCase()) : undefined
  if (byEmail) return { personId: byEmail.id, suggestions: [] }
  // Same words in any order counts as exact — "Smith, Bob" is Bob Smith
  const words = (n: string) => normName(n).split(' ').sort().join(' ')
  const exact = people.filter(p => words(p.name) === words(name))
  if (exact.length === 1) return { personId: exact[0].id, suggestions: [] }
  // Several people with the same name, or only a near match: suggest, don't pick
  const suggestions = exact.length > 1 ? exact : people.filter(p => likelySamePerson(p.name, name)).slice(0, 5)
  return { personId: null, suggestions }
}

const monthLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export function buildImport(
  rows: string[][],
  cols: Partial<Record<ColumnRole, number>>,
  people: Person[],
  courses: Course[],
): { groups: ImportGroup[]; problems: ImportProblem[] } {
  const problems: ImportProblem[] = []
  const groups = new Map<string, ImportGroup>()
  const cell = (r: string[], role: ColumnRole) => (cols[role] != null ? r[cols[role]!] ?? '' : '')

  rows.forEach((r, i) => {
    const line = i + 2 // +1 for the header row, +1 for 1-based
    const name = cell(r, 'name')
    if (!name) { problems.push({ line, message: 'No name — skipped' }); return }
    const type = parseCourseType(cell(r, 'course'), cell(r, 'number'))
    if (!type) { problems.push({ line, message: `Couldn't tell the course type from "${cell(r, 'course')}" — skipped` }); return }
    const rawDate = cell(r, 'startDate')
    const startDate = parseDate(rawDate)
    if (rawDate && !startDate) problems.push({ line, message: `Couldn't read the date "${rawDate}" — imported without it` })
    const endDate = parseDate(cell(r, 'endDate'))
    const email = cell(r, 'email') || null

    // A refresher number identifies a run on its own; rater runs (and
    // unnumbered refreshers) are told apart by their date.
    const key = type.kind === 'refresher' && type.number ? `refresher:${type.number}` : `${type.kind}:${startDate ?? 'undated'}`
    let g = groups.get(key)
    if (!g) {
      const existing = courses.find(c =>
        c.kind === type.kind && (type.kind === 'refresher' && type.number ? c.number === type.number : (c.startDate ?? null) === startDate)
      ) ?? null
      g = {
        key, kind: type.kind, number: type.number, existing, rows: [],
        startDate: null, endDate: null,
        name: existing?.name ?? (type.kind === 'refresher'
          ? (type.number ? `Refresher Course ${type.number}` : `Refresher Course — ${startDate ? monthLabel(startDate) : 'undated'}`)
          : `Rater Course — ${startDate ? monthLabel(startDate) : 'undated'}`),
      }
      groups.set(key, g)
    }
    // A run's dates span all its rows
    if (startDate && (!g.startDate || startDate < g.startDate)) g.startDate = startDate
    const end = endDate ?? startDate
    if (end && (!g.endDate || end > g.endDate)) g.endDate = end

    if (g.rows.some(x => normName(x.name) === normName(name))) {
      problems.push({ line, message: `${name} is listed twice for ${g.name} — kept once` })
      return
    }
    g.rows.push({ line, name, email, startDate, endDate, rawDate, ...matchPerson(people, name, email) })
  })

  const sorted = [...groups.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || (a.number ?? 0) - (b.number ?? 0) || (a.startDate ?? '').localeCompare(b.startDate ?? ''))
  return { groups: sorted, problems }
}
