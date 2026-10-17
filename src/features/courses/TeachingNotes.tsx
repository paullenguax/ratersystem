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
