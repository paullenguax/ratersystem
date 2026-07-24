import type { Test } from '@/types'

// Standardization tests are numbered in their own sequence, separate from
// the legacy numeric rater-course test numbers, and prefixed "S" so the two
// are never confused wherever a test number is shown.
export function formatTestNumber(testId: number | null | undefined, category?: Test['category']): string {
  if (testId == null) return '—'
  return category === 'standardization' ? `S${testId}` : `#${testId}`
}
