import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  collection, getDocs, query, where,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { PracticeSession, PracticeScore } from '@/types'
import { IcaoSliders, type DimScores } from '@/features/scoring/IcaoSliders'
import { Button } from '@/components/ui/button'

type PageState = 'loading' | 'not-found' | 'closed' | 'name-entry' | 'scoring' | 'done'

function levelColour(n: number) {
  if (n >= 5) return 'text-green-700 bg-green-50 border-green-300'
  if (n === 4) return 'text-blue-700 bg-blue-50 border-blue-300'
  if (n === 3) return 'text-amber-700 bg-amber-50 border-amber-300'
  return 'text-red-700 bg-red-50 border-red-300'
}

const LS_KEY = (code: string) => `practice_${code}`

interface StoredSubmission {
  name: string
  docId: string
}

export function PracticeScorePage() {
  const { code } = useParams<{ code: string }>()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [session, setSession] = useState<PracticeSession | null>(null)
  const [name, setName] = useState('')
  const [scores, setScores] = useState<DimScores>([null, null, null, null, null, null])
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [existingDocId, setExistingDocId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (!code) { setPageState('not-found'); return }

    async function load() {
      const snap = await getDocs(query(collection(db, 'practice_sessions'), where('code', '==', code!.toUpperCase())))
      if (snap.empty) { setPageState('not-found'); return }

      const s = { id: snap.docs[0].id, ...snap.docs[0].data() } as PracticeSession
      setSession(s)

      if (s.status === 'closed') { setPageState('closed'); return }

      const stored: StoredSubmission | null = JSON.parse(localStorage.getItem(LS_KEY(code!)) ?? 'null')
      if (stored) {
        setName(stored.name)
        setExistingDocId(stored.docId)
        setPageState('done')
      } else {
        setPageState('name-entry')
      }
    }

    load()
  }, [code])

  // Keyboard shortcut: 1–6 fills next unscored dimension
  useEffect(() => {
    if (pageState !== 'scoring') return
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const n = parseInt(e.key)
      if (n >= 1 && n <= 6) {
        setScores(prev => {
          const next = [...prev] as DimScores
          const firstNull = next.findIndex(v => v === null)
          if (firstNull !== -1) next[firstNull] = n
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pageState])

  function startScoring() {
    if (!name.trim()) return
    setScores([null, null, null, null, null, null])
    setShowErrors(false)
    setPageState('scoring')
  }

  async function handleSubmit() {
    if (!session || scores.some(s => s === null)) {
      setShowErrors(true)
      return
    }
    if (existingDocId && !confirm('Replace your previous scores for this test?')) return
    const [p, st, v, fl, c, inter] = scores as number[]
    const overall = Math.min(p, st, v, fl, c, inter)
    setSubmitting(true)
    try {
      const payload: Omit<PracticeScore, 'id'> = {
        sessionId: session.id,
        sessionCode: session.code,
        participantName: name.trim(),
        pronunciation: p, structure: st, vocabulary: v,
        fluency: fl, comprehension: c, interactions: inter,
        overallLevel: overall,
        sortKey: Math.random(),
        submittedAt: serverTimestamp() as PracticeScore['submittedAt'],
      }

      let docId = existingDocId
      if (docId) {
        await updateDoc(doc(db, 'practice_scores', docId), {
          pronunciation: p, structure: st, vocabulary: v,
          fluency: fl, comprehension: c, interactions: inter,
          overallLevel: overall,
          submittedAt: serverTimestamp(),
        })
      } else {
        const ref = await addDoc(collection(db, 'practice_scores'), payload)
        docId = ref.id
      }

      localStorage.setItem(LS_KEY(code!), JSON.stringify({ name: name.trim(), docId }))
      setExistingDocId(docId)
      setPageState('done')
    } finally {
      setSubmitting(false)
    }
  }

  const allScored = scores.every(s => s !== null)
  const overall = allScored ? Math.min(...(scores as number[])) : null

  // ── shell ──────────────────────────────────────────────────────────────

  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b px-4 py-3 flex items-center gap-3">
          <div className="size-7 rounded bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground text-xs font-bold">L</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">Lenguax Practice</p>
            {session && <p className="text-xs text-muted-foreground mt-0.5 truncate">{session.title}</p>}
          </div>
        </div>
        <div className="px-4 py-6 max-w-lg mx-auto">
          {children}
        </div>
      </div>
    )
  }

  // ── states ─────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <Shell>
        <p className="text-muted-foreground text-sm text-center py-20">Loading…</p>
      </Shell>
    )
  }

  if (pageState === 'not-found') {
    return (
      <Shell>
        <div className="text-center py-20 space-y-2">
          <p className="font-semibold">Session not found</p>
          <p className="text-sm text-muted-foreground">Check the link and try again.</p>
        </div>
      </Shell>
    )
  }

  if (pageState === 'closed') {
    return (
      <Shell>
        <div className="text-center py-20 space-y-2">
          <p className="font-semibold">This session is closed</p>
          <p className="text-sm text-muted-foreground">The trainer has ended this practice session.</p>
        </div>
      </Shell>
    )
  }

  if (pageState === 'done') {
    return (
      <Shell>
        <div className="space-y-6 py-8">
          <div className="text-center space-y-2">
            <div className="text-4xl">✓</div>
            <p className="text-xl font-semibold">Scores submitted</p>
            <p className="text-sm text-muted-foreground">Thanks, {name}. Your trainer can see your results.</p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setScores([null, null, null, null, null, null])
              setShowErrors(false)
              setPageState('scoring')
            }}
          >
            Re-score this test
          </Button>
        </div>
      </Shell>
    )
  }

  if (pageState === 'name-entry') {
    return (
      <Shell>
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold">Enter your name</h1>
            <p className="text-sm text-muted-foreground mt-1">Your trainer will see this next to your scores.</p>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') startScoring() }}
              autoFocus
              className="w-full border border-input rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button className="w-full" disabled={!name.trim()} onClick={startScoring}>
              Start scoring
            </Button>
          </div>
        </div>
      </Shell>
    )
  }

  // scoring state
  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="border-b px-4 py-3 flex items-center gap-3">
        <div className="size-7 rounded bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground text-xs font-bold">L</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-none">Lenguax Practice</p>
          {session && <p className="text-xs text-muted-foreground mt-0.5 truncate">{session.title}</p>}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{name}</span>
      </div>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-5">

        {/* Audio player */}
        {session?.audioUrl ? (
          <div className="rounded-lg bg-muted/40 p-4 space-y-2 border">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium">Recording</p>
              <div className="flex gap-1">
                {[0.75, 1, 1.25, 1.5].map(speed => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => {
                      setPlaybackSpeed(speed)
                      if (audioRef.current) audioRef.current.playbackRate = speed
                    }}
                    className={`px-2 py-0.5 text-xs rounded font-medium border transition-colors ${
                      playbackSpeed === speed
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
            </div>
            <audio
              ref={audioRef}
              controls
              controlsList="nodownload"
              onContextMenu={e => e.preventDefault()}
              onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = playbackSpeed }}
              className="w-full"
              src={session.audioUrl}
              preload="metadata"
            />
          </div>
        ) : (
          <div className="rounded-lg bg-muted/40 px-4 py-3 border text-sm text-muted-foreground">
            Your trainer is playing the recording — listen and score below.
          </div>
        )}

        <IcaoSliders scores={scores} onChange={setScores} showErrors={showErrors} />

      </div>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground shrink-0">Overall</span>
            {overall !== null
              ? <span className={`text-base font-bold px-2 py-0.5 rounded border ${levelColour(overall)}`}>{overall}</span>
              : <span className="text-sm text-muted-foreground">—</span>
            }
            <span className="text-xs text-muted-foreground ml-2 truncate">
              {scores.filter(s => s !== null).length}/6 scored
            </span>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!allScored || submitting}
            className="shrink-0"
          >
            {submitting ? 'Saving…' : existingDocId ? 'Update scores' : 'Submit scores'}
          </Button>
        </div>
      </div>
    </div>
  )
}
