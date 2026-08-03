import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, addDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/context/AuthContext'
import type { StorylinePartTheme, StorylineThemeRule } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchThemes(): Promise<StorylinePartTheme[]> {
  const snap = await getDocs(collection(db, 'storyline_themes'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylinePartTheme).sort((a, b) => a.label.localeCompare(b.label))
}

async function fetchRules(): Promise<StorylineThemeRule[]> {
  const snap = await getDocs(collection(db, 'storyline_theme_rules'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as StorylineThemeRule)
}

// Part 1 and Part 4 draw from one shared theme vocabulary (not two
// parallel lists) — the same real-world topic (e.g. "Weather") can
// plausibly show up as either a Part 1 or Part 4 topic.
export function StorylineThemeRulesPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [newThemeLabel, setNewThemeLabel] = useState('')
  const [part1ThemeId, setPart1ThemeId] = useState('')
  const [part4ThemeId, setPart4ThemeId] = useState('')
  const [ruleNote, setRuleNote] = useState('')

  const { data: themes = [], isLoading: themesLoading } = useQuery({ queryKey: ['storyline_themes'], queryFn: fetchThemes })
  const { data: rules = [], isLoading: rulesLoading } = useQuery({ queryKey: ['storyline_theme_rules'], queryFn: fetchRules })

  const themeLabel = (id: string) => themes.find(t => t.id === id)?.label ?? id

  async function handleAddTheme() {
    const label = newThemeLabel.trim()
    if (label === '') return
    await addDoc(collection(db, 'storyline_themes'), {
      label,
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
    })
    setNewThemeLabel('')
    queryClient.invalidateQueries({ queryKey: ['storyline_themes'] })
  }

  async function handleDeleteTheme(theme: StorylinePartTheme) {
    const inUseByRule = rules.some(r => r.part1ThemeId === theme.id || r.part4ThemeId === theme.id)
    if (inUseByRule) {
      window.alert(`"${theme.label}" is used by an unmixable-pair rule below — delete that rule first.`)
      return
    }
    if (!window.confirm(`Delete theme "${theme.label}"? Any Part currently tagged with it will just show "No theme" — nothing else breaks.`)) return
    await deleteDoc(doc(db, 'storyline_themes', theme.id))
    queryClient.invalidateQueries({ queryKey: ['storyline_themes'] })
  }

  async function handleAddRule() {
    if (!part1ThemeId || !part4ThemeId) return
    const exists = rules.some(r => r.part1ThemeId === part1ThemeId && r.part4ThemeId === part4ThemeId)
    if (exists) {
      window.alert('That pair is already marked unmixable.')
      return
    }
    await addDoc(collection(db, 'storyline_theme_rules'), {
      part1ThemeId,
      part4ThemeId,
      note: ruleNote.trim() || null,
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
    })
    setPart1ThemeId('')
    setPart4ThemeId('')
    setRuleNote('')
    queryClient.invalidateQueries({ queryKey: ['storyline_theme_rules'] })
  }

  async function handleDeleteRule(rule: StorylineThemeRule) {
    if (!window.confirm('Remove this unmixable-pair rule?')) return
    await deleteDoc(doc(db, 'storyline_theme_rules', rule.id))
    queryClient.invalidateQueries({ queryKey: ['storyline_theme_rules'] })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link to="/test-versions" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Unmixable Themes</h1>
          <p className="text-sm text-muted-foreground">
            Topics tagged on Part 1/4 content, and pairs that must never appear together in one candidate's session.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Themes</h2>
        <div className="flex gap-2 max-w-md">
          <Input
            placeholder="New theme label, e.g. Weather"
            value={newThemeLabel}
            onChange={e => setNewThemeLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddTheme()}
          />
          <Button onClick={handleAddTheme}>
            <Plus className="size-4 mr-2" /> Add
          </Button>
        </div>
        {themesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : themes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No themes yet — add one above, then tag it onto Part 1/4 content in the Parts Library.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {themes.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
                {t.label}
                <button
                  type="button"
                  onClick={() => handleDeleteTheme(t)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete theme ${t.label}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Unmixable pairs</h2>
        <p className="text-sm text-muted-foreground">
          If a candidate's Part 1 has one of these themes, their Part 4 will never be assigned the paired theme.
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="w-44">
            <Select value={part1ThemeId} onValueChange={v => setPart1ThemeId(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="Part 1 theme">{(v: string) => themeLabel(v)}</SelectValue></SelectTrigger>
              <SelectContent>
                {themes.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className="text-muted-foreground">≠</span>
          <div className="w-44">
            <Select value={part4ThemeId} onValueChange={v => setPart4ThemeId(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="Part 4 theme">{(v: string) => themeLabel(v)}</SelectValue></SelectTrigger>
              <SelectContent>
                {themes.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Note (optional)"
            value={ruleNote}
            onChange={e => setRuleNote(e.target.value)}
            className="w-56"
          />
          <Button onClick={handleAddRule} disabled={!part1ThemeId || !part4ThemeId}>
            <Plus className="size-4 mr-2" /> Add rule
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part 1 theme</TableHead>
                <TableHead />
                <TableHead>Part 4 theme</TableHead>
                <TableHead>Note</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No unmixable pairs yet.</TableCell></TableRow>
              ) : (
                rules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell>{themeLabel(rule.part1ThemeId)}</TableCell>
                    <TableCell className="text-muted-foreground text-center">≠</TableCell>
                    <TableCell>{themeLabel(rule.part4ThemeId)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{rule.note || '—'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteRule(rule)}>
                        <Trash2 className="size-4 mr-1" /> Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
