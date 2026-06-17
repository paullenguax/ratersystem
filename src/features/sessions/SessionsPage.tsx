import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Session } from '@/types'
import { SessionDrawer } from './SessionDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const TYPE_LABELS: Record<Session['type'], string> = {
  refresher:   'Refresher Course',
  reliability: 'Reliability Check',
  calibration: 'Calibration',
  historical:  'Historical Import',
  ad_hoc:      'Ad hoc',
}

const STATUS_VARIANT: Record<Session['status'], 'default' | 'secondary' | 'outline'> = {
  open:      'default',
  closed:    'secondary',
  published: 'outline',
}

async function fetchSessions(): Promise<Session[]> {
  const snap = await getDocs(collection(db, 'sessions'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Session)
    .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds)
}

export function SessionsPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Session | undefined>()

  const { data: sessions = [], isLoading } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions })

  function openAdd() { setSelected(undefined); setDrawerOpen(true) }
  function openEdit(s: Session) { setSelected(s); setDrawerOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" /> New session
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet — create one to start recording scores.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{TYPE_LABELS[s.type]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status]}>
                      {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{s.notes}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SessionDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} session={selected} />
    </div>
  )
}
