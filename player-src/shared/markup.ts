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
