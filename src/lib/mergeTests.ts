import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch, type DocumentReference } from 'firebase/firestore'
import { getMetadata, ref as storageRef } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { formatTestNumber } from '@/lib/testNumber'
import { normName, rcFields, rcSlots, type RcSlot } from '@/lib/courses'
import type { Course, CourseMaterial, Test } from '@/types'

// ── Finding duplicates ───────────────────────────────────────────────────────

export interface DuplicateGroup {
  tests: Test[]
  // 'exact': the same audio file (identical bytes). 'likely': same candidate
  // and test type, and a similar length — needs a listen to confirm.
  match: 'exact' | 'likely'
}

// Storage keeps an MD5 of every upload, so identical files uploaded twice
// can be spotted without downloading them. null for anything not in our
// bucket (an external URL) or unreadable.
async function audioHash(url: string): Promise<string | null> {
  try {
    const meta = await getMetadata(storageRef(storage, url))
    return meta.md5Hash ?? null
  } catch {
    return null
  }
}

export async function findDuplicateRecordings(
  tests: Test[],
  onProgress?: (done: number, total: number) => void,
): Promise<DuplicateGroup[]> {
  const pool = tests.filter(t => t.category === 'training' && t.status === 'active' && t.recordingUrl)
  const hashes = new Map<string, string | null>()
  for (let i = 0; i < pool.length; i += 10) {
    const chunk = pool.slice(i, i + 10)
    const hs = await Promise.all(chunk.map(t => audioHash(t.recordingUrl)))
    chunk.forEach((t, j) => hashes.set(t.id, hs[j]))
    onProgress?.(Math.min(i + 10, pool.length), pool.length)
  }

  // Union-find over the two kinds of evidence
  const parent = new Map(pool.map(t => [t.id, t.id]))
  const find = (id: string): string => { const p = parent.get(id)!; return p === id ? id : find(p) }
  const exactPair = new Set<string>()
  const join = (a: string, b: string, exact: boolean) => {
    parent.set(find(a), find(b))
    if (exact) { exactPair.add(a); exactPair.add(b) }
  }
  const byKey = (key: (t: Test) => string | null, exact: boolean) => {
    const seen = new Map<string, string>()
    for (const t of pool) {
      const k = key(t)
      if (!k) continue
      const first = seen.get(k)
      if (first) join(first, t.id, exact)
      else seen.set(k, t.id)
    }
  }
  byKey(t => t.recordingUrl, true)
  byKey(t => hashes.get(t.id) ?? null, true)
  // Same candidate and test type, and lengths within 3s when both are known
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j]
      if (a.testType !== b.testType || !normName(a.candidateName) || normName(a.candidateName) !== normName(b.candidateName)) continue
      if (a.durationSeconds && b.durationSeconds && Math.abs(a.durationSeconds - b.durationSeconds) > 3) continue
      join(a.id, b.id, false)
    }
  }

  const groups = new Map<string, Test[]>()
  for (const t of pool) {
    const root = find(t.id)
    groups.set(root, [...(groups.get(root) ?? []), t])
  }
  return [...groups.values()]
    .filter(g => g.length > 1)
    .map(g => ({
      tests: g.sort((a, b) => (a.testId ?? 9999) - (b.testId ?? 9999)),
      match: g.every(t => exactPair.has(t.id)) ? 'exact' as const : 'likely' as const,
    }))
    .sort((a, b) => (a.match === b.match ? 0 : a.match === 'exact' ? -1 : 1) || (a.tests[0].testId ?? 0) - (b.tests[0].testId ?? 0))
}

// The copy to keep by default: the one with the most teaching notes, then
// the most course sets, then the lowest number.
export function suggestedKeeper(tests: Test[]): Test {
  const score = (t: Test) => [(t.teachingNotes ?? '').trim().length, rcSlots(t).length + (t.raterCourseDay ? 1 : 0), -(t.testId ?? 9999)]
  return [...tests].sort((a, b) => {
    const x = score(a), y = score(b)
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
  })[0]
}

// ── Merging ──────────────────────────────────────────────────────────────────

export interface MergeResult {
  courses: number
  materials: number
  practiceSessions: number
  scores: number
  // Things the merge couldn't combine and left as the keeper had them
  conflicts: string[]
}

const refPattern = (n: number) => new RegExp(`(?<![\\w#])T${n}\\b`, 'g')

function appendNotes(keep: string | undefined, extra: { label: string; text: string | undefined }[], heading: string): string {
  let out = (keep ?? '').trim()
  for (const e of extra) {
    const text = (e.text ?? '').trim()
    if (!text || out.includes(text)) continue
    out = out ? `${out}\n\n---\n\n**${heading} ${e.label}:**\n\n${text}` : text
  }
  return out
}

