import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, serverTimestamp, query, where, limit, getDocs } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import type { Session } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TYPE_LABELS: Record<Session['type'], string> = {
  rater_course: 'Rater Course',
  refresher:    'Refresher Course',
  reliability:  'Reliability Check',
  calibration:  'Calibration',
  historical:   'Historical Import',
  ad_hoc:       'Ad hoc',
  examiner_standardization: 'Examiner Standardization',
}

const schema = z.object({
  name:   z.string().min(1, 'Required'),
  type:   z.enum(['rater_course', 'refresher', 'reliability', 'calibration', 'historical', 'ad_hoc', 'examiner_standardization']),
  status: z.enum(['open', 'closed', 'published']),
  notes:  z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = { name: '', type: 'refresher', status: 'open', notes: '' }

interface Props {
  open: boolean
  onClose: () => void
  session?: Session
}

export function SessionDrawer({ open, onClose, session }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!session
  const [hasScores, setHasScores] = useState(false)

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  useEffect(() => {
    if (!open) return
    reset(session
      ? { name: session.name, type: session.type, status: session.status, notes: session.notes ?? '' }
      : EMPTY
    )
    if (session) {
      Promise.all([
        getDocs(query(collection(db, 'scores'), where('sessionId', '==', session.id), limit(1))),
        getDocs(query(collection(db, 'standardization_scores'), where('sessionId', '==', session.id), limit(1))),
      ]).then(([scoresSnap, stdScoresSnap]) => setHasScores(!scoresSnap.empty || !stdScoresSnap.empty))
    } else {
      setHasScores(false)
    }
  }, [open, session, reset])

  async function onSubmit(data: FormData) {
    const payload = { name: data.name, type: data.type, status: data.status, notes: data.notes ?? '' }
    if (isEdit) {
      await updateDoc(doc(db, 'sessions', session.id), payload)
    } else {
      await addDoc(collection(db, 'sessions'), { ...payload, createdAt: serverTimestamp() })
    }
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit event' : 'New event'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...register('name')} placeholder="e.g. June 2026 Refresher Course" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Type</Label>
            <Controller name="type" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={hasScores}>
                <SelectTrigger>
                  <SelectValue>{TYPE_LABELS[field.value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
            {hasScores && (
              <p className="text-xs text-muted-foreground">Locked — scores have already been submitted for this event.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Controller name="status" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue>{field.value.charAt(0).toUpperCase() + field.value.slice(1)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea {...register('notes')} rows={3} placeholder="Optional…" />
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
