# TEAC content generation and SME review — proposal

Status: proposal, not yet agreed. Written 17 October 2026.

A tab in RaterSystem where SMEs and ELEs review generated TEAC test content
directly, and where Edition 3 content for all four Parts lives in one place with
an export.

## Why

Two problems, both operational rather than technical.

**The conduit.** Feedback from SMEs currently reaches the generation work through
one person relaying it by email, and relaying revised material back. That person
is a bottleneck, the reasoning behind each decision survives only in his inbox,
and nothing records which SME approved what.

**The spreadsheets.** Edition 3 content is spread across workbooks per role and
per Part, each with its own copy of the metadata. The pattern has already caused
real defects: a register recording Tower at 27 items a month after it was rebuilt
to 81, a domain map stated one way in the rules and another in the built set.
Content that lives in one queryable place with one export stops that class of
problem.

## What already exists

This proposal adds less than it looks, because `storyline_parts` is already most
of the content store.

| Exists | Use |
|---|---|
| `storyline_parts` | Pooled Part content, `partNumber` 1–4, shared across role types. Already has `status: draft/published/archived`, `active`, `isBackup`, `retired`, `testTypes`, `themeId`, `legacyCode` pointing at `TEAC_Test_Versions.xlsx`. |
| `StorylinePartsPage` / `StorylinePartEditorPage` | Authoring UI for the above. |
| `exportStoryline.ts` | Export path already written for the player. |
| `assignments` | Established pattern for giving a person work and tracking completion. |
| `src/lib/rasch` | Item statistics machinery, currently pointed at raters. |
| `paullenguax/teac` (private) | Rules, exemplars, skills and the validator for every Part. The source of truth for what a legal item is. |

`storyline_parts` was built to replace the spreadsheets and is explicitly modelled
on them. **The content home is not a new thing to build; it is a thing to finish
and fill.**

## What is missing

1. No `sme` or `ele` role. Roles today are `admin`, `senior_rater`, `trainee`.
2. No review workflow for *content*. The review machinery that exists is for
   rater scoring, not for approving items.
3. No generator, and no link between this app and the rules in `paullenguax/teac`.
4. No import path from the TEAC workbooks into `storyline_parts`.

---

## Roles

Add two roles to the existing three:

- **`sme`** — a subject-matter expert (controller, pilot, ground ops). Reviews
  content inside their competence. Sees assigned items and the Parts they are
  qualified for. Cannot generate, cannot publish.
- **`ele`** — an English language expert. Reviews language and construct across
  all Parts. Same powers as `sme` plus visibility of the rule a finding cites.

Both are review roles. Generating and publishing stay with `admin`.

`AuthContext` resolves roles from `people/{uid}.role`, so this is a change to that
union type, to `firestore.rules`' helper functions, and to `ProtectedRoute`. Note
that `isTrainer()` in the rules currently means admin-or-senior_rater; review
access needs its own helper rather than widening that one.

**An SME's competence is not the same as their role.** A tower controller should
not be asked to adjudicate rotary content. Add `people/{uid}.reviewScope` — the
role types (Airline, PPL, Rotary, Tower, FISO, Approach, Area, ADP, AOps) and Part
numbers that person is qualified for. Assignment respects it; the dashboard filters
by it.

---

## Data model

### `storyline_parts` — extend, don't duplicate

Add to `StorylinePart`:

```ts
// Where this content came from, and whether it can be rebuilt.
provenance?: {
  source: 'generated' | 'imported' | 'authored'
  // For generated content: which rules version it was generated against,
  // e.g. "A v5.3". Needed because an item legal under one version of the
  // rules may not be legal under the next.
  rulesVersion?: string
  // Lineage, in the TEAC repo's own vocabulary: 'native', or the parent
  // item a derived role took it from, e.g. "Tower V8.2".
  lineage?: string
  // Pass/fail from the validator, with the findings if it failed.
  validation?: { ok: boolean; checkedAt: Timestamp; findings: string[] }
}
// Set when review concludes. Distinct from `status`, which is the
// authoring lifecycle: a Part can be status:'draft' and reviewApproved,
// waiting only on recording.
reviewState?: 'unreviewed' | 'in_review' | 'approved' | 'changes_requested' | 'rejected'
```

