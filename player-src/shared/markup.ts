// Lightweight inline markup shared by both windows — `**bold**` and
// `__underline__`, which can combine (e.g. `**__both__**`) — not full HTML,
// so authoring stays plain-text-safe. Used for candidate-instruction lines,
// the examiner's script text/notes, and compiled Part-preview topic/questions.

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

export function renderInlineMarkup(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<u>$1</u>')
  return html
}

// Examiner script text (`.slide-text`) is styled royal-blue italic to mean
// "say this aloud". Anything the interlocutor should DO rather than say —
// a stage direction — is written in `[[ double brackets ]]` in the source
// and rendered upright and black via `.stage-direction` (the brackets
// themselves are stripped), so italic blue stays reserved for spoken words.
// Double brackets in the source (not single) so this never clashes with
// single-bracket `[placeholder]` author-fill tokens in the same field. Must
// open and close on one line; `**bold**` / `__underline__` still work
// inside and out.
export function renderScriptText(text: string): string {
  return text
    .split(/(\[\[[^\]\n]*\]\])/g)
    .map(segment =>
      /^\[\[[^\]\n]*\]\]$/.test(segment)
        ? `<span class="stage-direction">${renderInlineMarkup(segment.slice(2, -2).trim())}</span>`
        : renderInlineMarkup(segment),
    )
    .join('')
}
