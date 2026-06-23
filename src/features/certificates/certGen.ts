import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

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
  return 'L' + parts.join('')
}

export function generatePIN(): string {
  return String(Math.floor(Math.random() * (9999 - 1111 + 1)) + 1111)
}

export async function resolveTemplateUrl(certType: CertTypeValue, basePath: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'cert_config', 'templates'))
    if (snap.exists()) {
      const overrides = snap.data() as Record<string, string>
      if (overrides[certType]) return overrides[certType]
    }
  } catch { /* fall through */ }
  const certDef = CERT_TYPES.find(t => t.value === certType)!
  return `${basePath}/${certDef.template}`
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
  templateUrl?: string
}): Promise<jsPDF> {
  const { name, date, pin, certNumber, certType, validationUrl, basePath, templateUrl } = params

  const certDef = CERT_TYPES.find(t => t.value === certType)!

  const [templateData, qrData] = await Promise.all([
    loadImage(templateUrl ?? `${basePath}/${certDef.template}`),
    QRCode.toDataURL(validationUrl, { errorCorrectionLevel: 'L', width: 200 }),
  ])

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  // Background template
  pdf.addImage(templateData, 'JPEG', 0, 0, 210, 297)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text(name, 14, 85)

  pdf.setFontSize(10)
  pdf.text(date, 14, certDef.dateY)

  pdf.setFontSize(7)
  pdf.text(certNumber, 171, 238.5)
  pdf.text(pin, 154.5, 241.5)

  pdf.addImage(qrData, 'PNG', 120, 227, 18, 18)
  pdf.link(120, 227, 17, 17, { url: validationUrl })

  return pdf
}
