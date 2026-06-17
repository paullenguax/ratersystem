import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, addDoc, doc, updateDoc, setDoc, deleteDoc,
  query, where, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore'
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

  const [uidInput, setUidInput] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [linkDone, setLinkDone] = useState(false)

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
      setUidInput('')
      setLinkError('')
      setLinkDone(false)
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

  async function linkAccount() {
    if (!person) return
    const newUid = uidInput.trim()
    if (!newUid) { setLinkError('Paste the Firebase UID first.'); return }
    if (newUid === person.id) {
      // Already linked — just stamp linkedAt and we're done
      await updateDoc(doc(db, 'people', person.id), { linkedAt: serverTimestamp() })
      queryClient.invalidateQueries({ queryKey: ['people'] })
      setLinkDone(true)
      setTimeout(onClose, 1500)
      return
    }

    setLinkError('')
    setLinking(true)
    try {
      // 1. Create the new people doc using the Firebase UID as its ID
      await setDoc(doc(db, 'people', newUid), {
        name: person.name,
        email: person.email,
        role: person.role,
        status: person.status,
        notes: person.notes ?? '',
        createdAt: person.createdAt ?? serverTimestamp(),
        linkedAt: serverTimestamp(),
      })

      // 2. Re-point all scores that belong to this person
      const scoreSnap = await getDocs(query(collection(db, 'scores'), where('raterId', '==', person.id)))
      for (let i = 0; i < scoreSnap.docs.length; i += 499) {
        const batch = writeBatch(db)
        scoreSnap.docs.slice(i, i + 499).forEach(d => batch.update(d.ref, { raterId: newUid }))
        await batch.commit()
      }

      // 3. Re-point all assignments that belong to this person
      const assignSnap = await getDocs(query(collection(db, 'assignments'), where('raterId', '==', person.id)))
      for (let i = 0; i < assignSnap.docs.length; i += 499) {
        const batch = writeBatch(db)
        assignSnap.docs.slice(i, i + 499).forEach(d => batch.update(d.ref, { raterId: newUid }))
        await batch.commit()
      }

      // 4. Delete the old people doc
      await deleteDoc(doc(db, 'people', person.id))

      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      queryClient.invalidateQueries({ queryKey: ['scores'] })
      setLinkDone(true)
      setTimeout(onClose, 1500)
    } catch (e) {
      setLinkError('Something went wrong. Check the UID and try again.')
    } finally {
      setLinking(false)
    }
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

        {/* Link Firebase account — edit mode only */}
        {isEdit && (
          <div className="border-t pt-5 mt-2 space-y-3">
            <div>
              <p className="text-sm font-medium">Firebase account</p>
            </div>
            {person.linkedAt || linkDone ? (
              <p className="text-sm text-green-700 font-medium">
                ✓ Account linked
                {person.linkedAt && (
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    {new Date((person.linkedAt as any).seconds * 1000).toLocaleDateString()}
                  </span>
                )}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Paste the UID from Firebase Console → Authentication. All scores and
                  assignments will be moved to the new ID so nothing is lost.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Firebase UID (e.g. abc123xyz…)"
                    value={uidInput}
                    onChange={e => { setUidInput(e.target.value); setLinkError('') }}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={linking || !uidInput.trim()}
                    onClick={linkAccount}
                  >
                    {linking ? 'Linking…' : 'Link'}
                  </Button>
                </div>
                {linkError && <p className="text-xs text-destructive">{linkError}</p>}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
