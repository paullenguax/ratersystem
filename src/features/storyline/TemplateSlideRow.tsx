import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import type { TemplateSlide, TemplateSlideKind } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const SLIDE_KINDS: { value: TemplateSlideKind; label: string }[] = [
  { value: 'admin_checklist', label: 'Admin checklist (examiner-only)' },
  { value: 'examiner_preview', label: 'Examiner preview (examiner-only)' },
  { value: 'instruction', label: 'Instruction' },
  { value: 'question_set', label: 'Question set' },
  { value: 'image_question_set', label: 'Image + question set' },
  { value: 'timed_picture_description', label: 'Timed picture description' },
  { value: 'audio_response', label: 'Audio + response' },
  { value: 'audio_set', label: 'Audio set (intro + recordings)' },
  { value: 'closing', label: 'Closing' },
]

interface Props {
  slide: TemplateSlide
  disabled?: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onChange: (slide: TemplateSlide) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function TemplateSlideRow({ slide, disabled, canMoveUp, canMoveDown, onChange, onRemove, onMoveUp, onMoveDown }: Props) {
  function set<K extends keyof TemplateSlide>(key: K, value: TemplateSlide[K]) {
    onChange({ ...slide, [key]: value })
  }

  function setSlotSpec<K extends keyof TemplateSlide['slotSpec']>(key: K, value: TemplateSlide['slotSpec'][K]) {
    onChange({ ...slide, slotSpec: { ...slide.slotSpec, [key]: value } })
  }

  function setTiming(key: 'prepSeconds' | 'responseSeconds', value: number | undefined) {
    onChange({ ...slide, timing: { ...slide.timing, [key]: value } })
  }

  const isAudioSet = slide.slotSpec.audio === 'set'

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="w-64">
          <Select value={slide.kind} onValueChange={v => set('kind', v as TemplateSlideKind)} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SLIDE_KINDS.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon" onClick={onMoveUp} disabled={disabled || !canMoveUp}>
            <ArrowUp className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onMoveDown} disabled={disabled || !canMoveDown}>
            <ArrowDown className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} disabled={disabled}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={slide.label} onChange={e => set('label', e.target.value)} disabled={disabled} />
        </div>
        <div className="space-y-1">
          <Label>Candidate state</Label>
          <Input
            value={slide.candidateState ?? ''}
            onChange={e => set('candidateState', e.target.value || undefined)}
            placeholder="e.g. Task1 — leave blank for examiner-only slides"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label>Part</Label>
          <Select
            value={slide.partNumber ? String(slide.partNumber) : 'none'}
            onValueChange={v => set('partNumber', v === 'none' ? undefined : (Number(v) as TemplateSlide['partNumber']))}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Whole-test (not pooled)</SelectItem>
              <SelectItem value="1">Part 1</SelectItem>
              <SelectItem value="2">Part 2</SelectItem>
              <SelectItem value="3">Part 3</SelectItem>
              <SelectItem value="4">Part 4</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Script text</Label>
        <Textarea
          value={slide.scriptText}
          onChange={e => set('scriptText', e.target.value)}
          rows={4}
          placeholder="Fixed wording. {PortalField} = filled at real test-run time. [placeholder] = author-fillable. {questions}/{topic} = where the version's question list / topic title is inserted."
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-4 gap-3 items-end">
        <div className="space-y-1">
          <Label>Prep (s)</Label>
          <Input
            type="number" min={0}
            value={slide.timing?.prepSeconds ?? ''}
            onChange={e => setTiming('prepSeconds', e.target.value === '' ? undefined : Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label>Response (s)</Label>
          <Input
            type="number" min={0}
            value={slide.timing?.responseSeconds ?? ''}
            onChange={e => setTiming('responseSeconds', e.target.value === '' ? undefined : Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label>Images needed</Label>
          <Input
            type="number" min={0} max={2}
            value={slide.slotSpec.images ?? 0}
            onChange={e => setSlotSpec('images', Number(e.target.value) || undefined)}
            disabled={disabled}
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none pb-2">
          <input
            type="checkbox"
            checked={!!slide.slotSpec.questions}
            onChange={e => setSlotSpec('questions', e.target.checked || undefined)}
            className="rounded"
            disabled={disabled}
          />
          <span>Needs questions</span>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={!!slide.slotSpec.topic}
          onChange={e => setSlotSpec('topic', e.target.checked || undefined)}
          className="rounded"
          disabled={disabled}
        />
        <span>Needs a topic/title (use {'{topic}'} in the script text above)</span>
      </label>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 w-40">
          <Label>Audio</Label>
          <Select
            value={slide.slotSpec.audio ?? 'none'}
            onValueChange={v => setSlotSpec('audio', v === 'none' ? undefined : (v as 'single' | 'set'))}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="single">Single clip</SelectItem>
              <SelectItem value="set">Set (intro + recordings)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isAudioSet && (
          <div className="space-y-1 w-36">
            <Label>Recordings per set</Label>
            <Input
              type="number" min={1}
              value={slide.slotSpec.audioSetSize ?? 3}
              onChange={e => setSlotSpec('audioSetSize', Number(e.target.value) || undefined)}
              disabled={disabled}
            />
          </div>
        )}
        {slide.slotSpec.audio && slide.slotSpec.audio !== 'none' && (
          <div className="space-y-1 w-32">
            <Label>Max plays</Label>
            <Input
              type="number" min={1}
              value={slide.slotSpec.maxPlays ?? ''}
              onChange={e => setSlotSpec('maxPlays', e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder="Unlimited"
              disabled={disabled}
            />
          </div>
        )}
        <div className="space-y-1 flex-1 min-w-40">
          <Label>Variables (comma-separated)</Label>
          <Input
            value={slide.slotSpec.variables?.join(', ') ?? ''}
            onChange={e => setSlotSpec('variables', e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : undefined)}
            placeholder="e.g. role"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}
