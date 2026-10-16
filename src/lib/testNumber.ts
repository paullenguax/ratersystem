import type { Test } from '@/types'

// Standardization and training tests are each numbered in their own
// sequence, separate from the legacy numeric rater-course test numbers, and
// prefixed "S"/"T" so they're never confused wherever a test number is shown.
export function formatTestNumber(testId: number | null | undefined, category?: Test['category']): string {
  if (testId == null) return '—'
  if (category === 'standardization') return `S${testId}`
  if (category === 'training') return `T${testId}`
  return `#${testId}`
}
