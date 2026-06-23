import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type CertTypeValue, buildCertPDF, resolveTemplateUrl } from './certGen'
import { Download } from 'lucide-react'

interface CertRecord {
  certNumber: string
  pin: string
  name: string
  date: string
  certType: CertTypeValue
  certTypeName: string
}

type Result = { status: 'valid'; cert: CertRecord } | { status: 'invalid' } | null

const TEMPLATE_BASE   = '/ratersystem'
const VALIDATION_BASE = 'https://lenguax.com/ratersystem/validate'

export function ValidatePage() {
  const { certNumber: paramCertNumber } = useParams<{ certNumber: string }>()

  const [certNumber, setCertNumber] = useState(paramCertNumber ?? '')
  const [pin, setPin]               = useState('')
  const [checking, setChecking]     = useState(false)
  const [result, setResult]         = useState<Result>(null)
  const [certBlobUrl, setCertBlobUrl] = useState<string | null>(null)
  const [rendering, setRendering]   = useState(false)

  // Render the actual cert PDF whenever we get a valid result
  useEffect(() => {
    if (result?.status !== 'valid') {
      if (certBlobUrl) { URL.revokeObjectURL(certBlobUrl); setCertBlobUrl(null) }
      return
    }
    setRendering(true)
    const cert = result.cert
    resolveTemplateUrl(cert.certType, TEMPLATE_BASE)
      .then(templateUrl => buildCertPDF({
        name: cert.name,
        date: cert.date,
        pin: cert.pin,
        certNumber: cert.certNumber,
        certType: cert.certType,
        validationUrl: `${VALIDATION_BASE}/${cert.certNumber}`,
        basePath: TEMPLATE_BASE,
        templateUrl,
      }))
      .then(pdf => {
        const blob = pdf.output('blob')
        setCertBlobUrl(URL.createObjectURL(blob))
      })
      .finally(() => setRendering(false))
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!certNumber.trim() || !pin.trim()) return
    setChecking(true)
    setResult(null)
    try {
      const snap = await getDocs(
        query(collection(db, 'certificates'), where('certNumber', '==', certNumber.trim().toUpperCase()))
      )
      if (snap.empty) { setResult({ status: 'invalid' }); return }
      const cert = snap.docs[0].data() as CertRecord
      if (cert.pin !== pin.trim()) { setResult({ status: 'invalid' }); return }
      setResult({ status: 'valid', cert })
    } finally {
      setChecking(false)
    }
  }

  function handleDownload() {
    if (!certBlobUrl || result?.status !== 'valid') return
    const a = document.createElement('a')
    a.href = certBlobUrl
    a.download = `${result.cert.certTypeName} - ${result.cert.name} - ${result.cert.certNumber}.pdf`
    a.click()
  }

  return (
    <div className="min-h-screen bg-[#f5f7f9] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">

        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold text-[#00528C]">Lenguax</h1>
          <p className="text-sm text-muted-foreground">Certificate Validation</p>
        </div>

        <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the certificate number and PIN printed on your certificate to verify its authenticity.
          </p>
          <form onSubmit={handleVerify} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Certificate number</label>
              <Input
                placeholder="e.g. LA3X7K2"
                value={certNumber}
                onChange={e => { setCertNumber(e.target.value); setResult(null) }}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PIN</label>
              <Input
                placeholder="4-digit PIN"
                maxLength={4}
                value={pin}
                onChange={e => { setPin(e.target.value); setResult(null) }}
                className="font-mono"
              />
            </div>
            <Button type="submit" className="w-full" disabled={checking}>
              {checking ? 'Checking…' : 'Verify certificate'}
            </Button>
          </form>
        </div>

        {result?.status === 'valid' && (
          <div className="bg-white rounded-lg border border-green-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-700">
                <span className="text-lg">✓</span>
                <span className="font-semibold">Valid certificate</span>
              </div>
              {certBlobUrl && (
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  <Download className="size-4 mr-1.5" />
                  Download PDF
                </Button>
              )}
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Holder</span>
                <span className="font-medium">{result.cert.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Certificate</span>
                <span>{result.cert.certTypeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Course dates</span>
                <span>{result.cert.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Number</span>
                <span className="font-mono">{result.cert.certNumber}</span>
              </div>
            </div>

            {rendering && (
              <p className="text-xs text-muted-foreground">Rendering certificate…</p>
            )}
            {certBlobUrl && (
              <iframe
                src={certBlobUrl}
                title="Certificate"
                className="w-full rounded border"
                style={{ height: '520px' }}
              />
            )}
          </div>
        )}

        {result?.status === 'invalid' && (
          <div className="bg-white rounded-lg border border-red-200 shadow-sm p-4">
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <span>✗</span>
              <span>Certificate not found. Please check the number and PIN and try again.</span>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Lenguax · <a href="/ratersystem" className="hover:underline">lenguax.com</a>
        </p>
      </div>
    </div>
  )
}
