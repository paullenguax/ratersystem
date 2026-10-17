import type { Course, Person } from '@/types'
import { autoCourseName, normName } from '@/lib/courses'

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

export type ColumnRole = 'name' | 'surname' | 'email' | 'course' | 'number' | 'startDate' | 'endDate'

export const COLUMN_LABELS: Record<ColumnRole, string> = {
  name: 'Name (or first name)',
  surname: 'Surname, if separate',
  course: 'Course type',
  number: 'Refresher number, if separate',
  startDate: 'Date',
  endDate: 'End date',
  email: 'Email',
}

// Best guess at which header is which, so most sheets need no mapping
export function guessColumns(headers: string[]): Partial<Record<ColumnRole, number>> {
  const h = headers.map(x => x.toLowerCase())
  const taken: number[] = []
  const find = (re: RegExp) => {
    const i = h.findIndex((x, idx) => re.test(x) && !taken.includes(idx))
    if (i < 0) return undefined
    taken.push(i)
    return i
  }
  const email = find(/e-?mail/)
  const surname = find(/surname|last ?name|family/)
  const endDate = find(/end|finish|\bto\b/)
  const startDate = find(/date|start|from|when|month/)
  const number = find(/\bno\b|num|#/)
  const course = find(/course|type|refresher|kind/)
  const name = find(/name|attendee|rater|person|participant|student/)
  return { name, surname, email, course, number, startDate, endDate }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}
const monthIndex = (word: string) => {
  const i = MONTHS.indexOf(word.slice(0, 3))
  return i >= 0 ? i + 1 : null
}
const year2 = (y: string) => (y.length === 2 ? 2000 + +y : +y)

export interface ParsedDate {
  date: string | null
  // Day and month were read but the year is missing — filled in from context
  yearless?: { month: number; day: number }
  // A typo that was corrected, worth flagging
  corrected?: string
}

// Reads the date formats a hand-kept sheet tends to have, UK order first:
// 2025-03-12, 12/03/2025, 12.3.25, 19-Jun-26, 12th March 2025, March 2025
// (→ 1st), Excel serials; "8th April 20222" (year typo) and "8th July" (no
// year) are reported back for the caller to resolve.
export function parseDateLoose(raw: string): ParsedDate {
  let s = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (!s) return { date: null }
  let corrected: string | undefined
  // 5-digit year like 20222 — almost always a doubled digit
  const typo = s.match(/\b(20\d{2})\d\b/)
  if (typo) { corrected = `year “${typo[0]}” read as ${typo[1]}`; s = s.replace(typo[0], typo[1]) }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return { date: iso(+m[1], +m[2], +m[3]), corrected }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) return { date: iso(year2(m[3]), +m[2], +m[1]), corrected }
  m = s.match(/^(\d{1,2})[ -]([a-z]+)\.?[ -](\d{2}|\d{4})$/)
  if (m && monthIndex(m[2])) return { date: iso(year2(m[3]), monthIndex(m[2])!, +m[1]), corrected }
  m = s.match(/^([a-z]+)\.? (\d{1,2}) (\d{4})$/)
  if (m && monthIndex(m[1])) return { date: iso(+m[3], monthIndex(m[1])!, +m[2]), corrected }
  m = s.match(/^([a-z]+)\.? (\d{4})$/)
  if (m && monthIndex(m[1])) return { date: iso(+m[2], monthIndex(m[1])!, 1), corrected }
  m = s.match(/^(\d{1,2}) ([a-z]+)\.?$/) ?? null
  if (m && monthIndex(m[2])) return { date: null, yearless: { month: monthIndex(m[2])!, day: +m[1] } }
  m = s.match(/^([a-z]+)\.? (\d{1,2})$/)
  if (m && monthIndex(m[1])) return { date: null, yearless: { month: monthIndex(m[1])!, day: +m[2] } }
  if (/^\d{5}$/.test(s)) {
    // Excel serial day (1900 date system)
    const dt = new Date(Date.UTC(1899, 11, 30) + +s * 86400000)
    return { date: iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) }
  }
  return { date: null }
}

export function parseDate(raw: string): string | null {
  return parseDateLoose(raw).date
}

export interface CourseType { kind: Course['kind']; number: number | null }