Keep `status` as it is. Review state and authoring state are different axes and
collapsing them is how a "published but actually still contested" item happens.

### `content_reviews` — new

One document per review task. Modelled on the schema proved out in the prototype
review queue, which held 100 real entries (72 draft ADP and AOps items, 28
grandfathered findings).

```ts
{
  id: string
  partId: string              // -> storyline_parts/{id}
  partNumber: 1 | 2 | 3 | 4
  testType: string            // role version, e.g. 'ADP'
  assignedTo: string          // people/{uid}
  assignedBy: string
  assignedAt: Timestamp
  dueAt?: Timestamp
  verdict: 'accept' | 'changes_requested' | 'reject' | null
  note: string                // the SME's reasoning, in their words
  // When a finding cites a rule, record which one. This is what makes
  // the rule-pattern detection below possible, and it is the field most
  // likely to be skipped if it is optional in the UI.
  citedRule?: string          // e.g. 'A §10.3'
  decidedAt?: Timestamp
}
```

### `rule_change_proposals` — new

```ts
{
  id: string
  rule: string                // 'A §10.3'
  evidence: string[]          // content_reviews/{id} that cite it
  summary: string             // what the pattern suggests
  raisedAt: Timestamp
  state: 'open' | 'accepted' | 'declined'
  decidedBy?: string
  decidedAt?: Timestamp
  outcome?: string            // the resulting rules version, e.g. 'A v5.4'
}
```

---

## The generator

Server-side only, in `functions/`. Never in the client: the prompt embeds the
rules, and the rules are the instrument.

Inputs: Part number, role type, how many Versions, and the rules bundle. Output:
draft `storyline_parts` documents with `provenance.source: 'generated'`,
`status: 'draft'`, `reviewState: 'unreviewed'`.

**Generated content never skips review.** There is no path from generation to
`published` that does not pass an SME verdict.

### Where the rules come from

The rules, exemplars and skills live in `paullenguax/teac`. Do not copy them into
this repo — a copied ruleset is a second source of truth within a week, which is
the exact failure this proposal exists to stop.

Options, in order of preference:

1. Git submodule pinned to a tag, with the tag recorded in
   `provenance.rulesVersion`.
2. A CI step that fetches the rules at a pinned ref into `functions/rules/`.
3. Rules mirrored into Firestore by a sync job, with the source commit recorded.

Any of these gives a generated item a traceable answer to "which rules was this
legal under".

### Validation

`validate_part3.py` is Python; `functions/` is Node 24. Three honest options:

1. **A second Firebase Functions codebase in Python.** Firebase supports multiple
   codebases in one project. Keeps one copy of the validator, adds a runtime.
   Preferred.
2. **A small Cloud Run service** wrapping the validator, called over HTTP.
3. **Port to TypeScript.** Fastest to ship, and it guarantees the two copies
   drift. Do not do this.

The validator is not sufficient on its own and the spec should not pretend
otherwise. In the Part 3 work it passed items that were materially wrong: two Area
items sat legally at the Climb phase while naming a visual circuit and a departure
aerodrome, which no mechanical check caught. **Validation gates generation;
SME review gates publication.** Both are required.

---

## The rule-change loop

When an SME requests changes or rejects, the generator may offer an alternative
built against the same rules. That alternative enters the queue as a new draft
with its own review task. It never replaces the rejected item silently.

When several rejections cite the same rule, raise a `rule_change_proposals`
document and show it to admins.

