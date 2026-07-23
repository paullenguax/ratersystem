import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { StorylineTemplate, StorylineTest } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const EMPTY: FormData = { name: '', description: '' }

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', 'current'))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

interface Props {
  open: boolean
  onClose: () => void
  test?: StorylineTest
}

export function StorylineTestDrawer({ open, onClose, test }: Props) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isEdit = !!test
  const [active, setActive] = useState(true)
  const [variables, setVariables] = useState<Record<string, string>>({})

  const { data: template } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })
  const variableNames = useMemo(
    () => [...new Set((template?.slides ?? []).flatMap(s => s.slotSpec.variables ?? []))],
    [template],
  )

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  useEffect(() => {
    if (open) {
      reset(test ? { name: test.name, description: test.description ?? '' } : EMPTY)
      setActive(test?.active ?? true)
      setVariables(test?.variables ?? {})
    }
  }, [open, test, reset])

  async function onSubmit(data: FormData) {
    const payload = {
      name: data.name,
      description: data.description ?? '',
      active,
      variables,
    }
    if (isEdit) {
      await updateDoc(doc(db, 'storyline_tests', test.id), payload)
    } else {
      await addDoc(collection(db, 'storyline_tests'), {
        ...payload,
        createdBy: user?.uid ?? null,
        createdAt: serverTimestamp(),
      })
    }
    queryClient.invalidateQueries({ queryKey: ['storyline_tests'] })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit test' : 'Add test'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...register('name')} placeholder="e.g. Approach" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea {...register('description')} rows={3} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={active}
              onChange={e => setActive(e.target.checked)}
              className="rounded"
            />
            <span>Active</span>
          </label>

          {variableNames.length > 0 && (
            <div className="space-y-2">
              <Label>Script variables</Label>
              <p className="text-xs text-muted-foreground">
                Fills for [placeholder] tokens in the shared Script Template — reused across every version and Part reference for this test.
              </p>
              {variableNames.map(name => (
                <div key={name} className="space-y-1">
                  <Label className="text-xs">{name}</Label>
                  <Input
                    value={variables[name] ?? ''}
                    onChange={e => setVariables(prev => ({ ...prev, [name]: e.target.value }))}
                    placeholder={`Fills [${name}]`}
                  />
                </div>
              ))}
            </div>
          )}

          <SheetFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
