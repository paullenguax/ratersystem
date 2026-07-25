// Wire format for the standalone player shell. Deliberately duplicated (not
// imported) from src/types/index.ts's StorylineItem — this keeps player-src
// a fully self-contained TypeScript project, decoupled from the main app's
// tsconfig graph. This is the *resolved* shape (template + slot content
// already merged) — see src/features/storyline/resolveItems.ts.
// Keep in sync with src/types/index.ts.

export interface CandidateInstructionLine {
  text: string
  bullet?: boolean
  color?: string
}

export interface ChecklistItem {
  text: string
  icon?: 'screen' | 'speaker'
}

export type TemplateSlideKind =
  | 'accept_reject_test'
  | 'test_data_confirm'
  | 'admin_checklist'
  | 'examiner_preview'
  | 'instruction'
  | 'question_set'
  | 'image_question_set'
  | 'timed_picture_description'
  | 'audio_response'
  | 'audio_set'
  | 'closing'

export interface StorylineItem {
  id: string
  order: number
  kind: TemplateSlideKind
  label: string
  examinerText?: string
  candidateState: string
  notes?: string
  candidateInstructions?: CandidateInstructionLine[]
  checklistItems?: ChecklistItem[]
  testDisplayName?: string
  startsTestTimer?: boolean
  nextButtonLabel?: string
  previewContent?: { label: string; topic?: string; questions?: string[]; partNumber: 1 | 2 | 3 | 4 }[]
  media?: {
    images?: string[]
    // maxPlays: soft play-count ceiling — examiner.ts warns past it but
    // never blocks playback. Audio plays from the examiner's own console
    // (everyone in the room hears it), never on the candidate screen.
    audioClips?: { label: string; url: string; maxPlays?: number }[]
  }
  timing?: {
    prepSeconds?: number
    responseSeconds?: number
  }
}
