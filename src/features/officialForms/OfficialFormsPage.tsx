import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, deleteDoc, doc, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Copy, Check, Download, Trash2, ExternalLink, CloudUpload, LogOut } from 'lucide-react'
import { buildCaa5012PDF, buildCaa5012Filename, buildCaa5012DisplayName } from './caa5012Gen'
import { buildDgac87iPDF, buildDgac87iFilename, buildDgac87iEmail, buildDgac87iDisplayName } from './dgac87iGen'
import { msSignIn, msSignOut, getMsAccount } from '@/lib/msal'
import { uploadCaaToOneDrive } from '@/lib/oneDrive'

const BASE = '/ratersystem'

type FormTab = 'caa5012' | 'dgac87i'

interface FormRecord {
  id: string
  formType: FormTab
  name: string
  level: string
  createdAt: { seconds: number } | null
  // caa fields
  forenames?: string
  surname?: string
  dateOfAssessment?: string
  evaluator?: string
  dateOfIssue?: string
  // dgac fields
  candidateTitle?: string
  candidateName?: string
  dateOfTest?: string
  teacCity?: string
  candidateEmail?: string
}

export function OfficialFormsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<FormTab>('caa5012')

  // ── CAA 5012 state ──────────────────────────────────────────────────────
  const [caaForenames, setCaaForenames]     = useState('')
  const [caaSurname, setCaaSurname]         = useState('')
  const [caaAssessDate, setCaaAssessDate]   = useState('')
  const [caaLevel, setCaaLevel]             = useState<'4'|'5'|'6'>('4')
  const [caaEvaluator, setCaaEvaluator]     = useState('BEN RIMRON')
  const [caaIssueDate, setCaaIssueDate]     = useState('')
  const [caaGenerating, setCaaGenerating]   = useState(false)
  const [caaBlobUrl, setCaaBlobUrl]         = useState<string | null>(null)
  const [caaOneDriveUrl, setCaaOneDriveUrl] = useState<string | null>(null)
  const [caaOneDriveErr, setCaaOneDriveErr] = useState<string | null>(null)

  // ── Microsoft / OneDrive state ───────────────────────────────────────────
  const [msAccount, setMsAccount]           = useState(() => getMsAccount())

  useEffect(() => { setMsAccount(getMsAccount()) }, [])

  async function handleMsSignIn() {
    const account = await msSignIn()
    setMsAccount(account)
  }

  async function handleMsSignOut() {
    await msSignOut()
    setMsAccount(null)
  }

  // ── DGAC 87i state ──────────────────────────────────────────────────────
  const [dgacTitle, setDgacTitle]           = useState<'Mr'|'Mrs'>('Mr')
  const [dgacName, setDgacName]             = useState('')
  const [dgacTestDate, setDgacTestDate]     = useState('')
  const [dgacCity, setDgacCity]             = useState('')
  const [dgacLevel, setDgacLevel]           = useState<'4'|'5'|'6'>('4')
  const [dgacEmail, setDgacEmail]           = useState('')
  const [dgacGenerating, setDgacGenerating] = useState(false)
  const [dgacBlobUrl, setDgacBlobUrl]       = useState<string | null>(null)
  const [dgacEmailText, setDgacEmailText]   = useState('')
  const [dgacFilename, setDgacFilename]     = useState('')
  const [copiedEmail, setCopiedEmail]       = useState(false)

  // ── Records ─────────────────────────────────────────────────────────────
  const { data: records = [] } = useQuery({
    queryKey: ['official_forms'],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'official_forms'), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as FormRecord)
    },
  })

  async function handleDeleteRecord(id: string) {
    if (!confirm('Delete this record?')) return
    await deleteDoc(doc(db, 'official_forms', id))
    queryClient.invalidateQueries({ queryKey: ['official_forms'] })
  }

  // ── CAA generate ────────────────────────────────────────────────────────
  async function handleCaaGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!caaForenames || !caaSurname || !caaAssessDate || !caaIssueDate) return
    setCaaGenerating(true)
    setCaaOneDriveUrl(null)
    setCaaOneDriveErr(null)
    if (caaBlobUrl) URL.revokeObjectURL(caaBlobUrl)
    try {
      const pdf = await buildCaa5012PDF({
        forenames: caaForenames, surname: caaSurname,
        dateOfAssessment: caaAssessDate, level: caaLevel,
        evaluator: caaEvaluator, dateOfIssue: caaIssueDate,
        basePath: BASE,
      })
      const filename = buildCaa5012Filename({
        forenames: caaForenames.toUpperCase(), surname: caaSurname.toUpperCase(),
        dateOfAssessment: caaAssessDate, level: caaLevel,
        evaluator: caaEvaluator, dateOfIssue: caaIssueDate, basePath: BASE,
      })
      const blob = pdf.output('blob')
      const url  = URL.createObjectURL(blob)
      setCaaBlobUrl(url)
      pdf.save(filename)

      if (msAccount) {
        try {
          const odUrl = await uploadCaaToOneDrive(blob, filename)
          setCaaOneDriveUrl(odUrl)
        } catch (err) {
          setCaaOneDriveErr(err instanceof Error ? err.message : 'OneDrive upload failed')
        }
      }

      await addDoc(collection(db, 'official_forms'), {
        formType: 'caa5012',
        name: buildCaa5012DisplayName({ forenames: caaForenames, surname: caaSurname }),
        level: `Level ${caaLevel}`,
        forenames: caaForenames.trim().toUpperCase(),
        surname: caaSurname.trim().toUpperCase(),
        dateOfAssessment: caaAssessDate, evaluator: caaEvaluator,
        dateOfIssue: caaIssueDate,
        createdAt: serverTimestamp(),
      })
      queryClient.invalidateQueries({ queryKey: ['official_forms'] })
    } finally {
      setCaaGenerating(false)
    }
  }

  // ── DGAC generate ───────────────────────────────────────────────────────
  async function handleDgacGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!dgacName || !dgacTestDate || !dgacCity || !dgacEmail) return
    setDgacGenerating(true)
    if (dgacBlobUrl) URL.revokeObjectURL(dgacBlobUrl)
    try {
      const pdfBytes = await buildDgac87iPDF({
        candidateTitle: dgacTitle, candidateName: dgacName,
        dateOfTest: dgacTestDate, teacCity: dgacCity,
        level: dgacLevel, candidateEmail: dgacEmail,
        basePath: BASE,
      })
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      setDgacBlobUrl(url)

      const filename = buildDgac87iFilename({
        candidateTitle: dgacTitle, candidateName: dgacName.trim().toUpperCase(),
        dateOfTest: dgacTestDate, teacCity: dgacCity, level: dgacLevel,
        candidateEmail: dgacEmail, basePath: BASE,
      })
      setDgacFilename(filename)

      // Trigger download
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()

      const emailText = buildDgac87iEmail(`(see attachment)`)
      setDgacEmailText(emailText)

      await addDoc(collection(db, 'official_forms'), {
        formType: 'dgac87i',
        name: buildDgac87iDisplayName({ candidateTitle: dgacTitle, candidateName: dgacName }),
        level: `Level ${dgacLevel}`,
        candidateTitle: dgacTitle, candidateName: dgacName.trim().toUpperCase(),
        dateOfTest: dgacTestDate, teacCity: dgacCity.trim().toUpperCase(),
        candidateEmail: dgacEmail,
        createdAt: serverTimestamp(),
      })
      queryClient.invalidateQueries({ queryKey: ['official_forms'] })
    } finally {
      setDgacGenerating(false)
    }
  }

  async function handleCopyEmail() {
    await navigator.clipboard.writeText(dgacEmailText)
    setCopiedEmail(true)
    setTimeout(() => setCopiedEmail(false), 2500)
  }

  const mailtoHref = useMemo(() => {
    if (!dgacEmail || !dgacEmailText) return '#'
    const subj = encodeURIComponent('Your English Language Proficiency Certificate - Guidance for your DGAC Application')
    const body = encodeURIComponent(dgacEmailText)
    return `mailto:${encodeURIComponent(dgacEmail)}?subject=${subj}&body=${body}`
  }, [dgacEmail, dgacEmailText])

  const caaRecords  = records.filter(r => r.formType === 'caa5012')
  const dgacRecords = records.filter(r => r.formType === 'dgac87i')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Official Forms</h1>
        <p className="text-sm text-muted-foreground mt-1">Generate UK CAA 5012 and DGAC 87i-Formlic forms.</p>
      </div>

      {/* Tab selector */}
      <div className="flex gap-2 border-b pb-1">
        {(['caa5012', 'dgac87i'] as FormTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-t text-sm font-medium transition-colors ${
              tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {t === 'caa5012' ? 'UK CAA 5012' : 'DGAC 87i-Formlic'}
          </button>
        ))}
      </div>

      {/* ── CAA 5012 ─────────────────────────────────────────────────────── */}
      {tab === 'caa5012' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <form onSubmit={handleCaaGenerate} className="space-y-4">
            {/* OneDrive connection */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              {msAccount ? (
                <>
                  <span className="text-muted-foreground">
                    OneDrive: <span className="text-foreground font-medium">{msAccount.username}</span>
                  </span>
                  <button type="button" onClick={handleMsSignOut} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <LogOut className="size-3" /> Disconnect
                  </button>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">Auto-save to OneDrive</span>
                  <button type="button" onClick={handleMsSignIn} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                    <CloudUpload className="size-3.5" /> Connect
                  </button>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Candidate Forenames</label>
                <Input placeholder="e.g. James Edward" value={caaForenames} onChange={e => setCaaForenames(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Candidate Surname</label>
                <Input placeholder="e.g. Smith" value={caaSurname} onChange={e => setCaaSurname(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date of Assessment</label>
                <Input type="date" value={caaAssessDate} onChange={e => setCaaAssessDate(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date of Issue</label>
                <Input type="date" value={caaIssueDate} onChange={e => setCaaIssueDate(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Level Achieved</label>
              <div className="flex gap-4">
                {(['4','5','6'] as const).map(lvl => (
                  <label key={lvl} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="caa-level" value={lvl} checked={caaLevel===lvl} onChange={() => setCaaLevel(lvl)} />
                    Level {lvl}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Evaluator</label>
              <select
                value={caaEvaluator}
                onChange={e => setCaaEvaluator(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="TYRONE BISHOP">Tyrone Bishop</option>
                <option value="BEN RIMRON">Ben Rimron</option>
                <option value="PAUL READ">Paul Read</option>
              </select>
            </div>
            <Button type="submit" disabled={caaGenerating} className="w-full">
              {caaGenerating ? 'Generating…' : 'Generate CAA 5012'}
            </Button>
          </form>

          <div className="space-y-3">
            {caaBlobUrl && (
              <>
                <div className="flex gap-2">
                  <a href={caaBlobUrl} download className="flex-1">
                    <Button variant="outline" className="w-full">
                      <Download className="size-4 mr-1.5" /> Re-download PDF
                    </Button>
                  </a>
                </div>
                {caaOneDriveUrl && (
                  <a href={caaOneDriveUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-green-700 font-medium hover:underline">
                    <CloudUpload className="size-3.5" /> Saved to OneDrive
                  </a>
                )}
                {caaOneDriveErr && (
                  <p className="text-xs text-red-600">{caaOneDriveErr}</p>
                )}
                <iframe src={caaBlobUrl} title="CAA 5012 preview" className="w-full border rounded" style={{ height: '600px' }} />
              </>
            )}
            {!caaBlobUrl && (
              <div className="rounded-md border border-dashed p-16 text-center text-sm text-muted-foreground">
                Fill the form and generate to see a preview here.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DGAC 87i ─────────────────────────────────────────────────────── */}
      {tab === 'dgac87i' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <form onSubmit={handleDgacGenerate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Candidate Title</label>
                <div className="flex gap-4 pt-1">
                  {(['Mr','Mrs'] as const).map(t => (
                    <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="dgac-title" value={t} checked={dgacTitle===t} onChange={() => setDgacTitle(t)} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Candidate Full Name</label>
                <Input placeholder="e.g. DUPONT Jean-Pierre" value={dgacName} onChange={e => setDgacName(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date of Test</label>
                <Input type="date" value={dgacTestDate} onChange={e => setDgacTestDate(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">TEAC Centre City</label>
                <Input placeholder="e.g. Bratislava" value={dgacCity} onChange={e => setDgacCity(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Level — FCL.055(b)</label>
              <div className="flex gap-4">
                {(['4','5','6'] as const).map(lvl => (
                  <label key={lvl} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="dgac-level" value={lvl} checked={dgacLevel===lvl} onChange={() => setDgacLevel(lvl)} />
                    Level {lvl}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Candidate Email</label>
              <Input type="email" placeholder="candidate@example.com" value={dgacEmail} onChange={e => setDgacEmail(e.target.value)} required />
            </div>
            <Button type="submit" disabled={dgacGenerating} className="w-full">
              {dgacGenerating ? 'Generating…' : 'Generate 87i & Draft Email'}
            </Button>
          </form>

          <div className="space-y-4">
            {dgacBlobUrl && (
              <>
                <div className="flex gap-2 flex-wrap">
                  <a href={dgacBlobUrl} download={dgacFilename}>
                    <Button variant="outline" size="sm"><Download className="size-4 mr-1.5" />Re-download PDF</Button>
                  </a>
                  <a href="https://www.ecologie.gouv.fr/sites/default/files/documents/86iFormlic.pdf" target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm"><ExternalLink className="size-4 mr-1.5" />86iFORMLIC blank</Button>
                  </a>
                </div>

                {dgacEmailText && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Draft email</p>
                      <div className="flex gap-2">
                        <a href={mailtoHref}><Button size="sm" variant="outline" className="text-xs">Open in Outlook</Button></a>
                        <Button size="sm" variant="outline" className="text-xs" onClick={handleCopyEmail}>
                          {copiedEmail ? <><Check className="size-3.5 mr-1" />Copied</> : <><Copy className="size-3.5 mr-1" />Copy body</>}
                        </Button>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p><span className="font-medium">From:</span> testsubmissions@lenguax.com</p>
                      <p><span className="font-medium">To:</span> {dgacEmail}</p>
                      <p><span className="font-medium">Subject:</span> Your English Language Proficiency Certificate - Guidance for your DGAC Application</p>
                      <p className="text-amber-600 font-medium">⚠ Attach 87iFORMLIC manually before sending</p>
                    </div>
                    <Textarea value={dgacEmailText} readOnly rows={14} className="font-mono text-xs resize-none bg-muted/30" />
                  </div>
                )}
              </>
            )}
            {!dgacBlobUrl && (
              <div className="rounded-md border border-dashed p-16 text-center text-sm text-muted-foreground">
                Fill the form and generate to see the draft email here.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Records ──────────────────────────────────────────────────────── */}
      {records.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-medium text-sm">Records</h2>
            <span className="text-xs text-muted-foreground">{records.length} total</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(['caa5012', 'dgac87i'] as FormTab[]).map(ft => {
              const rows = ft === 'caa5012' ? caaRecords : dgacRecords
              if (rows.length === 0) return null
              return (
                <div key={ft} className="border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-muted text-xs font-medium">
                    {ft === 'caa5012' ? 'UK CAA 5012' : 'DGAC 87i-Formlic'} ({rows.length})
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="px-3 py-1.5 text-left font-medium">Name</th>
                        <th className="px-3 py-1.5 text-left font-medium">Level</th>
                        <th className="px-3 py-1.5 text-left font-medium">Date</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(rec => (
                        <tr key={rec.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-1.5 font-mono">{rec.name}</td>
                          <td className="px-3 py-1.5">{rec.level}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {rec.createdAt ? new Date(rec.createdAt.seconds * 1000).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              title="Delete record"
                              onClick={() => handleDeleteRecord(rec.id)}
                              className="text-muted-foreground hover:text-red-600"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
