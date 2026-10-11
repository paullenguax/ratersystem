import type { RaschRun, RaschRater } from '@/lib/parseFacets'

// Renders one rater's row of the Rater Measurement Report in the layout of
// Facets' Table 7.2.1 (same columns, same number formatting), with the
// all-rater Mean / S.D. rows and the separation line underneath. A returning
// rater's row under their previous number can be included alongside. Used on the
// Reports page for the table the feedback email refers to — the in-house
// analysis has no Facets output file to screenshot.

type Col = { head: [string, string]; width: number; dp: number; get: (r: RaschRater) => number | undefined }

// Columns grouped into Facets' "|"-separated blocks
const BLOCKS: Col[][] = [
  [
    { head: ['Total', 'Score'],     width: 7, dp: 0, get: r => r.totalScore },
    { head: ['Total', 'Count'],     width: 7, dp: 0, get: r => r.count },
    { head: ['Obsvd', 'Average'],   width: 8, dp: 2, get: r => r.observedAvg },
    { head: ['Fair(M)', 'Average'], width: 8, dp: 2, get: r => r.fairAvg },
  ],
  [
    { head: ['', 'Measure'],        width: 8, dp: 2, get: r => r.measure },
    { head: ['Model', 'S.E.'],      width: 6, dp: 2, get: r => r.se },
  ],
  [
    { head: ['Infit', 'MnSq'],      width: 6, dp: 2, get: r => r.infitMnSq },
    { head: ['', 'ZStd'],           width: 5, dp: 1, get: r => r.infitZStd },
    { head: ['Outfit', 'MnSq'],     width: 7, dp: 2, get: r => r.outfitMnSq },
    { head: ['', 'ZStd'],           width: 5, dp: 1, get: r => r.outfitZStd },
  ],
  [
    { head: ['Estim.', 'Discrm'],   width: 7, dp: 2, get: r => r.discrimination },
  ],
  [
    { head: ['Corr.', 'PtMea'],     width: 6, dp: 2, get: r => r.ptMea },
    { head: ['', 'PtExp'],          width: 6, dp: 2, get: r => r.ptExp },
  ],
]
const LABEL_WIDTH = 20

// Facets style: fixed decimals, no leading zero (".95", "-.12")
function fmt(n: number | undefined, dp: number): string {
  if (n == null || isNaN(n)) return ''
  return n.toFixed(dp).replace(/^(-?)0\./, '$1.')
}

function line(cells: (c: Col) => string, label: string): string {
  const blocks = BLOCKS.map(b => b.map(c => cells(c).padStart(c.width)).join('') + ' ')
  return `|${blocks.join('|')}| ${label.padEnd(LABEL_WIDTH)}|`
}

function rule(edge: string, join: string): string {
  const blocks = BLOCKS.map(b => '-'.repeat(b.reduce((w, c) => w + c.width, 0) + 1))
  return `${edge}${blocks.join(join)}${join}${'-'.repeat(LABEL_WIDTH + 1)}${edge}`
}

export function buildTable7Text(run: RaschRun, raterNumber: number, prevRaterNumber?: number): string | null {
  const rater = run.raters.find(r => r.raterNumber === raterNumber)
  if (!rater) return null
  const prev = prevRaterNumber != null && prevRaterNumber !== raterNumber
    ? run.raters.find(r => r.raterNumber === prevRaterNumber)
    : undefined
  const rows = prev ? [prev, rater] : [rater]

  // Summary rows over every rater in the run; blank where a column is missing
  // on any of them (runs saved before the score/count columns were kept)
  const summary = (fn: (vals: number[]) => number, dpOverride?: number) => (c: Col) => {
    const vals = run.raters.map(c.get)
    if (vals.some(v => v == null || isNaN(v))) return ''
    return fmt(fn(vals as number[]), dpOverride ?? Math.max(c.dp, c.dp === 0 ? 1 : c.dp))
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  const sd = (sample: boolean) => (v: number[]) => {
    const m = mean(v)
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - (sample ? 1 : 0)))
  }

  const n = run.raters.length
  const adjSd = run.separation * run.rmse
  const strata = (4 * run.separation + 1) / 3

  return [
    'Table 7.2.1  Rater Measurement Report',
    rule('+', '-'),
    line(c => c.head[0], ''),
    line(c => c.head[1], 'Num Rater'),
    rule('|', '+'),
    ...rows.map(r => line(c => fmt(c.get(r), c.dp), `${r.raterNumber} Rater ${r.raterNumber}`)),
    rule('|', '+'),
    line(summary(mean), `Mean (Count: ${n})`),
    line(summary(sd(false)), 'S.D. (Population)'),
    ...(n > 1 ? [line(summary(sd(true)), 'S.D. (Sample)')] : []),
    rule('+', '-'),
    `Model: RMSE ${fmt(run.rmse, 2)}  Adj (True) S.D. ${fmt(adjSd, 2)}  Separation ${fmt(run.separation, 2)}  Strata ${fmt(strata, 2)}  Reliability ${fmt(run.reliability, 2)}`,
  ].join('\n')
}

export function downloadTextAsPng(text: string, filename: string) {
  const lines = text.split('\n')
  const scale = 2, fontSize = 14, lineHeight = 18, pad = 16
  const font = `${fontSize}px "Courier New", Courier, monospace`
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  const width = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + pad * 2
  const height = lines.length * lineHeight + pad * 2
  canvas.width = width * scale
  canvas.height = height * scale
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.font = font
  ctx.textBaseline = 'top'
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lineHeight))
  canvas.toBlob(png => {
    if (!png) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(png)
    a.download = filename
    a.click()
  }, 'image/png')
}
