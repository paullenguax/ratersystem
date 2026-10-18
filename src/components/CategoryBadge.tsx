type Category = 'rater_course' | 'standardization' | 'training'

// Distinguishes the non-certification pools from ordinary rater-course
// tests/assignments. No badge for rater_course (the default, unlabeled look
// everyone is used to) — only the other pools get a visible pill, following
// the same raw span+Tailwind pattern as the existing self-serve pill in
// AssignmentsPage.tsx rather than forcing it through a generic Badge variant.
export function CategoryBadge({ category }: { category?: Category }) {
  if (category === 'standardization') {
    return (
      <span className="text-[10px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 py-0.5 font-normal">
        standardization
      </span>
    )
  }
  if (category === 'training') {
    return (
      <span className="text-[10px] text-teal-800 bg-teal-50 border border-teal-200 rounded px-1 py-0.5 font-normal">
        training
      </span>
    )
  }
  return null
}
