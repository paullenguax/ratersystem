import { useState, useEffect } from 'react'
import { collection, getDocs, orderBy, query, limit, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── types ─────────────────────────────────────────────────────────────────────

type EnrollStatus =
  | 'enrolled'
  | 'new_account'
  | 'already_enrolled'
  | 'matched_by_name'
  | 'probable_duplicate'
  | 'failed'

interface LogEntry {
  id: string
  source: 'woocommerce' | 'manual'
  email: string
  name?: string
  canvasUserId?: number | null
  sectionId?: number | null
  sectionName?: string
  status: EnrollStatus
  orderId?: string | null
  emailUpdated?: boolean
  concludedSections?: number[]
  enrolledBy?: string
  timestamp: Timestamp
}

// ── helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EnrollStatus }) {
  const map: Record<EnrollStatus, { label: string; className: string; icon: React.ReactNode }> = {
    enrolled: {
      label: 'Enrolled',
      className: 'bg-green-50 text-green-700 border-green-200',
      icon: <CheckCircle2 className="size-3.5" />,
    },
    new_account: {
      label: 'New account',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: <CheckCircle2 className="size-3.5" />,
    },
    already_enrolled: {
      label: 'Already enrolled',
      className: 'bg-gray-50 text-gray-600 border-gray-200',
      icon: <Info className="size-3.5" />,
    },
    matched_by_name: {
      label: 'Matched by name',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: <AlertTriangle className="size-3.5" />,
    },
    probable_duplicate: {
      label: 'Probable duplicate',
      className: 'bg-red-50 text-red-700 border-red-200',
      icon: <AlertTriangle className="size-3.5" />,
    },
    failed: {
      label: 'Failed',
      className: 'bg-red-50 text-red-700 border-red-200',
      icon: <AlertTriangle className="size-3.5" />,
    },
  }
  const { label, className, icon } = map[status] ?? map.failed
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${className}`}>
      {icon}
      {label}
    </span>
  )
}

function formatDate(ts: Timestamp) {
  return ts.toDate().toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

type Filter = 'all' | 'needs_review' | 'woocommerce' | 'manual'

// ── EnrollmentLogPage ─────────────────────────────────────────────────────────

export function EnrollmentLogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  async function load() {
    setLoading(true)
    try {
      const q = query(
        collection(db, 'canvasEnrollmentLog'),
        orderBy('timestamp', 'desc'),
        limit(200)
      )
      const snap = await getDocs(q)
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as LogEntry)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = entries.filter(e => {
    if (filter === 'needs_review') return e.status === 'matched_by_name' || e.status === 'probable_duplicate'
    if (filter === 'woocommerce') return e.source === 'woocommerce'
    if (filter === 'manual') return e.source === 'manual'
    return true
  })

  const reviewCount = entries.filter(e =>
    e.status === 'matched_by_name' || e.status === 'probable_duplicate'
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enrolment Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All Canvas enrolments — WooCommerce purchases and manual enrolments.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Review banner */}
      {reviewCount > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {reviewCount} enrolment{reviewCount !== 1 ? 's' : ''} need review
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              These were matched by name (different email) or flagged as a probable duplicate.
              Check they are the correct person in Canvas.
            </p>
            <button
              className="text-xs text-amber-700 underline mt-1"
              onClick={() => setFilter('needs_review')}
            >
              Show only these
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {(['all', 'needs_review', 'woocommerce', 'manual'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === f
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' && 'All'}
            {f === 'needs_review' && <>Needs review {reviewCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">{reviewCount}</span>}</>}
            {f === 'woocommerce' && 'WooCommerce'}
            {f === 'manual' && 'Manual'}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries found.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">When</th>
                <th className="text-left px-3 py-2 font-medium">Person</th>
                <th className="text-left px-3 py-2 font-medium">Section</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => (
                <tr key={entry.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {entry.timestamp ? formatDate(entry.timestamp) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {entry.name && <p className="font-medium">{entry.name}</p>}
                    <p className="text-xs text-muted-foreground font-mono">{entry.email}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {entry.sectionName || (entry.sectionId ? `Section ${entry.sectionId}` : '—')}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      entry.source === 'woocommerce'
                        ? 'bg-purple-50 text-purple-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {entry.source === 'woocommerce' ? 'WooCommerce' : 'Manual'}
                    </span>
                    {entry.orderId && (
                      <p className="text-xs text-muted-foreground mt-0.5">#{entry.orderId}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
            Showing {filtered.length} of {entries.length} entries (most recent 200)
          </div>
        </div>
      )}
    </div>
  )
}
