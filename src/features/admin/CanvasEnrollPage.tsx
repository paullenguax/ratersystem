import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckCircle2, AlertTriangle, Search, UserPlus, ChevronRight, RotateCcw } from 'lucide-react'

// ── types ─────────────────────────────────────────────────────────────────────

interface CanvasUser {
  canvasId: number
  name: string
  email: string
}

interface CanvasSection {
  id: number
  name: string
  courseId: number
  courseName: string
  courseDate: string
  displayName: string
}

interface ResolvedPerson {
  canvasUserId?: number   // undefined = create new account
  name: string
  inputEmail: string
  canvasEmail?: string    // the email currently on Canvas (may differ from inputEmail)
}

type Step =
  | { id: 'email' }
  | { id: 'name_search'; inputEmail: string }
  | { id: 'name_results'; inputEmail: string; results: CanvasUser[] }
  | { id: 'section_pick'; person: ResolvedPerson }
  | { id: 'confirm'; person: ResolvedPerson; section: CanvasSection; updateEmail: boolean; concludeOldSection: boolean }
  | { id: 'done'; person: ResolvedPerson; section: CanvasSection; result: EnrollResult }

interface EnrollResult {
  created: boolean
  alreadyEnrolled: boolean
  emailUpdated: boolean
  concludedSections: number[]
}

// ── firebase callables ────────────────────────────────────────────────────────

const lookupFn = httpsCallable<{ email: string }, { found: boolean; user?: CanvasUser }>(functions, 'canvasUserLookup')
const searchFn = httpsCallable<{ name: string }, { users: CanvasUser[] }>(functions, 'canvasUserSearch')
const sectionsFn = httpsCallable<Record<string, never>, { sections: CanvasSection[] }>(functions, 'canvasSections')
const enrollFn = httpsCallable<{
  canvasUserId?: number
  email: string
  firstName?: string
  lastName?: string
  sectionId: number
  updateEmail?: boolean
  concludeOldSection?: boolean
}, EnrollResult>(functions, 'canvasEnroll')

// ── sub-components ────────────────────────────────────────────────────────────

function StepCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-card p-6 space-y-5 max-w-lg">{children}</div>
}

function StepHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold">{children}</h2>
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
      <AlertTriangle className="size-4 shrink-0 mt-0.5" />
      {msg}
    </div>
  )
}

// ── EmailStep ─────────────────────────────────────────────────────────────────

