# RaterSystemNew — Claude instructions

Aviation English rater management system. React 19 + TypeScript + Vite, Tailwind v4, shadcn/ui (Base UI variant), Firebase Auth + Firestore + Storage (`ratersystem` project), React Router v6 `basename="/ratersystem"`. Deploys to `lenguax.com/ratersystem/` via GitHub Actions FTP on push to `main`.

## Critical: shadcn/ui Base UI variant

This project uses the **Base UI** variant of shadcn/ui. Always use the `render` prop — never `asChild`. The two APIs are incompatible and mixing them causes runtime errors.

## TypeScript strict mode

`tsc -b && vite build` — unused imports fail the build. CI won't deploy if the build fails. Keep imports clean.

## Auth and roles

`AuthContext` looks up `doc(db, 'people', user.uid)` after login. The Firestore `people` doc ID **must** equal the Firebase Auth UID — this is how roles are resolved. `loading: true` is set before the Firestore fetch so `ProtectedRoute` holds during the async gap.

Roles: `admin`, `senior_rater`, `trainee`.

## Key Firestore collections

`people`, `test_bank`, `sessions`, `assignments`, `scores`, `certificates`, `official_forms`, `cert_config/templates`, `benchmark_items`, `benchmark_results`, `pronunciation_config/status`, `config/canvas`, `canvasEnrollmentLog`, `practice_sessions`, `practice_scores`

## Canvas integration

Three enrollment paths converge on `canvasEnrollmentLog`: WooCommerce purchase (`CanvasCohortEnrollment` WP plugin → `enrollmentWebhook`), the manual wizard (`/admin/canvas-enroll` → `canvasEnroll`), and bulk course sync (`/admin/canvas-sync`, creates/links `people` docs — the normal way a Canvas user gets one before they can SSO in).

Self-serve exam entry (`/take-test` → Canvas SSO with `state=self_serve` → `requestSelfAssignment`) builds a trainee a 4-test `assignments` doc (`source: 'self_serve'`) tied to a `sessions` doc keyed by `canvasSectionId` and named `{course.name} — {section.name}`, reusing `AutoAssignPage.tsx`'s difficulty-tier/unseen-test selection logic server-side (plus randomisation and per-cohort frequency weighting — see `pickSelfServeTests`/`cohortFreq` in `functions/index.js`, otherwise every new trainee in a section converges on the same tests). `ScoringPage` auto-opens that assignment via router state. If Canvas Sync wasn't run in time, `canvasAuth` self-heals for self-serve logins only — auto-creates a trainee `people` doc, gated on active enrollment in a `config/canvas.courses`-listed course and no name-similar existing person (`resolveActiveRaterSection`/`namesLikelyMatch` in `functions/index.js`). Course/section naming convention (annual course clones, section per cohort) is documented in `README.md`. See `functions/index.js` for the full Cloud Functions list.

## Assignment lifecycle — status vs confirmedAt

`assignment.status` flips to `'submitted'` as soon as all 4 tests have a score — this does **not** mean the rater is done editing. `assignment.confirmedAt` is the separate, explicit lock: only set when the rater clicks "Yes, that's my scores" on the post-scoring summary screen in `ScoringPage.tsx`. Before `confirmedAt`, a rater can still revise any of their 4 scores; after, the UI offers no path back into edit mode. `notifySelfServeSubmission` and the Dashboard's self-serve card both key off `confirmedAt`, not `status` — don't reintroduce a check against `status === 'submitted'` alone for anything that should wait for the rater's actual sign-off.

## PDF generation

- **Lenguax certs** — jsPDF, A4 mm; `resolveTemplateUrl` in `certGen.ts` checks `cert_config/templates` for Storage URL overrides before falling back to `public/` templates. Used by both `CertificatesPage` and `ValidatePage`.
- **CAA 5012** — jsPDF image overlay on `CAA5012_BLANK.png`
- **DGAC 87i-Formlic** — pdf-lib AcroForm; page 2 overlays: X ticks at (59,151), (147,137), (15,251)mm from bottom

## Dual Firebase projects

The app connects to two Firebase projects:
- `ratersystem` — main project (`VITE_FIREBASE_*`)
- `lenguax-benchmark-32392` (Benchmark Check project, `VITE_BENCHMARK_*`) — used by the Benchmark admin tab (`benchmarkDb`/`benchmarkAuth`/`benchmarkStorage` in `lib/firebase.ts`)

Both sets of env vars are required for a full build.

`benchmark_results`/`benchmark_flags` in the benchmark project require `request.auth != null` to read (candidate PII). `BenchmarkPage.tsx` bridges the current admin's identity in via the `mintBenchmarkAdminToken` Cloud Function (checks `people/{uid}.role === 'admin'` in `ratersystem`, then mints a custom token for the benchmark project using a second `admin.app()` initialized from the `BENCHMARK_SERVICE_ACCOUNT_KEY` secret) and signs into `benchmarkAuth` with it before any query runs — don't add a `benchmark_*` query to that page without gating it behind `authState === 'ready'`, or it'll hit permission-denied.

The item editor there (`ItemForm`/`BenchmarkItem` in `src/features/benchmark/`) matches the benchmark project's live Firestore schema exactly (`stem`/`form`/index-based `correct`/`stimulus`/`audioRef`/`notes`/`correctedAt`) — this schema drifted out of sync once before and silently corrupted saves; don't reintroduce fields that aren't in the actual documents without checking live data first.

## SiteGround caching

Hard refresh (Ctrl+Shift+R) after every deploy. The cache is aggressive.

## After every build

After a successful `npm run build` in a session where code changes were made, update `README.md` to reflect any new pages, routes, Firestore collections, PDF templates, roles, or significant feature additions. Update the "Last updated" date at the bottom.
