import { useRef, useState } from 'react'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { Upload } from 'lucide-react'
import { storage } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  label: string
  accept: string
  value?: string
  storagePathPrefix: string
  onChange: (url: string) => void
  disabled?: boolean
}

export function MediaUploadField({ label, accept, value, storagePathPrefix, onChange, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  function handleFileUpload(file: File) {
    const path = `${storagePathPrefix}${Date.now()}_${file.name}`
    const task = uploadBytesResumable(storageRef(storage, path), file)
    setUploadProgress(0)
    task.on(
      'state_changed',
      snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => setUploadProgress(null),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        onChange(url)
        setUploadProgress(null)
      },
    )
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="https://… or upload below"
          className="flex-1"
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          title={`Upload ${label.toLowerCase()}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploadProgress !== null}
        >
          <Upload className="size-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
        />
      </div>
      {uploadProgress !== null && (
        <div className="w-full bg-muted rounded-full h-1.5 mt-1">
          <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
        </div>
      )}
      {value && accept.startsWith('image') && (
        <img src={value} alt={label} className="mt-1 max-h-32 rounded border object-contain" />
      )}
      {value && accept.startsWith('audio') && (
        <audio controls src={value} className="w-full mt-1" />
      )}
    </div>
  )
}