// Folds `dups` into `keeper`: course sets and days, teaching and admin notes,
// and everything that points at a duplicate (course runs and what's been
// played on them, practice sessions, scores, and "T12" references in session
// plans). Each duplicate is then retired with mergedInto set; its audio file
// is left in Storage.
export async function mergeRecordings(keeper: Test, dups: Test[], byName: string): Promise<MergeResult> {
  const dupIds = dups.map(d => d.id)
  const dupSet = new Set(dupIds)
  const conflicts: string[] = []
  const label = (t: Test) => formatTestNumber(t.testId, t.category)

  // Course sets: union, the keeper's day winning when both have one
  const slots: RcSlot[] = [...rcSlots(keeper)]
  for (const d of dups) {
    for (const s of rcSlots(d)) {
      const mine = slots.find(x => x.n === s.n)
      if (!mine) slots.push(s)
      else if (mine.day == null) mine.day = s.day
      else if (s.day != null && s.day !== mine.day) conflicts.push(`RC${s.n}: kept Day ${mine.day} (${label(d)} had Day ${s.day})`)
    }
  }
  let raterCourseDay = keeper.raterCourseDay ?? null
  for (const d of dups) {
    if (!d.raterCourseDay) continue
    if (raterCourseDay == null) raterCourseDay = d.raterCourseDay
    else if (d.raterCourseDay !== raterCourseDay) conflicts.push(`Rater Course: kept Day ${raterCourseDay} (${label(d)} had Day ${d.raterCourseDay})`)
  }

  const teachingNotes = appendNotes(keeper.teachingNotes, dups.map(d => ({ label: label(d), text: d.teachingNotes })), 'Notes merged from')
  const notes = appendNotes(keeper.notes, dups.map(d => ({ label: label(d), text: d.notes })), 'Merged from')

  const writes: [DocumentReference, Record<string, unknown>][] = []
  writes.push([doc(db, 'test_bank', keeper.id), {
    ...rcFields(slots),
    raterCourseDay,
    durationSeconds: keeper.durationSeconds ?? dups.find(d => d.durationSeconds)?.durationSeconds ?? null,
    notes,
    teachingNotes,
    ...(teachingNotes !== (keeper.teachingNotes ?? '').trim() && {
      teachingNotesUpdatedBy: byName,
      teachingNotesUpdatedAt: serverTimestamp(),
    }),
  }])
  for (const d of dups) {
    writes.push([doc(db, 'test_bank', d.id), {
      status: 'retired',
      mergedInto: keeper.id,
      raterCourseDay: null,
      ...rcFields([]),
    }])
  }

  // Course runs: swap the duplicate for the keeper, keeping "played" ticks
  const courseSnap = await getDocs(collection(db, 'courses'))
  let courses = 0
  for (const c of courseSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Course)) {
    const ids = c.testDocIds ?? []
    const played = c.playedAt ?? {}
    const touchesIds = ids.some(id => dupSet.has(id))
    const touchesPlayed = Object.keys(played).some(id => dupSet.has(id))
    if (!touchesIds && !touchesPlayed) continue
    const newIds = [...new Set(ids.map(id => dupSet.has(id) ? keeper.id : id))]
    const newPlayed = { ...played }
    for (const id of dupIds) {
      if (newPlayed[id] && !newPlayed[keeper.id]) newPlayed[keeper.id] = newPlayed[id]
      delete newPlayed[id]
    }
    writes.push([doc(db, 'courses', c.id), { testDocIds: newIds, playedAt: newPlayed }])
    courses++
  }

  // Session plans and other markdown notes: "T12" → the keeper's number
  let materials = 0
  const renumber = keeper.testId != null ? dups.filter(d => d.testId != null && d.testId !== keeper.testId) : []
  if (renumber.length) {
    const matSnap = await getDocs(collection(db, 'course_materials'))
    for (const m of matSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CourseMaterial)) {
      if (m.kind !== 'markdown' || !m.markdown) continue
      let md = m.markdown
      for (const d of renumber) md = md.replace(refPattern(d.testId!), `T${keeper.testId}`)
      if (md !== m.markdown) {
        writes.push([doc(db, 'course_materials', m.id), { markdown: md }])
        materials++
      }
    }
  }

  // Anything else that records the recording by its document ID
  const repoint = async (coll: string) => {
    let n = 0
    for (let i = 0; i < dupIds.length; i += 30) {
      const snap = await getDocs(query(collection(db, coll), where('testDocId', 'in', dupIds.slice(i, i + 30))))
      snap.docs.forEach(d => { writes.push([d.ref, { testDocId: keeper.id }]); n++ })
    }
    return n
  }
  const practiceSessions = await repoint('practice_sessions')
  const scores = (await repoint('scores')) + (await repoint('standardization_scores'))

  // Firestore batches cap at 500 writes
  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(db)
    writes.slice(i, i + 450).forEach(([ref, data]) => batch.update(ref, data))
    await batch.commit()
  }
  return { courses, materials, practiceSessions, scores, conflicts }
}
