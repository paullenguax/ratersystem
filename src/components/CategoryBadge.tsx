type Category = 'rater_course' | 'standardization'

// Distinguishes standardization-pool tests/assignments from ordinary
// rater-course ones. No badge for rater_course (the default, unlabeled look
// everyone is used to) — only standardization gets a visible pill, following
// the same raw span+Tailwind pattern as the existing self-serve pill in
// AssignmentsPage.tsx rather than forcing it through a generic Badge variant.
export function CategoryBadge({ category }: { category?: Category }) {
  if ((category ?? 'rater_course') !== 'standardization') return null

  return (
    <span className="text-[10px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 py-0.5 font-normal">
      standardization
    </span>
  )
}
