# RaterSystemNew — Rater Admin System

Aviation English rater management web app for Lenguax.

**Live:** `lenguax.com/ratersystem/`  
**Repo:** github.com/paullenguax/ratersystem

## What it does

Manages the full workflow of ICAO English rating: assigning tests to raters, entering scores, generating feedback reports, producing certificates (Lenguax + official CAA/DGAC forms), and syncing with Canvas LMS. Also hosts the admin interface for Benchmark Check and GPronTool.

## Tech stack

- React 19 + TypeScript + Vite
- Tailwind v4 + shadcn/ui (Base UI variant — use `render` prop, **not** `asChild`)
- Firebase Auth + Firestore + Storage (`ratersystem` project)
- React Router v6 with `basename="/ratersystem"`
- jsPDF + pdf-lib for PDF generation
- Deployed to SiteGround via GitHub Actions FTP on push to `main`

## Roles

| Page | admin | senior_rater | trainee | interlocutor |
|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| People | ✓ | | | |
| Test Bank | ✓ | | | |
| Storyline | ✓ | | | |
| Events (Sessions) | ✓ | | | |
| Assignments | ✓ | | | |
| Scoring | ✓ | ✓ | ✓ | |
| Standardization | ✓* | ✓* | ✓* | ✓ |
| Scores | ✓ | | | |
| Standardization Results | ✓ | | | |
| Statistics | ✓ | | | |
| Reports | ✓ | | | |
| Feedback | ✓ | ✓ | | |
| Certificates | ✓ | | | |
| Official Forms | ✓ | | | |
| Benchmark | ✓ | | | |
| Practice Sessions | ✓ | | | |
| Admin (incl. Canvas Sync/Enroll/Audit, Enrollment Log, Auto-assign, Import Rasch, Cert Assets, Pronunciation) | ✓ | | | |

\* admin always has access; senior_rater/trainee only if their `people` doc has `canStandardize: true` — see "Standardization" below.

Role is determined by the `people` Firestore collection — the doc ID **must** equal the Firebase Auth UID.

## Key Firestore collections

| Collection | Purpose |
|---|---|
| `people` | Raters + admins, keyed by Firebase Auth UID |
| `test_bank` | ICAO test recordings (51+ imported); `canonicalDifficulty`/`canonicalSE` from Rasch imports drive both Auto-assign and the self-serve picker; `category` (`'rater_course'` default, or `'standardization'`) separates the standardization test pool — every other test-pool consumer (Auto-assign, self-serve picker, Quick Entry, manual Score entry) excludes `'standardization'` tests |
| `sessions` | Named groups of scoring work; `canvasSectionId` links a session to a Canvas section for self-serve assignments |
| `assignments` | session + rater + tests; unit of work; `source: 'self_serve'` marks ones created by the self-serve flow; `category` (`'rater_course'` default, or `'standardization'`) determines which test pool and player the assignment uses; `confirmedAt` is the rater's explicit "yes, these are my answers" lock-in — distinct from `status: 'submitted'`, which just means all tests are scored |
| `scores` | Individual ICAO scores per rater per test (rater-course assignments only) |
| `standardization_scores` | Same shape as `scores` plus a `comments` field (≤250 chars), kept in a separate collection so standardization results never mix with rater-course scores — see "Standardization" below |
| `certificates` | Lenguax cert records (L-prefix numbers) |
| `official_forms` | CAA 5012 and DGAC 87i records |
| `cert_config/templates` | Storage URL overrides per cert type |
| `benchmark_items` | MCQ items for Benchmark Check — vocabulary/structure/comprehension constructs, reading/listening modalities |
| `benchmark_results` / `benchmark_flags` | Candidate results and item flags from Benchmark Check (separate `lenguax-benchmark-32392` project, not this one — admin reads require the `mintBenchmarkAdminToken` auth bridge) |
| `pronunciation_config/status` | Active languages for GPronTool |
| `config/canvas` | Canvas API token, Canvas Sync course list, `excludedCourseIds`, `notificationEmail` for self-serve alerts |
| `canvasEnrollmentLog` | Unified log of Canvas enrollments from both WooCommerce (`CanvasCohortEnrollment` WP plugin) and the manual `/admin/canvas-enroll` wizard |
| `practice_sessions` / `practice_scores` | Ad-hoc live-course practice player (`/practice`), joined via a 6-character code; login is now optional (Canvas SSO) — see "Practice Sessions" below |
| `storyline_tests` / `storyline_versions` | Storyline Replacement test authoring — see "Storyline Replacement" section below |

