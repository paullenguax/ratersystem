import { useEffect, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, getDocs, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { db, storage } from '@/lib/firebase'
import type { Test } from '@/types'
import { formatTestNumber } from '@/lib/testNumber'
import { CATEGORY_LABELS, LEGACY_COURSE_TAG_LABELS, type TestCategory } from '@/lib/testPool'
import { HeardBySection } from '@/features/courses/CourseExposure'
import { rcFields, rcSlots } from '@/lib/courses'
import { copyStandardizationScores, countPendingStandardizationScores } from '@/lib/standardizationCalibration'
import { useCurrentPersonName } from '@/features/courses/MaterialsSection'
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
  notes: z.string().optional(),
  teachingNotes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = {
  recordingUrl: '', candidateName: '', candidateNationality: '',
  testType: 'PPL', durationSeconds: undefined, status: 'active', testId: undefined, category: 'rater_course',
  raterCourseDay: 'none', notes: '', teachingNotes: '',
}

interface Props {
  open: boolean
  onClose: () => void
  test?: Test
}

export function TestDrawer({ open, onClose, test }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!test
  const myName = useCurrentPersonName()
  const [previewUrl, setPreviewUrl] = useState('')
  const [excludeFromPool, setExcludeFromPool] = useState(false)
  // Refresher sets this recording is in, each with its own day ('' = none)
  const [rcRows, setRcRows] = useState<{ n: string; day: string }[]>([])

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
        notes: test.notes ?? '',
        teachingNotes: test.teachingNotes ?? '',
      } : EMPTY
      reset(vals)
      setPreviewUrl(test?.recordingUrl ?? '')
      setExcludeFromPool(test?.excludeFromPool ?? false)
      setRcRows(test ? rcSlots(test).map(x => ({ n: String(x.n), day: x.day ? String(x.day) : '' })) : [])
    }
  }, [open, test, reset])

  useEffect(() => { setPreviewUrl(recordingUrlValue) }, [recordingUrlValue])

  // Moving an existing test to another pool takes the next number in that
  // pool (S3 → T13), the same as Test Bank's bulk move, rather than carrying
  // its old number into the new namespace (S3 → T3, usually a collision).
  // Switching back restores the original; a number typed afterwards wins.
  const originalCategory = test ? (test.category ?? 'rater_course') : null
  const categoryChanged = !!originalCategory && categoryValue !== originalCategory
  useEffect(() => {
    if (!open || !test) return
    setValue('testId', categoryChanged ? undefined : (test.testId ?? undefined))
  }, [open, test, categoryChanged, setValue])

  // Each pool has its own number sequence (#1… / S1… / T1…). Scans the
  // whole collection: legacy Certification tests have no `category` field,
  // so a where('category', ...) query would miss them.
  async function nextCategoryNumber(category: TestCategory): Promise<number> {
    const snap = await getDocs(collection(db, 'test_bank'))
    const nums = snap.docs
      .filter(d => d.id !== test?.id && ((d.data().category as Test['category']) ?? 'rater_course') === category)
      .map(d => (d.data().testId as number | undefined) ?? 0)
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
    // A manually typed number always wins. Otherwise a blank number is filled
    // with the next in the pool for Standardization/Training tests, and for
    // any test moved into another pool (including Certification). A brand-new
    // Certification test left blank stays unnumbered, as before.
    let testId = data.testId
    if (testId === undefined && (data.category !== 'rater_course' || categoryChanged)) {
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
      ...rcFields(data.category === 'training'
        ? rcRows.filter(r => Number(r.n) >= 1).map(r => ({ n: Math.floor(Number(r.n)), day: r.day ? Number(r.day) : null }))
        : []),
      excludeFromPool,
      notes: data.notes ?? '',
      teachingNotes: data.teachingNotes ?? '',
      // Stamp who last changed the teaching notes, only when they changed
      ...((data.teachingNotes ?? '') !== (test?.teachingNotes ?? '') && {
        teachingNotesUpdatedBy: myName,
        teachingNotesUpdatedAt: serverTimestamp(),
      }),
    }
    if (isEdit) {
      await updateDoc(doc(db, 'test_bank', test.id), payload)
      // Leaving Standardization for Certification: offer its ratings as calibration scores
      if (originalCategory === 'standardization' && data.category === 'rater_course') {
        const { pending } = await countPendingStandardizationScores(test.id)
        if (pending > 0 && confirm(`This test has ${pending} standardization rating${pending === 1 ? '' : 's'}. Bring ${pending === 1 ? 'it' : 'them'} across as published Certification scores, so ${pending === 1 ? 'it counts' : 'they count'} towards its calibration?\n\nThose raters will then also count as having heard it, so they won't be given it in an exam.`)) {
          await copyStandardizationScores({ ...test, testId, candidateName: data.candidateName, testType: data.testType })
          queryClient.invalidateQueries({ queryKey: ['scores'] })
        }
      }
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
                    <SelectItem value="standardization">Standardization</SelectItem>
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
                <Label>Refresher sets</Label>
                <div className="space-y-1">
                  {rcRows.map((r, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">RC</span>
                      <Input
                        type="number" min={1} className="w-16 h-8" aria-label="Refresher set number" value={r.n}
                        onChange={e => setRcRows(rows => rows.map((x, j) => j === i ? { ...x, n: e.target.value } : x))}
                      />
                      <select
                        value={r.day}
                        aria-label="Day in this refresher set"
                        onChange={e => setRcRows(rows => rows.map((x, j) => j === i ? { ...x, day: e.target.value } : x))}
                        className="h-8 text-sm border rounded-md px-1 bg-background"
                      >
                        <option value="">No day</option>
                        {[1, 2, 3].map(d => <option key={d} value={d}>Day {d}</option>)}
                      </select>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2" aria-label="Remove this refresher set"
                        onClick={() => setRcRows(rows => rows.filter((_, j) => j !== i))}>✕</Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setRcRows(rows => [...rows, { n: '', day: '' }])}>
                    + Add RC set
                  </Button>
                </div>
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Every new run of a course starts with the recordings tagged for it. One recording can be in several refresher sets, on a different day in each.
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
            })} placeholder={categoryChanged ? 'Next number in the new pool (or type one)' : 'Auto-assigned for standardization/training tests if left blank'} />
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
            <p className="text-xs text-muted-foreground">Admin-only.</p>
          </div>

          {categoryValue === 'training' && (
            <div className="space-y-1">
              <Label>Teaching notes</Label>
              <Textarea {...register('teachingNotes')} rows={5} className="font-mono text-xs" placeholder={'What to point out to the class, e.g.\n0:42 — listen for the readback error\n- **Fluency**: long pauses before numbers'} />
              <p className="text-xs text-muted-foreground">Shown to trainers in the Teach view, where m:ss timestamps jump the player. Markdown works.</p>
            </div>
          )}

          {isEdit && test.category === 'training' && <HeardBySection testDocId={test.id} />}
          {isEdit && (test.category ?? 'rater_course') === 'rater_course' && <StandardizationRatingsSection test={test} />}

          <SheetFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// A Certification test that came from Standardization: its standardization
// ratings not yet copied across as calibration scores (e.g. it was moved
// before this existed, or more ratings came in since)
function StandardizationRatingsSection({ test }: { test: Test }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const { data } = useQuery({
    queryKey: ['std-pending', test.id],
    queryFn: () => countPendingStandardizationScores(test.id),
  })
  if (!data?.total) return null

  async function bringAcross() {
    setBusy(true)
    try {
      const n = await copyStandardizationScores(test)
      setDone(`Brought ${n} across. Run Statistics → Tests → Save calibration to update its difficulty.`)
      queryClient.invalidateQueries({ queryKey: ['std-pending', test.id] })
      queryClient.invalidateQueries({ queryKey: ['scores'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border p-3 space-y-1 text-sm">
      <p className="font-medium">Standardization ratings</p>
      {done ? <p className="text-xs text-green-700">{done}</p> : data.pending === 0 ? (
        <p className="text-xs text-muted-foreground">All {data.total} count towards its calibration.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {data.pending} of {data.total} {data.total === 1 ? 'isn\'t' : 'aren\'t'} counted yet. Bringing them across adds them as published scores, so they count
            towards its calibration and those raters count as having heard it.
          </p>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={bringAcross}>
            {busy ? 'Bringing across…' : `Bring ${data.pending} across`}
          </Button>
        </>
      )}
    </div>
  )
}
