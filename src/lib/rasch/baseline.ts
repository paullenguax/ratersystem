import { useQuery } from '@tanstack/react-query'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { RaschBaseline } from './analysis'

// The active Rasch baseline lives in config/raschBaseline (admin-only).
// Replaced baselines are archived as config/raschBaseline-<createdAt> so the
// history of frames of reference is kept.

const ACTIVE = doc(db, 'config', 'raschBaseline')

export function useRaschBaseline() {
  return useQuery({
    queryKey: ['raschBaseline'],
    queryFn: async () => {
      const snap = await getDoc(ACTIVE)
      return snap.exists() ? (snap.data() as RaschBaseline) : null
    },
  })
}

async function archiveActive() {
  const snap = await getDoc(ACTIVE)
  if (!snap.exists()) return
  const old = snap.data() as RaschBaseline
  await setDoc(doc(db, 'config', `raschBaseline-${old.createdAt.replace(/[^0-9]/g, '')}`), old)
}

export async function saveBaseline(baseline: RaschBaseline) {
  await archiveActive()
  await setDoc(ACTIVE, baseline)
}

export async function clearBaseline() {
  await archiveActive()
  await deleteDoc(ACTIVE)
}
