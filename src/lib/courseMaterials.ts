import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import type { Course, CourseMaterial } from '@/types'

export async function fetchMaterials(): Promise<CourseMaterial[]> {
  const snap = await getDocs(collection(db, 'course_materials'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as CourseMaterial)
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99) || a.title.localeCompare(b.title))
}

// Where a new material lands. `course` scope needs the run's ID.
export interface MaterialTarget {
  scope: CourseMaterial['scope']
  courseId?: string | null
  day?: number | null
}

export const SCOPE_LABELS: Record<CourseMaterial['scope'], string> = {
  rater: 'All rater courses',
  refresher: 'All refresher courses',
  course: 'This course only',
}

// A run shows its own materials plus the shared ones for its kind.
export function materialsForCourse(all: CourseMaterial[], course: Course): CourseMaterial[] {
  return all.filter(m => (m.scope === 'course' && m.courseId === course.id) || m.scope === course.kind)
}

export async function uploadMaterialFile(
  file: File,
  target: MaterialTarget,
  updatedByName: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  // Create the doc first so the file sits under its ID in Storage
  const ref = await addDoc(collection(db, 'course_materials'), {
    scope: target.scope,
    courseId: target.courseId ?? null,
    day: target.day ?? null,
    title: file.name.replace(/\.[^.]+$/, ''),
    kind: 'file',
    fileName: file.name,
    contentType: file.type || null,
    size: file.size,
    updatedByName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  const path = `course-materials/${ref.id}/${file.name}`
  try {
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type || undefined })
    await new Promise<void>((resolve, reject) => {
      task.on('state_changed', s => onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, resolve)
    })
    const url = await getDownloadURL(task.snapshot.ref)
    await updateDoc(ref, { storagePath: path, url })
  } catch (e) {
    // Don't leave a doc pointing at nothing
    await deleteDoc(ref)
    throw e
  }
}

export async function createNote(title: string, target: MaterialTarget, updatedByName: string): Promise<string> {
  const ref = await addDoc(collection(db, 'course_materials'), {
    scope: target.scope,
    courseId: target.courseId ?? null,
    day: target.day ?? null,
    title,
    kind: 'markdown',
    markdown: `# ${title}\n\n`,
    updatedByName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteMaterial(m: CourseMaterial): Promise<void> {
  if (m.storagePath) {
    // Already gone from Storage is fine — the record is what matters
    await deleteObject(storageRef(storage, m.storagePath)).catch(() => {})
  }
  await deleteDoc(doc(db, 'course_materials', m.id))
}

export function formatSize(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
