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
| `assignments` | session + rater + tests; unit of work; `source: 'self_serve'` marks ones created by the self-serve flow |
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

## Cloud Functions (`functions/index.js`)

| Function | Purpose |
|---|---|
| `canvasAuth` | Canvas OAuth code → Firebase custom token. Requires a `people` doc matching the Canvas login email; creates the Firebase Auth user (UID = `people` doc ID) on first login |
| `canvasEnrollments` | All student enrollments for a course (used by Canvas Sync) |
| `canvasSections` | All sections across all accessible courses (admin, used by the enroll wizard and audits) |
| `canvasLookupUser` / `canvasUserSearch` | Exact-email / fuzzy-name Canvas user lookup (admin, enroll wizard) |
| `canvasEnroll` | Full manual enrollment: create-user-if-needed, optional email update, optional old-section conclusion, enroll, log (admin) |
| `canvasSectionEnrollments` | Students in one specific section (admin, section-membership audit) |
| `enrollmentWebhook` | HTTP endpoint the WordPress plugin POSTs to after each WooCommerce enrollment attempt; shared-secret auth (`x-webhook-secret` / `ENROLLMENT_WEBHOOK_SECRET`) |
| `requestSelfAssignment` | Self-serve exam entry point (any signed-in user). Resolves the caller's active Canvas section, finds-or-creates the matching `sessions` doc, and builds a 4-test `assignments` doc using unseen/difficulty-tier/well-known-anchor selection (same approach as Auto-assign) |
| `notifySelfServeSubmission` | Fires when a self-serve assignment's status flips to `submitted`; emails `config/canvas.notificationEmail` via Resend (`RESEND_API_KEY` secret) — skipped silently if either isn't configured |

See the full Canvas integration write-up (WP plugin ↔ Firebase ↔ RaterSystemNew) for the complete enrollment picture — ask Claude to regenerate it from `CanvasCohortEnrollment/canvas-cohort-enrollment.php` and this file if it's gone stale.

## Self-serve rater exam

A Canvas-enrolled trainee can go to `/take-test`, sign in with Canvas SSO, and land directly in the Scoring player (`/scoring`) pre-loaded with 4 tests — no admin setup required. Mechanics:

- The entry link (`TakeTestPage.tsx`) appends `state=self_serve` to the Canvas OAuth URL (`src/lib/canvasAuthUrl.ts`); Canvas round-trips that `state` back to `CanvasCallbackPage.tsx` unchanged.
- After Canvas sign-in, if `state === 'self_serve'`, the callback calls `requestSelfAssignment` and routes into `/scoring` with the new assignment ID, which `ScoringPage.tsx` auto-opens instead of showing the assignment picker.
- Test selection reuses `AutoAssignPage.tsx`'s tiering approach: tests this rater has never scored, spread across difficulty tiers (`Test.canonicalDifficulty`), with a preferred anchor that's both well-calibrated and has been scored by ≥100 distinct raters (`WELL_KNOWN_RATER_THRESHOLD` in `functions/index.js`).
- Requires `config/canvas.notificationEmail` and the `RESEND_API_KEY` secret set for email alerts; an in-app "self-serve submissions awaiting review" card also appears on the admin Dashboard regardless.

## Notes

- `shadcn/ui` here uses the Base UI variant — always `render` prop, never `asChild`
- SiteGround caches aggressively — hard refresh (Ctrl+Shift+R) after deploys
- Canvas SSO requires Redis on the Canvas server and Firebase Functions with public (unauthenticated) access
- Old GRaterSystem source is at `/home/paul/Programs/GRaterSystem/` for reference

## Last updated

2026-07-15
