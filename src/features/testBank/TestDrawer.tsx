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
import { CATEGORY_LABELS, LEGACY_COURSE_TAG_LABELS, type TestCategory } from '@/lib/testPool'
import { HeardBySection } from '@/features/courses/CourseExposure'
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
  testId: z.number().min(1).optional(),
  category: z.enum(['rater_course', 'standardization', 'training']),
  // 'none' is a form-only sentinel (Select can't bind to undefined) —
  // stripped back to null at the Firestore-payload boundary.
  raterCourseDay: z.enum(['none', '1', '2', '3', '4', '5']),
  refresherNumber: z.number().int().min(1).optional(),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = {
  recordingUrl: '', candidateName: '', candidateNationality: '',
  testType: 'PPL', durationSeconds: undefined, status: 'active', testId: undefined, category: 'rater_course',
  raterCourseDay: 'none', refresherNumber: undefined, notes: '',
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

  const { register, handleSubmit, control, reset, watch, setValue, setError, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  const recordingUrlValue = watch('recordingUrl')
  const categoryValue = watch('category')
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
        durationSeconds: test.durationSeconds ?? undefined,
        status: test.status,
        testId: test.testId ?? undefined,
        category: test.category ?? 'rater_course',
        raterCourseDay: test.raterCourseDay ? String(test.raterCourseDay) as FormData['raterCourseDay'] : 'none',
        refresherNumber: test.refresherNumber ?? undefined,
        notes: test.notes ?? '',
      } : EMPTY
      reset(vals)
      setPreviewUrl(test?.recordingUrl ?? '')
      setExcludeFromPool(test?.excludeFromPool ?? false)
    }
  }, [open, test, reset])

  useEffect(() => { setPreviewUrl(recordingUrlValue) }, [recordingUrlValue])

  // In-session and Training tests are each numbered in their own sequence
  // (S1, S2… / T1, T2…), separate from the legacy Certification numbers —
  // auto-assigned here whenever the number is left blank, whether that's a
  // brand-new test or an existing test being switched into the category
  // (which otherwise carries its old id straight into the new namespace,
  // where it usually collides with a number already in use there).
  async function nextCategoryNumber(category: 'standardization' | 'training'): Promise<number> {
    const snap = await getDocs(query(collection(db, 'test_bank'), where('category', '==', category)))
    const nums = snap.docs.map(d => (d.data().testId as number | undefined) ?? 0)
    return Math.max(0, ...nums) + 1
  }

  // "#3" and "S3" are separate namespaces (one per category) — a duplicate
  // is only a problem within the same category, not across both. Fetches the
  // whole collection rather than a `where('category', ...)` query because
  // most legacy rater-course tests have no `category` field at all (it's
  // treated as 'rater_course' by convention everywhere it's read) — a
  // Firestore equality filter would miss them and let a collision through.
  async function findDuplicateTestNumber(category: FormData['category'], testId: number): Promise<boolean> {
    const snap = await getDocs(collection(db, 'test_bank'))
    return snap.docs.some(d => {
      if (d.id === test?.id) return false
      const data = d.data()
      return ((data.category as Test['category']) ?? 'rater_course') === category && data.testId === testId
    })
  }

  async function onSubmit(data: FormData) {
    // A manually typed number always wins (this is also how the 3
    // standardization tests created before auto-numbering existed get
    // backfilled — just edit each one and type S1/S2/S3's plain number in).
    // Otherwise, any test landing in the In-session category with a blank
    // number gets the next one automatically — whether it's brand-new or an
    // existing Certification test switched over; everything else (non-
    // In-session, blank) is left unnumbered, same as always.
    let testId = data.testId
    if (testId === undefined && data.category !== 'rater_course') {
      testId = await nextCategoryNumber(data.category)
    }

    if (testId !== undefined && await findDuplicateTestNumber(data.category, testId)) {
      setError('testId', { message: `${formatTestNumber(testId, data.category)} is already used by another test in this category` })
      return
    }

    const payload = {
      recordingUrl: data.recordingUrl,
      candidateName: data.candidateName,
      candidateNationality: data.candidateNationality,
      testType: data.testType,
      durationSeconds: data.durationSeconds ?? null,
      status: data.status,
      testId: testId ?? null,
      category: data.category,
      raterCourseDay: data.category === 'training' && data.raterCourseDay !== 'none' ? Number(data.raterCourseDay) : null,
      refresherNumber: data.category === 'training' ? data.refresherNumber ?? null : null,
      excludeFromPool,
      notes: data.notes ?? '',
    }
    if (isEdit) {
      await updateDoc(doc(db, 'test_bank', test.id), payload)
    } else {
      await addDoc(collection(db, 'test_bank'), {
        ...payload,
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
                  <SelectTrigger><SelectValue>{(v: TestCategory) => CATEGORY_LABELS[v]}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rater_course">Certification</SelectItem>
                    <SelectItem value="standardization">In-session</SelectItem>
                    <SelectItem value="training">Training</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          {categoryValue === 'training' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Initial Rater Course day</Label>
                <Controller name="raterCourseDay" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue>{(v: string) => v === 'none' ? '—' : `Day ${v}`}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {['1', '2', '3', '4', '5'].map(d => <SelectItem key={d} value={d}>Day {d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1">
                <Label>Refresher set</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">RC</span>
                  <Input type="number" min={1} className="w-20" placeholder="—" {...register('refresherNumber', {
                    setValueAs: v => (v === '' || v == null ? undefined : Number(v)),
                  })} />
                </div>
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Every new run of that course starts with the recordings tagged here. Leave both blank for audio that isn't in a set.
              </p>
            </div>
          )}
          {(test?.courseTag || test?.dayLabel) && (
            <p className="text-xs text-muted-foreground">
              Old tag: {[test.courseTag && LEGACY_COURSE_TAG_LABELS[test.courseTag], test.dayLabel].filter(Boolean).join(' · ')}
            </p>
          )}

          <div className="space-y-1">
            <Label>Test number</Label>
            <Input type="number" min={1} {...register('testId', {
              setValueAs: v => (v === '' ? undefined : Number(v)),
            })} placeholder="Auto-assigned for in-session/training tests if left blank" />
            {errors.testId && <p className="text-xs text-destructive">{errors.testId.message}</p>}
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

          {isEdit && test.category === 'training' && <HeardBySection testDocId={test.id} />}

          <SheetFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
