export type BenchmarkLevel = 'below4' | 4 | 5 | 6

export const LEVEL_LABELS: Record<string, string> = {
  'below4': 'Below Level 4',
  4: 'Level 4 — Operational',
  5: 'Level 5 — Extended',
  6: 'Level 6 — Expert',
}

export const LEVEL_COLOURS: Record<string, string> = {
  'below4': 'bg-red-100 text-red-700 border-red-200',
  4:        'bg-amber-100 text-amber-700 border-amber-200',
  5:        'bg-blue-100 text-blue-700 border-blue-200',
  6:        'bg-green-100 text-green-700 border-green-200',
}

export type BenchmarkConstruct = 'vocabulary' | 'structure' | 'comprehension'
export const CONSTRUCTS: BenchmarkConstruct[] = ['vocabulary', 'structure', 'comprehension']

// Matches the live Firestore schema in lenguax-benchmark-32392 exactly — do not
// reintroduce the older pool/section/stimulus-as-question shape, it doesn't
// match what the candidate app actually reads/writes.
export interface BenchmarkItem {
  id: string
  source: string
  band: 4 | 5 | 6
  construct: BenchmarkConstruct
  modality: 'reading' | 'listening'
  form: 'A' | 'B'
  stem: string
  stimulus: string | null
  audioRef: string | null
  // How many times a candidate may play the audio before it locks — defaults
  // to 2 in the player when unset (see AudioPlayer.jsx in Benchmark Check).
  maxPlays?: number
  // 2 options for binary minimal-pair items, 4 for standard MCQ
  options: string[]
  correct: 0 | 1 | 2 | 3
  feedback: string
  active: boolean
  flagged: boolean
  notes: string
  correctedAt?: { seconds: number } | null
  // Field-test items: sampled into live sittings (see TrialPlayer.jsx's
  // samplePilotItems) but excluded from scoring. pairKey groups related
  // minimal-pair items so the sampler shows at most one per sitting.
  // pilotAttempts is maintained server-side by incrementPilotItemAttempts —
  // never set it from the admin form.
  pilot?: boolean
  pairKey?: string | null
  pilotAttempts?: number
}

export interface BenchmarkResponse {
  itemId: string
  band?: number
  construct?: string
  selected: string
  correct: boolean
  flagComment?: string | null
}

export interface TrialScores {
  band4: { correct: number; total: number }
  band5: { correct: number; total: number }
  band6: { correct: number; total: number }
  vocabulary: { correct: number; total: number }
  structure:  { correct: number; total: number }
  comprehension: { correct: number; total: number }
  totalCorrect: number
  totalItems: number
  indicativeLevel: string
}

// Drives the candidate player's section order/copy/composition
// (TrialPlayer.jsx in Benchmark Check reads this from
// `benchmark_config/sections`). Every section is form-split and scored —
// pilot items are never assigned to a section directly; they're sampled
// separately (pilotSampleCount) and woven into whichever section's block
// matches their modality/construct/band, same as an ordinary item would be.
export interface TestSectionFilter {
  modality: 'reading' | 'listening' | 'any'
  construct: BenchmarkConstruct | 'any'
  band: 4 | 5 | 6 | 'any'
}

export interface TestSection {
  id: string
  order: number
  title: string
  introBody: string
  showIntro: boolean
  filter: TestSectionFilter
}

export interface SectionsConfig {
  sections: TestSection[]
  // How many unscored pilot items to sample into a sitting overall (spread
  // across whichever sections match each sampled item), independent of how
  // many sections exist.
  pilotSampleCount: number
}

export interface BenchmarkResult {
  id: string
  mode?: 'trial' | 'adaptive'
  form?: 'A' | 'B'
  candidateName: string
  candidateEmail: string
  selfReportedLevel?: string
  centreId?: string | null
  timestamp: { seconds: number } | null
  responses: BenchmarkResponse[]
  // adaptive mode scores
  scores?: { phase1?: number; phase2?: number; phase3?: number } & Partial<TrialScores>
  indicativeLevel?: BenchmarkLevel
  linkedPersonId?: string
  linkedPersonName?: string
}
