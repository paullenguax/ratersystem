import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// "1:23" or "12:05" (m:ss) anywhere in the text — not inside a longer
// number, and not h:mm:ss (recordings are well under an hour).
const TIMESTAMP = /(?<![\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g

export function parseTimestamp(text: string): number | null {
  const m = text.match(/^(\d{1,2}):([0-5]\d)$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// Renders teaching notes as markdown. With onSeek, each timestamp becomes a
// button that jumps the player to that point.
export function TeachingNotesView({ markdown, onSeek }: { markdown: string; onSeek?: (seconds: number) => void }) {
  const linked = onSeek ? markdown.replace(TIMESTAMP, (ts) => `[${ts}](#t)`) : markdown
  return (
    <div className="manual-prose text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const label = String(Array.isArray(children) ? children.join('') : children ?? '')
            const seconds = href === '#t' ? parseTimestamp(label) : null
            if (seconds != null && onSeek) {
              return (
                <button
                  type="button"
                  onClick={() => onSeek(seconds)}
                  className="font-mono text-xs px-1 rounded border border-primary/40 text-primary hover:bg-primary/10 no-underline"
                  title={`Play from ${label}`}
                >
                  ▶ {label}
                </button>
              )
            }
            return <a href={href} target="_blank" rel="noopener">{children}</a>
          },
        }}
      >
        {linked}
      </ReactMarkdown>
    </div>
  )
}

// "T12" — a Training recording referenced by its number. Not part of a
// longer word ("ATC12") or a "#T12" anchor.
const RECORDING_REF = /(?<![\w#])T(\d{1,4})\b/g

// Recording numbers a session plan mentions, in first-mention order
export function recordingRefsInOrder(markdown: string): number[] {
  const seen: number[] = []
  for (const m of markdown.matchAll(RECORDING_REF)) {
    const n = Number(m[1])
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

export interface PlanRecording { id: string; label: string; name: string }

// Renders a session plan. Each "T12" for a recording in this course becomes
// a play button (✓ once played); one that isn't in the course stays text.
export function SessionPlanView({ markdown, recordings, playedIds, currentId, onPlay }: {
  markdown: string
  recordings: Map<number, PlanRecording>
  playedIds: Set<string>
  currentId: string | null
  onPlay: (id: string) => void
}) {
  const linked = markdown.replace(RECORDING_REF, (ref, n) => `[${ref}](#rec-${n})`)
  return (
    <div className="manual-prose text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#rec-(\d+)$/)
            if (!m) return <a href={href} target="_blank" rel="noopener">{children}</a>
            const rec = recordings.get(Number(m[1]))
            if (!rec) {
              return (
                <span className="underline decoration-dotted" title="Not in this course's audio — add it on the course page, or check the number">
                  {children}
                </span>
              )
            }
            const played = playedIds.has(rec.id)
            const current = currentId === rec.id
            return (
              <button
                type="button"
                onClick={() => onPlay(rec.id)}
                title={`${played ? 'Played — play again' : 'Play'}: ${rec.label} ${rec.name}`}
                className={`font-mono text-xs px-1 rounded border no-underline align-baseline ${
                  current ? 'bg-primary text-primary-foreground border-primary'
                    : played ? 'border-green-300 bg-green-50 text-green-800'
                      : 'border-primary/40 text-primary hover:bg-primary/10'}`}
              >
                {played ? '✓' : '▶'} {rec.label}
              </button>
            )
          },
        }}
      >
        {linked}
      </ReactMarkdown>
    </div>
  )
}
