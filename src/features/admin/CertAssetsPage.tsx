import { useState } from 'react'
import { ref, uploadBytes, getDownloadURL, listAll } from 'firebase/storage'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { storage, db } from '@/lib/firebase'
import { CERT_TYPES, type CertTypeValue } from '@/features/certificates/certGen'
import { Button } from '@/components/ui/button'
import { Upload, Download, FileImage, FileText } from 'lucide-react'

interface AssetRow {
  certType: CertTypeValue
  label: string
  defaultTemplate: string
  templateOverrideUrl: string | null
  psdUrl: string | null
  psdName: string | null
  displayUrl: string | null
}

async function loadAssets(): Promise<AssetRow[]> {
  const [overridesSnap, storageItems] = await Promise.all([
    getDoc(doc(db, 'cert_config', 'templates')),
    Promise.all(
      CERT_TYPES.map(async ct => {
        const psdRef = ref(storage, `cert-psd/${ct.value}`)
        const displayRef = ref(storage, `cert-display/${ct.value}`)
        const [psdList, displayList] = await Promise.all([
          listAll(psdRef).catch(() => ({ items: [] })),
          listAll(displayRef).catch(() => ({ items: [] })),
        ])
        const psd    = psdList.items[0]
        const disp   = displayList.items[0]
        const [psdUrl, displayUrl] = await Promise.all([
          psd   ? getDownloadURL(psd)  : Promise.resolve(null),
          disp  ? getDownloadURL(disp) : Promise.resolve(null),
        ])
        return { certType: ct.value as CertTypeValue, psdUrl, psdName: psd?.name ?? null, displayUrl }
      })
    ),
  ])
  const overrides = overridesSnap.exists() ? (overridesSnap.data() as Record<string, string>) : {}
  return CERT_TYPES.map((ct, i) => ({
    certType: ct.value as CertTypeValue,
    label: ct.label,
    defaultTemplate: ct.template,
    templateOverrideUrl: overrides[ct.value] ?? null,
    psdUrl: storageItems[i].psdUrl,
    psdName: storageItems[i].psdName,
    displayUrl: storageItems[i].displayUrl,
  }))
}

export function CertAssetsPage() {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState<Record<string, boolean>>({})

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cert-assets'],
    queryFn: loadAssets,
  })

  function setUploadingKey(key: string, val: boolean) {
    setUploading(p => ({ ...p, [key]: val }))
  }

  async function handleTemplateUpload(certType: CertTypeValue, file: File) {
    const key = `template-${certType}`
    setUploadingKey(key, true)
    try {
      const storageRef = ref(storage, `cert-templates/${certType}.jpg`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      const snap = await getDoc(doc(db, 'cert_config', 'templates'))
      const current = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'cert_config', 'templates'), { ...current, [certType]: url })
      queryClient.invalidateQueries({ queryKey: ['cert-assets'] })
    } catch (err) {
      alert(`Template upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploadingKey(key, false)
    }
  }

  async function handleDisplayUpload(certType: CertTypeValue, file: File) {
    const key = `display-${certType}`
    setUploadingKey(key, true)
    try {
      const storageRef = ref(storage, `cert-display/${certType}/${file.name}`)
      await uploadBytes(storageRef, file)
      queryClient.invalidateQueries({ queryKey: ['cert-assets'] })
    } catch (err) {
      alert(`Display upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploadingKey(key, false)
    }
  }

  async function handlePsdUpload(certType: CertTypeValue, file: File) {
    const key = `psd-${certType}`
    setUploadingKey(key, true)
    try {
      const storageRef = ref(storage, `cert-psd/${certType}/${file.name}`)
      await uploadBytes(storageRef, file)
      queryClient.invalidateQueries({ queryKey: ['cert-assets'] })
    } catch (err) {
      alert(`PSD upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploadingKey(key, false)
    }
  }

  function pickFile(accept: string, onFile: (f: File) => void) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      document.body.removeChild(input)
      if (input.files?.[0]) onFile(input.files[0])
    }
    input.click()
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading assets…</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Certificate Assets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage templates, display images, and source files for each certificate type.
          Uploading a new template immediately overrides the PDF background for future certificates.
        </p>
      </div>

      <div className="space-y-4">
        {rows.map(row => (
          <div key={row.certType} className="border rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">Type {row.certType}</span>
              <h2 className="font-medium text-sm">{row.label}</h2>
              {row.templateOverrideUrl && (
                <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                  Custom template active
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

              {/* Template */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <FileImage className="size-3" />
                  Template (PDF background)
                </p>
                <div className="relative aspect-[210/297] bg-muted rounded overflow-hidden border">
                  <img
                    src={row.templateOverrideUrl ?? `/ratersystem/${row.defaultTemplate}`}
                    alt={row.label}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
                <div className="space-y-1">
                  {row.templateOverrideUrl ? (
                    <p className="text-xs text-muted-foreground truncate">
                      Custom: <a href={row.templateOverrideUrl} target="_blank" rel="noreferrer" className="hover:underline">Storage</a>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Default: {row.defaultTemplate}</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={uploading[`template-${row.certType}`]}
                    onClick={() => pickFile('image/jpeg,image/png', f => handleTemplateUpload(row.certType, f))}
                  >
                    <Upload className="size-3.5 mr-1.5" />
                    {uploading[`template-${row.certType}`] ? 'Uploading…' : 'Upload new template'}
                  </Button>
                </div>
              </div>

              {/* Display image */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <FileImage className="size-3" />
                  Display image
                </p>
                <div className="relative aspect-[210/297] bg-muted rounded overflow-hidden border">
                  {row.displayUrl ? (
                    <img src={row.displayUrl} alt="display" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                      None — uses template
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={uploading[`display-${row.certType}`]}
                  onClick={() => pickFile('image/jpeg,image/png', f => handleDisplayUpload(row.certType, f))}
                >
                  <Upload className="size-3.5 mr-1.5" />
                  {uploading[`display-${row.certType}`] ? 'Uploading…' : 'Upload display image'}
                </Button>
              </div>

              {/* PSD source */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <FileText className="size-3" />
                  Source file (.psd)
                </p>
                <div className="aspect-[210/297] bg-muted rounded border flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  {row.psdUrl ? (
                    <>
                      <FileText className="size-8 opacity-30" />
                      <p className="text-xs px-2 text-center break-all">{row.psdName}</p>
                      <a href={row.psdUrl} target="_blank" rel="noreferrer" download>
                        <Button size="sm" variant="outline" className="text-xs">
                          <Download className="size-3.5 mr-1.5" />
                          Download
                        </Button>
                      </a>
                    </>
                  ) : (
                    <p className="text-xs">No source file stored</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={uploading[`psd-${row.certType}`]}
                  onClick={() => pickFile('.psd,.psb,.ai,.pdf,.zip', f => handlePsdUpload(row.certType, f))}
                >
                  <Upload className="size-3.5 mr-1.5" />
                  {uploading[`psd-${row.certType}`] ? 'Uploading…' : 'Upload source file'}
                </Button>
              </div>

            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
