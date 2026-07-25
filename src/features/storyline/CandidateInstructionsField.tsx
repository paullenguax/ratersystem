import { Plus, Trash2 } from 'lucide-react'
import type { CandidateInstructionLine } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  lines: CandidateInstructionLine[]
  onChange: (lines: CandidateInstructionLine[]) => void
  disabled?: boolean
}

export function CandidateInstructionsField({ lines, onChange, disabled }: Props) {
  function setLine(index: number, updated: CandidateInstructionLine) {
    onChange(lines.map((l, i) => (i === index ? updated : l)))
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index))
  }

  function addLine() {
    onChange([...lines, { text: '' }])
  }

  return (
    <div className="space-y-1">
      <Label>Candidate-screen instructions ({'**bold**'}, {'__underline__'} supported)</Label>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="flex gap-2 items-center">
            <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <input
                type="checkbox"
                checked={!!line.bullet}
                onChange={e => setLine(index, { ...line, bullet: e.target.checked || undefined })}
                className="rounded"
                disabled={disabled}
              />
              Bullet
            </label>
            <Input value={line.text} onChange={e => setLine(index, { ...line, text: e.target.value })} disabled={disabled} className="flex-1" />
            <Input
              value={line.color ?? ''}
              onChange={e => setLine(index, { ...line, color: e.target.value || undefined })}
              placeholder="color"
              disabled={disabled}
              className="w-24"
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} disabled={disabled}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={disabled}>
          <Plus className="size-4 mr-2" /> Add line
        </Button>
      </div>
    </div>
  )
}
