import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, addDoc, query, where, serverTimestamp } from 'firebase/firestore'
import type jsPDF from 'jspdf'
import { db } from '@/lib/firebase'
import { uploadToSharePoint, createAnonymousViewLink, SP_FOLDERS_CERT } from '@/lib/oneDrive'
import {
  CERT_TYPES, type CertTypeValue,
  generateCertNumber, generatePIN, buildCertPDF, resolveTemplateUrl,
} from './certGen'

// Kept out of certGen.ts so the public ValidatePage doesn't pull in the
// SharePoint/MSAL code just to render a PDF.

export interface CertRecord {
  id: string
  certNumber: string
  pin: string
  name: string
  date: string
  certType: CertTypeValue
  certTypeName: string
  createdAt?: { seconds: number }
  sharePointUrl?: string
  sharePointItemId?: string
  shareLink?: string
  shareLinkExpiresAt?: string
  // Only set on certificates issued from the Reports (feedback email) screen.
  raterId?: string
  sessionName?: string
}

export const VALIDATION_BASE = 'https://lenguax.com/ratersystem/validate'
export const TEMPLATE_BASE   = '/ratersystem'

export function validationUrl(certNumber: string) {
  return `${VALIDATION_BASE}/${certNumber}`
}

export async function logShareLink(entry: { certificateId: string; certNumber: string; candidateName: string; link: string; expiresAt: string; issuedBy: string }) {
  await addDoc(collection(db, 'certificateShareLinkLog'), {
    ...entry,
    issuedAt: serverTimestamp(),
  })
}

export interface IssuedCertificate {
  id: string
  certNumber: string
  pin: string
  pdf: jsPDF
  filename: string
  sharePointUrl: string | null
  sharePointErr: string | null
  shareLink: { url: string; expiresAt: string } | null
  shareLinkErr: string | null
}

// Builds the PDF, saves it to SharePoint with a per-candidate share link (when
// `upload` is set — i.e. the Microsoft session is connected), and writes the
// `certificates` record. SharePoint failures are reported in the result rather
// than thrown: the certificate itself is still issued.
export async function issueCertificate(params: {
  name: string
  date: string
  certType: CertTypeValue
  certNumber?: string
  pin?: string
  upload: boolean
  issuedBy: string
  raterId?: string
  sessionName?: string
}): Promise<IssuedCertificate> {
  const name = params.name.trim()
  const date = params.date.trim()
  const { certType, upload, issuedBy, raterId, sessionName } = params
  const certNumber = params.certNumber ?? generateCertNumber()
  const pin = params.pin ?? generatePIN()
  const certTypeName = CERT_TYPES.find(t => t.value === certType)!.label

  const templateUrl = await resolveTemplateUrl(certType, TEMPLATE_BASE)
  const pdf = await buildCertPDF({
    name,
    date,
    pin,
    certNumber,
    certType,
    validationUrl: validationUrl(certNumber),
    basePath: TEMPLATE_BASE,
    templateUrl,
  })
  const filename = `${certTypeName} - ${name} - ${certNumber}.pdf`

  let sharePointUrl: string | null = null
  let sharePointItemId: string | null = null
  let sharePointErr: string | null = null
  let shareLink: { url: string; expiresAt: string } | null = null
  let shareLinkErr: string | null = null
  if (upload) {
    try {
      const uploaded = await uploadToSharePoint(pdf.output('blob'), filename, SP_FOLDERS_CERT[certType], 'CourseCertificates')
      sharePointUrl = uploaded.webUrl
      sharePointItemId = uploaded.itemId
    } catch (err) {
      sharePointErr = err instanceof Error ? err.message : 'SharePoint upload failed'
    }

    // Per-candidate anonymous view link — only once the file itself is up.
    if (sharePointItemId) {
      try {
        shareLink = await createAnonymousViewLink(sharePointItemId, 'CourseCertificates')
      } catch (err) {
        shareLinkErr = err instanceof Error ? err.message : 'Could not create shareable link'
      }
    }
  }

  const docRef = await addDoc(collection(db, 'certificates'), {
    certNumber,
    pin,
    name,
    date,
    certType,
    certTypeName,
    createdBy: issuedBy,
    ...(raterId ? { raterId } : {}),
    ...(sessionName ? { sessionName } : {}),
    ...(sharePointUrl ? { sharePointUrl } : {}),
    ...(sharePointItemId ? { sharePointItemId } : {}),
    ...(shareLink ? { shareLink: shareLink.url, shareLinkExpiresAt: shareLink.expiresAt } : {}),
    createdAt: serverTimestamp(),
  })

  if (shareLink) {
    await logShareLink({
      certificateId: docRef.id,
      certNumber,
      candidateName: name,
      link: shareLink.url,
      expiresAt: shareLink.expiresAt,
      issuedBy,
    })
  }

  return { id: docRef.id, certNumber, pin, pdf, filename, sharePointUrl, sharePointErr, shareLink, shareLinkErr }
}

// Rebuilds an already-issued certificate's PDF from its record and downloads it.
export async function downloadCertificate(rec: CertRecord) {
  const templateUrl = await resolveTemplateUrl(rec.certType, TEMPLATE_BASE)
  const pdf = await buildCertPDF({
    name: rec.name,
    date: rec.date,
    pin: rec.pin,
    certNumber: rec.certNumber,
    certType: rec.certType,
    validationUrl: validationUrl(rec.certNumber),
    basePath: TEMPLATE_BASE,
    templateUrl,
  })
  pdf.save(`${rec.certTypeName} - ${rec.name} - ${rec.certNumber}.pdf`)
}

// Certificates already issued to a rater from the Reports screen, newest first.
// Key sits under ['certificates'] so the usual invalidation refreshes it too.
export function useRaterCertificates(raterId: string) {
  return useQuery({
    queryKey: ['certificates', 'byRater', raterId],
    enabled: !!raterId,
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'certificates'), where('raterId', '==', raterId)))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as CertRecord)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
    },
  })
}
