import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { useQueryClient } from '@tanstack/react-query'
import { functions } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'senior_rater', 'trainee', 'interlocutor']),
})
type FormData = z.infer<typeof schema>

const invitePersonFn = httpsCallable<
  { name: string; email: string; role: FormData['role']; canStandardize?: boolean },
  { uid: string }
>(functions, 'invitePerson')

interface Props {
  open: boolean
  onClose: () => void
}

export function InvitePersonDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [canStandardize, setCanStandardize] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: { name: '', email: '', role: 'interlocutor' },
    })

  useEffect(() => {
    if (open) {
      reset({ name: '', email: '', role: 'interlocutor' })
      setCanStandardize(false)
      setSubmitError(null)
    }
  }, [open, reset])

  async function onSubmit(data: FormData) {
    setSubmitError(null)
    try {
      await invitePersonFn({ ...data, canStandardize })
      queryClient.invalidateQueries({ queryKey: ['people'] })
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to send invite')
    }
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Invite person</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
          <p className="text-xs text-muted-foreground">
            Creates their account and emails them a link to set their own password —
            no manual Firebase Console steps needed.
          </p>

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
                  <SelectItem value="interlocutor">Interlocutor</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={canStandardize}
              onChange={e => setCanStandardize(e.target.checked)}
              className="rounded"
            />
            <span>Can do standardization work</span>
          </label>

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}

          <SheetFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Send invite'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
