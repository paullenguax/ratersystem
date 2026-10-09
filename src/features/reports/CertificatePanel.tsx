import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Download, CloudUpload, Link, Share2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SharePointBar } from '@/components/SharePointBar'
import { useMsConnection } from '@/lib/useMsConnection'
import { CERT_TYPES, type CertTypeValue } from '@/features/certificates/certGen'
import {
  type IssuedCertificate,
  issueCertificate, downloadCertificate, useRaterCertificates, validationUrl,
} from '@/features/certificates/issueCertificate'

// Issues the rater's certificate straight from the feedback email screen.
// The parent keys this by event + rater, so the form resets on every switch.
export function CertificatePanel({ raterId, raterName, sessionName, isRefresher }: {
  raterId: string
  raterName: string
  sessionName: string
  isRefresher: boolean
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const ms = useMsConnection()

  const [name, setName] = useState(raterName)
  const [date, setDate] = useState('')
  // Follows the Refresher tick box until a type is picked by hand
  // (the Interlocutor variants can't be inferred from anything on this screen).
  const [typeOverride, setTypeOverride] = useState<CertTypeValue | null>(null)
  const certType: CertTypeValue = typeOverride ?? (isRefresher ? '3' : '1')
  const [generating, setGenerating] = useState(false)
  const [issued, setIssued]         = useState<IssuedCertificate | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [copiedId, setCopiedId]     = useState<string | null>(null)

  const { data: existing = [] } = useRaterCertificates(raterId)
  const issuedForEvent = existing.some(c => c.sessionName === sessionName)

  async function handleGenerate() {
    if (!name.trim() || !date.trim()) return
    if (issuedForEvent && !confirm(`${name.trim()} already has a certificate for this event. Issue another one?`)) return
    setGenerating(true)
    setError(null)
    try {
      const result = await issueCertificate({
        name, date, certType,
        upload: ms.status === 'connected',
        issuedBy: user?.uid ?? '',
        raterId,
        sessionName,
      })
      setIssued(result)
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the certificate')
    } finally {
      setGenerating(false)
    }
  }

  async function copyLink(url: string, id: string) {
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Certificate</p>

      <SharePointBar ms={ms} signedOutText="Not signed in — certificates won't auto-save to SharePoint" />

      {existing.length > 0 && (
        <div className="rounded-md border divide-y text-xs">
          {existing.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span>
                <span className="font-mono font-medium">{c.certNumber}</span>
                <span className="text-muted-foreground"> · {c.certTypeName} · {c.date}</span>
                {c.sessionName !== sessionName && <span className="text-muted-foreground"> · {c.sessionName}</span>}
              </span>
              <span className="flex items-center gap-2">
                {c.shareLink && (
                  <button title="Copy shareable link" onClick={() => copyLink(c.shareLink!, `share-${c.id}`)} className="text-muted-foreground hover:text-primary">
                    {copiedId === `share-${c.id}` ? <Check className="size-3.5 text-green-600" /> : <Share2 className="size-3.5" />}
                  </button>
                )}
                {c.sharePointUrl && (
                  <>
                    <a href={c.sharePointUrl} target="_blank" rel="noreferrer" title="Open in SharePoint" className="text-muted-foreground hover:text-primary">
                      <CloudUpload className="size-3.5" />
                    </a>
                    <button title="Copy SharePoint link" onClick={() => copyLink(c.sharePointUrl!, `sp-${c.id}`)} className="text-muted-foreground hover:text-primary">
                      {copiedId === `sp-${c.id}` ? <Check className="size-3.5 text-green-600" /> : <Link className="size-3.5" />}
                    </button>
                  </>
                )}
                <button title="Download PDF" onClick={() => downloadCertificate(c)} className="text-muted-foreground hover:text-foreground">
                  <Download className="size-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Certificate type</label>
          <select
            value={certType}
            onChange={e => setTypeOverride(e.target.value as CertTypeValue)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Course date(s)</label>
          <Input placeholder="e.g. 12–14 March 2026" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Name on certificate</label>
        <Input value={name} onChange={e => setName(e.target.value)} />
      </div>

      <Button
        onClick={handleGenerate}
        disabled={!name.trim() || !date.trim() || generating}
        variant={issuedForEvent ? 'outline' : 'default'}
        className="w-full"
      >
        {generating ? 'Generating…' : issuedForEvent ? 'Issue another certificate' : 'Generate certificate'}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {issued && (
        <div className="rounded-md border p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <p className="font-medium text-green-700">
              Certificate {issued.certNumber} generated <span className="font-normal text-muted-foreground">· PIN {issued.pin}</span>
            </p>
            <Button size="sm" variant="outline" onClick={() => issued.pdf.save(issued.filename)}>
              <Download className="size-3.5 mr-1" /> Download PDF
            </Button>
          </div>
          {issued.sharePointUrl && (
            <a href={issued.sharePointUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-green-700 font-medium hover:underline">
              <CloudUpload className="size-3.5" /> Saved to SharePoint
            </a>
          )}
          <div className="space-y-1">
            <p className="text-muted-foreground">Validation URL</p>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-2 py-1 rounded flex-1 break-all">{validationUrl(issued.certNumber)}</code>
              <Button size="sm" variant="outline" onClick={() => copyLink(validationUrl(issued.certNumber), 'url')}>
                {copiedId === 'url' ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          {issued.shareLink && (
            <div className="space-y-1 border-t pt-2">
              <p className="text-muted-foreground flex items-center gap-1.5">
                <Share2 className="size-3.5" /> Shareable link (no sign-in required) — expires {new Date(issued.shareLink.expiresAt).toLocaleDateString()}
              </p>
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1 rounded flex-1 break-all">{issued.shareLink.url}</code>
                <Button size="sm" variant="outline" onClick={() => copyLink(issued.shareLink!.url, 'shareLink')}>
                  {copiedId === 'shareLink' ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          )}
          {issued.sharePointErr && <p className="text-red-600">{issued.sharePointErr}</p>}
          {issued.shareLinkErr && <p className="text-red-600 whitespace-pre-wrap">{issued.shareLinkErr}</p>}
        </div>
      )}
    </div>
  )
}
