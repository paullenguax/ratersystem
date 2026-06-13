# Rater Management App — Build Plan
**Aviation English Language Testing**

> **Purpose of this document:** A high-level map to keep vibe-coding sessions on track. Each module is self-contained and can be built, tested, and shipped independently. When starting a new Cursor session, paste the relevant module section as context.

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

**Decided:**
- **Firebase project:** New project — clean slate. Test and candidate data from the old system will be imported later via Admin Tools (Module 7).
- **Auth:** Firebase Auth, email/password. Admin + senior raters have accounts. Trainees log in via Canvas LMS (Phase 2 — see backlog).
- **No backend server:** All data via Firebase SDK directly from the React app. Cloud Functions added later as needed (e.g. Rasch engine).
- **Rasch engine:** Deferred — admin exports a Facets-compatible CSV, runs Facets externally, imports the output JSON. Cloud Function replacement is Phase 2.
- **Audio:** Recording URLs only (external hosting). No Firebase Storage required at launch.
- **Candidates:** Standalone per test — candidate metadata (name, nationality, licence type) is embedded in each `test_bank` document. No separate candidates collection.

---

## Firestore Data Model

### Key design concepts

**People vs Participations (longitudinal tracking)**
A `person` is a permanent identity. A `participation` is one instance of someone attending a session. This is how we track rater severity over time — rater 45 and rater 412 are the same `person`, linked via two `participation` records. Severity estimates are stored per `rasch_run` per `person`, enabling trajectory plots across refresher courses.

**Rater types use the same data structure**
Admins, senior raters, and trainees are all stored in `people/` — distinguished by the `role` field. The `session.type` field (`senior_calibration` | `trainee_course`) drives the business logic differences:
- Senior calibration: admin manually assigns any number of tests; submissions staged before committing to canonical pool
- Trainee course: 4 tests auto-allocated with minimal overlap across cohort; submissions never added to canonical pool

**Submissions are per test, not per session**
The atomic unit is one rater × one test × 6 dimension scores. This is what the Rasch engine consumes.

**Candidates are embedded, not a separate entity**
Each test in `test_bank/` represents a single candidate recording. Candidate metadata (name, nationality, licence type) lives directly on the test document. A candidate normatively appears only once.

---

### Collections

```
people/
  {personId}
    name:               string
    email:              string
    role:               "admin" | "senior_rater" | "trainee"
    status:             "active" | "inactive" | "suspended"
    notes:              string
    createdAt:          timestamp
    // No scores here — all scoring data lives in submissions

test_bank/
  {testId}
    recordingUrl:       string
    candidateName:      string
    candidateNationality: string
    testType:           "PPL" | "Airline Pilot" | "Helicopter Pilot" | "Student Pilot" | "Aerodrome ATC" | "Approach ATC" | "Area ATC" | "Student ATCO" | "Airport Operations" | "ADP Driver"
    durationSeconds:    number
    status:             "active" | "retired"
    // Empirical difficulty comes from Rasch runs (canonicalDifficulty), not set manually
    canonicalDifficulty: number | null  // logit estimate, null until anchored
    canonicalSE:        number | null
    anchoredAt:         timestamp | null
    notes:              string
    createdAt:          timestamp

sessions/
  {sessionId}
    label:              string        // e.g. "Trainee Cohort 2026-Q2" / "Senior Calibration Mar 2026"
    type:               "senior_calibration" | "trainee_course"
    status:             "draft" | "active" | "closed"
    createdBy:          personId
    createdAt:          timestamp
    closedAt:           timestamp | null
    notes:              string

  participations/               // subcollection
    {participationId}
      personId:         string   // → people/{personId}
      temporaryId:      string | null   // e.g. "412" — used during session, reconciled after
      joinedAt:         timestamp
      status:           "active" | "complete" | "withdrawn"

    assignments/                // subcollection of participation
      {assignmentId}
        testId:         string   // → test_bank/{testId}
        assignedAt:     timestamp
        dueAt:          timestamp | null
        status:         "pending" | "in_progress" | "submitted" | "accepted" | "returned"
        returnNote:     string | null

      submissions/              // subcollection of assignment (usually just one doc)
        {submissionId}
          scores: {
            pronunciation:    number   // 1–6
            structure:        number
            vocabulary:       number
            fluency:          number
            comprehension:    number
            interactions:     number
          }
          overallLevel:       number   // computed: min of 6, or holistic override
          holisticOverride:   boolean
          notes:              string
          submittedAt:        timestamp
          committedToPool:    boolean  // false for trainees always; seniors: true after admin review

rasch_runs/
  {runId}
    sessionId:          string | null  // null = cross-session run
    runAt:              timestamp
    runBy:              personId
    inputExportUrl:     string         // CSV downloaded by admin
    outputImportedAt:   timestamp | null
    status:             "pending_export" | "pending_import" | "complete"
    notes:              string

  facets/                       // subcollection — one doc per entity in this run
    {facetId}
      entityType:       "rater" | "test" | "dimension"
      entityId:         string   // personId or testId
      measure:          number   // logit
      se:               number
      infitMSQ:         number
      outfitMSQ:        number
      infitZSTD:        number
      outfitZSTD:       number

canonical_anchors/
  {testId}                      // same ID as test_bank doc
    difficulty:         number   // current best logit estimate
    se:                 number
    lastUpdatedAt:      timestamp
    lastUpdatedByRun:   runId
    contributingSubmissions: number
```

