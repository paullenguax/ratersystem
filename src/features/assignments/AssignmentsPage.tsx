import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, query, where, writeBatch, doc, updateDoc } from 'firebase/firestore'
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
  const [publishing, setPublishing] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: assignments = [], isLoading } = useQuery({ queryKey: ['assignments'], queryFn: fetchAssignments })

  function openAdd() { setSelected(undefined); setDrawerOpen(true) }
  function openEdit(a: Assignment) { setSelected(a); setDrawerOpen(true) }

  async function publishAssignment(a: Assignment) {
    if (!window.confirm(`Publish ${a.raterName}'s scores from "${a.sessionName}"?\n\nThis will add all their scores to the main pool. This cannot be undone.`)) return
    setPublishing(a.id)
    try {
      // Fetch all scores for this assignment
      const snap = await getDocs(query(collection(db, 'scores'), where('assignmentId', '==', a.id)))

      // Batch-update scores to published
      for (let i = 0; i < snap.docs.length; i += 499) {
        const batch = writeBatch(db)
        snap.docs.slice(i, i + 499).forEach(d => batch.update(d.ref, { published: true }))
        await batch.commit()
      }

      // Mark assignment as published
      await updateDoc(doc(db, 'assignments', a.id), { status: 'published' })

      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      queryClient.invalidateQueries({ queryKey: ['scores'] })
    } finally {
      setPublishing(null)
    }
  }

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
                    <div className="flex items-center gap-2">
                      {a.status !== 'published' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={publishing === a.id}
                          onClick={() => publishAssignment(a)}
                        >
                          {publishing === a.id ? 'Publishing…' : 'Publish'}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>Edit</Button>
                    </div>
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
