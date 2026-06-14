export type ParseFlag =
  | 'all_caps'
  | 'annotation'
  | 'one_word'
  | 'bad_email'
  | 'name_conflict'
  | 'dual_email'

export interface CleanRecord {
  name: string
  email: string
}

export interface ReviewRecord {
  id: string
  name: string        // suggested canonical name (auto-fixed)
  email: string
  flags: ParseFlag[]
  altNames: string[]  // other name variants seen for this email
  dualEmails: string[] // other emails that share this person's name
  included: boolean   // default decision
}

export interface ParseResult {
  clean: CleanRecord[]
  review: ReviewRecord[]
  totalRows: number
}

function parseCSVRow(line: string): string[] {
  const result: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { field += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(field); field = ''
    } else {
      field += ch
    }
  }
  result.push(field)
  return result
}

function fixEnc(s: string): string {
  // Strip Â artifacts (mangled non-breaking spaces from Windows/Excel UTF-8)
  return s
    .replace(/Â /g, ' ')
    .replace(/Â /g, ' ')
    .replace(/Â/g, '')
    .trim()
}

function normEmail(e: string): string {
  return fixEnc(e).toLowerCase().replace(/\s+/g, '')
}

function cleanNameRaw(n: string): string {
  return fixEnc(n)
    .replace(/^capt\.?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fixDoubledName(n: string): string {
  const words = n.split(/\s+/)
  if (words.length >= 4 && words.length % 2 === 0) {
    const half = words.length / 2
    const a = words.slice(0, half).join(' ').toLowerCase()
    const b = words.slice(half).join(' ').toLowerCase()
    if (a === b) return words.slice(0, half).join(' ')
  }
  return n
}

function makeNameKey(n: string): string {
  return n.toLowerCase().replace(/[^a-z]/g, '').slice(0, 24)
}

function isAllCaps(n: string): boolean {
  return (
    n.length > 3 &&
    n === n.toUpperCase() &&
    /[A-Z]{2}/.test(n) &&
    /\s/.test(n)
  )
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

function detectFlags(name: string, email: string): ParseFlag[] {
  const flags: ParseFlag[] = []
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    flags.push('bad_email')
    return flags
  }
  if (/[?()]/.test(name)) {
    flags.push('annotation')
  } else if (isAllCaps(name)) {
    flags.push('all_caps')
  }
  if (!name.trim().includes(' ')) {
    flags.push('one_word')
  }
  return flags
}

function autoFix(name: string, flags: ParseFlag[]): string {
  let s = fixDoubledName(name)
  if (flags.includes('annotation')) {
    s = s.replace(/\s*\([^)]*\)/g, '').replace(/\s*\?+/g, '').replace(/\s+/g, ' ').trim()
    // Fix doubled first word: "Andrei Andrei Starostin" → "Andrei Starostin"
    const parts = s.split(' ')
    if (parts.length >= 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
      s = parts.slice(1).join(' ')
    }
  }
  if (flags.includes('all_caps') || (s.length > 3 && !/[a-z]/.test(s) && /[A-Z]/.test(s))) {
    s = titleCase(s)
  }
  return s.trim()
}

let _id = 0

export function parseRaterCSV(csvText: string): ParseResult {
  _id = 0
  const text = csvText.replace(/^﻿/, '') // strip BOM
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // email -> string[] (names in order of first appearance)
  const byEmail = new Map<string, string[]>()
  // nameKey -> string[] (emails)
  const byNameKey = new Map<string, string[]>()
  let totalRows = 0

  function addRecord(rawEmail: string, rawName: string) {
    const email = normEmail(rawEmail)
    const name = cleanNameRaw(rawName)
    if (!email || !name) return

    if (!byEmail.has(email)) byEmail.set(email, [])
    const names = byEmail.get(email)!
    if (!names.map(n => n.toLowerCase()).includes(name.toLowerCase())) {
      names.push(name)
    }

    const nk = makeNameKey(name)
    if (nk.length < 8) return
    if (!byNameKey.has(nk)) byNameKey.set(nk, [])
    const emails = byNameKey.get(nk)!
    if (!emails.includes(email)) emails.push(email)
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    totalRows++

    const row = parseCSVRow(lines[i])
    while (row.length < 6) row.push('')

    const leftName = cleanNameRaw(row[0])
    const leftEmail = normEmail(row[1])
    if (leftEmail && leftName) addRecord(leftEmail, leftName)

    const rightParts = [row[3], row[4]].map(s => s.trim()).filter(Boolean)
    const rightName = cleanNameRaw(rightParts.join(' '))
    const rightEmail = normEmail(row[5])
    if (rightEmail && rightName) addRecord(rightEmail, rightName)
  }

  const clean: CleanRecord[] = []
  const review: ReviewRecord[] = []

  for (const [email, names] of byEmail) {
    const primaryName = names.reduce((a, b) => (a.length >= b.length ? a : b))
    const altNames = names.filter(n => n.toLowerCase() !== primaryName.toLowerCase())

    const flags = detectFlags(primaryName, email)
    const hasNameConflict = altNames.length > 0

    const nk = makeNameKey(primaryName)
    const dualEmails =
      nk.length >= 8
        ? (byNameKey.get(nk) ?? []).filter(e => e !== email)
        : []

    if (flags.length === 0 && !hasNameConflict && dualEmails.length === 0) {
      clean.push({ name: primaryName, email })
    } else {
      const allFlags: ParseFlag[] = [...flags]
      if (hasNameConflict) allFlags.push('name_conflict')
      if (dualEmails.length > 0) allFlags.push('dual_email')

      const suggestedName = autoFix(primaryName, flags)
      const suggestedAlts = altNames.map(n => autoFix(n, detectFlags(n, email)))

      review.push({
        id: `rv${++_id}`,
        name: suggestedName,
        email,
        flags: allFlags,
        altNames: suggestedAlts,
        dualEmails,
        included: !flags.includes('bad_email') && !flags.includes('one_word'),
      })
    }
  }

  return { clean, review, totalRows }
}
