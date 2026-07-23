import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, query, where, getDocs, doc, getDoc,
  addDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { ArrowLeft, Plus, Pencil, Eye, Rocket, Copy, Archive as ArchiveIcon, Download } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { StorylinePart, StorylinePartNumber, StorylineTemplate, StorylineTest, StorylineVersion } from '@/types'
import { previewStorylineVersion } from './useStorylinePreview'
import { exportStorylineVersion } from './exportStoryline'
import { resolveItems } from './resolveItems'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

async function fetchTest(testId: string): Promise<StorylineTest | null> {
  const snap = await getDoc(doc(db, 'storyline_tests', testId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTest) : null
}

async function fetchVersions(testId: string): Promise<StorylineVersion[]> {
  const snap = await getDocs(query(collection(db, 'storyline_versions'), where('testId', '==', testId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylineVersion)
}

async function fetchTemplate(): Promise<StorylineTemplate | null> {
  const snap = await getDoc(doc(db, 'storyline_template', 'current'))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StorylineTemplate) : null
}

async function fetchParts(): Promise<StorylinePart[]> {
  const snap = await getDocs(collection(db, 'storyline_parts'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePart)
}

const PART_NUMBERS: StorylinePartNumber[] = [1, 2, 3, 4]

function statusVariant(status: StorylineVersion['status']) {
  if (status === 'published') return 'default'
  if (status === 'archived') return 'secondary'
  return 'outline'
}

export function StorylineVersionsPage() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const { data: test } = useQuery({
    queryKey: ['storyline_test', testId],
    queryFn: () => fetchTest(testId!),
    enabled: !!testId,
  })

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['storyline_versions', testId],
    queryFn: () => fetchVersions(testId!),
    enabled: !!testId,
  })

  const { data: template } = useQuery({ queryKey: ['storyline_template'], queryFn: fetchTemplate })
  const { data: parts = [] } = useQuery({ queryKey: ['storyline_parts'], queryFn: fetchParts })

  function selectedParts(version: StorylineVersion) {
    const selected: Partial<Record<StorylinePartNumber, StorylinePart>> = {}
    for (const n of PART_NUMBERS) {
      const p = parts.find(part => part.id === version.partRefs?.[n])
      if (p) selected[n] = p
    }
    return selected
  }

  async function handleNewDraft() {
    const docRef = await addDoc(collection(db, 'storyline_versions'), {
      testId,
      versionLabel: `Draft ${new Date().toLocaleString()}`,
      status: 'draft',
      partRefs: {},
      slotContent: {},
      items: [],
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
    })
    navigate(`/test-versions/${testId}/versions/${docRef.id}/edit`)
  }

  async function handleDuplicate(version: StorylineVersion) {
    const docRef = await addDoc(collection(db, 'storyline_versions'), {
      testId,
      versionLabel: `${version.versionLabel} (copy)`,
      status: 'draft',
      partRefs: version.partRefs ?? {},
      slotContent: version.slotContent ?? {},
      items: [],
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
    })
    queryClient.invalidateQueries({ queryKey: ['storyline_versions', testId] })
    navigate(`/test-versions/${testId}/versions/${docRef.id}/edit`)
  }

  async function handlePublish(version: StorylineVersion) {
    if (!template) {
      window.alert('No Script Template found — set one up first.')
      return
    }
    const chosenParts = selectedParts(version)
    const missingOrDraft = PART_NUMBERS.filter(n => !chosenParts[n] || chosenParts[n]!.status !== 'published')
    if (missingOrDraft.length > 0) {
      window.alert(`Can't publish — Part ${missingOrDraft.join(', ')} is missing or still a draft. Every Part must be published first.`)
      return
    }
    if (!window.confirm(`Publish "${version.versionLabel}"? Published versions are immutable — further edits require duplicating as a new draft.`)) return
    const items = resolveItems(template.slides, test?.variables, version.slotContent ?? {}, chosenParts)
    await updateDoc(doc(db, 'storyline_versions', version.id), {
      items,
      status: 'published',
      publishedAt: serverTimestamp(),
    })
    queryClient.invalidateQueries({ queryKey: ['storyline_versions', testId] })
  }

  function handlePreview(version: StorylineVersion) {
    if (version.status === 'draft') {
      if (!template) {
        window.alert('No Script Template found — set one up first.')
        return
      }
      previewStorylineVersion(resolveItems(template.slides, test?.variables, version.slotContent ?? {}, selectedParts(version)))
    } else {
      previewStorylineVersion(version.items)
    }
  }

  async function handleExport(version: StorylineVersion) {
    if (!test) return
    try {
      await exportStorylineVersion(test, version)
    } catch (err) {
      window.alert(`Export failed: ${String(err)}`)
    }
  }

  async function handleArchive(version: StorylineVersion) {
    if (!window.confirm(`Archive "${version.versionLabel}"?`)) return
    await updateDoc(doc(db, 'storyline_versions', version.id), { status: 'archived' })
    queryClient.invalidateQueries({ queryKey: ['storyline_versions', testId] })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{test?.name ?? 'Versions'}</h1>
          {test?.description && <p className="text-sm text-muted-foreground">{test.description}</p>}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleNewDraft}>
          <Plus className="size-4 mr-2" /> New draft
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Parts / slides filled</TableHead>
                <TableHead>Published</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No versions yet.
                  </TableCell>
                </TableRow>
              ) : (
                versions.map(version => (
                  <TableRow key={version.id}>
                    <TableCell>{version.versionLabel}</TableCell>
                    <TableCell><Badge variant={statusVariant(version.status)}>{version.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {version.status === 'draft'
                        ? `${Object.keys(version.partRefs ?? {}).length}/4 parts, ${Object.keys(version.slotContent ?? {}).length} slides`
                        : `${version.items.length} items`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {version.publishedAt ? version.publishedAt.toDate().toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        {version.status === 'draft' && (
                          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/test-versions/${testId}/versions/${version.id}/edit`} />}>
                            <Pencil className="size-4 mr-1" /> Edit
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => handlePreview(version)}>
                          <Eye className="size-4 mr-1" /> Preview
                        </Button>
                        {version.status === 'draft' && (
                          <Button variant="ghost" size="sm" onClick={() => handlePublish(version)}>
                            <Rocket className="size-4 mr-1" /> Publish
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => handleDuplicate(version)}>
                          <Copy className="size-4 mr-1" /> Duplicate
                        </Button>
                        {version.status === 'published' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handleExport(version)}>
                              <Download className="size-4 mr-1" /> Export
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleArchive(version)}>
                              <ArchiveIcon className="size-4 mr-1" /> Archive
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
