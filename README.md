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

| Page | admin | senior_rater | trainee | examiner |
|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| People | ✓ | | | |
| Test Bank | ✓ | | | |
| Test Versions | ✓ | | | |
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
| `storyline_tests` / `storyline_versions` / `storyline_parts` / `storyline_template` / `storyline_events` | Test Versions (Storyline Replacement) authoring + violation/completion reports — see "Storyline Replacement" section below |

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

**Invite (recommended, any role)** — People page → "Invite": takes name/email/role/`canStandardize`, calls the `invitePerson` Cloud Function, which creates the Firebase Auth user + matching `people` doc (UID = doc ID) together and emails the person a link to set their own password. Works for `admin`/`senior_rater`/`trainee`/`examiner`.

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
| `notifyStandardizationSubmission` | Same shape as `notifySelfServeSubmission`, for standardization assignments (`category === 'standardization'` instead of `source === 'self_serve'`, since examiners are always admin-assigned, never self-serve) — emails the admin the moment an examiner confirms their scores |
| `mintBenchmarkAdminToken` | Bridges an admin's identity into the separate `lenguax-benchmark-32392` Firebase project. Checks `people/{uid}.role === 'admin'`, then mints a custom token with an `admin: true` claim via a second `admin.app()` credentialed with the `BENCHMARK_SERVICE_ACCOUNT_KEY` secret — that claim is what the benchmark project's Firestore rules use to distinguish an admin from a training centre's scoped login (see Benchmark Check's README) |
| `createBenchmarkCentreAccount` / `deleteBenchmarkCentreAccount` | Backs the Benchmark page's Centres tab — creates/removes a centre's Firebase Auth user and matching `centre_accounts/{uid}` doc together in the benchmark project. Rejects a `centreId` already in use by a different account |
| `invitePerson` | Backs the People page's "Invite" action — creates a Firebase Auth user + matching `people/{uid}` doc (any role) in one step, then emails a password-reset link via Resend (`RESEND_API_KEY`) so the person can set their own password. Rejects a duplicate email. Email-send failure is logged but non-fatal — the account/doc are already valid at that point |
| `reportStorylineEvent` | HTTP endpoint, no auth (called directly by the exported Storyline player, which has no Firebase SDK/session at all — see Storyline Replacement section). Logs every call to `storyline_events`; `type: 'violation'` calls also email `config/storyline.notificationEmail` via Resend |

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

- **UI labels (2026-07-30)**: the Test Bank/Assignments category pickers and filters display "Certification"/"In-session" rather than "Rater course"/"Standardization" — a display-only rename for user clarity. The underlying `category` values (`'rater_course'`/`'standardization'`), this section's own name, its route (`/standardization`), Firestore collections, and Cloud Function names are all unchanged — don't conflate the UI label with the internal identifier when grepping for one or the other.
- **Test pool**: `test_bank` docs get `category: 'rater_course' | 'standardization'` (undefined = `'rater_course'`). Shown as a coloured pill (`CategoryBadge.tsx`) in Test Bank and Assignments. Every existing test-pool consumer (Auto-assign, the self-serve trainee-exam picker, Quick Entry, manual Score entry) filters standardization tests out — they were never standardization-aware before this feature existed, so each needed an explicit exclusion.
- **Assignments**: `assignments` docs get the same `category` field, chosen as the *first* field when creating one (locked once created — can't be changed after tests are picked). Choosing "In-session" filters the test checklist to that pool and the rater picker to people with `role === 'examiner'` or `canStandardize: true`; choosing "Certification" excludes examiners from the rater picker. Sessions are **not** category-scoped — `Session.type` already means something else (`calibration`/`reliability` etc. are rater-course work), so any session can host either category. A dedicated `examiner_standardization` `Session.type` exists purely as an organizational label for events built around this work — it doesn't restrict which category of assignment a session can hold, same as every other type.
- **Test numbering**: standardization tests get their own auto-assigned number, separate from the legacy rater-course `testId` sequence, and shown prefixed "S" (e.g. "S3") everywhere a test number appears — via the shared `formatTestNumber()` helper in `src/lib/testNumber.ts`. Rater-course tests keep the plain "#3" format; neither sequence is auto-assigned except this one (new rater-course tests still get no number, matching the pre-existing behavior — `testId` was only ever populated for the ~51 legacy imported tests until now). Auto-assignment fires whenever the Test Bank edit form's "Test number" field is left blank and the category is standardization — **not just on create**: switching an existing test's category into standardization also triggers it (fixed 2026-07-30; previously only new tests got a number, so converting an existing rater-course test carried its old numeric id straight into the standardization namespace and usually collided with one already in use there). A typed value always wins over auto-assignment regardless, and is the way to backfill a number onto a test created before auto-numbering existed. Saving blocks if the typed number is already used by another test in the same category (the two "#"/"S" sequences are checked independently).
- **Gotcha (fixed 2026-07-30)**: Firestore stores an unset `testId`/`durationSeconds` as `null` (Firestore rejects real `undefined`), but the edit form's Zod schema only accepts `undefined` for an empty optional field. `TestDrawer.tsx`'s `reset()` used to load that `null` straight into form state, so saving *any* test with a blank number or duration failed validation with a raw "Invalid input" message before `onSubmit` ever ran. Now normalized to `undefined` on load — if a similar "Invalid input" surfaces on another optional numeric field loaded from Firestore, check for this same pattern first.
- **Gotcha (fixed 2026-07-30)**: Base UI's `<Select.Value>` renders the raw stored value when it has no explicit label mapping, not the matching `SelectItem`'s text — the Category picker showed literal `standardization` in the trigger instead of "In-session" until an explicit `children={(v) => label}`-style mapping was added (same workaround already used in `AssignmentDrawer.tsx`; see also `feedback_baseui_select_value` gotcha pattern). This was invisible before the label rename above since the old label text nearly matched the raw value — worth checking any other Select trigger in this codebase that lacks an explicit label mapping if a similar "shows the wrong text" report comes in.
- **Test Bank form**: the Duration (seconds) field was removed (2026-07-30) — it was optional, unenforced, and not read anywhere else in the app (not displayed in Test Bank, not used by scoring/players). `Test.durationSeconds` stays in the schema/type since old data and `ImportTestsPage.tsx` still populate it; there's just no way to set it by hand anymore.
- **Standardization Results** also has a plain CSV export (`Export CSV`, matches the export already on the Scores/Practice Sessions pages) and emails the admin via `notifyStandardizationSubmission` the moment an examiner confirms an assignment — see the Cloud Functions table below.
- **Player** (`StandardizationPlayerPage.tsx`, `/standardization`): an independent copy of `ScoringPage.tsx`'s mechanics (drafts, auto-save-on-navigate-away, single "Continue" button, review → confirm → lock via `assignment.confirmedAt`) — not shared code, same precedent as `PracticeScorePage.tsx`. Differences from `ScoringPage.tsx`: no trainee Candidate-A/B/C/D anonymisation (never a blind exam here), no self-serve auto-open, and an added free-text comments field per test (`maxLength 250`, tracked in the same draft map alongside the 6 ICAO scores).
- **Results** (`StandardizationResultsPage.tsx`, `/standardization-results`, admin-only): writes go to `standardization_scores`, a separate collection from `scores` (same shape minus `published`, plus `comments`) — modeled on `ScoresPage.tsx`'s fetch-all + client-side substring filter pattern (filter by rater/candidate/event name), without the Rasch-export/permanent-rater-number logic, which is a rater-course-specific psychometric concern.
- **Access**: gated by `ProtectedRoute`'s `requireStandardization` prop — `role === 'admin' || role === 'examiner' || canStandardize`. `AuthContext` carries `canStandardize` alongside `role` from the same `people/{uid}` read. `AppShell`'s nav uses the same OR-condition for the "Standardization" sidebar item.
- **Onboarding**: examiners (and any existing rater given `canStandardize: true`) are created via the "Invite" flow — see "Adding a person" above.
- **Results audio**: `StandardizationResultsPage.tsx` also has an inline play/stop button per row (same toggle pattern as Test Bank), so a score can be reviewed against its recording without leaving the page.
- **Fed by Practice Sessions too**: see below — a trainer can promote Canvas-identified Practice Session scores straight into `standardization_scores`.

## Practice Sessions (`/practice`, public `/practice/:code`)

Ad-hoc live-course exercise: a trainer creates a session (optionally linked to a `test_bank` recording), shares the 6-character-code link, and participants score along in real time — no account required by default.

- **The trainer plays the recording, not participants**: the audio player (with speed controls) lives in the trainer's session view (`PracticePage.tsx`'s `ResultsView`) — they play it once for the whole group (e.g. over speakers in the room). The participant-facing scoring page (`PracticeScorePage.tsx`) has no player at all, just a static "Your trainer is playing the recording" message; it never had one for ad-hoc (no linked test) sessions, and now doesn't for linked-test sessions either.
- **Identity is optional**: on landing at `/practice/:code`, an unauthenticated participant sees a prominent "Continue with Canvas" link before the old free-text name field. It reuses the self-serve exam's Canvas OAuth plumbing as-is (`canvasOAuthUrl`/`canvasAuth`/`CanvasCallbackPage.tsx`) via a second recognized `state` shape, `practice:<code>` — Canvas always redirects to the one fixed callback URL, so this opaque `state` string is what tells the callback "come back to this practice session" instead of the exam flow. A "I don't have a Canvas account" toggle still exposes the original anonymous name-entry, with a note that those scores can't be promoted.
- **Identified scores** carry `raterId`/`raterName` on the `PracticeScore` doc (anonymous ones omit both) and are looked up fresh from Firestore on reload (works across devices) instead of the `localStorage` check the anonymous path still uses.
- **Promote to standardization pool**: in the trainer's results view (`PracticePage.tsx`), a "Save to standardization pool" button sits next to the existing "Clear scores" delete — two independent choices, not a combined action. It copies every Canvas-identified, not-yet-promoted score into `standardization_scores` (stamping `promotedToStandardization: true` on the source so re-clicking is idempotent), using the session's linked `test_bank` doc for `candidateName`/`testType`/`testNumber`. Only available when the session was built from a real Test Bank recording — an ad-hoc session with no linked test has nothing to attach a standardization record to. Written as the signed-in admin, so the existing `standardization_scores` create rule's `isAdmin()` branch already covers it — **no Firestore rules changes were needed for any of this.**
- **Finding the right test to link**: the "New session" dialog's test picker only ever offers `category: 'standardization'` tests — `rater_course`-category tests are reserved for the trainee's real final assignment at the end of the course and must never be previewed in a live practice session ahead of time. Within that pool, the picker is filterable by `Test.courseTag` (`rater_course`/`refresher_course`/`other` — an independent sub-classification of *which course* the test is used in, unrelated to `category`) and sorted by `Test.dayLabel` (a free-text field like "Day 1", plain string-sorted) then test number.

