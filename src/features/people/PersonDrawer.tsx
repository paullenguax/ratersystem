import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collection, addDoc, doc, updateDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase'
import type { Person } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'senior_rater', 'trainee']),
  status: z.enum(['active', 'inactive', 'suspended']),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  person?: Person
}

export function PersonDrawer({ open, onClose, person }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!person

  const { register, handleSubmit, control, reset, setError, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: { name: '', email: '', role: 'senior_rater', status: 'active', notes: '' },
    })

  useEffect(() => {
    if (open) {
      reset(person
        ? { name: person.name, email: person.email, role: person.role, status: person.status, notes: person.notes ?? '' }
        : { name: '', email: '', role: 'senior_rater', status: 'active', notes: '' }
      )
    }
  }, [open, person, reset])

  async function onSubmit(data: FormData) {
    const q = query(collection(db, 'people'), where('email', '==', data.email))
    const snap = await getDocs(q)
    const duplicate = snap.docs.find(d => d.id !== person?.id)
    if (duplicate) {
      setError('email', { message: 'Email already in use' })
      return
    }

    const payload = { name: data.name, email: data.email, role: data.role, status: data.status, notes: data.notes ?? '' }

    if (isEdit) {
      await updateDoc(doc(db, 'people', person.id), payload)
    } else {
      await addDoc(collection(db, 'people'), { ...payload, createdAt: serverTimestamp() })
    }

    queryClient.invalidateQueries({ queryKey: ['people'] })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit person' : 'Add person'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Role</Label>
            <Controller name="role" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="senior_rater">Senior Rater</SelectItem>
                  <SelectItem value="trainee">Trainee</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Controller name="status" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
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
