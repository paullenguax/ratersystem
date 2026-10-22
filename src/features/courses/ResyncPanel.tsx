import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { doc, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Course, Test } from '@/types'
import { setForCourse, setLabel } from '@/lib/courses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Re-copies a set's current recordings into its runs. A run normally keeps
// the copy taken when it was created, so later edits to a set don't rewrite
// what earlier cohorts heard — this is the deliberate exception, for while a
// set is still being assembled (or, with a start date, for applying a changed
// set to current and future cohorts only). Runs a trainer has changed by hand
// (audioTweakedAt) are skipped and listed.
export function ResyncPanel({ courses, tests, initialSet = 'initial', onClose }: {
  courses: Course[]
  tests: Test[]
  initialSet?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const rcNumbers = [...new Set([
    ...courses.filter(c => c.kind === 'refresher' && c.number).map(c => c.number!),
    ...tests.map(t => t.refresherNumber ?? 0).filter(Boolean),
  ])].sort((a, b) => a - b)
  const [setKey, setSetKey] = useState(initialSet)
  const [fromDate, setFromDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const kind: Course['kind'] = setKey === 'initial' ? 'rater' : 'refresher'
  const number = kind === 'refresher' ? Number(setKey.slice(2)) : null
  const label = setLabel({ kind, number })
  const setTests = setForCourse(tests, { kind, number })
  const setIds = setTests.map(t => t.id)

  const runs = courses.filter(c =>
    c.kind === kind && (kind === 'rater' || c.number === number)
    && (!fromDate || (!!c.startDate && c.startDate >= fromDate)))
  const sameAudio = (c: Course) => {
    const a = [...(c.testDocIds ?? [])].sort()
    const b = [...setIds].sort()
    return a.length === b.length && a.every((id, i) => id === b[i])
  }
  const tweaked = runs.filter(c => c.audioTweakedAt)
  const upToDate = runs.filter(c => !c.audioTweakedAt && sameAudio(c))
  const toUpdate = runs.filter(c => !c.audioTweakedAt && !sameAudio(c))

  async function run() {
    if (!confirm(`Copy the ${label} (${setTests.length} recordings) into ${toUpdate.length} course${toUpdate.length === 1 ? '' : 's'}? Their students will then count as having heard exactly these recordings.`)) return
    setBusy(true)
    try {
      // Firestore batches cap at 500 writes
      for (let i = 0; i < toUpdate.length; i += 450) {
        const batch = writeBatch(db)
        toUpdate.slice(i, i + 450).forEach(c =>
          batch.update(doc(db, 'courses', c.id), { testDocIds: setIds, audioTweakedAt: null }))
        await batch.commit()
      }
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      setResult(`Updated ${toUpdate.length} course${toUpdate.length === 1 ? '' : 's'} from the ${label}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Re-sync from sets</h2>
          <p className="text-sm text-muted-foreground">
            Copies a set's current recordings into its courses. Use it while you're still tagging a set; once a set is settled,
            set a start date so changes only reach current and future cohorts and past courses keep what they actually heard.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block font-medium">Set</span>
          <select
            value={setKey}
            onChange={e => { setSetKey(e.target.value); setResult('') }}
            className="border border-input rounded-md px-2 py-1.5 bg-background"
          >
            <option value="initial">Initial Rater Course</option>
            {rcNumbers.map(n => <option key={n} value={`rc${n}`}>RC{n}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-medium">Only courses starting on or after</span>
          <Input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setResult('') }} className="w-44" />
        </label>
        {fromDate && <Button size="sm" variant="ghost" onClick={() => setFromDate('')}>All dates</Button>}
      </div>

      {setTests.length === 0 ? (
        <p className="text-sm text-amber-800">
          The {label} has no recordings yet — tag Training recordings {kind === 'rater' ? 'with a Rater Course day' : `as RC${number}`} in Test Bank first.
        </p>
      ) : (
        <div className="text-sm space-y-1">
          <p>
            <span className="font-medium">{toUpdate.length}</span> course{toUpdate.length === 1 ? '' : 's'} will get the {label} ({setTests.length} recording{setTests.length === 1 ? '' : 's'}).
            {upToDate.length > 0 && <span className="text-muted-foreground"> {upToDate.length} already match it.</span>}
            {!fromDate && runs.some(c => !c.startDate) && <span className="text-muted-foreground"> Includes undated courses.</span>}
          </p>
          {tweaked.length > 0 && (
            <details className="text-amber-800">
              <summary className="cursor-pointer">
                {tweaked.length} skipped — a trainer changed their audio by hand. Use “Update from set” on each one if you want the set there too.
              </summary>
              <ul className="mt-1 pl-4 list-disc">
                {tweaked.map(c => <li key={c.id}><Link to={`/courses/${c.id}`} className="underline">{c.name}</Link></li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={busy || setTests.length === 0 || toUpdate.length === 0}>
          {busy ? 'Updating…' : `Update ${toUpdate.length} course${toUpdate.length === 1 ? '' : 's'}`}
        </Button>
        {result && <span className="text-sm text-green-800">{result}</span>}
      </div>
    </div>
  )
}
