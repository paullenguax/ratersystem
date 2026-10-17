import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import type { Course, Person, Test } from '@/types'
import { autoCourseName, setForCourse, setLabel } from '@/lib/courses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'

const schema = z.object({
  // Blank = generated from the set number and start date
  name: z.string().optional(),
  number: z.number().int().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  // Creating: which kind, and the refresher set to suggest (the newest)
  kind: Course['kind']
  suggestedNumber?: number
  course?: Course
  people: Person[]
  tests: Test[]
  onCreated?: (id: string) => void
  onDeleted?: () => void
}

export function CourseDrawer({ open, onClose, kind, suggestedNumber, course, people, tests, onCreated, onDeleted }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!course
  const effectiveKind = course?.kind ?? kind
  const [trainerIds, setTrainerIds] = useState<string[]>([])

  const trainers = people
    .filter(p => p.role === 'admin' || p.isTrainer)
    .sort((a, b) => a.name.localeCompare(b.name))

  const { register, handleSubmit, reset, watch, setError, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema) })
  const numberValue = watch('number')
  const startValue = watch('startDate')
  const autoName = autoCourseName(effectiveKind, numberValue, startValue)
  const startingSet = setForCourse(tests, { kind: effectiveKind, number: numberValue ?? null })

  useEffect(() => {
    if (!open) return
    if (course) {
      reset({
        name: course.name, number: course.number ?? undefined,
        startDate: course.startDate ?? '', endDate: course.endDate ?? '', notes: course.notes ?? '',
      })
      setTrainerIds(course.trainerIds ?? [])
    } else {
      reset({
        name: '',
        number: kind === 'refresher' ? suggestedNumber : undefined,
        startDate: '', endDate: '', notes: '',
      })
      setTrainerIds([])
    }
  }, [open, course, kind, suggestedNumber, reset])

  async function onSubmit(data: FormData) {
    if (effectiveKind === 'refresher' && !data.number) {
      setError('number', { message: 'Which RC set is this run of?' })
      return
    }
    const payload = {
      name: data.name?.trim() || autoName,
      number: effectiveKind === 'refresher' ? data.number ?? null : null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      notes: data.notes ?? '',
      trainerIds,
    }
    if (isEdit) {
      await updateDoc(doc(db, 'courses', course.id), payload)
    } else {
      const ref = await addDoc(collection(db, 'courses'), {
        ...payload,
        kind,
        // Starts from the run's set; per-run tweaks are made on the course page
        testDocIds: startingSet.map(t => t.id),
        attendees: [],
        canvasSections: [],
        createdAt: serverTimestamp(),
      })
      onCreated?.(ref.id)
    }
    queryClient.invalidateQueries({ queryKey: ['courses'] })
    onClose()
  }

  async function handleDelete() {
    if (!course) return
    if (!confirm(`Delete ${course.name}? Its attendee list and audio list will be lost, so nobody will show as having heard its recordings.`)) return
    await deleteDoc(doc(db, 'courses', course.id))
    queryClient.invalidateQueries({ queryKey: ['courses'] })
    onClose()
    onDeleted?.()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? 'Edit course' : effectiveKind === 'refresher' ? 'New refresher course' : 'New rater course'}
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...register('name')} placeholder={autoName} />
            <p className="text-xs text-muted-foreground">Leave blank to use “{autoName}”.</p>
          </div>

          {effectiveKind === 'refresher' && (
            <div className="space-y-1">
              <Label>Refresher set</Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">RC</span>
                <Input
                  type="number" min={1} className="w-24"
                  {...register('number', { setValueAs: v => (v === '' ? undefined : Number(v)) })}
                />
              </div>
              {errors.number && <p className="text-xs text-destructive">{errors.number.message}</p>}
              <p className="text-xs text-muted-foreground">The newest set is suggested. A new set (e.g. RC{(suggestedNumber ?? 0) + 1}) starts empty until its recordings are tagged in Test Bank.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start date</Label>
              <Input type="date" {...register('startDate')} />
            </div>
            <div className="space-y-1">
              <Label>End date</Label>
              <Input type="date" {...register('endDate')} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Trainers</Label>
            {trainers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No trainers yet — tick "Trainer" on a person in People.</p>
            ) : (
              <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                {trainers.map(p => (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trainerIds.includes(p.id)}
                      onChange={e => setTrainerIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(i => i !== p.id))}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {!isEdit && (
            <p className="text-xs text-muted-foreground">
              Starts with the {setLabel({ kind: effectiveKind, number: numberValue ?? null })} — {startingSet.length} recording{startingSet.length === 1 ? '' : 's'} tagged in Test Bank.
            </p>
          )}

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea {...register('notes')} rows={3} placeholder="Optional…" />
          </div>

          <SheetFooter className="mt-2">
            {isEdit && (
              <Button type="button" variant="ghost" className="text-destructive mr-auto" onClick={handleDelete}>Delete</Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
