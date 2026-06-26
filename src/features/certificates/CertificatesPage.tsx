import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, deleteDoc, doc, query, where, serverTimestamp } from 'firebase/firestore'
import { Copy, Check, ExternalLink, Download, Trash2, CloudUpload, LogOut, Link } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CERT_TYPES, type CertTypeValue,
  generateCertNumber, generatePIN, buildCertPDF, resolveTemplateUrl,
} from './certGen'
import { msSignIn, msSignOut, getMsAccount } from '@/lib/msal'
import { uploadToSharePoint, SP_FOLDERS_CERT } from '@/lib/oneDrive'

interface CertRecord {
  id: string
  certNumber: string
  pin: string
  name: string
  date: string
  certType: CertTypeValue
  certTypeName: string
  createdAt?: { seconds: number }
  sharePointUrl?: string
}

const VALIDATION_BASE = 'https://lenguax.com/ratersystem/validate'
const TEMPLATE_BASE   = '/ratersystem'

function validationUrl(certNumber: string) {
  return `${VALIDATION_BASE}/${certNumber}`
}

export function CertificatesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName]             = useState('')
  const [date, setDate]             = useState('')
  const [certType, setCertType]     = useState<CertTypeValue>('1')
  const [pin]                       = useState(() => generatePIN())
  const [certNumber]                = useState(() => generateCertNumber())
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated]   = useState<{ certNumber: string; pin: string } | null>(null)
  const [copied, setCopied]         = useState<string | null>(null)

  // ── SharePoint state ─────────────────────────────────────────────────────
  const [msAccount, setMsAccount]       = useState(() => getMsAccount())
  useEffect(() => { setMsAccount(getMsAccount()) }, [])
  const [msSignInErr, setMsSignInErr]   = useState<string | null>(null)
  const [certSpUrl, setCertSpUrl]       = useState<string | null>(null)
  const [certSpErr, setCertSpErr]       = useState<string | null>(null)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)

  async function handleMsSignIn() {
    setMsSignInErr(null)
    try {
      const account = await msSignIn()
      setMsAccount(account)
    } catch (err) {
      setMsSignInErr(err instanceof Error ? err.message : 'Microsoft sign-in failed')
    }
  }

  async function handleMsSignOut() {
    await msSignOut()
    setMsAccount(null)
  }

  const { data: records = [] } = useQuery({
    queryKey: ['certificates'],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'certificates'), where('certNumber', '>=', 'L')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as CertRecord)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
    },
  })

  const selectedType = useMemo(() => CERT_TYPES.find(t => t.value === certType)!, [certType])

  async function handleGenerate() {
    if (!name.trim() || !date.trim()) return
    setGenerating(true)
    setCertSpUrl(null)
    setCertSpErr(null)
    try {
      const templateUrl = await resolveTemplateUrl(certType, TEMPLATE_BASE)
      const pdf = await buildCertPDF({
        name: name.trim(),
        date: date.trim(),
        pin,
        certNumber,
        certType,
        validationUrl: validationUrl(certNumber),
        basePath: TEMPLATE_BASE,
        templateUrl,
      })

      const filename = `${selectedType.label} - ${name.trim()} - ${certNumber}.pdf`
      pdf.save(filename)

      let spUrl: string | null = null
      if (msAccount) {
        try {
          const blob = pdf.output('blob')
          spUrl = await uploadToSharePoint(blob, filename, SP_FOLDERS_CERT[certType])
          setCertSpUrl(spUrl)
        } catch (err) {
          setCertSpErr(err instanceof Error ? err.message : 'SharePoint upload failed')
        }
      }

      await addDoc(collection(db, 'certificates'), {
        certNumber,
        pin,
        name: name.trim(),
        date: date.trim(),
        certType,
        certTypeName: selectedType.label,
        createdBy: user?.uid ?? '',
        ...(spUrl ? { sharePointUrl: spUrl } : {}),
        createdAt: serverTimestamp(),
      })

      setGenerated({ certNumber, pin })
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
    } finally {
      setGenerating(false)
    }
  }

  async function handleRegenerate(rec: CertRecord) {
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

  async function handleDelete(rec: CertRecord) {
    if (!confirm(`Delete certificate ${rec.certNumber} for ${rec.name}?`)) return
    await deleteDoc(doc(db, 'certificates', rec.id))
    queryClient.invalidateQueries({ queryKey: ['certificates'] })
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  async function copyLink(url: string, id: string) {
    await navigator.clipboard.writeText(url)
    setCopiedLinkId(id)
    setTimeout(() => setCopiedLinkId(null), 2000)
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Certificates</h1>
          <p className="text-muted-foreground text-sm mt-1">Generate and manage Lenguax certificates.</p>
        </div>
        <Button variant="outline" size="sm" render={<a href="https://lenguax.com/cert_generator" target="_blank" rel="noreferrer" />}>
          <ExternalLink className="size-4 mr-1.5" />
          Old system
        </Button>
      </div>

      {/* SharePoint connection bar */}
      {msSignInErr && <p className="text-xs text-red-600">{msSignInErr}</p>}
      <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        {msAccount ? (
          <>
            <span className="text-muted-foreground">
              SharePoint: <span className="text-foreground font-medium">{msAccount.username}</span>
            </span>
            <button type="button" onClick={handleMsSignOut} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <LogOut className="size-3" /> Disconnect
            </button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Auto-save to SharePoint</span>
            <button type="button" onClick={handleMsSignIn} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <CloudUpload className="size-3.5" /> Connect
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

        {/* ── LEFT: form ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <p className="text-sm font-medium">New certificate</p>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Certificate type</label>
            <select
              value={certType}
              onChange={e => setCertType(e.target.value as CertTypeValue)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Full name</label>
            <Input placeholder="e.g. Jane Smith" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Course date(s)</label>
            <Input placeholder="e.g. 12–14 March 2026" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Certificate number</label>
              <Input value={certNumber} readOnly className="font-mono opacity-70 cursor-default" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">PIN (auto-generated)</label>
              <Input value={pin} readOnly className="font-mono opacity-70 cursor-default" />
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!name.trim() || !date.trim() || generating}
            className="w-full"
          >
            {generating ? 'Generating…' : 'Generate & download certificate'}
          </Button>

          {/* Template preview */}
          <div className="rounded-md border overflow-hidden">
            <img
              src={`${TEMPLATE_BASE}/${selectedType.template}`}
              alt={selectedType.label}
              className="w-full opacity-80"
            />
          </div>
        </div>

        {/* ── RIGHT: result ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          {generated ? (
            <div className="rounded-md border p-5 space-y-4">
              <p className="text-sm font-medium text-green-700">Certificate generated</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Certificate number</span>
                  <span className="font-mono font-medium">{generated.certNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">PIN</span>
                  <span className="font-mono font-medium">{generated.pin}</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Validation URL</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">
                    {validationUrl(generated.certNumber)}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copyText(validationUrl(generated.certNumber), 'url')}>
                    {copied === 'url' ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </div>
              {certSpUrl && (
                <a href={certSpUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-green-700 font-medium hover:underline">
                  <CloudUpload className="size-3.5" /> Saved to SharePoint
                </a>
              )}
              {certSpErr && <p className="text-xs text-red-600">{certSpErr}</p>}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
              Fill in the form and generate a certificate to see the result here.
            </div>
          )}

          {/* Records table */}
          {records.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Recent certificates</p>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Number</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Date</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(rec => (
                      <tr key={rec.id} className="border-b hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono">{rec.certNumber}</td>
                        <td className="px-2 py-1.5">{rec.name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{rec.certTypeName}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{rec.date}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-2">
                            {rec.sharePointUrl && (
                              <>
                                <a href={rec.sharePointUrl} target="_blank" rel="noreferrer" title="Open in SharePoint" className="text-muted-foreground hover:text-primary">
                                  <CloudUpload className="size-3.5" />
                                </a>
                                <button
                                  title="Copy SharePoint link"
                                  onClick={() => copyLink(rec.sharePointUrl!, rec.id)}
                                  className="text-muted-foreground hover:text-primary"
                                >
                                  {copiedLinkId === rec.id ? <Check className="size-3.5 text-green-600" /> : <Link className="size-3.5" />}
                                </button>
                              </>
                            )}
                            <button title="Re-download PDF" onClick={() => handleRegenerate(rec)} className="text-muted-foreground hover:text-foreground">
                              <Download className="size-3.5" />
                            </button>
                            <button title="Delete record" onClick={() => handleDelete(rec)} className="text-muted-foreground hover:text-red-600">
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