function EmailStep({ onFound, onNotFound }: {
  onFound: (user: CanvasUser) => void
  onNotFound: (email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await lookupFn({ email: email.trim().toLowerCase() })
      if (res.data.found && res.data.user) {
        onFound(res.data.user)
      } else {
        onNotFound(email.trim().toLowerCase())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <StepCard>
      <StepHeading>Who are you enrolling?</StepHeading>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Email address</label>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="student@example.com"
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">
            We'll look this up in Canvas first.
          </p>
        </div>
        {error && <ErrorMsg msg={error} />}
        <Button type="submit" disabled={loading || !email}>
          {loading ? <><Search className="size-4 mr-2 animate-pulse" />Looking up…</> : <>Look up <ChevronRight className="size-4 ml-1" /></>}
        </Button>
      </form>
    </StepCard>
  )
}

// ── NameSearchStep ────────────────────────────────────────────────────────────

function NameSearchStep({ inputEmail, onFound, onNew, onBack }: {
  inputEmail: string
  onFound: (user: CanvasUser) => void
  onNew: (name: string) => void
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [results, setResults] = useState<CanvasUser[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await searchFn({ name: name.trim() })
      setResults(res.data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <StepCard>
      <div>
        <StepHeading>No Canvas account found</StepHeading>
        <p className="text-sm text-muted-foreground mt-1">
          No account exists for <span className="font-mono text-xs">{inputEmail}</span>.
          Enter their name to check if they have an account under a different email.
        </p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Full name</label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="John Smith"
              autoFocus
              required
            />
            <Button type="submit" disabled={loading || !name} variant="outline">
              {loading ? <Search className="size-4 animate-pulse" /> : <Search className="size-4" />}
            </Button>
          </div>
        </div>
        {error && <ErrorMsg msg={error} />}
      </form>

      {results !== null && (
        <div className="space-y-3">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches found in Canvas.</p>
          ) : (
            <>
              <p className="text-sm font-medium">Possible matches — is this the same person?</p>
              <div className="space-y-2">
                {results.map(user => (
                  <button
                    key={user.canvasId}
                    type="button"
                    onClick={() => onFound(user)}
                    className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{user.email}</p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="pt-2 border-t space-y-2">
            <p className="text-sm text-muted-foreground">
              Not there? This is a new person — we'll create a Canvas account for them.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onNew(name.trim())}
              disabled={!name.trim()}
            >
              <UserPlus className="size-4 mr-2" />
              Create new account for "{name.trim()}"
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back
      </button>
    </StepCard>
  )
}

// ── SectionPickStep ───────────────────────────────────────────────────────────

function SectionPickStep({ person, onConfirm, onBack }: {
  person: ResolvedPerson
  onConfirm: (section: CanvasSection, updateEmail: boolean, concludeOldSection: boolean) => void
  onBack: () => void
}) {
  const [sections, setSections] = useState<CanvasSection[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedSection, setSelectedSection] = useState<CanvasSection | null>(null)
  const [updateEmail, setUpdateEmail] = useState(false)
  const [concludeOldSection, setConcludeOldSection] = useState(true)

  const emailMismatch = person.canvasEmail && person.canvasEmail !== person.inputEmail

  async function loadSections() {
    setLoading(true)
    setError('')
    try {
      const res = await sectionsFn({})
      setSections(res.data.sections)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sections')
    } finally {
      setLoading(false)
    }
  }

  // Group sections by course for display
  const grouped = sections
    ? sections.reduce<Record<string, { courseName: string; courseDate: string; sections: CanvasSection[] }>>((acc, s) => {
        const key = String(s.courseId)
        if (!acc[key]) acc[key] = { courseName: s.courseName, courseDate: s.courseDate, sections: [] }
        acc[key].sections.push(s)
        return acc
      }, {})
    : {}

  return (
    <StepCard>
      <div>
        <StepHeading>Select a section</StepHeading>
        <p className="text-sm text-muted-foreground mt-1">
          Enrolling: <span className="font-medium text-foreground">{person.name}</span>
          {person.canvasUserId
            ? <span className="text-xs ml-1 text-muted-foreground">(existing Canvas account)</span>
            : <span className="text-xs ml-1 text-amber-600">(new Canvas account will be created)</span>
          }
        </p>
      </div>

      {!sections ? (
        <Button onClick={loadSections} disabled={loading} variant="outline">
          {loading ? 'Loading sections…' : 'Load sections from Canvas'}
        </Button>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {Object.values(grouped).map(group => (
            <div key={group.courseName}>
              <p className="text-xs font-medium text-muted-foreground px-1 py-1 sticky top-0 bg-card">
                {group.courseName}{group.courseDate ? ` (${group.courseDate})` : ''}
              </p>
              {group.sections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSection(s)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedSection?.id === s.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {error && <ErrorMsg msg={error} />}

      {/* Options — only show once a section is selected and person has existing account */}
      {selectedSection && person.canvasUserId && (
        <div className="space-y-3 pt-2 border-t">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={concludeOldSection}
              onChange={e => setConcludeOldSection(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium">Conclude previous section enrolment</p>
              <p className="text-xs text-muted-foreground">
                If they're already in another section of this course, mark it as concluded and move them to the new one.
              </p>
            </div>
          </label>

          {emailMismatch && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={updateEmail}
                onChange={e => setUpdateEmail(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">Update Canvas email</p>
                <p className="text-xs text-muted-foreground">
                  Change their Canvas login from{' '}
                  <span className="font-mono">{person.canvasEmail}</span> to{' '}
                  <span className="font-mono">{person.inputEmail}</span>
                </p>
              </div>
            </label>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          disabled={!selectedSection}
          onClick={() => selectedSection && onConfirm(selectedSection, updateEmail, concludeOldSection)}
        >
          Review & confirm <ChevronRight className="size-4 ml-1" />
        </Button>
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
    </StepCard>
  )
}

// ── ConfirmStep ───────────────────────────────────────────────────────────────

function ConfirmStep({ person, section, updateEmail, concludeOldSection, onConfirm, onBack }: {
  person: ResolvedPerson
  section: CanvasSection
  updateEmail: boolean
  concludeOldSection: boolean
  onConfirm: (result: EnrollResult) => void
  onBack: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleEnroll() {
    setError('')
    setLoading(true)
    try {
      const nameParts = person.name.trim().split(' ')
      const firstName = nameParts[0]
      const lastName = nameParts.slice(1).join(' ') || nameParts[0]

      const res = await enrollFn({
        canvasUserId: person.canvasUserId,
        email: person.inputEmail,
        firstName,
        lastName,
        sectionId: section.id,
        updateEmail,
        concludeOldSection,
      })
      onConfirm(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrolment failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <StepCard>
      <StepHeading>Confirm enrolment</StepHeading>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between py-1.5 border-b">
          <span className="text-muted-foreground">Person</span>
          <span className="font-medium">{person.name}</span>
        </div>
        <div className="flex justify-between py-1.5 border-b">
          <span className="text-muted-foreground">Email</span>
          <span className="font-mono text-xs">{person.inputEmail}</span>
        </div>
        <div className="flex justify-between py-1.5 border-b">
          <span className="text-muted-foreground">Course</span>
          <span className="font-medium text-right max-w-48">{section.courseName}</span>
        </div>
        <div className="flex justify-between py-1.5 border-b">
          <span className="text-muted-foreground">Section</span>
          <span className="font-medium">{section.name}</span>
        </div>
        {!person.canvasUserId && (
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Canvas account</span>
            <span className="text-amber-600 font-medium">Will be created</span>
          </div>
        )}
        {updateEmail && (
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Update email</span>
            <span className="text-blue-600 font-medium">Yes</span>
          </div>
        )}
        {concludeOldSection && person.canvasUserId && (
          <div className="flex justify-between py-1.5">
            <span className="text-muted-foreground">Conclude old section</span>
            <span className="text-blue-600 font-medium">If applicable</span>
          </div>
        )}
      </div>

      {error && <ErrorMsg msg={error} />}

      <div className="flex gap-2">
        <Button onClick={handleEnroll} disabled={loading}>
          {loading ? 'Enrolling…' : 'Enrol now'}
        </Button>
        <Button variant="ghost" onClick={onBack} disabled={loading}>Back</Button>
      </div>
    </StepCard>
  )
}

// ── DoneStep ──────────────────────────────────────────────────────────────────

function DoneStep({ person, section, result, onReset }: {
  person: ResolvedPerson
  section: CanvasSection
  result: EnrollResult
  onReset: () => void
}) {
  return (
    <StepCard>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="size-6 text-green-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">
            {result.alreadyEnrolled ? 'Already enrolled — no changes needed' : 'Done!'}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{person.name}</span>
            {result.alreadyEnrolled
              ? ` was already in ${section.name}.`
              : ` has been enrolled in ${section.name}.`}
          </p>
          {result.created && (
            <p className="text-sm text-muted-foreground">
              A new Canvas account was created — they'll receive a confirmation email from Canvas.
            </p>
          )}
          {result.emailUpdated && (
            <p className="text-sm text-muted-foreground">
              Canvas login email updated to {person.inputEmail}.
            </p>
          )}
          {result.concludedSections.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Previous section enrolment concluded.
            </p>
          )}
        </div>
      </div>

      <Button onClick={onReset} variant="outline">
        <RotateCcw className="size-4 mr-2" />
        Enrol another person
      </Button>
    </StepCard>
  )
}

// ── CanvasEnrollPage ──────────────────────────────────────────────────────────

export function CanvasEnrollPage() {
  const [step, setStep] = useState<Step>({ id: 'email' })
  const [person, setPerson] = useState<ResolvedPerson | null>(null)

  function reset() {
    setStep({ id: 'email' })
    setPerson(null)
  }

  // Email found — existing Canvas user, exact email match
  function handleEmailFound(user: CanvasUser) {
    const resolved: ResolvedPerson = {
      canvasUserId: user.canvasId,
      name: user.name,
      inputEmail: user.email,
      canvasEmail: user.email,
    }
    setPerson(resolved)
    setStep({ id: 'section_pick', person: resolved })
  }

  // Email not found — move to name search
  function handleEmailNotFound(inputEmail: string) {
    setStep({ id: 'name_search', inputEmail })
  }

  // Name search found an existing Canvas user (different email)
  function handleNameFound(user: CanvasUser, inputEmail: string) {
    const resolved: ResolvedPerson = {
      canvasUserId: user.canvasId,
      name: user.name,
      inputEmail,
      canvasEmail: user.email,
    }
    setPerson(resolved)
    setStep({ id: 'section_pick', person: resolved })
  }

  // Confirmed this is a new person — create a new account
  function handleNewPerson(name: string, inputEmail: string) {
    const resolved: ResolvedPerson = {
      canvasUserId: undefined,
      name,
      inputEmail,
    }
    setPerson(resolved)
    setStep({ id: 'section_pick', person: resolved })
  }

  function handleSectionConfirm(section: CanvasSection, updateEmail: boolean, concludeOldSection: boolean) {
    if (!person) return
    setStep({ id: 'confirm', person, section, updateEmail, concludeOldSection })
  }

  function handleEnrolled(result: EnrollResult) {
    if (step.id !== 'confirm') return
    setStep({ id: 'done', person: step.person, section: step.section, result })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Enrol in Canvas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add someone to a Canvas course section.
        </p>
      </div>

      {step.id === 'email' && (
        <EmailStep
          onFound={handleEmailFound}
          onNotFound={handleEmailNotFound}
        />
      )}

      {step.id === 'name_search' && (
        <NameSearchStep
          inputEmail={step.inputEmail}
          onFound={user => handleNameFound(user, step.inputEmail)}
          onNew={name => handleNewPerson(name, step.inputEmail)}
          onBack={reset}
        />
      )}

      {step.id === 'section_pick' && person && (
        <SectionPickStep
          person={person}
          onConfirm={handleSectionConfirm}
          onBack={() => reset()}
        />
      )}

      {step.id === 'confirm' && (
        <ConfirmStep
          person={step.person}
          section={step.section}
          updateEmail={step.updateEmail}
          concludeOldSection={step.concludeOldSection}
          onConfirm={handleEnrolled}
          onBack={() => person && setStep({ id: 'section_pick', person })}
        />
      )}

      {step.id === 'done' && (
        <DoneStep
          person={step.person}
          section={step.section}
          result={step.result}
          onReset={reset}
        />
      )}
    </div>
  )
}
