import { useEffect, useState } from 'react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import type { Assignment, Person, Test, Session } from '@/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const STATUS_LABELS: Record<Assignment['status'], string> = {
  pending:   'Pending',
  submitted: 'Submitted',
  reviewed:  'Reviewed',
  published: 'Published',
}

const schema = z.object({
  sessionId: z.string().min(1, 'Required'),
  raterId:   z.string().min(1, 'Required'),
  status:    z.enum(['pending', 'submitted', 'reviewed', 'published']),
  notes:     z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = { sessionId: '', raterId: '', status: 'pending', notes: '' }

async function fetchSessions(): Promise<Session[]> {
  const snap = await getDocs(collection(db, 'sessions'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Session)
    .filter(s => s.status !== 'published')
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchPeople(): Promise<Person[]> {
  const snap = await getDocs(collection(db, 'people'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Person)
    .filter(p => p.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchTests(): Promise<Test[]> {
  const snap = await getDocs(collection(db, 'test_bank'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Test)
    .filter(t => t.status === 'active')
    .sort((a, b) => (a.testId ?? 999) - (b.testId ?? 999))
}

interface Props {
  open: boolean
  onClose: () => void
  assignment?: Assignment
}

export function AssignmentDrawer({ open, onClose, assignment }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!assignment
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([])
  const [testSearch, setTestSearch] = useState('')
  const [showRated, setShowRated] = useState(false)

  const { data: sessions = [] } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions })
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchTests })

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  const raterId = useWatch({ control, name: 'raterId' })

  // Fetch test IDs this rater has already scored (new assignments only)
  const { data: ratedTestIds = new Set<string>() } = useQuery({
    queryKey: ['rater-rated-tests', raterId],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, 'scores'), where('raterId', '==', raterId)))
      return new Set(snap.docs.map(d => d.data().testDocId as string))
    },
    enabled: !!raterId && !isEdit,
  })

  // Reset "show rated" when the rater changes
  useEffect(() => { setShowRated(false) }, [raterId])

  const alreadyRatedCount = isEdit ? 0 : tests.filter(t => ratedTestIds.has(t.id)).length

  const filteredTests = tests.filter(t => {
    if (!isEdit && !showRated && ratedTestIds.has(t.id)) return false
    if (!testSearch) return true
    const q = testSearch.toLowerCase()
    return (
      t.candidateName.toLowerCase().includes(q) ||
      t.testType.toLowerCase().includes(q) ||
      String(t.testId ?? '').includes(q)
    )
  })

  useEffect(() => {
    if (!open) return
    if (assignment) {
      reset({ sessionId: assignment.sessionId, raterId: assignment.raterId, status: assignment.status, notes: assignment.notes ?? '' })
      setSelectedTestIds(assignment.testDocIds)
    } else {
      reset(EMPTY)
      setSelectedTestIds([])
    }
    setTestSearch('')
  }, [open, assignment, reset])

  function toggleTest(id: string) {
    setSelectedTestIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function onSubmit(data: FormData) {
    if (!isEdit && selectedTestIds.length === 0) return

    // Editing with all tests unchecked → delete the assignment
    if (isEdit && selectedTestIds.length === 0) {
      await deleteDoc(doc(db, 'assignments', assignment!.id))
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      onClose()
      return
    }

    const session = sessions.find(s => s.id === data.sessionId)
      ?? (isEdit ? { id: assignment!.sessionId, name: assignment!.sessionName } as Session : null)
    const rater = people.find(p => p.id === data.raterId)
    if (!session || !rater) return

    const payload = {
      sessionId: data.sessionId,
      sessionName: session.name,
      raterId: data.raterId,
      raterName: rater.name,
      testDocIds: selectedTestIds,
      status: data.status,
      notes: data.notes ?? '',
    }

    if (isEdit) {
      await updateDoc(doc(db, 'assignments', assignment!.id), payload)
    } else {
      await addDoc(collection(db, 'assignments'), { ...payload, createdAt: serverTimestamp() })
    }

    queryClient.invalidateQueries({ queryKey: ['assignments'] })
    onClose()
  }

  const noTests = !isEdit && selectedTestIds.length === 0 && !isSubmitting

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit assignment' : 'New assignment'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">

          {/* Session */}
          <div className="space-y-1">
            <Label>Event</Label>
            <Controller name="sessionId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select event…">
                    {sessions.find(s => s.id === field.value)?.name
                      ?? (isEdit ? assignment?.sessionName : undefined)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {sessions.length === 0
                    ? <div className="px-3 py-2 text-sm text-muted-foreground">No open sessions.</div>
                    : sessions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            )} />
            {errors.sessionId && <p className="text-xs text-destructive">{errors.sessionId.message}</p>}
          </div>

          {/* Rater */}
          <div className="space-y-1">
            <Label>Rater</Label>
            <Controller name="raterId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select rater…">
                    {people.find(p => p.id === field.value)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {people.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {errors.raterId && <p className="text-xs text-destructive">{errors.raterId.message}</p>}
          </div>

          {/* Test checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tests</Label>
              <div className="flex items-center gap-3">
                {!isEdit && alreadyRatedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowRated(v => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    {showRated
                      ? 'Hide already rated'
                      : `${alreadyRatedCount} already rated — show?`}
                  </button>
                )}
                <span className="text-xs text-muted-foreground">{selectedTestIds.length} selected</span>
              </div>
            </div>
            <Input
              placeholder="Search tests…"
              value={testSearch}
              onChange={e => setTestSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
              {filteredTests.length === 0
                ? <p className="px-3 py-4 text-sm text-muted-foreground">No tests found.</p>
                : filteredTests.map(t => (
                  <label key={t.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 select-none">
                    <input
                      type="checkbox"
                      checked={selectedTestIds.includes(t.id)}
                      onChange={() => toggleTest(t.id)}
                      className="rounded"
                    />
                    <span className="text-sm">
                      {t.testId ? <span className="font-mono text-xs text-muted-foreground mr-1">#{t.testId}</span> : null}
                      {t.candidateName}
                      <span className="text-muted-foreground ml-1 text-xs">({t.testType})</span>
                    </span>
                  </label>
                ))
              }
            </div>
            {noTests && <p className="text-xs text-destructive">Select at least one test.</p>}
          </div>

          {/* Status */}
          <div className="space-y-1">
            <Label>Status</Label>
            <Controller name="status" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue>{STATUS_LABELS[field.value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea {...register('notes')} placeholder="Optional…" rows={2} />
          </div>

          <SheetFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={isSubmitting || (!isEdit && selectedTestIds.length === 0)}
              variant={isEdit && selectedTestIds.length === 0 ? 'destructive' : 'default'}
            >
              {isSubmitting ? 'Saving…' : isEdit && selectedTestIds.length === 0 ? 'Delete assignment' : 'Save'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