---

### Firestore query patterns (the important ones)

```
// Rater's current queue
sessions/{sid}/participations/{pid}/assignments
  where status in ["pending", "in_progress"]

// All submissions for a test across all raters (for IRR)
collectionGroup("submissions")
  where testId == {testId}
  where committedToPool == true

// All participations for a person (longitudinal history)
collectionGroup("participations")
  where personId == {personId}

// All facets for a person across all Rasch runs (severity trajectory)
collectionGroup("facets")
  where entityType == "rater"
  where entityId == {personId}
```

> ⚠️ `collectionGroup` queries require composite indexes in Firestore — add these to `firestore.indexes.json` as you build each query.

---

### Rater identity reconciliation (the "rater 45 / rater 412" problem)

When a senior rater returns for a refresher course:
1. They get a new `participation` record with a `temporaryId` (e.g. "412")
2. After the session, admin links this participation to the correct `people` doc (the one that was previously "rater 45")
3. The `temporaryId` is kept for audit trail; the `personId` is what links history
4. Severity trajectory is then queryable via `collectionGroup("facets") where entityId == personId`

This reconciliation should be a dedicated admin UI step — a "merge participation" flow — not a freeform edit.

---

## Module Map

| # | Module | Core user story | Depends on |
|---|--------|----------------|------------|
| 0 | **Auth & Shell** ✅ | Admin can log in; navigation shell exists | — |
| 1 | **People & Test Bank** ✅ | CRUD rater profiles; manage test recordings | 0 |
| 2 | **Sessions** | Create senior calibration runs and trainee course cohorts | 1 |
| 3 | **Assignments** | Assign seniors to tests manually; auto-allocate trainees | 2 |
| 4 | **Scoring** | Rater opens assignment, submits 6-dimension scores | 3 |
| 5 | **Rasch & Statistics** | Export Facets CSV; import results; view severity trajectory | 4 |
| 6 | **Reports & Export** | PDF/CSV results; rater longitudinal summary | 5 |
| 7 | **Admin Tools** | Identity reconciliation, audit log, bulk import from old system | all |

Build in order. Each module should be mergeable to `main` and usable before the next begins.

---

## Module 0 — Auth & Shell ✅

**Goal:** Working login, role-aware nav, blank page stubs for all modules.

**Key decisions:**
- Auth: Firebase Auth, email/password
- Roles at launch: `admin`, `senior_rater`. Trainees via Canvas SSO — Phase 2.
- Role stored in Firestore `people/{uid}.role`

**Acceptance criteria:**
- [x] Admin can log in with email + password
- [x] Senior rater can log in; sees only Assignments and Scoring in nav
- [x] Route guards redirect unauthenticated users to login
- [x] Nav shell renders stubs for all modules
- [ ] Dark/light mode toggle (optional — deferred)

