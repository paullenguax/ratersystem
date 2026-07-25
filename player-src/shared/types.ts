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

export interface StorylineItem {
  id: string
  order: number
  label: string
  examinerText?: string
  candidateState: string
  notes?: string
  candidateInstructions?: CandidateInstructionLine[]
  startsTestTimer?: boolean
  nextButtonLabel?: string
  previewContent?: { label: string; topic?: string; questions?: string[] }[]
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
