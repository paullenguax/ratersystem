import logo from '@/assets/lenguax-logo.png'

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

// Opens rendered HTML (e.g. a markdown preview's innerHTML) in a clean,
// Lenguax-branded window and prints it — the print dialog's "Save as PDF"
// is the PDF export. Page numbers use CSS @page margin boxes (Chrome/Edge;
// other browsers just omit them).
export function printDocument({ title, html, subtitle }: { title: string; html: string; subtitle?: string }) {
  const w = window.open('', '_blank')
  if (!w) {
    alert('The print window was blocked — allow pop-ups for this site and try again.')
    return
  }
  const logoUrl = new URL(logo, window.location.href).href
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4; margin: 18mm 18mm 20mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #666; } @bottom-left { content: "${escapeHtml(title).replace(/"/g, '')}"; font: 8pt system-ui, sans-serif; color: #666; } }
    body { font: 10.5pt/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; }
    header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #00528C; padding-bottom: 8px; margin-bottom: 18px; }
    header img { height: 34px; }
    header .meta { text-align: right; font-size: 8.5pt; color: #555; }
    h1 { font-size: 18pt; color: #00528C; margin: 0 0 .5em; } h2 { font-size: 13.5pt; color: #00528C; margin: 1.4em 0 .4em; } h3 { font-size: 11.5pt; margin: 1.2em 0 .3em; }
    h1, h2, h3 { break-after: avoid; } table, pre, blockquote, img { break-inside: avoid; }
    p { margin: 0 0 .8em; } ul, ol { margin: 0 0 .8em; padding-left: 1.4em; } li { margin: .15em 0; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: 9.5pt; } th, td { border: 1px solid #bbb; padding: .3em .5em; text-align: left; vertical-align: top; } th { background: #B3C8D9; }
    code { background: #f2f2f2; padding: 0 .2em; border-radius: 3px; font-size: .9em; } pre { background: #f2f2f2; padding: .6em; white-space: pre-wrap; }
    blockquote { border-left: 3px solid #B3C8D9; margin: 0 0 .8em; padding-left: 1em; color: #444; }
    hr { border: 0; border-top: 1px solid #ccc; margin: 1.4em 0; }
    a { color: #00528C; }
  </style></head><body>
    <header><img src="${logoUrl}" alt="Lenguax"><div class="meta">${subtitle ? escapeHtml(subtitle) + '<br>' : ''}${today}</div></header>
    <main>${html}</main>
    <script>window.onload = () => { window.focus(); window.print() }</script>
  </body></html>`)
  w.document.close()
}
