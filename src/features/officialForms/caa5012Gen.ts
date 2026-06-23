import jsPDF from 'jspdf'

export interface Caa5012Params {
  forenames: string
  surname:   string
  dateOfAssessment: string  // formatted e.g. "1 JAN 2025"
  level: '4' | '5' | '6'
  evaluator: string
  dateOfIssue: string       // formatted e.g. "1 JAN 2025"
  basePath: string
}

async function loadImage(src: string): Promise<string> {
  const resp = await fetch(src)
  const blob = await resp.blob()
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
}

export function buildCaa5012DisplayName(p: { forenames: string; surname: string }) {
  return `${p.forenames.trim()} ${p.surname.trim()}`.trim()
}

export function buildCaa5012Filename(p: Caa5012Params) {
  const d = new Date(p.dateOfIssue + 'T00:00:00')
  const iso = `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${d.getFullYear()}`
  return `CAA5012 - ${p.forenames} ${p.surname} - ${iso}.pdf`
}

export async function buildCaa5012PDF(raw: Omit<Caa5012Params, 'forenames' | 'surname' | 'evaluator'> & {
  forenames: string; surname: string; evaluator: string
}): Promise<jsPDF> {
  const p: Caa5012Params = {
    ...raw,
    forenames: raw.forenames.trim().toUpperCase(),
    surname:   raw.surname.trim().toUpperCase(),
    evaluator: raw.evaluator.trim().toUpperCase(),
    dateOfAssessment: formatDate(raw.dateOfAssessment),
    dateOfIssue:      formatDate(raw.dateOfIssue),
  }

  const [bgData, sigData, stampData] = await Promise.all([
    loadImage(`${p.basePath}/CAA5012_BLANK.png`),
    loadImage(`${p.basePath}/BR_Signature_Original.png`),
    loadImage(`${p.basePath}/Lenguax-Logo-Stamp.png`),
  ])

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  // Background — placed at y=0 (original tFPDF used y=-3; all text offsets below compensate)
  pdf.addImage(bgData, 'PNG', 0, 0, 210, 297)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(0, 0, 0)

  // tFPDF coords → jsPDF: add +5 for 10mm cell centering, then -3 for missing background offset = +2
  // Coordinates from generate_CAA_5012_utf-8.php SetXY(x, y) + Cell(0, 10, text)
  pdf.text(p.forenames, 60,  96)   // SetXY(60, 89)
  pdf.text(p.surname,  129,  96)   // SetXY(129, 89)

  pdf.text(`${p.forenames} ${p.surname}`,  45, 167)  // SetXY(45, 160)
  pdf.text(p.evaluator,                    15, 175)  // SetXY(15, 168)
  pdf.text(p.dateOfAssessment,             65, 182)  // SetXY(65, 175)

  // Level tick — X mark in the appropriate column
  const levelX: Record<string, number> = { '4': 31, '5': 78, '6': 119 }
  pdf.text('X', levelX[p.level], 201)  // SetXY(lx, 194)

  pdf.text('TYRONE BISHOP', 71, 244)  // SetXY(71, 237)
  pdf.text('GBR-LTB-0002',  93, 252)  // SetXY(93, 245)
  pdf.text('BEN RIMRON',    78, 259)  // SetXY(78, 252)
  pdf.text(p.dateOfIssue,  148, 273)  // SetXY(148, 266)

  // Signature: tFPDF Image(path, 70, 258, 50, 25) → y = 258 - 3 = 255
  pdf.addImage(sigData,   'PNG', 70, 255, 50, 25)
  // Stamp: tFPDF Image(path, 120, 220, 28, 43) → y = 220 - 3 = 217
  pdf.addImage(stampData, 'PNG', 120, 217, 28, 43)

  return pdf
}
