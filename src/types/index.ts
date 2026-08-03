import type { Timestamp } from 'firebase/firestore'

export interface Person {
  id: string
  name: string
  email: string
  role: 'admin' | 'senior_rater' | 'trainee' | 'examiner'
  status: 'active' | 'inactive' | 'suspended'
  raterNumber?: number
  notes?: string
  linkedAt?: Timestamp
  createdVia?: 'self_serve_auto'
  // Lets an admin/senior_rater/trainee also take on standardization work,
  // in addition to the dedicated 'examiner' role.
  canStandardize?: boolean
  createdAt?: Timestamp
}

export interface Assignment {
  id: string
  sessionId: string
  sessionName: string
  raterId: string
  raterName: string
  testDocIds: string[]
  status: 'pending' | 'submitted' | 'reviewed' | 'published'
  notes?: string
  source?: 'admin' | 'self_serve'
  // Undefined is treated as 'rater_course' everywhere this is read.
  category?: 'rater_course' | 'standardization'
  confirmedAt?: Timestamp
  createdAt?: Timestamp
}

export interface Session {
  id: string
  name: string
  type: 'rater_course' | 'refresher' | 'reliability' | 'calibration' | 'historical' | 'ad_hoc' | 'examiner_standardization'
  status: 'open' | 'closed' | 'published'
  notes?: string
  canvasSectionId?: number
  createdAt?: Timestamp
}

export interface Score {
  id: string
  assignmentId: string
  sessionId: string
  sessionName: string
  raterId: string
  raterName: string
  testDocId: string
  testNumber?: number
  candidateName: string
  testType: string
  pronunciation: number
  structure: number
  vocabulary: number
  fluency: number
  comprehension: number
  interactions: number
  overallLevel: number
  published: boolean
  notes?: string
  createdAt?: Timestamp
}

// Standardization-exercise results, kept entirely separate from `Score`/
// `scores` (no published/Rasch-export concerns here — see StandardizationPlayerPage).
export interface StandardizationScore {
  id: string
  assignmentId: string
  sessionId: string
  sessionName: string
  raterId: string
  raterName: string
  testDocId: string
  testNumber?: number
  candidateName: string
  testType: string
  pronunciation: number
  structure: number
  vocabulary: number
  fluency: number
  comprehension: number
  interactions: number
  overallLevel: number
  comments?: string
  createdAt?: Timestamp
}

export interface PracticeSession {
  id: string
  code: string
  title: string
  trainerId: string
  trainerName: string
  testDocId?: string
  testSource?: 'test_bank' | 'training_recording'
  audioUrl?: string
  testLabel?: string
  status: 'active' | 'closed'
  createdAt?: Timestamp
}

