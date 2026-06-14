import { useEffect } from 'react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import type { Person, Test, Score } from '@/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const DIMENSIONS = [
  { key: 'pronunciation',  label: 'Pronunciation' },
  { key: 'structure',      label: 'Structure' },
  { key: 'vocabulary',     label: 'Vocabulary' },
  { key: 'fluency',        label: 'Fluency' },
  { key: 'comprehension',  label: 'Comprehension' },
  { key: 'interactions',   label: 'Interactions' },
] as const

type DimKey = typeof DIMENSIONS[number]['key']

const dimSchema = z.number().min(1, 'Required').max(6)
const schema = z.object({
  raterId:       z.string().min(1, 'Required'),
  testDocId:     z.string().min(1, 'Required'),
  pronunciation: dimSchema,
  structure:     dimSchema,
  vocabulary:    dimSchema,
  fluency:       dimSchema,
  comprehension: dimSchema,
  interactions:  dimSchema,
  notes:         z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = {
  raterId: '', testDocId: '',
  pronunciation: 0 as number, structure: 0 as number, vocabulary: 0 as number,
  fluency: 0 as number, comprehension: 0 as number, interactions: 0 as number,
  notes: '',
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

function levelColour(n: number) {
  if (n >= 5) return 'text-green-700 bg-green-50'
  if (n === 4) return 'text-blue-700 bg-blue-50'
  if (n === 3) return 'text-amber-700 bg-amber-50'
  return 'text-red-700 bg-red-50'
}

interface Props {
  open: boolean
  onClose: () => void
  score?: Score
}

export function ScoreDrawer({ open, onClose, score }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!score

  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: tests = [] } = useQuery({ queryKey: ['tests'], queryFn: fetchTests })

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  const watched = useWatch({ control, name: ['pronunciation', 'structure', 'vocabulary', 'fluency', 'comprehension', 'interactions'] })
  const allSet = watched.every(v => v >= 1)
  const overallLevel = allSet ? Math.min(...watched) : null

  useEffect(() => {
    if (!open) return
    if (score) {
      reset({
        raterId: score.raterId,
        testDocId: score.testDocId,
        pronunciation: score.pronunciation,
        structure: score.structure,
        vocabulary: score.vocabulary,
        fluency: score.fluency,
        comprehension: score.comprehension,
        interactions: score.interactions,
        notes: score.notes ?? '',
      })
    } else {
      reset(EMPTY)
    }
  }, [open, score, reset])

  async function onSubmit(data: FormData) {
    const rater = people.find(p => p.id === data.raterId)
    const test = tests.find(t => t.id === data.testDocId)
    if (!rater || !test) return

    const overall = Math.min(
      data.pronunciation, data.structure, data.vocabulary,
      data.fluency, data.comprehension, data.interactions,
    )

    const payload = {
      raterId: data.raterId,
      raterName: rater.name,
      testDocId: data.testDocId,
      testNumber: test.testId ?? null,
      candidateName: test.candidateName,
      testType: test.testType,
      pronunciation: data.pronunciation,
      structure: data.structure,
      vocabulary: data.vocabulary,
      fluency: data.fluency,
      comprehension: data.comprehension,
      interactions: data.interactions,
      overallLevel: overall,
      notes: data.notes ?? '',
    }

    if (isEdit) {
      await updateDoc(doc(db, 'scores', score.id), payload)
    } else {
      await addDoc(collection(db, 'scores'), { ...payload, createdAt: serverTimestamp() })
    }

    queryClient.invalidateQueries({ queryKey: ['scores'] })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit score' : 'Add score'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5 py-4">
          {/* Rater */}
          <div className="space-y-1">
            <Label>Rater</Label>
            <Controller name="raterId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select rater…" /></SelectTrigger>
                <SelectContent>
                  {people.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
            {errors.raterId && <p className="text-xs text-destructive">{errors.raterId.message}</p>}
          </div>

          {/* Test */}
          <div className="space-y-1">
            <Label>Test</Label>
            <Controller name="testDocId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select test…" /></SelectTrigger>
                <SelectContent>
                  {tests.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.testId ? `#${t.testId} – ` : ''}{t.candidateName} ({t.testType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
            {errors.testDocId && <p className="text-xs text-destructive">{errors.testDocId.message}</p>}
          </div>

          {/* ICAO dimension scores */}
          <div className="space-y-3">
            <Label>ICAO Scores</Label>
            {DIMENSIONS.map(dim => (
              <Controller key={dim.key} name={dim.key as DimKey} control={control} render={({ field }) => (
                <div className="flex items-center gap-3">
                  <span className="w-32 text-sm shrink-0">{dim.label}</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => field.onChange(n)}
                        className={`w-9 h-9 rounded border text-sm font-medium transition-colors ${
                          field.value === n
                            ? `${levelColour(n)} border-current font-bold`
                            : 'border-input hover:bg-muted'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  {errors[dim.key as DimKey] && <p className="text-xs text-destructive">Required</p>}
                </div>
              )} />
            ))}
          </div>

          {/* Overall level */}
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3">
            <span className="text-sm font-medium">Overall level</span>
            {overallLevel !== null
              ? <span className={`text-lg font-bold px-2 py-0.5 rounded ${levelColour(overallLevel)}`}>{overallLevel}</span>
              : <span className="text-sm text-muted-foreground">— set all 6 scores</span>
            }
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea {...register('notes')} rows={2} placeholder="Optional…" />
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
