import type { Test } from '@/types'

export type TestCategory = NonNullable<Test['category']>

// Display names for the three test pools. 'standardization' was shown as
// "Standardization" while it doubled as the live-practice pool; since Practice
// Sessions moved to Training (2026-10) it's labelled by what it is again.
export const CATEGORY_LABELS: Record<TestCategory, string> = {
  rater_course: 'Certification',
  standardization: 'Standardization',
  training: 'Training',
}

// Old free-form course tags (superseded by Test.raterCourseDay), still shown
// faintly as a hint while sorting tests into pools.
export const LEGACY_COURSE_TAG_LABELS: Record<NonNullable<Test['courseTag']>, string> = {
  rater_course: 'Rater course',
  refresher_course: 'Refresher course',
  other: 'Other',
}

// Undefined is treated as 'rater_course' everywhere — most legacy tests
// predate the field.
export function testCategory(t: Pick<Test, 'category'>): TestCategory {
  return t.category ?? 'rater_course'
}

// The one test for "may this recording be handed out in a certification
// exam?" Deliberately a positive match on rater_course: an exclusion list
// (`!== 'standardization'`) silently lets every newly added category — like
// training audio played on courses — leak into exams. Mirrored server-side
// in functions/index.js (isExamPoolTest).
export function isExamPoolTest(t: Pick<Test, 'category'>): boolean {
  return testCategory(t) === 'rater_course'
}
