import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  label: string
  questions: string[]
  onChange: (questions: string[]) => void
  disabled?: boolean
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
            <Input value={q} onChange={e => setQuestion(index, e.target.value)} disabled={disabled} />
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
