import { useEffect, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { db, storage } from '@/lib/firebase'
import type { Test } from '@/types'
import { formatTestNumber } from '@/lib/testNumber'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TEST_TYPES = ['PPL', 'Airline Pilot', 'Helicopter Pilot', 'Student Pilot', 'Aerodrome ATC', 'Approach ATC', 'Area ATC', 'Student ATCO', 'Airport Operations', 'ADP Driver'] as const

const schema = z.object({
  recordingUrl: z.string().min(1, 'Required'),
  candidateName: z.string().min(1, 'Required'),
  candidateNationality: z.string().min(1, 'Required'),
  testType: z.enum(TEST_TYPES),
  durationSeconds: z.number().min(0).optional(),
  status: z.enum(['active', 'retired']),
  category: z.enum(['rater_course', 'standardization']),
  // 'unset' is a form-only sentinel (Select can't bind to undefined) —
  // stripped back to undefined/null at the Firestore-payload boundary.
  courseTag: z.enum(['unset', 'rater_course', 'refresher_course', 'other']),
  dayLabel: z.string().optional(),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = {
  recordingUrl: '', candidateName: '', candidateNationality: '',
  testType: 'PPL', durationSeconds: undefined, status: 'active', category: 'rater_course',
  courseTag: 'unset', dayLabel: '', notes: '',
}

interface Props {
  open: boolean
  onClose: () => void
  test?: Test
}

export function TestDrawer({ open, onClose, test }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!test
  const [previewUrl, setPreviewUrl] = useState('')
  const [excludeFromPool, setExcludeFromPool] = useState(false)

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  const recordingUrlValue = watch('recordingUrl')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  function handleFileUpload(file: File) {
    const path = `tests/${Date.now()}_${file.name}`
    const ref = storageRef(storage, path)
    const task = uploadBytesResumable(ref, file)
    setUploadProgress(0)
    task.on(
      'state_changed',
      snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => setUploadProgress(null),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        setValue('recordingUrl', url, { shouldValidate: true })
        setUploadProgress(null)
      },
    )
  }

  useEffect(() => {
    if (open) {
      const vals: FormData = test ? {
        recordingUrl: test.recordingUrl,
        candidateName: test.candidateName,
        candidateNationality: test.candidateNationality,
        testType: test.testType,
        durationSeconds: test.durationSeconds,
        status: test.status,
        category: test.category ?? 'rater_course',
        courseTag: test.courseTag ?? 'unset',
        dayLabel: test.dayLabel ?? '',
        notes: test.notes ?? '',
      } : EMPTY
      reset(vals)
      setPreviewUrl(test?.recordingUrl ?? '')
      setExcludeFromPool(test?.excludeFromPool ?? false)
    }
  }, [open, test, reset])

  useEffect(() => { setPreviewUrl(recordingUrlValue) }, [recordingUrlValue])

  // Standardization tests are numbered in their own sequence (S1, S2…),
  // separate from the legacy rater-course numbers — auto-assigned here since
  // nothing else in the app assigns testId for a newly-created test.
  async function nextStandardizationNumber(): Promise<number> {
    const snap = await getDocs(query(collection(db, 'test_bank'), where('category', '==', 'standardization')))
    const nums = snap.docs.map(d => (d.data().testId as number | undefined) ?? 0)
    return Math.max(0, ...nums) + 1
  }

  async function onSubmit(data: FormData) {
    const payload = {
      recordingUrl: data.recordingUrl,
      candidateName: data.candidateName,
      candidateNationality: data.candidateNationality,
      testType: data.testType,
      durationSeconds: data.durationSeconds ?? null,
      status: data.status,
      category: data.category,
      courseTag: data.courseTag === 'unset' ? null : data.courseTag,
      dayLabel: data.dayLabel?.trim() || null,
      excludeFromPool,
      notes: data.notes ?? '',
    }
    if (isEdit) {
      await updateDoc(doc(db, 'test_bank', test.id), payload)
    } else {
      const testId = data.category === 'standardization' ? await nextStandardizationNumber() : undefined
      await addDoc(collection(db, 'test_bank'), {
        ...payload,
        ...(testId !== undefined ? { testId } : {}),
        canonicalDifficulty: null, canonicalSE: null, anchoredAt: null,
        createdAt: serverTimestamp(),
      })
    }
    queryClient.invalidateQueries({ queryKey: ['tests'] })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit test' : 'Add test'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
          {isEdit && test?.testId && (
            <p className="text-xs text-muted-foreground">Test {formatTestNumber(test.testId, test.category)}</p>
          )}
          <div className="space-y-1">
            <Label>Recording</Label>
            <div className="flex gap-2">
              <Input {...register('recordingUrl')} placeholder="https://… or upload below" className="flex-1" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Upload audio file"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress !== null}
              >
                <Upload className="size-4" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
              />
            </div>
            {uploadProgress !== null && (
              <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
            {errors.recordingUrl && <p className="text-xs text-destructive">{errors.recordingUrl.message}</p>}
            {previewUrl && <audio controls src={previewUrl} className="w-full mt-1" />}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Candidate name</Label>
              <Input {...register('candidateName')} />
              {errors.candidateName && <p className="text-xs text-destructive">{errors.candidateName.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Nationality</Label>
              <Input {...register('candidateNationality')} />
              {errors.candidateNationality && <p className="text-xs text-destructive">{errors.candidateNationality.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Test type</Label>
              <Controller name="testType" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1">
              <Label>Duration (seconds)</Label>
              <Input type="number" min={0} {...register('durationSeconds', {
                setValueAs: v => (v === '' ? undefined : Number(v)),
              })} />
              {errors.durationSeconds && <p className="text-xs text-destructive">{errors.durationSeconds.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rater_course">Rater course</SelectItem>
                    <SelectItem value="standardization">Standardization</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Used in</Label>
              <Controller name="courseTag" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">—</SelectItem>
                    <SelectItem value="rater_course">Rater course</SelectItem>
                    <SelectItem value="refresher_course">Refresher course</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1">
              <Label>Day</Label>
              <Input {...register('dayLabel')} placeholder="e.g. Day 1" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludeFromPool}
              onChange={e => setExcludeFromPool(e.target.checked)}
              className="rounded"
            />
            <span>Exclude from rater course pool</span>
          </label>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea {...register('notes')} rows={3} />
          </div>

          <SheetFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
