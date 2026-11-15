import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import type { Test } from '@/types'
import { formatTestNumber } from '@/lib/testNumber'
import { rcSlots } from '@/lib/courses'
import { findDuplicateRecordings, mergeRecordings, suggestedKeeper, type DuplicateGroup } from '@/lib/mergeTests'
import { useCurrentPersonName } from '@/features/courses/MaterialsSection'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const fmtDuration = (s?: number) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—'

// Test Bank → Find duplicates: Training recordings uploaded more than once
// (usually to put the same audio in another RC set), with a one-click merge
// into the copy you keep.
export function DuplicatesPanel({ tests, playingUrl, onPlay, onClose }: {
  tests: Test[]
  playingUrl: string | null
  onPlay: (url: string) => void
  onClose: () => void
}) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, 0])

  useEffect(() => {
    let cancelled = false
    findDuplicateRecordings(tests, (d, t) => !cancelled && setProgress([d, t]))
      .then(g => !cancelled && setGroups(g))
    return () => { cancelled = true }
    // Scan once per opening; merges update the groups locally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Duplicate recordings</h2>
          <p className="text-sm text-muted-foreground">
            Active Training recordings that are the same audio file, or look like the same candidate's test. Merging keeps one
            copy: it takes on every course set and day of the others, their teaching notes are added under its own, and courses,
            practice sessions and session-plan references move across. The other copies are retired.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>

      {groups === null ? (
        <p className="text-sm text-muted-foreground">Checking {progress[1] ? `${progress[0]} of ${progress[1]}` : ''} recordings…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No duplicates found.</p>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <GroupCard key={g.tests.map(t => t.id).join()} group={g} playingUrl={playingUrl} onPlay={onPlay} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group, playingUrl, onPlay }: { group: DuplicateGroup; playingUrl: string | null; onPlay: (url: string) => void }) {
  const queryClient = useQueryClient()
  const myName = useCurrentPersonName()
  const [keepId, setKeepId] = useState(() => suggestedKeeper(group.tests).id)
  // "Likely" matches need a listen first, so nothing is ticked for them
  const [mergeIds, setMergeIds] = useState<Set<string>>(
    () => new Set(group.match === 'exact' ? group.tests.map(t => t.id) : []))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const keeper = group.tests.find(t => t.id === keepId)!
  const dups = group.tests.filter(t => t.id !== keepId && mergeIds.has(t.id))
  const label = (t: Test) => formatTestNumber(t.testId, t.category)

  function toggle(id: string) {
    setMergeIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function merge() {
    if (!confirm(`Merge ${dups.map(label).join(', ')} into ${label(keeper)}?\n\n${label(keeper)} takes on their course sets, teaching notes and course history, and ${dups.length === 1 ? 'the other copy is' : 'the other copies are'} retired. This can't be undone automatically.`)) return
    setBusy(true)
    try {
      const r = await mergeRecordings(keeper, dups, myName)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tests'] }),
        queryClient.invalidateQueries({ queryKey: ['courses'] }),
        queryClient.invalidateQueries({ queryKey: ['course-materials'] }),
      ])
      const moved = [
        r.courses && `${r.courses} course${r.courses === 1 ? '' : 's'}`,
        r.materials && `${r.materials} note${r.materials === 1 ? '' : 's'} renumbered`,
        r.practiceSessions && `${r.practiceSessions} practice session${r.practiceSessions === 1 ? '' : 's'}`,
        r.scores && `${r.scores} score${r.scores === 1 ? '' : 's'}`,
      ].filter(Boolean).join(', ')
      setDone(`Merged into ${label(keeper)}${moved ? ` (${moved} updated)` : ''}.${r.conflicts.length ? ` Kept as they were: ${r.conflicts.join('; ')}.` : ''}`)
    } catch (e) {
      alert(`Merge failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <span className="text-sm font-medium">
          {group.match === 'exact'
            ? <>Same audio file</>
            : <>Same candidate and test type <span className="text-muted-foreground font-normal">— listen to check, then tick the copies to merge</span></>}
        </span>
        {done ? null : (
          <Button size="sm" disabled={busy || dups.length === 0} onClick={merge}>
            {busy ? 'Merging…' : `Merge into ${label(keeper)}`}
          </Button>
        )}
      </div>
      {done ? (
        <p className="px-3 py-2 text-sm text-green-700">{done}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-1 font-normal">Keep</th>
              <th className="px-1 py-1 font-normal">Merge</th>
              <th className="px-1 py-1 font-normal" />
              <th className="px-1 py-1 font-normal">Recording</th>
              <th className="px-1 py-1 font-normal">Length</th>
              <th className="px-1 py-1 font-normal">Course sets</th>
              <th className="px-3 py-1 font-normal">Teaching notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {group.tests.map(t => {
              const isKeeper = t.id === keepId
              const notesLen = (t.teachingNotes ?? '').trim().length
              return (
                <tr key={t.id} className={isKeeper ? 'bg-primary/5' : ''}>
                  <td className="px-3 py-1.5">
                    <input type="radio" name={`keep-${group.tests[0].id}`} checked={isKeeper} onChange={() => setKeepId(t.id)} aria-label={`Keep ${label(t)}`} />
                  </td>
                  <td className="px-1 py-1.5">
                    <input type="checkbox" disabled={isKeeper} checked={!isKeeper && mergeIds.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Merge ${label(t)}`} />
                  </td>
                  <td className="px-1 py-1.5">
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Play ${label(t)}`} onClick={() => onPlay(t.recordingUrl)}>
                      {playingUrl === t.recordingUrl ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                    </Button>
                  </td>
                  <td className="px-1 py-1.5">
                    <span className="font-mono text-xs text-muted-foreground mr-1">{label(t)}</span>
                    {t.candidateName} <span className="text-xs text-muted-foreground">({t.testType})</span>
                  </td>
                  <td className="px-1 py-1.5 text-xs text-muted-foreground">{fmtDuration(t.durationSeconds)}</td>
                  <td className="px-1 py-1.5">
                    <div className="flex gap-1 flex-wrap">
                      {t.raterCourseDay && <Badge variant="outline">Rater Course · Day {t.raterCourseDay}</Badge>}
                      {rcSlots(t).map(s => <Badge key={s.n} variant="outline">RC{s.n}{s.day ? ` · Day ${s.day}` : ''}</Badge>)}
                      {!t.raterCourseDay && rcSlots(t).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground" title={t.teachingNotes ?? ''}>
                    {notesLen ? `${notesLen} characters` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
