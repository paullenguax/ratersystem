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

| Page | admin | senior_rater | trainee |
|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ |
| People | ✓ | | |
| Test Bank | ✓ | | |
| Events (Sessions) | ✓ | | |
| Assignments | ✓ | | |
| Scoring | ✓ | ✓ | ✓ |
| Scores | ✓ | | |
| Statistics | ✓ | | |
| Reports | ✓ | | |
| Feedback | ✓ | ✓ | |
| Certificates | ✓ | | |
| Official Forms | ✓ | | |
| Benchmark | ✓ | | |
| Practice Sessions | ✓ | | |
| Admin (incl. Canvas Sync/Enroll/Audit, Enrollment Log, Auto-assign, Import Rasch, Cert Assets, Pronunciation) | ✓ | | |

Role is determined by the `people` Firestore collection — the doc ID **must** equal the Firebase Auth UID.

## Key Firestore collections

| Collection | Purpose |
|---|---|
| `people` | Raters + admins, keyed by Firebase Auth UID |
| `test_bank` | ICAO test recordings (51+ imported); `canonicalDifficulty`/`canonicalSE` from Rasch imports drive both Auto-assign and the self-serve picker |
| `sessions` | Named groups of scoring work; `canvasSectionId` links a session to a Canvas section for self-serve assignments |
| `assignments` | session + rater + tests; unit of work; `source: 'self_serve'` marks ones created by the self-serve flow; `confirmedAt` is the rater's explicit "yes, these are my answers" lock-in — distinct from `status: 'submitted'`, which just means all tests are scored |
| `scores` | Individual ICAO scores per rater per test |
| `certificates` | Lenguax cert records (L-prefix numbers) |
| `official_forms` | CAA 5012 and DGAC 87i records |
| `cert_config/templates` | Storage URL overrides per cert type |
| `benchmark_items` | MCQ items for Benchmark Check |
| `benchmark_results` | Candidate results from Benchmark Check |
| `pronunciation_config/status` | Active languages for GPronTool |
| `config/canvas` | Canvas API token, Canvas Sync course list, `excludedCourseIds`, `notificationEmail` for self-serve alerts |
| `canvasEnrollmentLog` | Unified log of Canvas enrollments from both WooCommerce (`CanvasCohortEnrollment` WP plugin) and the manual `/admin/canvas-enroll` wizard |
| `practice_sessions` / `practice_scores` | Ad-hoc live-course practice player (`/practice`), joined via a 6-character code, no login required |

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

## Adding a rater (manual)

The Firestore `people` doc ID must equal the Firebase Auth UID:
1. Firebase Console → Auth → Add user → copy UID
2. Firestore → `people` → new doc with that UID as the document ID; fields: `name`, `email`, `role` (`admin`/`senior_rater`/`trainee`), `status` (`active`)
3. Firebase Console → Auth → send password reset to the user

Canvas SSO users: run Canvas Sync (Admin page) — it creates the `people` doc automatically.

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

## Notes

- `shadcn/ui` here uses the Base UI variant — always `render` prop, never `asChild`
- SiteGround caches aggressively — hard refresh (Ctrl+Shift+R) after deploys
- Canvas SSO requires Redis on the Canvas server and Firebase Functions with public (unauthenticated) access
- Old GRaterSystem source is at `/home/paul/Programs/GRaterSystem/` for reference

## Last updated

2026-07-16