**Prompt seed for Cursor:**
> "Build a React + Vite app with Tailwind and shadcn/ui. Firebase Auth (email/password only — no other providers). Layout shell with a sidebar nav containing: Dashboard, People, Test Bank, Sessions, Assignments, Scoring, Statistics, Reports, Admin. Protect all routes using Firebase Auth onAuthStateChanged. Role is stored in Firestore `people/{uid}.role` as `admin` or `senior_rater`. Admins see all nav items; senior_raters see only Assignments and Scoring. Each nav item renders a placeholder page component. No Express or Node server — all data will go via Firebase SDK directly."

---

## Module 1 — People & Test Bank ✅

**Goal:** CRUD for rater profiles and test recordings. Both are admin-managed master data.

### People

**Fields:** Name, email, role (admin | senior_rater | trainee), status (active | inactive | suspended), notes.

**UI:**
- People list table, filterable by role and status
- Slide-over drawer for create/edit
- Status badge (colour-coded)

**Acceptance criteria:**
- [x] Admin can create, edit, deactivate a person
- [x] Email uniqueness enforced (check against Firestore before write)
- [x] Table is searchable and filterable by role/status
- [ ] Person record shows count of linked participations — deferred to after Sessions/Assignments exist

### Test Bank

**Fields:** Recording URL, candidate name, candidate nationality, test type (PPL | Airline Pilot | Helicopter Pilot | Student Pilot | Aerodrome ATC | Approach ATC | Area ATC | Student ATCO | Airport Operations | ADP Driver), duration (seconds), status (active/retired), notes. Empirical difficulty is derived from Rasch runs, not stored manually.

**UI:**
- Test list table, filterable by test type and status
- Inline audio player (play/stop per row)
- Slide-over drawer for add/edit

**Acceptance criteria:**
- [x] Admin can add, edit, retire a test
- [x] Recording URL plays inline
- [ ] Table shows number of times assigned — deferred to after Assignments exist

**Data migration (deferred to Module 7):** Import from old `tests_dev` collection. Field mapping: `audioUrl` → `recordingUrl`, status mapping (`new`/`scoring`/`benchmarked` → `active`, `archived` → `retired`), `testType` assigned in bulk. Old data lives in `raterscores.firebasestorage.app` — audio URLs remain valid.

**Prompt seed for Cursor:**
> "Add People and Test Bank modules to the existing shell. No backend — all Firestore SDK. People: collection `people/`, TanStack Table with columns [Name, Email, Role, Status], filterable by role and status. Slide-over drawer for create/edit using react-hook-form + zod. Check email uniqueness against Firestore before creating. Test Bank: collection `test_bank/`, fields: recordingUrl, candidateName, candidateNationality, testType (PPL|Airline Pilot|Helicopter Pilot|Student Pilot|Aerodrome ATC|Approach ATC|Area ATC|Student ATCO|Airport Operations|ADP Driver), durationSeconds, status (active|retired), notes. Table with inline HTML5 audio player for recordingUrl. Both modules: admin-only access."

---

## Module 2 — Sessions

**Goal:** Create and manage senior calibration runs and trainee course cohorts.

**Session types:**
- `senior_calibration`: admin manually assigns any number of tests to each participant
- `trainee_course`: 4 tests auto-allocated per trainee with minimal overlap across cohort

**Lifecycle:** `draft` → `active` → `closed`. Closing a session locks further score submission.

**UI:**
- Session list with type and status filters
- Session detail page showing participants and their assignment counts
- Add/remove participants
- Status transition buttons

**Acceptance criteria:**
- [ ] Admin can create a session (type, label, notes)
- [ ] Admin can add/remove participants from a draft or active session
- [ ] Closing a session is a confirmed, irreversible action
- [ ] Session detail shows per-participant progress at a glance

**Prompt seed for Cursor:**
> "Add a Sessions module. Firestore collection `sessions/` with subcollection `participations/` (fields: personId, temporaryId, joinedAt, status). Session list page with type/status filters. Session detail page: show label, type, status, and a table of participants fetched from the participations subcollection. Buttons to add participants (search people/ collection) and remove them. Status transitions: draft → active → closed, with a confirmation dialog for closing. Closing sets closedAt timestamp and prevents further edits. Admin-only."

