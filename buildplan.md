# Rater Management App — Build Plan
**Aviation English Language Testing**

> **Purpose of this document:** A high-level map to keep development sessions on track. Each module is self-contained and can be built, tested, and shipped independently.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                      Frontend                        │
│         React SPA  (Vite + Tailwind + shadcn)        │
│                                                      │
│  People │ Test Bank │ Sessions │ Scoring │ Rasch     │
└─────────────────────┬───────────────────────────────┘
                      │ Firebase SDK (direct)
┌─────────────────────▼───────────────────────────────┐
│                Firebase Platform                     │
│                                                      │
│  Firebase Auth  │  Firestore  │  Cloud Functions     │
└─────────────────────────────────────────────────────┘
```

**Key decisions:**
- Firebase project: `ratersystem` (clean slate; old project is `raterscores`)
- Auth: Firebase Auth, email/password + Canvas OAuth SSO (via Cloud Function)
- No backend server: all data via Firebase SDK. Cloud Functions for Canvas OAuth only.
- Rasch engine: admin exports Facets-compatible CSV, runs Facets externally, imports results manually. Cloud Function replacement is Phase 2.
- Audio: recording URLs only — old tests point to `raterscores.firebasestorage.app` (still valid); new uploads go to `ratersystem.firebasestorage.app`.
- Candidates: embedded in `test_bank` docs — no separate candidates collection.
- Deployed to: `lenguax.com/ratersystem` via GitHub Actions FTP on push to `main`.

---

## Actual Firestore Data Model (as built)

> Note: the original plan used deep subcollections. The actual implementation uses flat top-level collections for simplicity and query performance.

```
people/           role: admin | senior_rater | trainee
                  raterNumber: number | null   (permanent Rasch ID)

test_bank/        recordingUrl, candidateName, testType, status (active|retired)
                  canonicalDifficulty: logit | null   (from Rasch runs)
                  canonicalSE: number | null

sessions/         name, type, status (open|closed|published), notes

assignments/      sessionId, raterId, testDocIds[], status (pending|submitted|reviewed|published)

scores/           assignmentId, sessionId, raterId, testDocId, testNumber
                  pronunciation/structure/vocabulary/fluency/comprehension/interactions (1–6)
                  overallLevel, published: bool, notes, createdAt

config/canvas     apiToken, courses: [{id, name}]   (Canvas API config)

certificates/     (planned) certNumber, name, date, type, pin, createdAt, createdBy
```

---

## Module Status

| # | Module | Status | Notes |
|---|--------|--------|-------|
| 0 | Auth & Shell | ✅ Done | Firebase Auth + role nav |
| 1 | People & Test Bank | ✅ Done | Full CRUD with drawers |
| 2 | Sessions | ✅ Done | Create/edit sessions |
| 3 | Assignments | ✅ Done | Manual create, publish, review page with SR score toggle; remove test/delete from drawer or review page |
| 3b | Auto-assign | ✅ Done | Smart algorithm: anchor + difficulty spread + cohort overlap |
| 3c | Quick Entry | ✅ Done | Admin manual score entry without an assignment |
| 4 | Scoring Player | ✅ Done | GRaterSystem-style sliders, keyboard shortcuts, pre-fill, submit |
| 5a | Statistics | ✅ Done | Distribution, dimension means, agreement rate, rater table (SR filter), returnees |
| 5b | Rasch CSV Export | ✅ Done | Dual-number scheme: temp# for current session (incl. returnees), permanent# for historical; no occasion column |
| 5c | Rasch Import | ✅ Done | Paste Facets .out file → parse Table 7 + Table 6 → store in rasch_runs; personalised Wright map in Reports with PNG download |
| 6a | Reports (email) | ✅ Done | Per-rater feedback email; score comparison; Wright map auto-populates from rasch_runs |
| 6b | Reports (PDF) | ❌ Not built | Candidate score report PDF |
| 6c | CAA Export | ❌ Not built | CAA-format export (schema not yet defined) |
| 7 | Admin Tools | ✅ Done | Import raters/tests/historical scores, Canvas Sync, Import Rasch Results |
| 8 | Canvas SSO | ✅ Done | OAuth2 → Firebase custom token via Cloud Function |
| 9 | Certificates | 🔜 Placeholder | Links to existing cert_generator; full migration pending |

---

## What's Left to Build

### Priority 1 — Rasch import: verify with full session file

The import parser and Wright map are built and working. Next step is to test
with a full-session `.out` file (many rater rows in Table 7, not just one) and
verify the Wright map renders correctly for different raters.

Possible enhancements:
- Infit/outfit traffic-light table in Statistics (green < 1.3, amber ≥ 1.3, red ≥ 1.5)
- Rater severity trajectory — compare measure across multiple rasch_runs

### Priority 2 — Certificates (full migration)

Replace the standalone PHP `cert_generator` with a built-in page.  
**Requires:**
- Template JPGs uploaded to Firebase Storage once
- PDF generation client-side with `pdf-lib` (already installed) + QR code
- Firestore `certificates/` collection for records
- Public `/validate?c=XXXX` route (no login required) reading from Firestore
- Old PHP-generated certs continue to validate at `validate.php` (MySQL untouched)
- New certs validate in RaterSystem — both URLs permanently valid

**Certificate types:** Full Rater, Rater Interlocutor, Refresher, Refresher Interlocutor, Teacher  
**Fields:** name, course dates, cert type, auto-generated cert number (6-char alphanumeric), auto-generated 4-digit PIN, QR code

### Priority 3 — Candidate PDF score reports (Module 6b)

PDF report for each candidate showing:
- Name, test date, test type
- Dimension scores (1–6) with ICAO descriptors
- Overall level
- Logo and version stamp

Client-side with `pdf-lib`. Triggered from the Scores page per score record.

### Priority 4 — CAA export (Module 6c)

CAA-format export of scores. Schema to be defined separately — needs input from Paul on what the CAA requires.

---

## Phase 2 Backlog (don't build now, don't forget)

- Rasch engine as Cloud Function (replace CSV export/import workflow)
- Trainee Canvas SSO login (Canvas OAuth for trainees — groundwork done for admins)
- Automated email reminders for rater due dates
- Rater calibration training module (inter-rater reliability exercises)
- Mobile-responsive scoring view (tablets)
- Multi-organisation / multi-client tenancy
- Audit log (who changed what, when)

---

## Coding Conventions

- **File structure:** Feature-folder pattern — `src/features/people/`, `src/features/testBank/`, etc.
- **State:** TanStack Query for server state; local useState for UI state
- **Forms:** react-hook-form + zod validation
- **Tables:** TanStack Table
- **UI:** shadcn/ui components (Base UI variant — use `render` prop, NOT `asChild`)
- **No backend:** Firebase SDK only — no Express, no Node server
- **Deploy:** push to `main` → GitHub Actions FTP to SiteGround → hard refresh needed (aggressive caching)

---

*Last updated: June 2026 — Modules 0–8 + 5c complete. Remaining: Rasch import verification, Certificates migration, Candidate PDF reports, CAA export.*
