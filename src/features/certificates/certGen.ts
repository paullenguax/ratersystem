import jsPDF from 'jspdf'
import QRCode from 'qrcode'

export const CERT_TYPES = [
  { value: '1', label: 'Full Rater Certificate',          template: 'Certificate_Rater_Course_Generic.jpg',      dateY: 132 },
  { value: '2', label: 'Rater Interlocutor Certificate',  template: 'Certificate_Rater_Course_Interlocutor.jpg', dateY: 132 },
  { value: '3', label: 'Refresher Certificate',           template: 'Certificate_Rater_Refresher_Course.jpg',    dateY: 133 },
  { value: '4', label: 'Teacher Certificate',             template: 'Certificate_Teacher_Course.jpg',            dateY: 130 },
  { value: '6', label: 'Refresher Interlocutor Certificate', template: 'Certificate_Refresher_Interlocutor.jpg', dateY: 133 },
] as const

export type CertTypeValue = (typeof CERT_TYPES)[number]['value']

export function generateCertNumber(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits  = '0123456789'
  const parts = [
    ...Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]),
    ...Array.from({ length: 3 }, () => digits[Math.floor(Math.random() * digits.length)]),
  ]
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]]
  }
  return 'LX-' + parts.join('')
}

export function generatePIN(): string {
  return String(Math.floor(Math.random() * (9999 - 1111 + 1)) + 1111)
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

export async function buildCertPDF(params: {
  name: string
  date: string
  pin: string
  certNumber: string
  certType: CertTypeValue
  validationUrl: string
  basePath: string
}): Promise<jsPDF> {
  const { name, date, pin, certNumber, certType, validationUrl, basePath } = params

  const certDef = CERT_TYPES.find(t => t.value === certType)!

  const [templateData, qrData] = await Promise.all([
    loadImage(`${basePath}/${certDef.template}`),
    QRCode.toDataURL(validationUrl, { errorCorrectionLevel: 'L', width: 200 }),
  ])

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  // Background template
  pdf.addImage(templateData, 'JPEG', 0, 0, 210, 297)

  // Name — LiberationSans Bold 16pt equiv → Helvetica Bold 16pt
  // Original: SetXY(12, 78), Cell(40, 10) → baseline ≈ y + cell/2 = 83
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text(name, 12, 83)

  // Date — Arial Bold 10pt, y varies by cert type
  pdf.setFontSize(10)
  pdf.text(date, 12, certDef.dateY)

  // Certificate number — Arial Bold 7pt, original SetXY(170, 232.5)
  pdf.setFontSize(7)
  pdf.text(certNumber, 170, 237.5)

  // PIN — Arial Bold 7pt, original SetXY(153.5, 235.5)
  pdf.text(pin, 153.5, 240.5)

  // QR code — original x=120, y=227, w=18
  pdf.addImage(qrData, 'PNG', 120, 227, 18, 18)

  // Clickable link over QR
  pdf.link(120, 227, 17, 17, { url: validationUrl })

  return pdf
}