---

## Module 3 — Assignments

**Goal:** Link raters to tests; track the workflow from assignment through to accepted submission.

**States:** `pending` → `in_progress` → `submitted` → `accepted` | `returned`

**Business rules:**
- Senior calibration: admin manually assigns tests to each participant
- Trainee course: auto-allocate 4 tests per trainee, minimising overlap (no two trainees share more than 1 test where possible)
- Same rater cannot be assigned the same test twice in a session
- Admin can return a submitted score with a note, resetting it for re-submission

**UI:**
- Admin view: session → participant → assignments list with status chips
- Rater view: "My Queue" sorted by due date

**Acceptance criteria:**
- [ ] Admin can assign one or more tests to a senior participant
- [ ] Auto-allocate button distributes tests across trainees with minimal overlap
- [ ] Duplicate assignment within a session is prevented
- [ ] Rater queue shows pending and in-progress items
- [ ] Admin can return a submission with a note

**Prompt seed for Cursor:**
> "Add an Assignments module. Subcollection path: sessions/{sid}/participations/{pid}/assignments/{aid} (fields: testId, assignedAt, dueAt, status, returnNote). Admin view: session detail now shows an 'Assignments' tab per participant — admin can search test_bank and add assignments. For trainee_course sessions, add an 'Auto-allocate' button that assigns 4 tests per trainee minimising overlap (greedy algorithm is fine). Prevent duplicate testId within a participation. Rater view: 'My Queue' page — collectionGroup query across all participations where personId == currentUser, status in [pending, in_progress], joined with test_bank data. Return flow: admin sets status back to in_progress with a returnNote."

---

## Module 4 — Scoring

**Goal:** Rater submits 6-dimension ICAO scores for their assigned test.

**ICAO dimensions (each scored 1–6):**
1. Pronunciation
2. Structure
3. Vocabulary
4. Fluency
5. Comprehension
6. Interactions

Overall level = lowest dimension (ICAO rule), or holistic override.

**UI:**
- Embedded audio player (from test_bank recordingUrl)
- Six score selectors (segmented controls, 1–6)
- Real-time display of computed overall level
- Holistic override toggle + level selector
- Notes field
- Submit + confirm dialog
- Submitted scores are read-only; admin can unlock for re-scoring

**Acceptance criteria:**
- [ ] Rater cannot submit without all 6 dimensions scored
- [ ] ICAO minimum computed and displayed in real time
- [ ] Submitted scores are locked (read-only view with timestamp)
- [ ] Admin can unlock a submission for re-scoring
- [ ] Score history is preserved (new submission doc, never overwrite)

**Prompt seed for Cursor:**
> "Add a Scoring module. When a rater opens an assignment from their queue, show: HTML5 audio player for the test's recordingUrl, six segmented controls (1–6) for pronunciation, structure, vocabulary, fluency, comprehension, interactions. Compute and display overall level in real time as the minimum of all scored dimensions. Add a holistic override toggle — when enabled, show a separate level selector and set holisticOverride: true on submission. Notes field. Submit button opens a confirmation dialog. On confirm, write a new document to the submissions subcollection (never update in place). Mark assignment status as 'submitted'. Submitted view is read-only. Admin can set status back to 'in_progress' to unlock."

---

## Module 5 — Rasch & Statistics

**Goal:** Generate Facets-compatible CSV exports; import Rasch results; display severity statistics.

**This is the most technically sensitive module. The CSV format must be correct for Facets to consume it without manual editing.**

### 5a — Descriptive Statistics (build first)
- Per-rater: mean score by dimension, score distribution, inter-rater agreement on shared tests
- Per-test: score spread, standard deviation, flagged outliers

### 5b — Rasch CSV Export (day-one requirement)
- Admin selects a closed session (or a cross-session batch)
- App generates a CSV with one row per observation: `raterPersonId, testId, dimension, score`
- CSV must be clean and Facets-compatible — no manual massaging required
- Admin downloads the CSV, runs Facets externally, gets output files

