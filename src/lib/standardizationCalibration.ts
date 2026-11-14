import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { StandardizationScore, Test } from '@/types'

// A Standardization test moved into Certification can bring its
// standardization ratings with it, as published certification scores. They
// then count towards its calibration (Statistics → Tests → Save
// calibration) like any other published score, and the exam pickers see
// those raters as having heard it. Each copy records the score it came
// from, so bringing them across again only adds new ones.

async function standardizationScoresFor(testDocId: string): Promise<{ all: StandardizationScore[]; pending: StandardizationScore[] }> {
  const [std, copied] = await Promise.all([
    getDocs(query(collection(db, 'standardization_scores'), where('testDocId', '==', testDocId))),
    getDocs(query(collection(db, 'scores'), where('testDocId', '==', testDocId))),
  ])
  const done = new Set(copied.docs.map(d => d.data().fromStandardizationScoreId).filter(Boolean))
  const all = std.docs.map(d => ({ id: d.id, ...d.data() }) as StandardizationScore)
  return { all, pending: all.filter(s => !done.has(s.id)) }
}

export async function countPendingStandardizationScores(testDocId: string): Promise<{ total: number; pending: number }> {
  const { all, pending } = await standardizationScoresFor(testDocId)
  return { total: all.length, pending: pending.length }
}

export async function copyStandardizationScores(test: Pick<Test, 'id' | 'testId' | 'candidateName' | 'testType'>): Promise<number> {
  const { pending } = await standardizationScoresFor(test.id)
  for (let i = 0; i < pending.length; i += 450) {
    const batch = writeBatch(db)
    for (const s of pending.slice(i, i + 450)) {
      batch.set(doc(collection(db, 'scores')), {
        assignmentId: s.assignmentId,
        sessionId: s.sessionId,
        sessionName: s.sessionName,
        raterId: s.raterId,
        raterName: s.raterName,
        testDocId: test.id,
        // The test's Certification number, not its old S number
        testNumber: test.testId ?? null,
        candidateName: test.candidateName,
        testType: test.testType,
        pronunciation: s.pronunciation,
        structure: s.structure,
        vocabulary: s.vocabulary,
        fluency: s.fluency,
        comprehension: s.comprehension,
        interactions: s.interactions,
        overallLevel: s.overallLevel,
        published: true,
        notes: s.comments ?? '',
        fromStandardizationScoreId: s.id,
        createdAt: s.createdAt ?? serverTimestamp(),
      })
    }
    await batch.commit()
  }
  return pending.length
}