**The system never edits the rules.** It raises the pattern; a human decides; on
acceptance, the rules change happens in `paullenguax/teac` with a version bump and
a change note, and the new version flows back through whichever sync option is
chosen.

This is deliberate and should not be designed away later:

- The ruleset is what makes an item from one role comparable to an item from
  another, and a 2026 item comparable to a 2027 one. An instrument that edits
  itself under the bank cannot support that claim.
- Lenguax operates under UK CAA approval and should be able to show why its
  generation rules say what they say. Documents A v5.1 → v5.2 → v5.3 each carry a
  change summary naming what moved and why. An automatic edit has no author and
  no reason.
- One rejection is usually a bad item, not a bad rule. The signal is the pattern.

---

## Pages

| Route | Who | What |
|---|---|---|
| `/content` | sme, ele, admin | Dashboard. My assigned reviews, my scope, what I have decided. |
| `/content/review/:id` | sme, ele, admin | One item: the script or question, its metadata, validator result, verdict buttons, note, cited rule. |
| `/content/bank` | all four roles | The whole Edition 3 bank, filterable by Part, role type, status, review state. Export. |
| `/content/generate` | admin | Generate drafts. Pick Part, role type, count. Review the validator result before anything is saved. |
| `/content/assign` | admin | Assign review tasks, respecting `reviewScope`. See who is overdue. |
| `/content/rules` | admin, ele | Open rule-change proposals and their evidence. |

Follows the repo's existing conventions: shadcn/ui **Base UI** variant, so the
`render` prop and never `asChild`; TypeScript strict, so no unused imports;
`README.md` updated after the build.

---

## Export

The point of one home is getting content back out. From `/content/bank`:

- **Workbook per role version** — the shape the voice artists and SMEs already
  know, generated from Firestore rather than maintained by hand.
- **The register** — every item across all four Parts with its metadata, review
  state and provenance. Replaces `D_Item_Bank_Register`.
- **Recording manifest** — approved items only, with voice-artist slot and
  callsign treatment. This is the one the current spreadsheets cannot produce,
  because neither field exists in them yet.

---

## Phases

Each phase is useful on its own and ships before the next starts.

1. **Bank, read-only.** Import the existing Part 3 and Part 4 content into
   `storyline_parts`, add the provenance fields, build `/content/bank` and the
   exports. Forces the data model the rest depends on, and kills the spreadsheets
   without touching workflow.
2. **Review and assignment.** Add the `sme` and `ele` roles, `content_reviews`,
   `reviewScope`, the dashboard, the review page, the assignment page. This is the
   phase that removes the conduit.
3. **Generation.** Rules integration, the generator function, the validator
   service, `/content/generate`. Drafts land in the phase-2 queue.
4. **Rule-change proposals.** Pattern detection, `/content/rules`, the accept path
   that bumps the rules version in `paullenguax/teac`.

---

## Open decisions

- **This repository is public; `paullenguax/teac` is private.** The live item bank
  is secure test material. Before phase 1, decide whether this repo goes private,
  or whether a hard rule keeps all item content in Firestore and out of the
  codebase. Nothing in this spec requires item text in the repo, and it should
  stay that way either way.
- **Where recorded audio sits** relative to a Part, and whether a reviewed item
  whose audio is later re-recorded needs re-review.
- **Callsign treatment** is still undecided for Part 3. Word counts deliberately
  exclude callsigns because they are added at handover, so no item is strictly
  complete until this is settled. It blocks the recording manifest, not the bank.
- **Voice artist slot** is carried in no workbook today. It needs to exist as a
  field before the recording manifest can be produced.
- **Whether `senior_rater` should see the bank** read-only. They rate the test;
  seeing live items may be a conflict.
- **Item statistics.** Once items have run, `src/lib/rasch` could estimate item
  difficulty and fit, which is a better answer than an SME verdict to whether a
  trap mechanism works. Out of scope here, but the data model should not make it
  harder: keep item identity stable from generation through to scoring.