## Storyline Replacement / Test Versions (`/test-versions`)

Phase 1 of replacing Articulate Storyline as the tool used to author and run
TEAC (Test of English for Aeronautical Communication) speaking tests (full
background: `/home/paul/Programs/Storyline-Replacement/storyline-replacement-
spec.md` and its `Spec Updates/` revision). Branded "Test Versions" in the
nav (bottom of the sidebar, admin-only); folder/component names still say
"Storyline" internally. This phase covers authoring, in-app preview, and
export — **not** the WordPress auth/redirect integration, which is a later
phase.

- **Data model**: a `storyline_tests` doc is a role type (e.g. "Approach"),
  branded "Test Type" in the nav/UI (`StorylineTestsPage`'s heading, "Add
  test type" etc. — only the label changed, collection/component names
  still say "test"); `testType` (a fixed `StorylineTestType` union — Airline
  Pilot, Private Pilot, Ab-Initio Pilot, Rotary Wing Pilot, Aerodrome/
  Approach/Area ATC, Student ATC, ADP Driver, Airport Operations, FISO/
  AFISO) lets the list be sorted by licence/role category independent of
  the free-text `name`; each `storyline_versions` doc is one immutable-once-published assembly of
  content for that test. The real test content is 4 **Parts**, each a
  globally-shared, pooled unit in its own `storyline_parts` collection (not
  scoped to any Test — matches real cross-role-type content sharing found in
  the TEAC tracking spreadsheet), with `draft`/`published`/`archived` status
  plus `active`/`isBackup` flags, plus an optional `testTypes:
  StorylineTestType[]` — which Test Types a Part is eligible for, not
  mutually exclusive (e.g. a Part 2 might serve both FISO/AFISO and ADP
  Driver, matching the real "W pool spans 7 of 11 types" sharing already
  noted on `StorylinePart`). Undefined/empty means eligible for every Test
  Type — the backward-compatible default, so none of the ~90 Parts that
  existed before this field did needed retroactive tagging. Edited inline
  in `StorylinePartsPage` (a "Test types" action expands a row of toggle
  chips, immediate-persist, no separate save step — same pattern as
  Active/Backup toggles) and filterable there too. `StorylineVersionEditorPage`'s
  Part picker filters its options by the current Test's `testType` against
  each candidate Part's `testTypes` (untagged Parts stay eligible
  everywhere) — an already-selected Part stays visible even if it's since
  been retagged out of eligibility, so an existing draft doesn't silently
  lose its selection. A Version just references one Part per number
  (`partRefs`) and supplies its own whole-test slide content directly.
  A single shared `storyline_template/current` doc (`StorylineTemplate`,
  edited on `StorylineTemplateEditorPage`) holds the fixed examiner wording
  as an ordered list of `TemplateSlide`s — `{questions}`/`{topic}` are
  content slots filled per-Version/Part, `[placeholder]` tokens are filled
  once per Test (`StorylineTest.variables`), `notes` is examiner-only
  guidance shown in the player's notes drawer, `candidateInstructions` is
  fixed on-screen text/bullets shown to the candidate for the whole
  duration of that slide's `candidateState` (e.g. Part 2/3's "report the
  message" prompts — supports lightweight `**bold**`/`__underline__`
  markup, no full HTML), `checklistItems` turns an `admin_checklist` slide
  into one checkbox per item (Next disabled until all are ticked), and
  `startsTestTimer` marks the one slide (normally "invite candidate into
  the room") that starts the session timer. `resolveItems.ts` is the single
  function that merges template + Test variables + a Version's whole-test
  content + its 4 Parts' content into the final flat `StorylineItem[]` —
  used identically by Preview, Publish (snapshots the result into
  `version.items`), and Export. It also takes a `testDisplayName` param
  (`"{test.name} — {version.versionLabel}"`, computed by the caller — the
  only field on `StorylineItem` not derived from `TemplateSlide`/slot
  content) for the `accept_reject_test` slide to display.
- **Pages**: `StorylineTestsPage` → `StorylineVersionsPage` (draft/publish/
  duplicate-as-new-draft/archive lifecycle, Part picker, Preview, Export) →
  `StorylineVersionEditorPage` (whole-test slot-filling + per-Part Select).
  `StorylinePartsPage` (Parts Library, filterable by Part number/status/
  backup, archived hidden by default via a "Show archived" toggle since they
  pile up and rarely matter day-to-day) → `StorylinePartEditorPage`
  (slot-filling for that Part's slides only). `StorylineThemeRulesPage`
  (`/test-versions/themes`) manages the shared theme vocabulary and
  unmixable Part-1/4 pairs (see "Dynamic Part-pooling" below).
  `StorylineTestContentEditorPage` (`/test-versions/:testId/content`, "Content"
  from the Test Types list) is the whole-test-slide equivalent of
  `StorylinePartEditorPage`, also part of the dynamic Part-pooling work
  below. A published Version or Part's
  *content* is read-only — edits require "Duplicate" to spin up a new draft
  — but a Part's `label` can be renamed regardless of status (it's
  organizational metadata, not test content, so renaming doesn't touch the
  immutability guarantee); mainly useful to clean up a Duplicate's default
  "(copy)" name. Publish is blocked with a specific list of what's missing
  if any of that Part's tagged slides are missing required content
  (`partCompleteness.ts`'s `missingPartContent()`, checked against the
  template's slotSpec for topic/questions/images/audio/volumeCheck).
- **Access**: `storyline_tests`/`storyline_versions`/`storyline_parts`/
  `storyline_template`/`storylines/` Storage are admin-only for read *and*
  write (unlike `test_bank`'s `isSignedIn()`-read — test content should stay
  confidential, and the exported player never queries Firestore directly).
  Storage's `isAdmin()` checks an `admin: true` Auth custom claim (synced
  from `people.role` by the `syncAdminClaim` Cloud Function) rather than a
  cross-service Firestore read — see "Gotchas" below.
- **Player shell** (`player-src/` at the repo root, sibling to `src/`, its own
  minimal `tsconfig.json` — deliberately outside the main `tsc -b` graph):
  `examiner.html`/`examiner.ts` is a single-slide-at-a-time navigator (one
  large fixed-size card headed by the slide's authored `label`, a segmented
  progress bar, a small Lenguax brand mark in the header, Back/Next) and
  `candidate.html`/`candidate.ts` builds one panel **per distinct
  `candidateState`** (not per item — several slides can share one state,
  e.g. Part 3's four sub-slides all stay on "Task3", so items are grouped
  and whichever one in the group actually has images/`candidateInstructions`
  is used, rather than stacking duplicate panels on top of each other at the
  same fixed position) — an image row if the slide has images, the slide's
  `candidateInstructions` (bullets/bold/underline, transcribed from the old
  system's actual candidate-screen slides) if it has those, or the TEAC logo
  (`player-src/assets/teac-logo.png`, a local copy so the exported zip stays
  self-contained) as a fallback rather than the raw internal `candidateState`
  key, which was never meant to be candidate-facing — and toggles visibility
  on incoming messages. When a slide shows more than one
  image at once (e.g. Part 4's "both pictures"), each one is tagged A, B, …
  on both the examiner and candidate screens so everyone can unambiguously
  refer to "picture A" vs "picture B"; on the examiner screen a thumbnail
  can also be clicked to pop out to near-full-viewport size (a `position:
  fixed` clone animated from/to the thumbnail's own on-screen rect — a FLIP-
  style animation, not a generic centered lightbox) and clicked again (or
  the backdrop) to collapse back to exactly where it was. No React or
  Firebase dependency, so an exported test runs standalone. Sync is via
  `BroadcastChannel` (replacing the old system's fragile direct cross-window
  JS reference); both windows independently load the same item list at
  startup, and the channel carries the runtime "advance to state X" signal,
  sent automatically on every Next/Back — there's no separate "Show"
  action. `candidate.ts` also posts a `ready` message once its panels are
  built (on first load *and* every reopen) — `examiner.ts` replies with the
  current slide's state directly, so a (re)opened candidate window shows
  the right panel immediately instead of sitting blank until the next
  slide transition (a real bug: opening the candidate window mid-slide
  previously showed nothing until the next Next/Back click, since nothing
  had re-sent the already-current state to the newly-loaded page).
  Audio plays from the **examiner's own console** (everyone in the room
  hears it via one set of speakers, matching the real in-person, single-room
  setup). Only one clip may be active at a time across the whole console —
  starting one disables every other clip's Play button until it's
  explicitly Stopped or finishes on its own (pausing does not free the
  slot up; Pause toggles pause/resume in place on the active clip, with a
  pulsing indicator dot while playing). Each clip has a soft play-count
  limit (warns and logs past `maxPlays`, never blocks) tracked on actual
  completion (the `ended` event, not the click) — shown as green ✓ ticks,
  turning into a red ❗ past two completions — plus a visible in-session
  Event Log. A slide can also declare `slotSpec.volumeCheck` for a separate,
  unlimited-replay clip (e.g. Part 2's pre-recording volume check),
  rendered as an ordinary extra clip alongside the slide's main audio. Next
  is disabled until every audio clip on the current slide has actually
  completed at least once, except in Preview mode, which bypasses this so
  an admin can click through freely while the candidate window still tracks
  the current slide. A header volume slider scales every clip's playback
  volume live. A collapsible notes drawer (collapsed by default) shows each
  slide's `notes`. A continuous timer starts the moment the slide tagged
  `startsTestTimer` is reached and runs for the rest of the session; a
  slide's own `timing.prepSeconds`/`responseSeconds` (if set) auto-starts a
  second countdown the moment that slide becomes current — purely
  informational, it never gates navigation. A slide can also declare
  `previewParts: [1, 4]` etc. to compile the actual topic/question content
  already authored for those Parts into a visually distinct block on its own
  slide (bold+italic, extra paragraph spacing — `StorylineItem.previewContent`,
  kept structured rather than flattened into `examinerText` specifically so
  the player can style it) — e.g. an "examiner preview" slide shown before
  the test starts, with `previewExclude` letting individual Part-tagged
  slides opt out of appearing in any such compilation (e.g. Part 4's
  picture-interview slides are excluded — those questions depend on seeing
  the images live, so only the closing discussion questions are worth
  previewing in advance). `nextButtonLabel` overrides the Next button's
  text/prominence for one slide only (e.g. "START TEST" on the last
  pre-test slide, styled bigger via `.next-btn-prominent`), reverting to
  the default "Next ▶" on the following slide.
  **Gotcha — editing the template is safe, *reloading* the seed is not**:
  `notes`, `startsTestTimer`, `previewParts`, `previewExclude`,
  `nextButtonLabel`, and `volumeCheck` are all fields on `TemplateSlide`,
  authored per-slide in the Script Template editor (`/test-versions/
  template`) — not in `templateSeed.ts` (that file only seeds the *first*
  "Load example script" click; it never updates a template already saved to
  Firestore). A template saved before one of these fields existed simply
  won't have it set on any slide until an admin opens the affected slide(s)
  and sets it. "Load example script" (`loadExampleScript()` in
  `StorylineTemplateEditorPage.tsx`) now preserves each slide's existing
  `id` when its `label` matches an existing slide, specifically so
  `StorylinePart`/`StorylineVersion` slot content — which is keyed by slide
  id, not label — doesn't get silently orphaned by a reload. Before this
  fix, reloading the seed to pick up new fields assigned every slide a
  fresh random id, breaking every Part/Version's already-authored questions
  and media (nothing was deleted, but `slotFor()` in `resolveItems.ts`
  could no longer find it — a real incident, repaired via a one-off script
  matching old keys to new ids by content shape/filename). If this ever
  recurs (e.g. a slide's `label` was also renamed in the same reload, so
  the matching can't find it), the fix is the same: match each Part's
  `slotContent` keys to the new template's slide ids by shape (which slide
  has images vs questions vs which audio filenames) and rewrite the keys.
- **Pre-test gated screens** (3 seed slides, transcribed from the old
  system's real start-of-test screens): `accept_reject_test` shows
  `item.testDisplayName` with Accept/Reject buttons in place of the normal
  nav bar — Accept advances, Reject confirms then calls `endSession()`
  (clears the slide card, hides the nav bar, and makes every button
  handler a no-op for the rest of the session — recoverable only by
  re-launching Preview/export); in Preview mode Reject just logs instead,
  since preview is for free exploration. `test_data_confirm` renders 4
  plain text inputs (Centre Name/Test Number/Examiner Name/Candidate
  Name) + an agree-to-terms checkbox — a manual stand-in for what a real
  booking system will supply once Phase 2 exists — gated the same way as
  audio (Next disabled until complete, bypassed in Preview). The values
  typed there are the one piece of genuinely new *runtime* state in the
  player (`liveFields` in `examiner.ts`, populated when Next is clicked on
  that slide): `applyLiveFieldSubstitutions()` fills the same
  `{Centre Name}`/`{Test Number}`/`{Examiner Name}`/`{Candidate Name}`/
  `{Date}` tokens into `examinerText` at render time for every slide after
  it (e.g. the Preamble) — everything else in this app resolves once at
  authoring time, this is the one thing that has to happen live, since the
  data doesn't exist until the examiner types it in mid-session.
- **Build**: a *separate* `vite.config.player.ts` (multi-page, content-hashed
  asset names via a manifest, `outDir` pointed straight at `public/player-
  shell`) builds this shell. Wired as an npm `prebuild` script, so `public/
  player-shell/` can never drift from `player-src/` source — safe because it
  never touches `dist/` beyond what the main build's static-asset copy
  already does, and `.github/workflows/deploy.yml` only FTPs `dist/`.
  Content-hashed (not fixed) filenames specifically so a browser can't keep
  serving a stale cached copy after a deploy — this shell changes
  constantly during active development, and a fixed filename with no
  explicit Cache-Control header on the production host caused a real,
  multi-round debugging saga (a "fix isn't showing up" report that was
  actually just a stale-cache issue, not a code bug — see
  `vite.config.player.ts`'s comment for the full history).
  Both examiner.ts and candidate.ts also call `preloadAllMedia()`
  (`player-src/shared/preloadMedia.ts`) as soon as items load — a
  fire-and-forget `fetch()` of every image/audio URL the version
  references, warming the browser's HTTP cache ahead of when each slide is
  actually reached, rather than only fetching lazily per-slide. Not a
  guarantee of true offline playback (that would need a service worker
  explicitly caching responses regardless of server headers — not built),
  just meaningfully reduces the odds a brief connectivity hiccup mid-test
  lands on a slide whose media hasn't loaded yet.
- **Preview**: `useStorylinePreview.ts` writes the resolved items to
  `localStorage` under a random per-launch session ID and opens `player-
  shell/examiner.html?preview=1&session=…` — the *exact* same built artifact
  used for export, so there's no drift between what's tested and what's
  shipped.
- **Look & feel** (`StorylineTheme` on `StorylineTemplate.theme`, built
  2026-07-30): a deliberately small, fixed set of admin-configurable knobs
  — logo height, accent color, slide max-width, slide min-height — not
  arbitrary CSS, to keep every version looking coherent rather than risking
  admins producing something broken/inconsistent. Edited in a "Look & feel"
  panel on `StorylineTemplateEditorPage`, applied by the player as CSS
  custom properties (`applyTheme()` in `player-src/shared/applyTheme.ts`,
  called once on load) — `player.css`'s relevant rules read `var(--x,
  <built-in-default>)`, so an unset field just falls back cleanly. Kept as
  a *separate* file from the item data rather than a field on it — Preview
  writes it to its own `localStorage` key (`themeStorageKey()`), Export
  writes a sibling `theme.json` in the zip (not baked into `version.json`)
  — so an export built before this feature (no `theme.json` at all) falls
  back to every default exactly the same way an unset field does. Bumped
  the built-in defaults themselves at the same time (logo 56→84px, slide
  max-width 960→1100px, slide min-height 560→640px) as a "tidy up the first
  few slides" pass.
- **Export** (the legacy, still-live one-zip-per-Version path used by the
  Practice/example-test flow — the dynamic Part-pooling exports are a
  separate set of functions in the same file, documented under "Dynamic
  Part-pooling" below): `exportStoryline.ts` reads `public/player-shell/.vite/
  manifest.json` (emitted by the player build) to discover every built file
  without hardcoding filenames — walking each chunk's `imports`, `css`, *and*
  `assets` (the last covers static files like the candidate logo that a
  chunk references but doesn't import as a module; easy to forget since only
  `imports`/`css` mattered before player-src had any static assets) — zips
  them with `jszip` alongside a generated `version.json`. `bundleMedia()`
  downloads every image/audio URL referenced across the version's items
  exactly once (deduped by URL — combo-image slides always reuse an
  earlier slide's upload) and embeds them in the zip under `media/`,
  rewriting `version.json` to reference those local relative paths instead
  of the live Firebase Storage URLs — reverses the originally-decided
  no-offline-first posture, since once uploaded next to `examiner.php`
  every asset loads same-origin from the WP host itself rather than
  depending on Firebase Storage staying reachable during a real sitting.
  Dedup is keyed by the in-flight *promise*, not the resolved filename —
  items are processed concurrently, so two slides sharing one URL could
  otherwise both pass the "already downloading?" check before either
  fetch resolves and embed the same file twice under different names.
  `examiner.html` is wrapped into `examiner.php` with the exact PHP access
  gate the old Storyline exports had prepended by hand (WP session +
  booking `check` hash + `administer_tests` capability — see
  `Storyline-Replacement/storyline-replacement-spec.md` §"Path A") baked in
  automatically, so nobody has to remember to copy-paste it per export.
  `candidate.html` is left unwrapped — it's only ever opened via
  `window.open()` from inside the already-gated examiner session, never
  navigated to directly, so it never needed its own gate either. A
  generated `HOW-TO-ACTIVATE.txt` in the zip walks whoever uploads it
  through the two remaining manual steps (upload the folder, add one
  `wp_teac_test_versions` row) — deliberately the *only* things that stay
  manual; WordPress's existing booking/random-assignment/exposure-tracking
  logic needs zero changes, since it only ever sees "a Test_id has a
  TestUrl," not which tool built the content behind it.
- **Ungated Versions** (built 2026-08-04, restricted to Practice-only
  2026-08-06, `StorylineVersion.ungated`): a per-Version toggle ("Make
  ungated"/"Make gated" on `StorylineVersionsPage`, metadata not content —
  safe regardless of publish status) for exports that don't have a real live
  booking behind them. Exported as a separate `flags.json` alongside
  `version.json`/`theme.json` — same "absent file = today's default
  behavior" pattern as `theme.json`, so every already-deployed export keeps
  working unchanged. In the player, an ungated export behaves like Preview
  for the Next-button confirmation gating only (`bypassesGating()` in
  `examiner.ts` — Next is never blocked waiting for audio-completion,
  checklist-ticking, or the Test Data Confirm fields) — deliberately **not**
  the same as Preview everywhere: violation/completion reporting and the
  Accept/Reject screen's session-lock still fire normally, since (unlike
  Preview) an ungated export might genuinely be run outside the admin app.
  A small amber "UNGATED" badge appears in the player header whenever this
  is active, so nobody mistakes the run for a fully-gated real exam. Scoped
  to the legacy per-Version export path only — the dynamic Part-pooling
  path (`loadDynamicItems()`) doesn't fetch `flags.json` at all, since
  there's no per-candidate "skip gating" concept there yet.
  **Hard restriction added 2026-08-06**: only `versionType === 'practice'`
  versions may ever be ungated — `handleToggleUngated` is a no-op and the
  "Make ungated" button is disabled for Live/Backup versions, and switching
  a version's type away from `'practice'` force-sets `ungated: false` in
  the same write. Real exams (Live) and backup-examiner copies (Backup)
  must always ship gated — the way an admin checks a Live/Backup version's
  flow without gating is Preview, which already bypasses gating
  unconditionally (`bypassesGating()` is `isPreview || isUngated`) without
  ever touching that version's real `ungated` flag or its exported artifact.
- **Version type — Live/Backup/Practice (built 2026-08-06,
  `StorylineVersion.versionType`)**: a per-Version category, undefined
  treated as `'live'` (backward-compatible default). Set via a small picker
  next to "New draft" on `StorylineVersionsPage` (carried over on
  Duplicate), and changeable afterward via the same Type column — metadata,
  not content, so free to change regardless of publish status like
  `isBackup`. Two effects: choosing `'backup'` unlocks `isBackup`-flagged
  Parts in that Version's Part picker on `StorylineVersionEditorPage`
  (normally excluded from the `'live'`/`'practice'` picker entirely, with
  no override — a `'backup'` version is exactly where reserve Parts
  belong); `ungated` is now hard-linked to type (see above) — `'practice'`
  defaults it on and allows toggling, `'live'`/`'backup'` force it off and
  disable the toggle entirely. `versionType === 'practice'` now also
  branches export behavior — see the next entry.
- **Self-service Practice player** (built 2026-08-06, redesigned same day to
  restore the two-window shape, `player-src/practice.ts`/`practice.html`,
  exported via `exportStorylinePractice()` in `exportStoryline.ts`): a third
  player-src entry point, alongside examiner.ts/candidate.ts, for
  `versionType === 'practice'` Versions — `handleExport` on
  `StorylineVersionsPage` branches to it automatically, Live/Backup keep
  going through `exportStorylineVersion()` unchanged. Mirrors the real
  exam's two-window shape on purpose (so practicing feels like the real
  thing) — this window drives audio/text/controls/timers, and opens a
  genuine `candidate.html` popup for the actual images, reusing that file
  completely unmodified (`bundlePracticeShellFiles()` bundles it alongside
  `story.html`) since it has no WordPress calls or violation reporting of
  its own to strip. What's actually stripped: no violation reporting at
  all — not even "candidate window closed", which examiner.ts reports but
  practice.ts's `updateCandidateStatus()` deliberately doesn't — no
  `reportStorylineEvent`/WP `callSendStats`/`callRejectTest` calls, no
  Next-button gating (always enabled), no PHP gate at all (ships as plain
  static `story.html` — the filename intentionally matches the old pre-
  RaterSystemNew Storyline system's sample-test convention). Booking-only
  slide kinds `test_data_confirm`/`admin_checklist` are filtered out
  entirely (`SKIPPED_KINDS`); `accept_reject_test` is kept but re-rendered
  as a non-interactive intro (`renderIntro()`, `BRANDED_KINDS`) — the same
  blue/white branded chrome (logo strip) the real exam gives its pre-test
  screens, showing `testDisplayName` plus a plain-language "this is a
  sample, nothing is recorded" note, instead of real accept/reject controls
  that only mean something against a real booking. Images render as small
  reference thumbnails in this window (`.exam-thumbs`, same sizing as the
  examiner console) — the actual full-size copies are on the candidate
  window, same split as the real exam. Also keeps: linear Next/Back,
  per-slide script text + freely-replayable audio, prep/response and
  session timers (informational only, ported unchanged), `previewParts`
  content, click-to-zoom on the reference thumbnails. The export zip also
  bundles `HOW-TO-PUBLISH.txt` and a starter `home.html` — see the next
  entry. All the "complex stuff" (violation tracking, exposure/part-
  counting, the WP booking gate) stays scoped to Live/Backup exports only,
  per explicit design intent.
- **"Flight Strip" sample-tests landing page** (built 2026-08-06,
  `buildHomeTemplate()`/`HOME_SHELL_HEAD`/`HOME_SHELL_FOOT`/
  `HOME_LOGO_BASE64` in `exportStoryline.ts`, standalone starter copy at
  `sample-site/index.html`): the hand-maintained landing page bundled into
  every Practice export as `home.html` — deliberately *not* auto-generated
  from Firestore, since this folder can contain whatever tests an admin
  chooses to publish here in whatever order they want. Add one
  `<li><a href="./folder/story.html">Name</a></li>` line per sample test by
  hand (the arrow after it is CSS-generated, `.strip-board a::after`, never
  typed) — same one-line-per-test workflow the old system's `home.html`
  had. Styled as an ATC flight-progress-strip board (colored tab per entry,
  shifts to amber on hover) since most candidates are pilots/ATCOs; the
  Lenguax mark is embedded as base64 so the page stays one self-contained
  file with nothing else to lose when copied around by hand. `HOME_SHELL_
  HEAD`/`FOOT` are shared between the one generated `<li>` line and
  `sample-site/index.html` so they can't visually drift apart — if the CSS/
  shell ever changes, regenerate `sample-site/index.html` from a fresh
  export's `home.html` rather than hand-editing its shell.
- **Dynamic Part-pooling (Phase A, built 2026-08-01)**: groundwork for
  replacing whole-Version candidate assignment with true per-candidate Part
  pooling — see `/home/paul/.claude/plans/encapsulated-drifting-corbato.md`
  for the full design (kept for reference; only Phase A, Firestore schema +
  authoring UI, is built — the player runtime-composition redesign and all
  WP/MySQL-side selection/sync/backfill work described there are later
  phases, not started). `StorylinePart` gained `themeId` (Part 1/4 only —
  points at a new flat `storyline_themes` collection, one shared vocabulary
  for both, edited inline via `StorylinePartsPage`'s new Theme column) and
  `legacyCode` (unused until the legacy exposure backfill phase; set by hand
  per Part transcribed from old Storyline content). A new
  `storyline_theme_rules` collection holds forbidden Part-1-theme/Part-4-
  theme pairs — content must never combine across a pair in one candidate's
  session — managed on a new `StorylineThemeRulesPage`
  (`/test-versions/themes`, linked from the Test Types nav). This is a
  direct, functioning port of an old prototype's schema
  (`Storyline-Replacement/Dynamic-Interlocutor-Tool-main/
  manage_unmixable_themes.php`) that existed there but, per that repo's own
  `int_tool_test_versions` table, was never actually wired to any real
  selection logic — enforcement here is still a later (WP-side) phase, but
  the rule data itself is now real and admin-editable. `StorylineTest`
  gained its own `slotContent`/`status`/`items`/`publishedAt` — the
  successor to `StorylineVersion.slotContent` for whole-test
  (preamble/accept-reject/checklist/closing) slides, since dynamic pooling
  means there's no more one hand-built Version per candidate to hold a
  per-candidate copy of that content. Edited on a new
  `StorylineTestContentEditorPage` (`/test-versions/:testId/content`, linked
  as "Content" from the Test Types list), with the same draft/publish/
  immutability posture as a Part, reusing `resolveItems()`/
  `partCompleteness.ts`'s `missingPartContent()` (which now accepts
  `partNumber: undefined` to mean "whole-test slides," not just a specific
  Part number) — `previewParts`-driven slides intentionally resolve empty
  here, since which 4 Parts a candidate actually gets isn't known until
  WordPress assigns them at booking time; the not-yet-built exported player
  is what will re-derive that content client-side once it has the real 4
  Parts. `StorylineTest` also gained `wpTestId` (entered via the Test Types
  edit drawer) — the live `wp_teac_tests.id`/`Test_id` this Test corresponds
  to, required before it can be included in the (not yet built) WP sync.
  `StorylineVersion`/`exportStorylineVersion()`/`StorylineVersionEditorPage`
  are all untouched by this phase and keep serving the existing hand-built
  Practice/example-test path exactly as before.
- **Dynamic Part-pooling (Phase B, built 2026-08-01)**: the player
  runtime-composition redesign. Instead of one hand-picked Version exported
  as one zip, four new functions in `exportStoryline.ts` export reusable
  fragments independently — `exportPlayerShell()` (shell + `theme.json`,
  uploaded once, re-run only when the shell code changes),
  `exportStorylineTemplate()` (`template.json`, just `{slides}`, no media),
  `exportStorylineTest()` (`test.json` — `{name, variables, slotContent}`,
  **raw** slot content, not pre-resolved — see below — plus that Test's own
  bundled media), and `exportStorylinePart()` (`part.json` — `{slotContent}`
  + bundled media, the main workhorse, run once per Part publish). All four
  are wired to "Export" buttons: on `StorylineTemplateEditorPage` (two
  buttons, disabled while there are unsaved edits so a stale export can't
  silently ship), on `StorylinePartsPage` (per published Part), and on the
  new `StorylineTestContentEditorPage` (per published Test). Media bundling
  reuses the exact `bundleMedia()` dedup pattern (promise-cached by URL, not
  resolved filename) via a new shared `createLocalMediaResolver()` factory
  — `bundleSlotContentMedia()` is the raw-slotContent counterpart used by
  the two new per-Test/per-Part exporters, since they ship unresolved
  content instead of a resolved `StorylineItem[]`. Net effect vs. the old
  model: a Part's media now downloads/bundles exactly once, ever, instead
  of once per Version that ever referenced it.

  **Player side**: `player-src/shared/resolveItems.ts` and
  `deriveComboImages.ts` are new, deliberately-duplicated ports of the
  admin app's same-named files (same precedent as `player-src/shared/
  types.ts` already duplicating `StorylineItem` — player-src stays a fully
  self-contained TS project). `player-src/shared/types.ts` gained the raw
  (unresolved) shapes needed to call it — `TemplateSlide`,
  `StorylineSlotContent`, `StorylinePartFragment` (just `{slotContent}` —
  lighter than the admin app's full authoring `StorylinePart`, the player
  has no use for id/label/status/theme), `StorylineTestFragment`. A real
  simplification made during the build, worth knowing if you're comparing
  against the original design doc: `test.json` ships **raw** `slotContent`
  rather than a pre-resolved `StorylineItem[]` snapshot — the original plan
  was to ship the Test's whole-test content pre-resolved and separately
  re-derive just the `previewParts` slides client-side once real Parts were
  known. Simpler in practice: since the player needs `template.json` raw
  regardless (for slide ordering/combo-image scoping), it just runs
  `resolveItems()` **once**, client-side, over everything together
  (`template.slides` + `test.variables` + `test.slotContent` + the 4 fetched
  Part fragments) — identical in shape to what `StorylineVersionEditorPage`'s
  admin Preview already does, no separate partial-resolve/merge step to get
  subtly wrong. `player-src/shared/session.ts`'s `getParams()` gained
  `testId`/`p1`-`p4` — a dynamic launch URL looks like
  `examiner.php?testId=…&p1=…&p2=…&p3=…&p4=…&id=…&tc=…&in=…&cn=…&check=…`,
  same `id`/`tc`/`in`/`cn`/`check` as the legacy path. `isDynamic` requires
  all 4 part IDs present, not just `testId` — a partially-specified URL
  falls back to the legacy `version.json` fetch rather than trying to
  resolve with missing Parts. `dataSource.ts`'s `loadItems()` branches on
  three modes now: preview (localStorage, unchanged), dynamic
  (`loadDynamicItems()` — fetches `template.json` + `tests/<testId>/
  test.json` + the 4 `parts/<n>/<id>/part.json` in parallel, then calls the
  ported `resolveItems()`), and legacy (single `version.json` fetch,
  unchanged) — the legacy path is untouched, so every already-deployed
  Version zip keeps working exactly as before. `loadTheme()` didn't need to
  change — `theme.json` is fetched from the same relative location either
  way, just exported once via `exportPlayerShell()` for dynamic launches
  instead of per-zip.

  **Verification performed**: `tsc -b`, `npx tsc -p player-src/tsconfig.json
  --noEmit`, and `npm run build` (both the player and main builds) all
  clean. The ported `resolveItems()` was exercised directly (not just
  type-checked) against fabricated fixtures covering variable substitution,
  `{topic}`/`{questions}` splicing, `previewParts` cross-part compilation,
  and per-scope combo-image derivation — all passed. **Not verified**: a
  real browser run of the new export buttons or a real dynamic-launch URL
  end to end — no admin login credentials were available in that session.
  Worth doing before relying on this in production: log in as admin, click
  each new Export button once for real, and hand-construct a dynamic launch
  URL against the exported fragments to confirm the full composed player
  renders correctly.
- **Dynamic Part-pooling (Phase C, built 2026-08-01)**: WP/MySQL schema +
  sync, in the *sibling* `Storyline-Replacement/TEAC-Plugin-master` repo
  (not this one — that's the live WordPress plugin's source, checked out
  locally at `/home/paul/Programs/Storyline-Replacement/`), plus one new
  Cloud Function here. `getStorylineSyncData` (`functions/index.js`,
  secret-gated via a new `STORYLINE_SYNC_SECRET`, same pattern as
  `enrollmentWebhook`) reads published `storyline_parts` + all
  `storyline_themes`/`storyline_theme_rules` + `storyline_tests` (for
  `wpTestId`), and — the one piece of real logic in it — resolves each
  Part's `testTypes` (role-type *labels*) into concrete `wpTestId`s
  server-side, so WordPress never needs to understand Firestore's
  label-matching; a Part with no `testTypes` (eligible for every type, the
  established convention) expands against every synced Test. New,
  entirely additive tables on the WP side (`wp_teac_storyline_parts`,
  `_part_test_types`, `_themes`, `_theme_rules`, `_part_exposure` — exact
  schema in the plan doc §3) live in a new, deliberately self-contained
  `TEAC-Plugin-master/includes/class-teac-storyline-sync.php` — created via
  `dbDelta` (not woven into `class-teac-centres-activator.php`'s existing
  68-step sequential migration, to keep this reviewable/deployable
  independently of that file). WordPress **polls** the Cloud Function
  (`wp_cron`, every 5 minutes, plus a manual "Sync now" button on a new
  standalone `Storyline Sync` admin page) rather than the reverse — no
  mysql driver or outbound-DB precedent exists in this codebase, and the
  droplet is self-hosted, not a managed Cloud SQL instance reachable via a
  proxy, so pushing outward would mean exposing MySQL's port or building a
  tunnel that doesn't exist today. Sync is a full reconciliation, not just
  upsert — rows whose `firestore_id` no longer appears in a sync are
  deleted, so an unpublished/deleted Part or removed theme rule actually
  disappears from WP too. **Wiring**: `class-teac-centres.php` (the
  plugin's main loader) gained one `require_once` + one `TEAC_Storyline_
  Sync::init()` call, following the exact pattern its other classes already
  use — nothing about the *existing* booking/version-selection code paths
  was touched.
- **Dynamic Part-pooling (Phase D, built 2026-08-01)**: the legacy exposure
  backfill tool — also in the sibling WP plugin repo, `TEAC-Plugin-master/
  includes/class-teac-storyline-backfill-cli.php`, a WP-CLI-only command
  (`wp teac-storyline backfill-legacy-exposure`, self-guarded on
  `defined('WP_CLI')` so it has zero effect on normal page loads). `Storyline
  Part.legacyCode` (Phase A) now has a real editor — a "Legacy code" action
  on `StorylinePartsPage`, same `window.prompt` pattern as Rename — and
  syncs down via Phase C's `getStorylineSyncData`. The real spreadsheet
  (`Storyline-Replacement/Spec Updates/TEAC_Test_Versions.xlsx`) was opened
  and machine-parsed directly (not just referenced) to build `TEAC-Plugin-
  master/includes/storyline-legacy-version-codes.json` — 103 real, verified
  Version-Name → 4-part-code mappings from the "Complete Tests" tab (3 rows
  legitimately skipped: `ADP 004`–`006` are literal "no new version" gaps
  in the pool). This confirmed the spec's original illustrative decomposition
  example (`Airline_001` → `001_1..4`) was a simplification — real per-part
  codes are differently shaped per part type (e.g. `001-A-1-001` / `W001` /
  `A-3-001` / `A-4-001`), so the backfill is a **lookup** against this JSON,
  not a parsing algorithm. Also confirmed directly against the sheet:
  `Approach 007`'s Part 1 code really is missing its dash (`037F-1-007`),
  and `Airline 008`/`009` really do share one internal tracking hash
  (harmless — spreadsheet-internal, not a DB key). The CLI command's join
  chain: historical `wp_teac_booking_checks.TestVersion` → `wp_teac_
  test_versions.TestUrl` → (regex, `--url-pattern`-overridable) a
  `RoleType-NNN`-shaped folder segment → (dash→space) a Version Name →
  the JSON lookup's 4 codes → `wp_teac_storyline_parts.legacy_code` → a
  local part id → one `wp_teac_storyline_part_exposure` row per resolved
  Part (`source='legacy_backfill'`, `UNIQUE(Booking_id, storyline_part_id)`
  makes re-runs after fixing a mapping issue safe via `INSERT IGNORE`).
  **Defaults to a dry-run** that reports match-rate stats and sample
  failures at every stage — nothing is written without an explicit
  `--commit`. **The genuinely unverified step, called out explicitly in the
  script's own docblock**: whether production `TestUrl` values actually
  contain that folder-segment shape — only the spreadsheet's separate
  *backup*-URL column was confirmed to have it (no droplet DB access was
  available to check production directly), which is exactly why the dry-run
  exists and `--url-pattern` is overridable rather than hardcoded. **Real
  verification performed**: the regex-extraction → dash/space-normalize →
  JSON-lookup logic was pulled out and exercised standalone (`php`, not
  just read) against the confirmed backup-URL shapes plus deliberately
  broken inputs (no match at all, matches but not in the lookup, partial
  legacy_code coverage correctly excluded rather than silently
  under-resolving) — all passed. **Not verified**: an actual run (dry or
  otherwise) against the real production database — do that, read the
  match-rate report, and adjust `--url-pattern` if needed before ever
  passing `--commit`.
- **Not built yet**: the real WordPress portal integration (Phase 2 "full
  replacement" — single fixed player URL, signed short-lived tokens instead
  of the current export's reused MD5 gate, Firestore-served content instead
  of a baked-in `version.json`; deliberately shelved until there's an actual
  decision to retire the WordPress-side portal, since the export-based path
  above already meets the urgent need without it); Phase E of the dynamic
  Part-pooling work above — the actual selection function
  (`assign_storyline_parts_for_booking()`) and the live cutover of the 5
  existing whole-Version-picking call sites in the WP plugin (plan doc §5,
  the only remaining phase that changes real candidate-facing behavior —
  deliberately not started without an explicit go-ahead); a real
  browser+login verification pass on Phase B's export buttons/dynamic-launch
  URL and a real database run of Phase D's backfill CLI (both "Not
  verified" call-outs above); and multiple named Script
  Templates (today `storyline_template` is a single fixed doc, `'current'`
  — hardcoded as that literal string in six different files — implicitly
  shared by every Test; no test type has needed a structurally different
  template yet). **Confirmed 2026-07-30: no real need yet, but there's a
  clear path when one shows up** — turn `storyline_template` into a real
  collection (same shape `storyline_parts`/`storyline_tests` already have)
  and give each `StorylineTest` a `templateId` reference instead of every
  page hardcoding `'current'`. This is also the prerequisite for a Part 5:
  `StorylinePartNumber` is a fixed `1|2|3|4` union (baked into 4 places —
  the type, two `PART_NUMBERS` constants, `resolveItems.ts`'s combo-image
  loop, and the template editor's Part-tag picker) plus the Parts Library's
  filter buttons — widening it only makes sense once per-Test template
  selection exists, otherwise every 4-Part test would be forced to carry
  an irrelevant 5th slot. Don't build either speculatively; when a real
  5-Part (or otherwise structurally different) test type actually comes
  up, do both together.
- **Violation/completion reporting** (built 2026-07-25): the exported
  player otherwise has zero backend connectivity at all (`dataSource.ts`
  only ever fetches its own `version.json`) — `reportStorylineEvent()`
  (`player-src/shared/reportEvent.ts`) is its one channel back, a plain
  fetch (no Firebase SDK, no auth — the player runs in an examiner's
  browser at a random test centre with no way to embed a real secret) to
  a new unauthenticated HTTPS Cloud Function of the same name in
  `functions/index.js`. Every call logs a `storyline_events` doc
  regardless of type; only `type: 'violation'` also emails
  `config/storyline.notificationEmail` (a dedicated field, deliberately
  separate from `config/canvas.notificationEmail` used elsewhere — same
  Resend pattern as `notifySelfServeSubmission`). Fire-and-forget
  throughout — a failed report never blocks or alters the actual test.
  Violation triggers wired up in `examiner.ts`: an audio clip played past
  its `maxPlays` limit (already detected/logged locally, now also
  reported), the candidate window closing during the session (tracked via
  the existing `updateCandidateStatus()` poll, open→closed transition),
  internet connectivity dropping (`window`'s `offline`/`online` events —
  the drop itself almost certainly fails to send since there's no
  connectivity to send it over, but the *recovery* report, once back
  online, usually gets through and carries how long the drop lasted), and
  the examiner rejecting the test. **A "Finish test" action was also
  added** — Next becomes "✓ Finish test" on the last slide (previously
  just permanently disabled once reached, with no completion concept at
  all) rather than staying gated on `isLast`; still respects the usual
  audio/checklist/test-data gating up to that point. Both the reject and
  finish paths also call the *old* system's own, already-working
  `assets/rejectTest.php`/`sendStats.php` (`player-src/shared/
  wpCallback.ts`, best-effort, relative fetch, `!isPreview`-only) — so
  existing WordPress-side completion/rejection emails keep firing
  unchanged for versions built with this tool too, alongside (not instead
  of) the new Firestore record. That field mapping is a known
  approximation, not a confirmed exact match (only each PHP file's header
  was reviewed, and there's no equivalent in this app's data model for the
  old system's short test-type codes or a numeric centre code) — verify
  against a real deployment before relying on it as more than a
  best-effort duplicate of the old notification. None of this fires in
  Preview mode.

## Notes

- `shadcn/ui` here uses the Base UI variant — always `render` prop, never `asChild`
- SiteGround caches aggressively — hard refresh (Ctrl+Shift+R) after deploys
- Canvas SSO requires Redis on the Canvas server and Firebase Functions with public (unauthenticated) access
- Old GRaterSystem source is at `/home/paul/Programs/GRaterSystem/` for reference

## Last updated

2026-08-06