export interface PracticeScore {
  id: string
  sessionId: string
  sessionCode: string
  participantName: string
  // Present only when the participant signed in via Canvas SSO — anonymous
  // ("I don't have Canvas") submissions omit both, and can never be promoted.
  raterId?: string
  raterName?: string
  pronunciation: number
  structure: number
  vocabulary: number
  fluency: number
  comprehension: number
  interactions: number
  overallLevel: number
  sortKey: number
  submittedAt?: Timestamp
  // Stamped by PracticePage's "Save to standardization pool" action so a
  // repeat click doesn't create duplicate standardization_scores docs.
  promotedToStandardization?: boolean
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

// One slide of the shared examiner script, shown/edited on its own page
// (StorylineTemplateEditorPage) independently of any specific test. The
// fixed wording (scriptText) is authored once here; each StorylineVersion
// only supplies the per-test slot content declared by slotSpec.
export type StorylinePartNumber = 1 | 2 | 3 | 4

// One line of fixed on-screen instructional text shown to the candidate
// (e.g. Part 2/3's "after every recording, report the message" prompts,
// transcribed from the old system's candidate-screen slides). `text`
// supports lightweight inline markup: `**bold**` and `__underline__`
// (they can combine, e.g. `**__both__**`), rendered by the player — not
// full HTML, to keep authoring safe and simple.
export interface CandidateInstructionLine {
  text: string
  bullet?: boolean
  color?: string
}

export interface ChecklistItem {
  text: string
  icon?: 'screen' | 'speaker'
}

export interface TemplateSlide {
  id: string
  order: number
  kind: TemplateSlideKind
  label: string
  candidateState?: string
  // Which of the 4 pooled Parts this slide belongs to. Undefined = whole-test
  // content (setup/preamble/introduction/closing) — authored directly on the
  // Version, never pooled/shared via StorylinePart.
  partNumber?: StorylinePartNumber
  // Fixed wording. {PortalField} tokens (Test Number, Date, Centre Name,
  // Candidate Name, Examiner Name) are resolved at real test-run time from
  // portal/booking data — left as literal tokens for now (Phase 2 concern).
  // [placeholder] tokens (e.g. [role]) are named in slotSpec.variables and
  // filled once per StorylineTest (StorylineTest.variables) — a role type
  // is fixed per Test, not per version, so the same pooled Part can be
  // referenced by multiple Tests and still resolve correctly for each.
  // {topic} marks where a short per-content title/topic gets spliced in
  // (e.g. "Effective Radio Communications") — content, not fixed wording,
  // so it's a slot like {questions} rather than baked into scriptText.
  scriptText: string
  // Examiner-only contextual guidance, shown in the player's collapsible
  // notes drawer — distinct from scriptText (what's said aloud to the
  // candidate). [placeholder] tokens named in slotSpec.variables are filled
  // the same way as in scriptText.
  notes?: string
  // Fixed on-screen instructions shown to the candidate for the whole
  // duration of this candidateState (e.g. Part 2/3's "report the message"
  // prompts) — distinct from scriptText (read aloud by the examiner) and
  // from media.images (photos, not text). When several slides share one
  // candidateState (e.g. Part 3's four sub-slides), only the first one
  // that sets this is used — see player-src/candidate.ts's panel dedup.
  candidateInstructions?: CandidateInstructionLine[]
  // For `admin_checklist`-kind slides: one checkbox per item, rendered in
  // the player instead of a plain bullet list. Next is disabled until every
  // item is ticked (see player-src/examiner.ts) — bypassed in Preview mode.
  // `icon` optionally adds a small clickable action next to that item —
  // 'screen' opens/focuses the candidate window, 'speaker' plays whichever
  // clip elsewhere in the resolved version is labeled "Volume check" (see
  // slotSpec.volumeCheck) — so the examiner can verify sound during setup
  // using the exact same clip Part 2 uses later, not a separate upload.
  checklistItems?: ChecklistItem[]
  // Arriving at this slide starts the continuous session timer, which then
  // runs for the rest of the test. Exactly one slide (typically the
  // "invite candidate into the room" slide) should set this.
  startsTestTimer?: boolean
  // Overrides the Next button's label/prominence on this slide only (e.g.
  // "START TEST" on the last pre-test slide) — reverts to the default
  // "Next ▶" on the following slide.
  nextButtonLabel?: string
  // This slide compiles a read-only preview of the actual topic/question
  // content already authored for the listed Parts (e.g. "review Part 1 and
  // Part 4 before starting") — resolved from those Parts' own slot content,
  // not authored directly on this slide.
  previewParts?: StorylinePartNumber[]
  // Excludes THIS slide's own topic/questions from any other slide's
  // previewParts compilation, even though its Part number is included
  // (e.g. Part 4's picture-interview slides are usually skipped so the
  // preview only shows the closing discussion questions).
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
    // A separate, unlimited-replay audio clip for checking playback volume
    // with the candidate before the scored recording — independent of the
    // slide's main clip(s) above.
    volumeCheck?: boolean
    // Soft play-count limit for this slide's audio clip(s) — same ceiling
    // applies to every clip the slide produces (the intro + all numbered
    // recordings for a 'set'). The player warns past this count but never
    // blocks playback. Undefined = unlimited.
    maxPlays?: number
    variables?: string[]
  }
}

// Admin-configurable slide look & feel — a deliberately small, fixed set of
// knobs (not arbitrary CSS) applied by the player as CSS custom properties,
// each falling back to the player's own built-in default when unset. Global
// like the rest of the template, not per-Test/Version — matches the old
// system's single fixed branded look, just with a few adjustable dials.
export interface StorylineTheme {
  logoHeight?: number
  accentColor?: string
  slideMaxWidth?: number
  slideMinHeight?: number
}

export interface StorylineTemplate {
  id: string
  slides: TemplateSlide[]
  theme?: StorylineTheme
  updatedAt?: Timestamp
  updatedBy?: string
}

// Draft-editable raw fills for one template slide — content only.
// [placeholder] variable values live on StorylineTest.variables instead
// (a role type is fixed per Test, not per slide/version/part).
// Keyed by TemplateSlide.id on StorylineVersion.slotContent (whole-test
// slides) or StorylinePart.slotContent (part-tagged slides).
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

