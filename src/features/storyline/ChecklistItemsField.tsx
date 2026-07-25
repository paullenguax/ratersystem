import { Plus, Trash2 } from 'lucide-react'
import type { ChecklistItem } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  items: ChecklistItem[]
  onChange: (items: ChecklistItem[]) => void
  disabled?: boolean
}

export function ChecklistItemsField({ items, onChange, disabled }: Props) {
  function setItem(index: number, updated: ChecklistItem) {
    onChange(items.map((it, i) => (i === index ? updated : it)))
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  function addItem() {
    onChange([...items, { text: '' }])
  }

  return (
    <div className="space-y-1">
      <Label>Checklist items (examiner must tick every one to advance)</Label>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-2 items-center">
            <Input value={item.text} onChange={e => setItem(index, { ...item, text: e.target.value })} disabled={disabled} className="flex-1" />
            <select
              value={item.icon ?? ''}
              onChange={e => setItem(index, { ...item, icon: (e.target.value || undefined) as ChecklistItem['icon'] })}
              disabled={disabled}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">No action button</option>
              <option value="screen">🖥 Open candidate window</option>
              <option value="speaker">🔊 Play volume check</option>
            </select>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={disabled}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={disabled}>
          <Plus className="size-4 mr-2" /> Add checklist item
        </Button>
      </div>
    </div>
  )
}
