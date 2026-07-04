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

`people`, `test_bank`, `sessions`, `assignments`, `scores`, `certificates`, `official_forms`, `cert_config/templates`, `benchmark_items`, `benchmark_results`, `pronunciation_config/status`

## PDF generation

- **Lenguax certs** — jsPDF, A4 mm; `resolveTemplateUrl` in `certGen.ts` checks `cert_config/templates` for Storage URL overrides before falling back to `public/` templates. Used by both `CertificatesPage` and `ValidatePage`.
- **CAA 5012** — jsPDF image overlay on `CAA5012_BLANK.png`
- **DGAC 87i-Formlic** — pdf-lib AcroForm; page 2 overlays: X ticks at (59,151), (147,137), (15,251)mm from bottom

## Dual Firebase projects

The app connects to two Firebase projects:
- `ratersystem` — main project (`VITE_FIREBASE_*`)
- Benchmark Check project (`VITE_BENCHMARK_*`) — used by the Benchmark admin tab

Both sets of env vars are required for a full build.

## SiteGround caching

Hard refresh (Ctrl+Shift+R) after every deploy. The cache is aggressive.

## After every build

After a successful `npm run build` in a session where code changes were made, update `README.md` to reflect any new pages, routes, Firestore collections, PDF templates, roles, or significant feature additions. Update the "Last updated" date at the bottom.
