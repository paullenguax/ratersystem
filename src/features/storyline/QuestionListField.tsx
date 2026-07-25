import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface Props {
  label: string
  questions: string[]
  onChange: (questions: string[]) => void
  disabled?: boolean
}

// A fixed rows={1} textarea would let a second typed line scroll out of
// view instead of actually losing it — auto-grow so every typed line stays
// visible without the admin needing to notice and manually resize.
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function QuestionListField({ label, questions, onChange, disabled }: Props) {
  function setQuestion(index: number, value: string) {
    onChange(questions.map((q, i) => (i === index ? value : q)))
  }

  function removeQuestion(index: number) {
    onChange(questions.filter((_, i) => i !== index))
  }

  function addQuestion() {
    onChange([...questions, ''])
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="space-y-2">
        {questions.map((q, index) => (
          <div key={index} className="flex gap-2">
            <Textarea
              value={q}
              onChange={e => { setQuestion(index, e.target.value); autoGrow(e.target) }}
              ref={el => { if (el) autoGrow(el) }}
              disabled={disabled}
              rows={1}
              className="min-h-9 resize-none overflow-hidden"
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => removeQuestion(index)} disabled={disabled}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addQuestion} disabled={disabled}>
          <Plus className="size-4 mr-2" /> Add question
        </Button>
      </div>
    </div>
  )
}