### 5c — Import Rasch Results
- Admin uploads Facets output (JSON, to be defined when building)
- App stores measures in `rasch_runs/{runId}/facets/` subcollection
- Display rater severity dot plot with SE error bars
- Infit/outfit summary table with traffic-light flagging: |MSQ| > 1.3 = amber, > 1.5 = red
- Wright map (candidate ability vs test difficulty)

**Acceptance criteria:**
- [ ] Admin can trigger a CSV export for a session or cross-session batch
- [ ] CSV is Facets-compatible without editing
- [ ] Admin can import a Facets output JSON and associate it with a run
- [ ] Rater severity estimates displayed with SE and fit statistics
- [ ] Raters flagged for high misfit appear in an alert panel
- [ ] Run history is preserved — compare severity across sessions

**Prompt seed for Cursor:**
> "Add a Rasch & Statistics module. Part A: descriptive stats page — fetch all committed submissions for a session, show per-rater mean scores by dimension and a score distribution chart. Part B: CSV export — admin picks a closed session, app queries collectionGroup('submissions') where committedToPool == true, generates a CSV with columns [raterPersonId, testId, dimension, score] (6 rows per submission, one per dimension), triggers a file download. Part C: import — admin uploads a JSON file (schema TBD), app writes a rasch_runs doc and a facets subcollection. Display rater severity as a dot plot (measure ± SE) using Recharts or similar. Traffic-light flag infit/outfit MSQ: green < 1.3, amber ≥ 1.3, red ≥ 1.5."

---

## Module 6 — Reports & Export

**Goal:** Generate shareable outputs for candidates, clients, and regulators.

**Outputs:**
- Candidate score report (PDF): name, test date, dimension scores, overall level, ICAO proficiency descriptors
- Rater performance summary (PDF/CSV): severity, fit stats, reliability
- Batch CSV export: all scores for a session
- CAA-format export: schema to be defined separately in `/docs/caa-export-format.md`

**Acceptance criteria:**
- [ ] Candidate PDF generated (Puppeteer via Cloud Function, or pdf-lib client-side)
- [ ] Batch CSV export filterable by session/date range
- [ ] Reports include logo, date, version stamp
- [ ] CAA export schema documented before building

---

## Module 7 — Admin Tools

**Goal:** Operational safety net, power-user features, and old-system data import.

**Features:**
- **Identity reconciliation:** "Merge participation" flow — link a temporaryId participation to the correct people doc after a session
- **Audit log:** every score submission, edit, status change — who, what, when
- **Bulk import:** import test and candidate data from old Firebase project (JSON/CSV)
- **User management:** create/deactivate accounts, reset passwords, change roles
- **System settings:** min raters per test, score lock policy

---

## Phase 2 Backlog (don't build now, don't forget)

- Trainee login via Canvas LMS (Canvas SSO / LTI integration) — trainees currently have no login
- Rasch engine as Cloud Function (replace CSV export/import workflow)
- Automated email reminders for rater due dates
- Rater calibration training module (inter-rater reliability exercises)
- Mobile-responsive scoring view (tablets)
- CAA submission integration
- Multi-organisation / multi-client tenancy

---

## Coding Conventions (for Cursor sessions)

- **File structure:** Feature-folder pattern — `src/features/people/`, `src/features/testBank/`, `src/features/sessions/`, etc.
- **State:** React Query (TanStack Query) for server state; Zustand for local UI state
- **Forms:** react-hook-form + zod validation
- **Tables:** TanStack Table
- **No backend:** Firebase SDK only — no Express, no Node server
- **Tests:** Vitest unit tests for Rasch CSV utilities; Playwright e2e for critical flows (scoring submission)
- **Commits:** one commit per acceptance criterion where possible

---

## Session Start Checklist

Before each Cursor session, confirm:
1. Which module are we working on?
2. Which acceptance criteria are already ticked?
3. Any data model changes since last session? → update the schema section above.
4. Are we on `main` or a feature branch?
5. Any blocking decisions that need resolving before writing code?

---

*Last updated: June 2026 — Modules 0 and 1 complete. Next: Module 2 (Sessions).*
