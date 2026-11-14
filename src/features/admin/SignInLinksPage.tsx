import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ChevronLeft } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import type { Person } from '@/types'
import { fetchCourses, normName } from '@/lib/courses'
import { fetchPeople } from '@/features/courses/CoursesPage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type LoginStatus = { hasLogin: boolean; authEmail: string | null }
const signInStatusFn = httpsCallable<{ personIds: string[] }, Record<string, LoginStatus>>(functions, 'signInStatus')
const sendSignInLinkFn = httpsCallable<{ personId: string }, { created: boolean; movedFrom: string | null; email: string }>(functions, 'sendSignInLink')
const setPersonEmailFn = httpsCallable<{ personId: string; email: string }, { hasLogin: boolean; changed: boolean }>(functions, 'setPersonEmail')
const invitePersonFn = httpsCallable<
  { name: string; email: string; role: Person['role']; canStandardize: boolean },
  { uid: string; inviteEmailSent: boolean }
>(functions, 'invitePerson')

const EMAIL_RE = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[^\s<>,;"'()]+/

interface Row {
  key: number
  input: string
  name: string
  email: string
  // Exact matches (by email, else by name); several = the admin must pick
  matches: Person[]
  // Same surname and first initial, when nothing matched exactly
  possible: Person[]
  personId: string | null
  // A pasted email that differs from the record: use it (updating the record
  // and their sign-in) or keep the record's
  useNewEmail: boolean
  // From the course-records import, for a name with no People record
  courseEmail: string | null
  // A possible match was looked at and this is someone else
  confirmedNew: boolean
  include: boolean
  result?: { ok: boolean; text: string }
}

function parseLines(text: string): { input: string; name: string; email: string }[] {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(input => {
      const email = input.match(EMAIL_RE)?.[0] ?? ''
      const name = input.replace(email, ' ').replace(/[<>,;"\t()]/g, ' ').replace(/\s+/g, ' ').trim()
      return { input, name, email: email.toLowerCase() }
    })
    // A header row ("Name, Email") has no address in it
    .filter((l, i) => !(i === 0 && !l.email && /\bemail\b/i.test(l.input)))
}

function surnameKey(name: string): string {
  const parts = normName(name).split(' ').filter(Boolean)
  return parts.length ? `${parts[0][0]}|${parts[parts.length - 1]}` : ''
}

export function SignInLinksPage() {
  const queryClient = useQueryClient()
  const { data: people = [] } = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [status, setStatus] = useState<Record<string, LoginStatus>>({})
  const [newRole, setNewRole] = useState<Person['role']>('trainee')
  const [checking, setChecking] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function check() {
    setError('')
    const byEmail = new Map(people.filter(p => p.email).map(p => [p.email.toLowerCase().trim(), p]))
    // Course attendees who never got a People record, by name, with any email the import had
    const courseEmails = new Map<string, string>()
    for (const c of courses) for (const a of c.attendees ?? []) {
      if (!a.personId && a.email) courseEmails.set(normName(a.name), a.email.toLowerCase())
    }
    const next: Row[] = parseLines(text).map((l, key) => {
      const emailMatch = l.email ? byEmail.get(l.email) : undefined
      const matches = emailMatch ? [emailMatch] : l.name ? people.filter(p => normName(p.name) === normName(l.name)) : []
      const possible = matches.length || !l.name ? [] : people.filter(p => surnameKey(p.name) === surnameKey(l.name))
      return {
        key, ...l, matches, possible,
        personId: matches.length === 1 ? matches[0].id : null,
        useNewEmail: true,
        courseEmail: !matches.length && !l.email ? courseEmails.get(normName(l.name)) ?? null : null,
        confirmedNew: false,
        include: true,
      }
    })
    setRows(next)
    const ids = [...new Set(next.flatMap(r => [...r.matches, ...r.possible].map(p => p.id)))]
    if (!ids.length) return
    setChecking(true)
    try {
      setStatus((await signInStatusFn({ personIds: ids })).data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check who has a login')
    } finally {
      setChecking(false)
    }
  }

  const update = (key: number, patch: Partial<Row>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))

  // What sending would do for a row, or why it can't
  function plan(r: Row): { kind: 'send' | 'invite' | 'problem'; email: string; notes: string[] } {
    const person = people.find(p => p.id === r.personId)
    if (!person) {
      if (r.matches.length > 1) return { kind: 'problem', email: '', notes: [`${r.matches.length} people have this name — pick one`] }
      const email = r.email || r.courseEmail || ''
      if (!email) return { kind: 'problem', email: '', notes: ['Not in People — add their email to the line to invite them'] }
      if (!r.name) return { kind: 'problem', email, notes: ['Add their name to the line to invite them'] }
      if (r.possible.length && !r.confirmedNew) return { kind: 'problem', email, notes: ['Pick the matching person, or choose “New person”'] }
      return { kind: 'invite', email, notes: [r.courseEmail && !r.email ? 'Email from the course records' : ''].filter(Boolean) }
    }
    const differs = !!r.email && r.email !== (person.email ?? '').toLowerCase().trim()
    const email = differs && r.useNewEmail ? r.email : person.email
    if (!email) return { kind: 'problem', email: '', notes: ['No email on their record — add one to the line'] }
    const taken = differs && r.useNewEmail && people.find(p => p.id !== person.id && (p.email ?? '').toLowerCase().trim() === r.email)
    if (taken) return { kind: 'problem', email, notes: [`${r.email} already belongs to ${taken.name}`] }
    const s = status[person.id]
    const notes: string[] = []
    if (differs && r.useNewEmail) notes.push(`Changes their email from ${person.email || '(none)'}`)
    if (!s) notes.push(checking ? 'Checking login…' : 'Login status unknown')
    else if (!s.hasLogin) notes.push('Creates a login')
    else if (s.authEmail && s.authEmail.toLowerCase() !== email.toLowerCase()) notes.push(`Moves their sign-in from ${s.authEmail}`)
    if (person.canvasUserId) notes.push('Canvas user — Log in with Canvas still works; Canvas sets their email')
    if (person.status !== 'active') notes.push(`Record is ${person.status}`)
    return { kind: 'send', email, notes }
  }

  async function sendAll() {
    const todo = rows.filter(r => r.include && !r.result?.ok && plan(r).kind !== 'problem')
    if (!todo.length) return
    if (!confirm(`Email sign-in links to ${todo.length} ${todo.length === 1 ? 'person' : 'people'}?`)) return
    for (const [i, r] of todo.entries()) {
      setSending(`Sending ${i + 1} of ${todo.length}…`)
      const p = plan(r)
      try {
        if (p.kind === 'invite') {
          const { data } = await invitePersonFn({ name: r.name, email: p.email, role: newRole, canStandardize: false })
          update(r.key, { result: data.inviteEmailSent
            ? { ok: true, text: `Invited — sent to ${p.email}` }
            : { ok: false, text: 'Added and login created, but the email failed — use Forgot password?' } })
        } else {
          const person = people.find(x => x.id === r.personId)!
          if (p.email !== person.email) {
            await setPersonEmailFn({ personId: person.id, email: p.email })
            await updateDoc(doc(db, 'people', person.id), { email: p.email })
          }
          const { data } = await sendSignInLinkFn({ personId: person.id })
          update(r.key, { result: { ok: true, text: `Sent to ${data.email}${data.created ? ' (login created)' : data.movedFrom ? ` (sign-in moved from ${data.movedFrom})` : ''}` } })
        }
      } catch (e) {
        update(r.key, { result: { ok: false, text: e instanceof Error ? e.message : 'Failed' } })
      }
      // Stay under the email provider's rate limit
      await new Promise(res => setTimeout(res, 600))
    }
    setSending(null)
    queryClient.invalidateQueries({ queryKey: ['people'] })
  }

  const plans = rows.map(r => ({ r, p: plan(r) }))
  const ready = plans.filter(({ r, p }) => r.include && !r.result?.ok && p.kind !== 'problem').length
  const problems = plans.filter(({ p }) => p.kind === 'problem').length
  const sent = rows.filter(r => r.result?.ok).length

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link to="/admin" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Admin Tools
        </Link>
        <h1 className="text-2xl font-semibold">Email sign-in links</h1>
        <p className="text-sm text-muted-foreground">
          Paste the people to contact, one per line — a name, an email, or both (“Jane Smith, jane@example.com”). Each gets an email naming the address they
          sign in with and a link to set a password. People without a login get one; names not in People are invited.
        </p>
      </div>

      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        className="font-mono text-xs"
        placeholder={'Jane Smith, jane@example.com\njohn.doe@example.com\nAlex Brown'}
        aria-label="People to email"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" onClick={check} disabled={!text.trim() || !!sending}>Check list</Button>
        <label className="text-sm flex items-center gap-2">
          New people join as
          <select value={newRole} onChange={e => setNewRole(e.target.value as Person['role'])} className="border border-input rounded-md px-2 py-1 bg-background">
            <option value="trainee">Trainee</option>
            <option value="senior_rater">Senior Rater</option>
          </select>
        </label>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {rows.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} line{rows.length === 1 ? '' : 's'} · {ready} ready{problems > 0 && ` · ${problems} to sort out`}{sent > 0 && ` · ${sent} sent`}
          </p>
          <div className="rounded-md border divide-y text-sm">
            {plans.map(({ r, p }) => {
              const person = people.find(x => x.id === r.personId)
              const choices = r.matches.length > 1 ? r.matches : r.possible
              return (
                <div key={r.key} className="flex items-start gap-3 px-3 py-2">
                  <input
                    type="checkbox" className="mt-1"
                    checked={r.include && p.kind !== 'problem'}
                    disabled={p.kind === 'problem' || !!r.result?.ok}
                    onChange={e => update(r.key, { include: e.target.checked })}
                    aria-label={`Include ${r.input}`}
                  />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="font-mono text-xs text-muted-foreground truncate">{r.input}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {person
                        ? <span className="font-medium">{person.name}</span>
                        : p.kind === 'invite' ? <span className="font-medium">New: {r.name}</span> : null}
                      {p.email && <span className="text-muted-foreground">{p.email}</span>}
                      {choices.length > 0 && (r.matches.length > 1 || !r.matches.length) && (
                        <select
                          value={r.personId ?? (r.confirmedNew ? 'new' : '')}
                          onChange={e => update(r.key, { personId: e.target.value && e.target.value !== 'new' ? e.target.value : null, confirmedNew: e.target.value === 'new' })}
                          className="text-xs border rounded px-1 py-0.5 bg-background"
                          aria-label="Which person"
                        >
                          <option value="">Pick…</option>
                          {r.matches.length <= 1 && <option value="new">New person (not listed)</option>}
                          {choices.map(c => <option key={c.id} value={c.id}>{r.matches.length > 1 ? '' : 'Same person? '}{c.name} — {c.email || 'no email'}</option>)}
                        </select>
                      )}
                      {person && r.email && r.email !== (person.email ?? '').toLowerCase().trim() && (
                        <label className="text-xs flex items-center gap-1">
                          <input type="checkbox" checked={r.useNewEmail} onChange={e => update(r.key, { useNewEmail: e.target.checked })} />
                          use {r.email}
                        </label>
                      )}
                    </div>
                    {p.notes.length > 0 && (
                      <div className={`text-xs ${p.kind === 'problem' ? 'text-amber-700' : 'text-muted-foreground'}`}>{p.notes.join(' · ')}</div>
                    )}
                    {r.result && <div className={`text-xs ${r.result.ok ? 'text-green-700' : 'text-destructive'}`}>{r.result.text}</div>}
                  </div>
                  <span className={`text-[10px] rounded px-1 border shrink-0 ${p.kind === 'problem' ? 'text-amber-800 bg-amber-50 border-amber-200' : p.kind === 'invite' ? 'text-blue-800 bg-blue-50 border-blue-200' : 'text-teal-800 bg-teal-50 border-teal-200'}`}>
                    {p.kind === 'problem' ? 'sort out' : p.kind === 'invite' ? 'invite' : 'send link'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={sendAll} disabled={!ready || !!sending || checking}>
              {sending ?? `Email ${ready} sign-in link${ready === 1 ? '' : 's'}`}
            </Button>
            <span className="text-xs text-muted-foreground">Fix a line in the box above and click Check list again to re-match it.</span>
          </div>
        </>
      )}
    </div>
  )
}
