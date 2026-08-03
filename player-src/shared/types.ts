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

// --- Raw (unresolved) shapes, needed for client-side resolveItems() ---
// Ported alongside the resolved StorylineItem shape above for the same
// reason: player-src stays a fully self-contained TypeScript project. Keep
// in sync with src/types/index.ts (TemplateSlide/StorylineSlotContent/
// StorylinePartNumber) and src/features/storyline/resolveItems.ts.

export type StorylinePartNumber = 1 | 2 | 3 | 4

export interface StorylineSlotContent {
  topic?: string
  questions?: string[]
  images?: string[]
  audio?: {
    intro?: string
    recordings?: string[]
    volumeCheck?: string
  }
}

export interface TemplateSlide {
  id: string
  order: number
  kind: TemplateSlideKind
  label: string
  candidateState?: string
  partNumber?: StorylinePartNumber
  scriptText: string
  notes?: string
  candidateInstructions?: CandidateInstructionLine[]
  checklistItems?: ChecklistItem[]
  startsTestTimer?: boolean
  nextButtonLabel?: string
  previewParts?: StorylinePartNumber[]
  previewExclude?: boolean
  timing?: {
    prepSeconds?: number
    responseSeconds?: number
  }
  slotSpec: {
    topic?: boolean
    questions?: boolean
    images?: number
    audio?: 'none' | 'single' | 'set'
    audioSetSize?: number
    volumeCheck?: boolean
    maxPlays?: number
    variables?: string[]
  }
}

// The shape of one fetched parts/<n>/<partId>/part.json fragment — just
// enough for resolveItems() to merge, not the full authoring StorylinePart
// (no id/label/status/theme/etc. — the player has no use for those).
export interface StorylinePartFragment {
  slotContent: Record<string, StorylineSlotContent>
}

// The shape of one fetched tests/<testId>/test.json fragment. Raw
// (unresolved) slotContent, not a pre-resolved StorylineItem[] snapshot —
// deliberate simplification vs. shipping a partial resolve and merging it
// with freshly-resolved Part content client-side: the player already needs
// template.json raw (for previewParts/combo-image derivation regardless),
// so it's simpler and more correct to run resolveItems() exactly once,
// client-side, over everything together — identical in shape to what
// StorylineVersionEditorPage's admin Preview already does — than to
// reconcile a pre-baked whole-test snapshot against live Part data.
export interface StorylineTestFragment {
  name: string
  variables?: Record<string, string>
  slotContent: Record<string, StorylineSlotContent>
}

export interface ChecklistItem {
  text: string
  icon?: 'screen' | 'speaker'
}

export interface StorylineTheme {
  logoHeight?: number
  accentColor?: string
  slideMaxWidth?: number
  slideMinHeight?: number
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
