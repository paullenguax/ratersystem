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

// Prose part of examiner script text: inline markup plus `[[ … ]]` stage
// directions. A `[[ double brackets ]]` run is rendered upright/black via
// `.stage-direction` (the brackets are stripped) so italic blue stays
// reserved for spoken words. Double brackets in the source (not single) so
// this never clashes with single-bracket `[placeholder]` author-fill tokens
// in the same field — and a `[placeholder]` may sit *inside* a `[[ … ]]`
// direction (the match runs non-greedily to the first `]]`, so a lone `]`
// inside is fine). Must open and close on one line; `**bold**` /
// `__underline__` still work in and out.
function renderProse(text: string): string {
  return text
    .split(/(\[\[[^\n]+?\]\])/g)
    .map(segment =>
      /^\[\[[^\n]+?\]\]$/.test(segment)
        ? `<span class="stage-direction">${renderInlineMarkup(segment.slice(2, -2).trim())}</span>`
        : renderInlineMarkup(segment),
    )
    .join('')
}

// A run of lines starting `- ` is a question list — the resolver emits them
// that way for every `{questions}` slot. Render them as a real `<ul>` so the
// player can give them hanging black bullets (see `.script-questions`),
// while the question text itself stays blue italic like the rest of the
// spoken script. Everything outside such a run is ordinary prose.
const BULLET_RE = /^[ \t]*-[ \t]+(?=\S)/

export function renderScriptText(text: string): string {
  let html = ''
  let list: string[] = []
  let prose: string[] = []
  const flushProse = () => {
    if (prose.length) { html += renderProse(prose.join('\n')); prose = [] }
  }
  const flushList = () => {
    if (list.length) {
      html += `<ul class="script-questions">${list.map(q => `<li>${renderProse(q)}</li>`).join('')}</ul>`
      list = []
    }
  }
  for (const line of text.split('\n')) {
    if (BULLET_RE.test(line)) { flushProse(); list.push(line.replace(BULLET_RE, '')) }
    else { flushList(); prose.push(line) }
  }
  flushProse()
  flushList()
  return html
}