// The resolved, publish-time-snapshotted output of merging a template slide
// with its slot content — what player-src/ and exportStoryline.ts consume.
// Immutable once written into StorylineVersion.items at publish time.
export interface StorylineItem {
  id: string
  order: number
  // Carried through so the player can branch on it — most kinds render
  // generically (whatever fields are present), but accept_reject_test and
  // test_data_confirm need bespoke UI, and admin_checklist needs to know to
  // render checklistItems as checkboxes.
  kind: TemplateSlideKind
  // The template slide's authored label (e.g. "Part 1 — Experience
  // questions") — shown as the examiner's slide heading. Distinct from
  // candidateState, which is an internal state key for the candidate
  // screen, not human-facing text.
  label: string
  examinerText?: string
  candidateState: string
  notes?: string
  candidateInstructions?: CandidateInstructionLine[]
  checklistItems?: ChecklistItem[]
  // Only set on the accept_reject_test item — "{test.name} — {version.
  // versionLabel}", computed by the caller and threaded through
  // resolveItems() since it isn't authored on any TemplateSlide.
  testDisplayName?: string
  startsTestTimer?: boolean
  nextButtonLabel?: string
  // Compiled from other slides' actual topic/question content when this
  // slide declares previewParts (e.g. an "examiner preview" slide shown
  // before the test starts) — rendered distinctly from examinerText so the
  // player can visually set it apart (bold/italic, extra spacing).
  previewContent?: { label: string; topic?: string; questions?: string[]; partNumber: StorylinePartNumber }[]
  media?: {
    images?: string[]
    // maxPlays carries over from the slide's slotSpec — the exported item
    // is self-contained, so the player never needs the template to enforce
    // the soft play-count warning.
    audioClips?: { label: string; url: string; maxPlays?: number }[]
  }
  timing?: {
    prepSeconds?: number
    responseSeconds?: number
  }
}

// The TEAC licence/role categories a Test Type (StorylineTest) groups by —
// distinct from test_bank's `Test.testType` (individual scored recordings,
// a different enum with different values/purpose).
export type StorylineTestType =
  | 'Airline Pilot'
  | 'Private Pilot'
  | 'Ab-Initio Pilot'
  | 'Rotary Wing Pilot'
  | 'Aerodrome ATC'
  | 'Approach ATC'
  | 'Area ATC'
  | 'Student ATC'
  | 'ADP Driver'
  | 'Airport Operations'
  | 'FISO/AFISO'

export interface StorylineTest {
  id: string
  name: string
  description?: string
  active: boolean
  // Which TEAC licence/role category this Test Type groups under — lets
  // the list be sorted/scanned by category (e.g. all the ATC ones
  // together) independent of `name`, which is free text.
  testType?: StorylineTestType
  // Fills for every [placeholder] token referenced anywhere in the shared
  // template (e.g. { role: 'air traffic controller' }) — a role type is
  // fixed per Test, reused across every Version of it and every Part it
  // references, so the same pooled Part resolves correctly for whichever
  // Test is using it.
  variables?: Record<string, string>
  // Draft-editable raw fills for whole-test (partNumber-undefined) slides
  // — preamble, accept/reject test name, test data confirm, checklist,
  // closing. Successor to StorylineVersion.slotContent for this content:
  // under dynamic Part pooling there's no more one hand-built Version per
  // candidate to hold a per-candidate copy, so this is now the single
  // canonical set shared by every dynamically-composed candidate instance
  // of this Test. StorylineVersion keeps its own slotContent too, for the
  // still-supported hand-built Practice/example-test path — a Version's
  // own value there is an override, this is the shared default.
  slotContent?: Record<string, StorylineSlotContent>
  // draft -> published lifecycle for slotContent/items below, same
  // posture as StorylinePart/StorylineVersion. A Test can be actively
  // edited (name/testType/variables) without this being 'published' —
  // it only gates whether slotContent has been resolved into items.
  status?: 'draft' | 'published'
  // Resolved snapshot of ONLY the whole-test slides (resolveItems() run
  // the same way it already runs for a Part today, parts={}) — does NOT
  // include previewParts-driven content, since which 4 Parts a candidate
  // gets isn't known until WP assigns them at booking time. Those slides'
  // previewContent comes back empty here by design; the exported player
  // re-derives it client-side once it has the real 4 Parts (see
  // player-src/shared/resolveItems.ts).
  items?: StorylineItem[]
  publishedAt?: Timestamp
  // The corresponding wp_teac_tests.id / Test_id on the live WordPress
  // side. Entered by hand once per Test — there's no reliable name-
  // matching heuristic between the two systems (TestName strings on each
  // side have drifted independently). Required before this Test can be
  // included in the WP sync.
  wpTestId?: number
  createdAt?: Timestamp
  createdBy?: string
}

