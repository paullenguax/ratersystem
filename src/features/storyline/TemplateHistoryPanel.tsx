import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore'
import { History, Star, RotateCcw, Trash2, Pencil } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { StorylineTemplateSnapshot, TemplateSlide, StorylineTheme } from '@/types'
import { Button } from '@/components/ui/button'

const HISTORY_PATH = ['storyline_template', 'current', 'history'] as const

async function fetchHistory(): Promise<StorylineTemplateSnapshot[]> {
  const snap = await getDocs(
    query(collection(db, ...HISTORY_PATH), orderBy('savedAt', 'desc'), limit(100)),
  )
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<StorylineTemplateSnapshot, 'id'>) }))
}

function formatWhen(s: StorylineTemplateSnapshot): string {
  const d = s.savedAt?.toDate?.()
  return d ? d.toLocaleString() : '—'
}

export function TemplateHistoryPanel({
  onRestore,
}: {
  onRestore: (slides: TemplateSlide[], theme: StorylineTheme | undefined) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['storyline_template_history'],
    queryFn: fetchHistory,
    enabled: open,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['storyline_template_history'] })
  }

  async function togglePin(s: StorylineTemplateSnapshot) {
    await updateDoc(doc(db, ...HISTORY_PATH, s.id), { pinned: !s.pinned })
    refresh()
  }

  async function editLabel(s: StorylineTemplateSnapshot) {
    const label = window.prompt('Label for this snapshot (leave blank to clear):', s.label ?? '')
    if (label === null) return
    await updateDoc(doc(db, ...HISTORY_PATH, s.id), { label: label.trim() || null })
    refresh()
  }

  async function remove(s: StorylineTemplateSnapshot) {
    if (!window.confirm(`Delete the snapshot from ${formatWhen(s)}? This can't be undone.`)) return
    await deleteDoc(doc(db, ...HISTORY_PATH, s.id))
    refresh()
  }

  function restore(s: StorylineTemplateSnapshot) {
    if (
      !window.confirm(
        `Load the ${formatWhen(s)} snapshot into the editor?\n\n` +
          'Nothing is saved yet — review it, then click Save (which snapshots again). ' +
          'If this snapshot predates a slide being added/renamed, restoring it may unlink ' +
          "that slide's Part/Version content until you fix it.",
      )
    )
      return
    onRestore(s.slides, s.theme)
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
      >
        <History className="size-4" />
        Version history
        <span className="text-xs text-muted-foreground">
          — every Save is snapshotted here so it can be undone
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t px-4 py-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && !snapshots?.length && (
            <p className="text-sm text-muted-foreground">
              No snapshots yet — the next Save will create the first one.
            </p>
          )}
          {!!snapshots?.length && (
            <ul className="divide-y">
              {snapshots.map(s => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => togglePin(s)}
                    title={s.pinned ? 'Unpin' : 'Pin (keeps it out of any future cleanup)'}
                    className={s.pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}
                  >
                    <Star className="size-4" fill={s.pinned ? 'currentColor' : 'none'} />
                  </button>
                  <span className="tabular-nums">{formatWhen(s)}</span>
                  {s.savedByName && <span className="text-muted-foreground">by {s.savedByName}</span>}
                  <span className="text-muted-foreground">· {s.slides.length} slides</span>
                  {s.label && <span className="font-medium">“{s.label}”</span>}
                  <button
                    type="button"
                    onClick={() => editLabel(s)}
                    title="Edit label"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => restore(s)}>
                      <RotateCcw className="size-3.5" /> Restore
                    </Button>
                    {!s.pinned && (
                      <button
                        type="button"
                        onClick={() => remove(s)}
                        title="Delete snapshot"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