## Local dev

```bash
npm install
npm run dev
```

Needs a `.env.local` file:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_BENCHMARK_API_KEY=...
VITE_BENCHMARK_AUTH_DOMAIN=...
VITE_BENCHMARK_PROJECT_ID=...
VITE_BENCHMARK_STORAGE_BUCKET=...
VITE_BENCHMARK_MESSAGING_SENDER_ID=...
VITE_BENCHMARK_APP_ID=...
```

The `VITE_BENCHMARK_*` vars are for reading/writing the Benchmark Check Firebase project from the admin UI.

## Deployment

GitHub Actions on push to `main` → FTP to `lenguax.com/public_html/ratersystem/`.

All env vars above must be set as GitHub Actions secrets. Also needs `FTP_HOST`, `FTP_USERNAME`, `FTP_PASSWORD`.

Build runs `tsc -b && vite build` — TypeScript strict mode is on, unused imports fail the build.

## Adding a person

**Invite (recommended, any role)** — People page → "Invite": takes name/email/role/`canStandardize`, calls the `invitePerson` Cloud Function, which creates the Firebase Auth user + matching `people` doc (UID = doc ID) together and emails the person a link to set their own password. Works for `admin`/`senior_rater`/`trainee`/`interlocutor`.

**Manual (fallback)** — the Firestore `people` doc ID must equal the Firebase Auth UID:
1. Firebase Console → Auth → Add user → copy UID
2. Firestore → `people` → new doc with that UID as the document ID; fields: `name`, `email`, `role`, `status` (`active`)
3. Firebase Console → Auth → send password reset to the user

Canvas SSO users: run Canvas Sync (Admin page) — it creates the `people` doc automatically, no password ever needed.

Any already-active user can reset their own password anytime via "Forgot password?" on the login page (`sendPasswordResetEmail`, no Cloud Function involved).

## PDF generation

**Lenguax certs** — jsPDF, A4, mm units; template JPGs from `public/` or Firebase Storage override via `cert_config/templates`

**CAA 5012** — jsPDF image overlay on `CAA5012_BLANK.png`

**DGAC 87i-Formlic** — pdf-lib AcroForm field filling on `87iFormlic.pdf`; page 2 has hardcoded X ticks + signature/stamp overlays

Certificate validation is public at `/validate/:certNumber` (no auth required).

## Canvas naming convention

`Rater Course` and `Refresher Course` are cloned annually on Canvas, with a section per cohort inside each year's clone:

- **Course**: `Rater Course {Year}` / `Refresher Course {Year}` (e.g. "Rater Course 2026") — clone yearly
- **Section**: `{Month} {Year}` for open monthly cohorts (e.g. "July 2026"), or the client/group name for closed cohorts (e.g. "Acme Airlines")
- **SIS IDs are not used anywhere in this integration** — everything (this app, the WP plugin, self-serve) reads/writes Canvas's own numeric `course.id`/`section.id`. No need to set one when creating a section.
- Set an **end date** on each section once its cohort finishes — `canvasSections()` auto-hides sections ended >7 days ago from every picker (enroll wizard, audits, self-serve), so this keeps them tidy without needing `config/canvas.excludedCourseIds` (that field is for hiding unrelated Lenguax courses from the account entirely, not for retiring old cohorts)
- Add each year's cloned course to `config/canvas.courses` (via Canvas Sync's Settings panel) — this list is also the self-serve auto-provisioning failsafe's allowlist, so a course needs to be here before self-serve login works for its enrollees

## Cloud Functions (`functions/index.js`)

| Function | Purpose |
|---|---|
| `canvasAuth` | Canvas OAuth code → Firebase custom token. Requires a `people` doc matching the Canvas login email; creates the Firebase Auth user (UID = `people` doc ID) on first login. For self-serve logins (`selfServe: true`) with no matching `people` doc, auto-provisions one as a trainee — but only if the caller is actively enrolled in a course listed in `config/canvas.courses` and no existing person has a similar name (possible-duplicate case, left for an admin to link manually) |
| `canvasEnrollments` | All student enrollments for a course (used by Canvas Sync) |
| `canvasSections` | All sections across all accessible courses (admin, used by the enroll wizard and audits) |
| `canvasLookupUser` / `canvasUserSearch` | Exact-email / fuzzy-name Canvas user lookup (admin, enroll wizard) |
| `canvasEnroll` | Full manual enrollment: create-user-if-needed, optional email update, optional old-section conclusion, enroll, log (admin) |
| `canvasSectionEnrollments` | Students in one specific section (admin, section-membership audit) |
| `enrollmentWebhook` | HTTP endpoint the WordPress plugin POSTs to after each WooCommerce enrollment attempt; shared-secret auth (`x-webhook-secret` / `ENROLLMENT_WEBHOOK_SECRET`) |
| `requestSelfAssignment` | Self-serve exam entry point (any signed-in user). Resolves the caller's active Canvas section, finds-or-creates the matching `sessions` doc, and builds a 4-test `assignments` doc using unseen/difficulty-tier/well-known-anchor selection (same approach as Auto-assign) |
| `notifySelfServeSubmission` | Fires when a self-serve rater explicitly confirms their scores (`confirmedAt` newly set — not just all 4 tests being scored, which only flips `status` to `submitted`); emails `config/canvas.notificationEmail` via Resend (`RESEND_API_KEY` secret) — skipped silently if either isn't configured |
| `notifyStandardizationSubmission` | Same shape as `notifySelfServeSubmission`, for standardization assignments (`category === 'standardization'` instead of `source === 'self_serve'`, since interlocutors are always admin-assigned, never self-serve) — emails the admin the moment an interlocutor confirms their scores |
| `mintBenchmarkAdminToken` | Bridges an admin's identity into the separate `lenguax-benchmark-32392` Firebase project. Checks `people/{uid}.role === 'admin'`, then mints a custom token with an `admin: true` claim via a second `admin.app()` credentialed with the `BENCHMARK_SERVICE_ACCOUNT_KEY` secret — that claim is what the benchmark project's Firestore rules use to distinguish an admin from a training centre's scoped login (see Benchmark Check's README) |
| `createBenchmarkCentreAccount` / `deleteBenchmarkCentreAccount` | Backs the Benchmark page's Centres tab — creates/removes a centre's Firebase Auth user and matching `centre_accounts/{uid}` doc together in the benchmark project. Rejects a `centreId` already in use by a different account |
| `invitePerson` | Backs the People page's "Invite" action — creates a Firebase Auth user + matching `people/{uid}` doc (any role) in one step, then emails a password-reset link via Resend (`RESEND_API_KEY`) so the person can set their own password. Rejects a duplicate email. Email-send failure is logged but non-fatal — the account/doc are already valid at that point |

See the full Canvas integration write-up (WP plugin ↔ Firebase ↔ RaterSystemNew) for the complete enrollment picture — ask Claude to regenerate it from `CanvasCohortEnrollment/canvas-cohort-enrollment.php` and this file if it's gone stale.

## Self-serve rater exam

A Canvas-enrolled trainee can go to `/take-test`, sign in with Canvas SSO, and land directly in the Scoring player (`/scoring`) pre-loaded with 4 tests — no admin setup required. Mechanics:

- The entry link (`TakeTestPage.tsx`) appends `state=self_serve` to the Canvas OAuth URL (`src/lib/canvasAuthUrl.ts`); Canvas round-trips that `state` back to `CanvasCallbackPage.tsx` unchanged.
- After Canvas sign-in, if `state === 'self_serve'`, the callback calls `requestSelfAssignment` and routes into `/scoring` with the new assignment ID, which `ScoringPage.tsx` auto-opens instead of showing the assignment picker.
- Test selection reuses `AutoAssignPage.tsx`'s tiering approach: tests this rater has never scored, spread across difficulty tiers (`Test.canonicalDifficulty`), with a preferred anchor that's both well-calibrated and has been scored by ≥100 distinct raters (`WELL_KNOWN_RATER_THRESHOLD` in `functions/index.js`). Picks are randomised among equally-eligible candidates (not just the single "best" one) and weighted toward whichever tests this specific section/cohort has used least so far (`cohortFreq` in `requestSelfAssignment`) — otherwise every brand-new trainee in a section would converge on the same handful of tests.
- The session a self-serve assignment files under is named `{Canvas course name} — {Canvas section name}` (e.g. "Rater Course 2026 — July 2026" or "Rater Course 2026 — Acme Airlines"), found-or-created by `canvasSectionId`. Course/section naming is otherwise just a Canvas-side habit — see "Canvas naming convention" below.
- Requires `config/canvas.notificationEmail` and the `RESEND_API_KEY` secret set for email alerts; an in-app "self-serve submissions awaiting review" card also appears on the admin Dashboard regardless.
- **Failsafe:** if Canvas Sync hasn't been run yet for someone taking a self-serve exam, `canvasAuth` auto-creates their `people` doc (role `trainee`) rather than hard-failing — gated on active enrollment in a course from `config/canvas.courses` and no name-similar existing person. Auto-created accounts show a small "auto" badge on the People page for a quick admin sanity check.

## Scoring player (`ScoringPage.tsx`, `/scoring`)

Shared by all three roles for working through an assignment's 4 tests — used both by the self-serve flow above and by normal admin/senior_rater/trainee scoring.

- **Trainee-only anonymisation**: when `role === 'trainee'` (`isTraineeExam`), tests are labelled "Candidate A/B/C/D" instead of showing the candidate's real name, test type, nationality, or test ID — so a rater sitting their own certification exam can't cross-reference which recordings they were assigned. Admins/senior raters scoring elsewhere always see full detail; this is scoped by role, not by page or session type.
- **Drafts survive navigation**: in-progress slider values are mirrored into an in-memory `drafts` map (keyed by testDocId) as you type, independent of what's saved in Firestore. Switching to another candidate and back restores an unsaved edit rather than silently reverting to the last-saved value.
- **Auto-save on navigate-away**: every way of leaving a test with a complete, unsaved change (arrows, "Back to summary," "← Assignments") saves it first automatically — you can't lose an edit just by clicking away without an explicit submit.
- **Review → confirm → lock**: once all 4 are scored, a summary screen ("Review your scores") shows each candidate's overall level (click to expand the full 6-dimension breakdown). Nothing is final until the rater clicks "Yes, that's my scores," which sets `assignment.confirmedAt` — distinct from `status: 'submitted'` (which just means all 4 are scored, and still allows "Review or change an answer"). Once confirmed, there's no UI path back into edit mode.
- **One unified "Continue" button**: never a dead end. It saves the current test if needed, then goes to whichever makes sense next — the nearest not-yet-scored candidate (`findNextIncompleteIdx`, searches forward and wraps, so it works regardless of what order you actually score things in), "Complete" if this is the last one left, or "Back to summary" while reviewing. Flanked by prev/next arrows in the same bottom bar for quick manual navigation.
- **Save confirmation that outlives the navigation**: a `justSaved` toast ("✓ Candidate A saved") persists ~2.5s across whatever screen you land on next, since a save and the navigation that follows it don't always happen on the same screen. A separate, non-expiring `editedThisSession` badge marks any test you've actually changed (not just scored) for the rest of the session, so returning to a candidate later still shows whether you're looking at your edit or the untouched original.
- **Accessibility**: the amber "you changed this" state is backed by a pencil icon and screen-reader-only text, not colour alone; an `aria-live` region announces candidate changes (switching tests updates content in place rather than navigating to a new page); icon-only nav buttons have `aria-label`s. The main button shows a shorter label on narrow screens (`sm:` breakpoint) since the full destination-aware label ("Continue to Candidate C") can overflow next to the flanking arrows.

`PracticeScorePage.tsx` (`/practice/:code` — the separate live-practice player for in-course group exercises, joined via a 6-character code, no login) reuses only the ready-to-submit banner/bar-colour treatment from this page, not the rest of it — it's always a single test with no multi-candidate navigation, review, or confirm step.

## Standardization (`StandardizationPlayerPage.tsx`, `/standardization` + `/standardization-results`)

A second, entirely separate test/assignment/score pipeline for standardization exercises, kept deliberately isolated from the rater-course one so the two pools can never cross-contaminate:

- **Test pool**: `test_bank` docs get `category: 'rater_course' | 'standardization'` (undefined = `'rater_course'`). Shown as a coloured pill (`CategoryBadge.tsx`) in Test Bank and Assignments. Every existing test-pool consumer (Auto-assign, the self-serve trainee-exam picker, Quick Entry, manual Score entry) filters standardization tests out — they were never standardization-aware before this feature existed, so each needed an explicit exclusion.
- **Assignments**: `assignments` docs get the same `category` field, chosen as the *first* field when creating one (locked once created — can't be changed after tests are picked). Choosing "Standardization" filters the test checklist to that pool and the rater picker to people with `role === 'interlocutor'` or `canStandardize: true`; choosing "Rater course" excludes interlocutors from the rater picker. Sessions are **not** category-scoped — `Session.type` already means something else (`calibration`/`reliability` etc. are rater-course work), so any session can host either category. A dedicated `examiner_standardization` `Session.type` exists purely as an organizational label for events built around this work — it doesn't restrict which category of assignment a session can hold, same as every other type.
- **Test numbering**: standardization tests get their own auto-assigned number on creation, separate from the legacy rater-course `testId` sequence, and shown prefixed "S" (e.g. "S3") everywhere a test number appears — via the shared `formatTestNumber()` helper in `src/lib/testNumber.ts`. Rater-course tests keep the plain "#3" format; neither sequence is auto-assigned except this one (new rater-course tests still get no number, matching the pre-existing behavior — `testId` was only ever populated for the ~51 legacy imported tests until now). Test Bank's edit form also has a manual "Test number" field — a typed value always wins over auto-assignment, and it's the way to backfill a number onto a test created before auto-numbering existed. Saving blocks if the typed number is already used by another test in the same category (the two "#"/"S" sequences are checked independently).
- **Standardization Results** also has a plain CSV export (`Export CSV`, matches the export already on the Scores/Practice Sessions pages) and emails the admin via `notifyStandardizationSubmission` the moment an interlocutor confirms an assignment — see the Cloud Functions table below.
- **Player** (`StandardizationPlayerPage.tsx`, `/standardization`): an independent copy of `ScoringPage.tsx`'s mechanics (drafts, auto-save-on-navigate-away, single "Continue" button, review → confirm → lock via `assignment.confirmedAt`) — not shared code, same precedent as `PracticeScorePage.tsx`. Differences from `ScoringPage.tsx`: no trainee Candidate-A/B/C/D anonymisation (never a blind exam here), no self-serve auto-open, and an added free-text comments field per test (`maxLength 250`, tracked in the same draft map alongside the 6 ICAO scores).
- **Results** (`StandardizationResultsPage.tsx`, `/standardization-results`, admin-only): writes go to `standardization_scores`, a separate collection from `scores` (same shape minus `published`, plus `comments`) — modeled on `ScoresPage.tsx`'s fetch-all + client-side substring filter pattern (filter by rater/candidate/event name), without the Rasch-export/permanent-rater-number logic, which is a rater-course-specific psychometric concern.
- **Access**: gated by `ProtectedRoute`'s `requireStandardization` prop — `role === 'admin' || role === 'interlocutor' || canStandardize`. `AuthContext` carries `canStandardize` alongside `role` from the same `people/{uid}` read. `AppShell`'s nav uses the same OR-condition for the "Standardization" sidebar item.
- **Onboarding**: interlocutors (and any existing rater given `canStandardize: true`) are created via the "Invite" flow — see "Adding a person" above.
- **Results audio**: `StandardizationResultsPage.tsx` also has an inline play/stop button per row (same toggle pattern as Test Bank), so a score can be reviewed against its recording without leaving the page.
- **Fed by Practice Sessions too**: see below — a trainer can promote Canvas-identified Practice Session scores straight into `standardization_scores`.

## Practice Sessions (`/practice`, public `/practice/:code`)

Ad-hoc live-course exercise: a trainer creates a session (optionally linked to a `test_bank` recording), shares the 6-character-code link, and participants score along in real time — no account required by default.

- **Identity is optional**: on landing at `/practice/:code`, an unauthenticated participant sees a prominent "Continue with Canvas" link before the old free-text name field. It reuses the self-serve exam's Canvas OAuth plumbing as-is (`canvasOAuthUrl`/`canvasAuth`/`CanvasCallbackPage.tsx`) via a second recognized `state` shape, `practice:<code>` — Canvas always redirects to the one fixed callback URL, so this opaque `state` string is what tells the callback "come back to this practice session" instead of the exam flow. A "I don't have a Canvas account" toggle still exposes the original anonymous name-entry, with a note that those scores can't be promoted.
- **Identified scores** carry `raterId`/`raterName` on the `PracticeScore` doc (anonymous ones omit both) and are looked up fresh from Firestore on reload (works across devices) instead of the `localStorage` check the anonymous path still uses.
- **Promote to standardization pool**: in the trainer's results view (`PracticePage.tsx`), a "Save to standardization pool" button sits next to the existing "Clear scores" delete — two independent choices, not a combined action. It copies every Canvas-identified, not-yet-promoted score into `standardization_scores` (stamping `promotedToStandardization: true` on the source so re-clicking is idempotent), using the session's linked `test_bank` doc for `candidateName`/`testType`/`testNumber`. Only available when the session was built from a real Test Bank recording — an ad-hoc session with no linked test has nothing to attach a standardization record to. Written as the signed-in admin, so the existing `standardization_scores` create rule's `isAdmin()` branch already covers it — **no Firestore rules changes were needed for any of this.**
- **Finding the right test to link**: the "New session" dialog's test picker only ever offers `category: 'standardization'` tests — `rater_course`-category tests are reserved for the trainee's real final assignment at the end of the course and must never be previewed in a live practice session ahead of time. Within that pool, the picker is filterable by `Test.courseTag` (`rater_course`/`refresher_course`/`other` — an independent sub-classification of *which course* the test is used in, unrelated to `category`) and sorted by `Test.dayLabel` (a free-text field like "Day 1", plain string-sorted) then test number.

## Storyline Replacement (`/storyline`)

Phase 1 of replacing Articulate Storyline as the tool used to author and run
aviation English speaking tests (full background:
`/home/paul/Programs/Storyline-Replacement/storyline-replacement-spec.md`).
This phase covers authoring, in-app preview, and export — **not** the
WordPress auth/redirect integration, which is a later phase.

- **Data model**: `storyline_tests` (a named test series, e.g. "Approach") →
  `storyline_versions` (an immutable-once-published version, `testId` +
  `status: 'draft'|'published'|'archived'` + an embedded `items[]` array).
  `StorylineItem` = `{ id, type: 'logo'|'task_prompt'|'picture_prompt', order,
  examinerText?, candidateState, media?: {imageUrl?, audioUrl?}, timing?:
  {prepSeconds?, responseSeconds?} }`. Task types are structurally identical
  across tests — only content differs — so the item form doesn't branch on
  `type`; it's mainly a content-organisation label.
- **Pages**: `StorylineTestsPage` → `StorylineVersionsPage` (draft/publish/
  duplicate-as-new-draft/archive lifecycle) → `StorylineVersionEditorPage`
  (add/reorder/remove items, per-item media upload via `MediaUploadField`).
  A published version's editor is read-only — edits require "Duplicate" to
  spin up a new draft.
- **Access**: `storyline_tests`/`storyline_versions`/`storylines/` Storage are
  admin-only for read *and* write (unlike `test_bank`'s `isSignedIn()`-read —
  test content should stay confidential, and the exported player never
  queries Firestore directly).
- **Player shell** (`player-src/` at the repo root, sibling to `src/`, its own
  minimal `tsconfig.json` — deliberately outside the main `tsc -b` graph):
  plain HTML/TS `examiner.html`/`examiner.ts` (control view, triggers
  candidate-state changes) and `candidate.html`/`candidate.ts` (builds one
  hidden panel per item, toggles visibility on incoming messages) — no React
  or Firebase dependency, so an exported test runs standalone. Sync is via
  `BroadcastChannel` (replacing the old system's fragile direct cross-window
  JS reference); both windows independently load the same item list at
  startup (no ready/handshake race), and the channel carries only the
  runtime "advance to state X" signal.
- **Build**: a *separate* `vite.config.player.ts` (multi-page, fixed asset
  names via a manifest, `outDir` pointed straight at `public/player-shell`)
  builds this shell. Wired as an npm `prebuild` script, so `public/player-
  shell/` can never drift from `player-src/` source — safe because it never
  touches `dist/` beyond what the main build's static-asset copy already
  does, and `.github/workflows/deploy.yml` only FTPs `dist/`.
- **Preview**: `useStorylinePreview.ts` writes the current (possibly unsaved)
  draft items to `localStorage` under a random per-launch session ID and
  opens `player-shell/examiner.html?preview=1&session=…` — the *exact* same
  built artifact used for export, so there's no drift between what's tested
  and what's shipped.
- **Export**: `exportStoryline.ts` reads `public/player-shell/.vite/
  manifest.json` (emitted by the player build) to discover every built file
  without hardcoding filenames, zips them with `jszip` alongside a generated
  `version.json` (the published version's `items`, referencing live Firebase
  Storage download-URLs — no media re-hosting, matching the already-decided
  no-offline-first posture), and downloads it. v1 publish is manual: an admin
  uploads this zip to the WordPress tests folder and pastes the URL into the
  existing TEAC-Plugin admin, same as the current Storyline workflow.

## Notes

- `shadcn/ui` here uses the Base UI variant — always `render` prop, never `asChild`
- SiteGround caches aggressively — hard refresh (Ctrl+Shift+R) after deploys
- Canvas SSO requires Redis on the Canvas server and Firebase Functions with public (unauthenticated) access
- Old GRaterSystem source is at `/home/paul/Programs/GRaterSystem/` for reference

## Last updated

2026-07-24
