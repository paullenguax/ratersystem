import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import type { Test } from '@/types'
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
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = {
  recordingUrl: '', candidateName: '', candidateNationality: '',
  testType: 'PPL', durationSeconds: undefined, status: 'active', notes: '',
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

  const { register, handleSubmit, control, reset, watch, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  const recordingUrlValue = watch('recordingUrl')

  useEffect(() => {
    if (open) {
      const vals = test ? {
        recordingUrl: test.recordingUrl,
        candidateName: test.candidateName,
        candidateNationality: test.candidateNationality,
        testType: test.testType,
        durationSeconds: test.durationSeconds,
        status: test.status,
        notes: test.notes ?? '',
      } : EMPTY
      reset(vals)
      setPreviewUrl(test?.recordingUrl ?? '')
    }
  }, [open, test, reset])

  useEffect(() => { setPreviewUrl(recordingUrlValue) }, [recordingUrlValue])

  async function onSubmit(data: FormData) {
    const payload = {
      recordingUrl: data.recordingUrl,
      candidateName: data.candidateName,
      candidateNationality: data.candidateNationality,
      testType: data.testType,
      durationSeconds: data.durationSeconds ?? null,
      status: data.status,
      notes: data.notes ?? '',
    }
    if (isEdit) {
      await updateDoc(doc(db, 'test_bank', test.id), payload)
    } else {
      await addDoc(collection(db, 'test_bank'), {
        ...payload, canonicalDifficulty: null, canonicalSE: null, anchoredAt: null,
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
            <p className="text-xs text-muted-foreground">Test #{test.testId}</p>
          )}
          <div className="space-y-1">
            <Label>Recording URL</Label>
            <Input {...register('recordingUrl')} placeholder="https://…" />
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
              <Input type="number" min={0} {...register('durationSeconds', { valueAsNumber: true })} />
            </div>
          </div>

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
