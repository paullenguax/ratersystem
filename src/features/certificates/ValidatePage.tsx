import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CERT_TYPES, type CertTypeValue } from './certGen'

interface CertRecord {
  certNumber: string
  pin: string
  name: string
  date: string
  certType: CertTypeValue
  certTypeName: string
}

type Result = { status: 'valid'; cert: CertRecord } | { status: 'invalid' } | null

export function ValidatePage() {
  const { certNumber: paramCertNumber } = useParams<{ certNumber: string }>()
  const navigate = useNavigate()

  const [certNumber, setCertNumber] = useState(paramCertNumber ?? '')
  const [pin, setPin]               = useState('')
  const [checking, setChecking]     = useState(false)
  const [result, setResult]         = useState<Result>(null)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!certNumber.trim() || !pin.trim()) return
    setChecking(true)
    setResult(null)
    try {
      const snap = await getDocs(
        query(collection(db, 'certificates'), where('certNumber', '==', certNumber.trim().toUpperCase()))
      )
      if (snap.empty) {
        setResult({ status: 'invalid' })
        return
      }
      const cert = snap.docs[0].data() as CertRecord
      if (cert.pin !== pin.trim()) {
        setResult({ status: 'invalid' })
        return
      }
      setResult({ status: 'valid', cert })
    } finally {
      setChecking(false)
    }
  }

  const certDef = result?.status === 'valid'
    ? CERT_TYPES.find(t => t.value === result.cert.certType)
    : null

  return (
    <div className="min-h-screen bg-[#f5f7f9] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold text-[#00528C]">Lenguax</h1>
          <p className="text-sm text-muted-foreground">Certificate Validation</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the certificate number and PIN printed on your certificate to verify its authenticity.
          </p>
          <form onSubmit={handleVerify} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Certificate number</label>
              <Input
                placeholder="e.g. LX-A3X7K2"
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

        {/* Result */}
        {result?.status === 'valid' && (
          <div className="bg-white rounded-lg border border-green-200 shadow-sm p-6 space-y-3">
            <div className="flex items-center gap-2 text-green-700">
              <span className="text-lg">✓</span>
              <span className="font-semibold">Valid certificate</span>
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
            {certDef && (
              <div className="pt-2 border-t">
                <img
                  src={`/ratersystem/${certDef.template}`}
                  alt={certDef.label}
                  className="w-full rounded opacity-80"
                />
              </div>
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