// "Refresher 3", "RC3", "RC1 (2022)", "Refresher Course 3", "Initial",
// "Rater course"… The year in "RC1 (2022)" is ignored.
export function parseCourseType(raw: string, numberRaw?: string): CourseType | null {
  const s = raw.trim().toLowerCase()
  const fromCell = s.match(/(?:\brc|refresher(?: course)?|^r)\s*#?\s*(\d{1,2})\b/)?.[1]
  const number = Number((numberRaw ?? '').match(/\d+/)?.[0] ?? fromCell) || null
  if (/refresh|^rc\b|^rc\s*\d|^r\s*\d/.test(s)) return { kind: 'refresher', number }
  if (/rater|initial|^ir?c$/.test(s)) return { kind: 'rater', number: null }
  return null
}

// "RC1 (2022) & RC2 (2023)" — one row, two courses on the same day
export function splitCourseCell(raw: string): string[] {
  return raw.split(/\s*(?:&|\+|\band\b|\/)\s*/i).map(x => x.trim()).filter(Boolean)
}

const TITLES = /^(capt(ain)?|dr|mr|mrs|ms|miss|prof|f\/o|fo|sfo)\.?\s+/i

// Joins first + last name, drops a leading title (Capt., Dr…) and
// title-cases names typed in ALL CAPS.
export function cleanName(first: string, last = ''): string {
  let n = `${first} ${last}`.replace(/\s+/g, ' ').trim()
  while (TITLES.test(n)) n = n.replace(TITLES, '')
  if (n === n.toUpperCase() && /[A-Z]/.test(n)) {
    n = n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
  }
  return n
}

export interface ImportRow {
  line: number           // 1-based spreadsheet row, for messages
  name: string
  email: string | null
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

export interface ImportProblem { line: number; message: string; skipped: boolean }

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

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

interface ParsedRow {
  line: number
  name: string
  email: string | null
  courseCell: string
  types: CourseType[]
  date: ParsedDate
  endDate: string | null
}

export function buildImport(
  rows: string[][],
  cols: Partial<Record<ColumnRole, number>>,
  people: Person[],
  courses: Course[],
): { groups: ImportGroup[]; problems: ImportProblem[] } {
  const problems: ImportProblem[] = []
  const cell = (r: string[], role: ColumnRole) => (cols[role] != null ? r[cols[role]!] ?? '' : '')

  // ── pass 1: read every row ────────────────────────────────────────────────
  const parsed: ParsedRow[] = rows.map((r, i) => {
    const courseCell = cell(r, 'course')
    const types = splitCourseCell(courseCell)
      .map(part => parseCourseType(part, cell(r, 'number')))
      .filter((t): t is CourseType => !!t)
    return {
      line: i + 2, // +1 for the header row, +1 for 1-based
      name: cleanName(cell(r, 'name'), cell(r, 'surname')),
      email: cell(r, 'email') || null,
      courseCell,
      types,
      date: parseDateLoose(cell(r, 'startDate')),
      endDate: parseDate(cell(r, 'endDate')),
    }
  })

  // ── pass 2: fill in missing years from the dated rows around them ─────────
  // Hand-kept sheets are usually in date order, so "8th July" between June
  // and September 2023 rows is July 2023.
  parsed.forEach((p, i) => {
    if (!p.date.yearless) return
    const prev = parsed.slice(0, i).reverse().find(x => x.date.date)?.date.date ?? null
    const next = parsed.slice(i + 1).find(x => x.date.date)?.date.date ?? null
    const { month, day } = p.date.yearless
    const years = [prev, next].filter(Boolean).flatMap(d => { const y = +d!.slice(0, 4); return [y, y + 1, y - 1] })
    const candidates = [...new Set(years)].map(y => iso(y, month, day)).filter((d): d is string => !!d)
    const fits = candidates.find(d => (!prev || d >= prev) && (!next || d <= next)) ?? candidates[0] ?? null
    p.date = { date: fits, yearless: p.date.yearless }
    problems.push({
      line: p.line, skipped: false,
      message: fits ? `No year — assumed ${fmtDate(fits)} from the rows around it` : 'No year and no dated rows nearby — imported without a date',
    })
  })

  // ── pass 3: a blank course type takes the only course run on that date ───
  parsed.forEach(p => {
    if (p.types.length || p.courseCell) return
    if (!p.date.date) return
    const sameDay = new Map<string, CourseType>()
    parsed.filter(x => x !== p && x.date.date === p.date.date).forEach(x => x.types.forEach(t => sameDay.set(`${t.kind}:${t.number}`, t)))
    if (sameDay.size === 1) {
      const t = [...sameDay.values()][0]
      p.types = [t]
      problems.push({ line: p.line, skipped: false, message: `No course type — assumed ${t.kind === 'refresher' ? `RC${t.number}` : 'Initial'}, the only course on ${fmtDate(p.date.date)}` })
    }
  })

  // ── pass 4: group into course runs ────────────────────────────────────────
  const groups = new Map<string, ImportGroup>()
  for (const p of parsed) {
    if (!p.name) { problems.push({ line: p.line, skipped: true, message: 'No name — skipped' }); continue }
    if (!p.types.length) {
      problems.push({ line: p.line, skipped: true, message: p.courseCell ? `Couldn't tell the course type from “${p.courseCell}” — skipped` : 'No course type — skipped' })
      continue
    }
    if (p.date.corrected) problems.push({ line: p.line, skipped: false, message: `Date typo: ${p.date.corrected}` })
    const startDate = p.date.date
    if (!startDate && !p.date.yearless) problems.push({ line: p.line, skipped: false, message: 'No readable date — imported into an undated course' })

    for (const type of p.types) {
      if (type.kind === 'refresher' && !type.number) {
        problems.push({ line: p.line, skipped: true, message: `Refresher with no RC number (“${p.courseCell}”) — skipped` })
        continue
      }
      // A run is one set delivered on one date
      const key = `${type.kind}:${type.number ?? ''}:${startDate ?? 'undated'}`
      let g = groups.get(key)
      if (!g) {
        const existing = courses.find(c =>
          c.kind === type.kind && (c.number ?? null) === type.number && (c.startDate ?? null) === startDate) ?? null
        g = {
          key, kind: type.kind, number: type.number, existing, rows: [],
          startDate, endDate: p.endDate ?? startDate,
          name: existing?.name ?? autoCourseName(type.kind, type.number, startDate),
        }
        groups.set(key, g)
      }
      if (p.endDate && (!g.endDate || p.endDate > g.endDate)) g.endDate = p.endDate
      if (g.rows.some(x => normName(x.name) === normName(p.name))) {
        problems.push({ line: p.line, skipped: false, message: `${p.name} is listed twice for ${g.name} — kept once` })
        continue
      }
      g.rows.push({ line: p.line, name: p.name, email: p.email, ...matchPerson(people, p.name, p.email) })
    }
  }

  const sorted = [...groups.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || (a.number ?? 0) - (b.number ?? 0) || (a.startDate ?? '').localeCompare(b.startDate ?? ''))
  problems.sort((a, b) => a.line - b.line)
  return { groups: sorted, problems }
}
