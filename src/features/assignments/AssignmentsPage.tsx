import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { Plus } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { Assignment } from '@/types'
import { AssignmentDrawer } from './AssignmentDrawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const STATUS_VARIANT: Record<Assignment['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending:   'secondary',
  submitted: 'default',
  reviewed:  'outline',
  published: 'outline',
}

async function fetchAssignments(): Promise<Assignment[]> {
  const snap = await getDocs(collection(db, 'assignments'))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }) as Assignment)
    .sort((a, b) => {
      const sA = a.sessionName.localeCompare(b.sessionName)
      return sA !== 0 ? sA : a.raterName.localeCompare(b.raterName)
    })
}

export function AssignmentsPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Assignment | undefined>()

  const { data: assignments = [], isLoading } = useQuery({ queryKey: ['assignments'], queryFn: fetchAssignments })

  function openAdd() { setSelected(undefined); setDrawerOpen(true) }
  function openEdit(a: Assignment) { setSelected(a); setDrawerOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Assignments</h1>
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" /> New assignment
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Rater</TableHead>
                <TableHead className="text-center">Tests</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="text-muted-foreground text-sm">{a.sessionName}</TableCell>
                  <TableCell className="font-medium">{a.raterName}</TableCell>
                  <TableCell className="text-center text-sm">{a.testDocIds.length}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[a.status]}>
                      {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{a.notes}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AssignmentDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} assignment={selected} />
    </div>
  )
}