// The atomic, globally-shareable authoring/pooling unit for one of the 4
// test Parts — deliberately not scoped to a testId (real tests share Part
// content across role types, e.g. Part 2's "W" pool spans 7 of 11 types —
// see Storyline-Replacement/Spec Updates/TEAC_Test_Versions.xlsx). Same
// immutable-once-published posture as StorylineVersion. No pooling/selection
// logic yet — a Version just references one Part per number directly.
export interface StorylinePart {
  id: string
  partNumber: StorylinePartNumber
  label: string
  // draft -> published -> archived is the authoring lifecycle (archived =
  // permanently retired, matches the spreadsheet's retired versions).
  status: 'draft' | 'published' | 'archived'
  // Quick pause toggle for an otherwise-published Part — pulls it out of
  // normal selection without retiring it outright (e.g. a flagged image
  // pending review). Undefined/true = active. Distinct from `status` so it
  // doesn't require duplicating/re-publishing to temporarily stand it down.
  active?: boolean
  // Reserve/emergency-only content, matching the spreadsheet's "Back Up"
  // versions — never offered as a normal selection, kept in case primary
  // content fails at a real test centre. Independent of active/status: a
  // backup Part is still fully published and ready, just excluded from the
  // ordinary picker.
  isBackup?: boolean
  // Which Test Types this Part is eligible for — not mutually exclusive
  // (e.g. a Part 2 might serve both FISO/AFISO and ADP Driver), matching
  // the real pooling shape noted above. Undefined/empty = eligible for
  // every Test Type (backward-compatible default for every Part that
  // existed before this field did — nobody had to go back and tag ~90
  // Parts retroactively just to keep using them).
  testTypes?: StorylineTestType[]
  // Which topic this Part's content covers — only meaningful for
  // partNumber 1 or 4 (Part 2/3 don't participate in the unmixable-pair
  // rule below). Points at storyline_themes/{id}, not free text: pairing
  // needs reliable equality, and a free label drifts/typos silently.
  themeId?: string
  // Historical content-pool code from TEAC_Test_Versions.xlsx (e.g.
  // "001-A-1-001" for a Part 1, "W001" for a shared Part 2 pool) — set by
  // hand for whichever of this Part's content was transcribed from a
  // legacy Storyline version. Undefined for Parts authored fresh here
  // with no legacy equivalent. Used only by the one-off WP exposure
  // backfill, never read at export/selection time.
  legacyCode?: string
  // Keyed by TemplateSlide.id, only for slides whose partNumber matches.
  slotContent: Record<string, StorylineSlotContent>
  createdAt?: Timestamp
  createdBy?: string
  publishedAt?: Timestamp
}

// A shared topic vocabulary for tagging Part 1 / Part 4 content (see
// StorylinePart.themeId) — deliberately one flat list usable by either
// part number rather than two parallel lists, since the same real-world
// topic (e.g. "Weather") can plausibly show up in either. Distinct from
// StorylineTheme above, which is unrelated look-and-feel config — the
// name clash with that existing type is why this one is called
// StorylinePartTheme, not StorylineTheme.
export interface StorylinePartTheme {
  id: string
  label: string
  createdAt?: Timestamp
  createdBy?: string
}

// A forbidden Part-1-theme / Part-4-theme pairing — enforced by WP's
// selection logic so one candidate's Part 1 and Part 4 never share a
// topic. Admin-managed via StorylineThemeRulesPage.
export interface StorylineThemeRule {
  id: string
  part1ThemeId: string
  part4ThemeId: string
  note?: string
  createdAt?: Timestamp
  createdBy?: string
}

export interface StorylineVersion {
  id: string
  testId: string
  versionLabel: string
  status: 'draft' | 'published' | 'archived'
  // Which StorylinePart this version uses for each of the 4 Part numbers.
  partRefs: Partial<Record<StorylinePartNumber, string>>
  // Draft-editable raw fills for whole-test slides only (no partNumber),
  // keyed by TemplateSlide.id. Present on drafts; irrelevant once published
  // (items below is the immutable source of truth).
  slotContent: Record<string, StorylineSlotContent>
  // Resolved output (see StorylineItem) — empty until Publish computes it.
  items: StorylineItem[]
  createdAt?: Timestamp
  createdBy?: string
  publishedAt?: Timestamp
}

export interface Test {
  id: string
  testId?: number
  recordingUrl: string
  candidateName: string
  candidateNationality: string
  testType: 'PPL' | 'Airline Pilot' | 'Helicopter Pilot' | 'Student Pilot' | 'Aerodrome ATC' | 'Approach ATC' | 'Area ATC' | 'Student ATCO' | 'Airport Operations' | 'ADP Driver'
  durationSeconds?: number
  status: 'active' | 'retired'
  excludeFromPool?: boolean
  // Undefined is treated as 'rater_course' everywhere this is read.
  category?: 'rater_course' | 'standardization'
  // Which course this test's recording is used in — a sub-classification
  // within the rater_course pool (unrelated to `category` above, which
  // separates rater_course from standardization). Helps a trainer find the
  // right test when picking one for a Practice Session.
  courseTag?: 'rater_course' | 'refresher_course' | 'other'
  // Free-text, e.g. "Day 1" — sortable/filterable alongside courseTag in
  // Test Bank and the Practice Session test picker.
  dayLabel?: string
  canonicalDifficulty?: number | null
  canonicalSE?: number | null
  notes?: string
  createdAt?: Timestamp
}
