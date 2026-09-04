# Storyline Replacement — server-side & sanitisation briefing

For the dev / Tim call. Covers what runs server-side for an exported TEAC
speaking test ("Test Versions" / Storyline Replacement), how each piece is
authenticated, and how input is validated / escaped.

**TL;DR:** the exported test is a static folder (HTML/JS/CSS + bundled
media) plus **one PHP file** (`examiner.php`) that carries the same
WordPress access gate the old Storyline exports had. It talks to **three
Cloud Functions** (Firebase, `us-central1`) and, best-effort, the old
system's own two PHP callback scripts. WordPress booking / random
assignment / exposure tracking is **not touched** — a new version is just a
row in `wp_teac_test_versions`.

---

## 1. The export folder

Produced by `src/features/storyline/exportStoryline.ts` (`exportStorylineVersion`).
Contents:

| File | What it is |
|---|---|
| `examiner.php` | `examiner.html` with a PHP access-gate header/footer wrapped around it (section 2) |
| `candidate.html` | the second-screen candidate window — plain HTML, no gate (only ever opened via `window.open()` from the already-gated examiner page, never navigated to directly — same as the old `Candidate.php`) |
| `assets/*` | content-hashed JS/CSS bundle (the player) |
| `media/*` | every image and audio file for this test, downloaded and bundled at export time — nothing streams from Firebase once uploaded |
| `version.json` | the frozen, resolved test content (script text, question lists, media paths). Plain data, rendered as text/DOM by the player (section 4) |
| `theme.json`, `flags.json` | small config (brand colours; `ungated` flag; `liveContentId` for Live versions) |
| `HOW-TO-ACTIVATE.txt` | upload instructions |

No server-side code except `examiner.php`. Everything else is static.

---

## 2. `examiner.php` — the WordPress access gate

Prepended verbatim at export time (was a manual copy-paste per export in the
old system; now automated so it can't be forgotten or mistyped). Source:
`PHP_GATE_HEADER` in `exportStoryline.ts`.

```php
<?php
include_once("../../../wp-load.php");
if(
      !array_key_exists("validation",$_SESSION)
    ||!array_key_exists("check",$_GET)
    ||!array_key_exists("id",$_GET)
    ||!array_key_exists("tc",$_GET)
    ||!array_key_exists("in",$_GET)
    ||!array_key_exists("cn",$_GET)
    ||$_SESSION["validation"] != md5($_GET['check'])
    ||$_GET['check'] != md5(implode("-", array("id"=>$_GET['id'],"tc"=>$_GET['tc'],"in"=>$_GET['in'],"cn"=>$_GET['cn'])))
    ||!current_user_can("administer_tests")
) {
    header("Location: ".get_site_url()."/tests/Access-Denied/story.html");
} else {
?>
  … examiner.html …
<?php } ?>
```

What it enforces before a byte of the player is served:

1. A live WordPress session with `$_SESSION['validation']` set (i.e. the
   examiner went through the normal WP booking-accept flow).
2. The `check` query param matches `md5` of `$_SESSION['validation']`.
3. `check` also equals `md5("id-tc-in-cn")` of the four launch params — so
   `id` / `tc` (centre) / `in` (examiner) / `cn` (candidate) cannot be
   altered in the URL without invalidating the hash.
4. The logged-in user has the `administer_tests` capability.

Any failure → redirect to the WP "Access-Denied" page; the player is never
output.

This is **identical to what every existing Storyline test uses** — it's
lifted from the old exports, not new. The four params are read straight from
the WP booking-accept flow (`getTestUrlByTestVersion()` in the sibling
`Front-End-master/functions.php`), which is unchanged.

**One manual step:** the `../../../wp-load.php` include assumes the folder
sits 3 levels deep in the WP install (where previous exports have lived). If
it's placed at a different depth, the `../` count on line 1 needs adjusting
by hand — called out in `HOW-TO-ACTIVATE.txt`.

---

## 3. Cloud Functions (`functions/index.js`, Firebase, `us-central1`, Node 20)

Three endpoints. The first two are **unauthenticated by necessity** — they
run in an examiner's browser at a random test centre, where there is
nowhere to safely hold a secret. This is a deliberate, documented choice:
the exported player is already access-controlled by `examiner.php`, and
these endpoints are shaped-input-only and either write low-value telemetry
or return non-secret exam wording.

### 3a. `reportStorylineEvent` — telemetry sink

- **Method:** `POST` only (else 405). CORS on.
- **Auth:** none (see above).
- **Input:** accepts either a batch `{ events: [ {event, runId, playerBuild,
  clientTs, testDisplayName, centreName, testNumber, examinerName,
  candidateName, ungated, hasLiveContent, data} ] }` or the legacy single
  `{ type: 'violation'|'completed', subtype, …, details }` shape.
- **Validation / normalisation** (`normalizeStorylineEvents`):
  - Batch is capped at **300 events**; entries without a string `event` are
    dropped.
  - `ungated` / `hasLiveContent` coerced to boolean-or-null.
  - `data` kept only if it's a plain object, else null.
  - Legacy shape accepted only for `type` in `violation` / `completed`;
    anything else → 400 "No valid events".
  - Every stored field is `|| null` — no undefined reaches Firestore.
- **Writes:** one doc per event into the `storyline_events` collection
  (Admin SDK). Server-stamped `createdAt`.
- **Emails:** only for event names in a small `STORYLINE_EMAIL_RULES` map
  (`test_finished`, `test_rejected`, `audio_replay_limit`,
  `candidate_window_closed`, `connectivity_*`). Recipients come from
  `config/storyline` (`notificationEmail` = ops, `complianceEmail`).
  Sent via Resend as **plain text** (`text:` field, never `html:`), one
  message per recipient.
- **PII:** the stored events carry centre / examiner / candidate names from
  the launch URL. Read only by admins on the Test activity page
  (`storyline_events` is `allow read: if isAdmin()`, `allow write: if false`
  in `firestore.rules` — only the function writes it).
- **Abuse ceiling:** a spammed endpoint can only create `storyline_events`
  docs (300 per request) and trigger emails for the whitelisted event
  names. No data is read back out, nothing else is writable.
- **Known area:** `data` is stored as an arbitrary client object (bounded by
  Firestore's 1 MB doc limit). It is only ever rendered as escaped text
  (React) or plain-text email — never as HTML — so it's a storage-shape
  note, not an injection vector.

### 3b. `getStorylineLiveContent` — live script text for Live versions

- **Method:** `GET` only (else 405). CORS on. `maxInstances: 10`.
- **Auth:** none. Gated by requiring the exact Firestore Version id (a
  random ~20-char auto-ID that only exists inside that one exam's own
  already-gated zip, in `flags.json`), plus: the version must be
  `versionType === 'live'` **and** `status === 'published'`, else 404.
- **Input:** one param, `versionId` (string). Missing/non-string → 400.
- **Returns:** `{ items: [ {id, examinerText, notes} ] }` — **only** the
  resolved script text and examiner notes, never media URLs or the full
  item. This is deliberate: it makes it structurally impossible for the
  player to pull live Firebase Storage URLs and break offline-resilience.
- A missing referenced doc (template / test / any Part) → 404 (hard fail,
  never a partial/wrong resolve; the player then falls back to its bundled
  static `version.json`).
- `Cache-Control: no-store`.
- **What it exposes if hit directly:** the exam's scripted wording for a
  known published Live version id. No candidate data, no secrets. Backup and
  Practice exports never carry a `liveContentId` and never call this.

### 3c. `getStorylineSyncData` — Part/theme metadata for WP-side pooling

- **Auth:** shared secret in the `x-sync-secret` header
  (`STORYLINE_SYNC_SECRET`); mismatch → 401.
- **Caller:** a WordPress cron job (in the sibling `TEAC-Plugin-master`
  repo), polling. Not reached from any browser.
- **Returns:** Part / theme / rule **metadata only** (ids, part numbers,
  test-type→wpTestId mappings, theme labels, unmixable pairs) — **never
  test content**. Only `status === 'published'` Parts.
- Not yet load-bearing — this feeds the not-yet-built dynamic Part-pooling
  selection.

### 3d. Legacy WP callbacks (`player-src/shared/wpCallback.ts`)

On finish / reject the player also does a best-effort `fetch` to the **old
system's own** `../assets/sendStats.php` and `../assets/rejectTest.php`
(relative path, `!isPreview` only, failures swallowed). These are the
existing, already-live files that fire the current WP-side completion /
rejection emails — calling them keeps those working unchanged, alongside
the new Firestore record. **The field mapping here is a best-effort
approximation** (only each PHP file's header was reviewed; the old short
test-type codes and numeric centre code have no clean equivalent in the new
data model) — worth verifying against a real deployment. This is the item
most in need of the dev's eyes.

---

## 4. Client-side sanitisation (the player itself)

Script text / notes / question lists are authored by admins in the RaterSystem
UI (or come from `getStorylineLiveContent`). The player renders them through
`player-src/shared/markup.ts`:

- `escapeHtml()` runs first on every string — `textContent` → `innerHTML`,
  which neutralises all HTML.
- Only then is a tiny allow-list of markup turned into tags: `**bold**` →
  `<strong>`, `__underline__` → `<u>`, and `[[ … ]]` → a styled `<span>`.
- So even though the result is assigned via `innerHTML`, authored content
  cannot inject `<script>` / event handlers / arbitrary tags.

The four launch-URL values (`id`/`tc`/`in`/`cn`) are substituted into script
text **before** that escaping step, so a hostile `cn=<script>…` in the URL
is rendered as inert text — and in any case `examiner.php` has already
rejected any URL whose params don't match the `md5` hash.

The Test activity admin page renders `storyline_events` via React (auto-escaped
text), not `innerHTML`.

---

## 5. What is deliberately unchanged on the WordPress side

- Booking, random version assignment, per-candidate exposure tracking:
  **zero changes.** A new version is one `wp_teac_test_versions` row
  (`Test_id`, `TestUrl` → the folder's `examiner.php`, `Active = true`); the
  existing rotation picks it up automatically.
- No new WP plugin code is required to run a test. (The separate
  `TEAC-Plugin-master` sync class is only for the future Part-pooling work
  and is additive — its own tables, not woven into existing activator
  steps.)

---

## 6. Files to look at

| Concern | Path |
|---|---|
| PHP gate, export contents, activation steps | `src/features/storyline/exportStoryline.ts` (`PHP_GATE_HEADER`, `bundlePlayerShellFiles`, `buildActivationInstructions`) |
| Cloud Functions | `functions/index.js` — `reportStorylineEvent`, `getStorylineLiveContent`, `getStorylineSyncData` |
| Legacy WP callbacks | `player-src/shared/wpCallback.ts` |
| Client escaping | `player-src/shared/markup.ts` |
| Telemetry sender | `player-src/shared/telemetry.ts` |
| Firestore rules | `firestore.rules` (`storyline_events`, `config`, `storyline_*`) |
| Full design reasoning | `README.md` → "Storyline Replacement" / "Telemetry" sections |

---

## 7. File-by-file — what's actually in each

### In the uploaded folder

- **`examiner.php`** — ~20 lines of PHP (the gate in §2), then the entire
  `examiner.html` markup, then `<?php } ?>`. The PHP does nothing except
  `include wp-load.php` and the `if(...)` check; there is no database
  access, no user input processed beyond the four `$_GET` params it
  hash-checks, no file I/O. If the checks pass it just prints the HTML.
- **`candidate.html`** — static HTML, ~15 lines: a container div and a
  `<script>` tag for the candidate-window bundle. No PHP, no logic of its
  own; it's driven entirely by messages from the examiner window
  (`BroadcastChannel`, same-origin only).
- **`assets/*.js` / `*.css`** — the compiled player (TypeScript → bundled
  JS). Content-hashed filenames. This is the app: slide navigation, audio
  controls, timers, the two-window sync. Readable but minified; the source
  is `player-src/` in the repo.
- **`media/*`** — the actual `.jpg` / `.mp3` files for this one test,
  downloaded from Firebase Storage at export time and bundled. After upload
  nothing streams from anywhere — a centre can lose internet mid-test and
  keep all content.
- **`version.json`** — a JSON array: one object per slide with its script
  text, question list, `media/…` paths, timing. Pure data. The player reads
  it and builds the DOM (escaping as in §4). No code.
- **`theme.json` / `flags.json`** — a few keys each: brand colour + logo
  height; `{ ungated: bool, liveContentId?: string }`.
- **`HOW-TO-ACTIVATE.txt`** — plain text upload steps.

### Source in the repo (what the dev would review)

- **`src/features/storyline/exportStoryline.ts`** (~620 lines, TS) — runs in
  the admin's browser when they click Export. Builds the zip: fetches the
  player shell, wraps `examiner.html` in the PHP gate string
  (`PHP_GATE_HEADER`), downloads + de-dupes every media URL into `media/`,
  writes the JSON files and `HOW-TO-ACTIVATE.txt`. No server involvement —
  the zip is assembled client-side and downloaded.
- **`functions/index.js`** — all the project's Cloud Functions in one file
  (Canvas sync, certs, invites, etc. — Storyline is a small part). The
  three Storyline ones are each ~30–60 lines:
  - `reportStorylineEvent` — parse/validate the event batch, write rows,
    maybe send a plain-text email. §3a.
  - `getStorylineLiveContent` — look up one published Live version, re-run
    the same `resolveItems()` the export uses, return `{id, examinerText,
    notes}` per slide. §3b.
  - `getStorylineSyncData` — secret-checked; return Part/theme metadata for
    the WP cron. §3c.
- **`player-src/shared/wpCallback.ts`** (~35 lines, TS) — two functions that
  `fetch("../assets/sendStats.php?…")` / `rejectTest.php` with URL params,
  errors swallowed. This is the only place the new player talks to the
  *old* PHP. §3d — the field mapping here is the review priority.
- **`player-src/shared/markup.ts`** (~55 lines, TS) — `escapeHtml()` +
  the `**bold**` / `__underline__` / `[[stage direction]]` allow-list. §4.
- **`player-src/shared/telemetry.ts`** (~110 lines, TS) — buffers events,
  flushes every 15 s / on page-hide via `navigator.sendBeacon`, POSTs to
  `reportStorylineEvent`. Fire-and-forget; wrapped in try/catch so it can
  never throw into the test flow.
- **`firestore.rules`** — the database access rules. Relevant lines:
  `storyline_events` = admin read, **no client writes** (only the function,
  via Admin SDK); `config/*` = admin only; `storyline_*` collections =
  admin only.

---

## 8. If the Cloud Functions feel risky — straight answers

A WordPress dev's instinct is reasonably "why is there suddenly a
third-party serverless thing in the path of a test?" Point by point:

**"They're unauthenticated — anyone can hit them."**
True for two of the three, and unavoidable: the caller is a browser at a
random centre with nowhere to keep a secret. But look at what a caller can
actually *do*:
- `reportStorylineEvent`: only *write* telemetry rows (≤300 per request,
  every field coerced to a safe type) and fire an email **only** for a
  hard-coded list of event names. Nothing is readable. `storyline_events`
  denies all client writes in the rules — the function is the only writer.
  Worst-case abuse = junk rows in one collection and some emails to the ops
  inbox; both are trivial to filter/clean, and a shared token or App Check
  can be bolted on later if it ever matters.
- `getStorylineLiveContent`: only *returns* the scripted wording of one
  **published Live** exam, addressed by a random ~20-char version id that
  only exists inside that exam's own gated zip. No candidate data, no
  secrets, no media URLs. Backup/Practice exports can't call it at all.
- `getStorylineSyncData`: shared-secret header, WP-cron only.

**"So Firebase is now a single point of failure for running a test."**
No. The uploaded test is fully static with its media bundled and runs with
**no network at all** once the page has loaded. `getStorylineLiveContent`
is called once at boot for Live versions, has its own timeout, and on any
failure the player silently uses the bundled `version.json` — the test
proceeds normally. `reportStorylineEvent` is fire-and-forget and never
blocks or changes anything. Firebase being down mid-test = no telemetry for
that session, full stop.

**"Candidate names are leaving our environment."**
The centre / examiner / candidate names that reach Firestore come from the
launch URL and are stored only in `storyline_events`, admin-read-only. It's
the same identity data the RaterSystem side already holds for the rater
programme. If that's still a concern for Tim, the telemetry context can be
cut back to a centre code / test id instead of names — that's a config
change to `telemetry.ts`, not a rebuild. Worth deciding explicitly.

**"We can't see the code running on Google's servers."**
It's `functions/index.js` in the same repo — plain, readable, ~40 lines per
Storyline function, deployed from that repo. Nothing obfuscated or hosted
out of view.

**"Why not a PHP script on our server, like the old system?"**
Because the telemetry and live-text features have to reach the RaterSystem
database (Firestore), which the WordPress box has no connection to. A PHP
script there would need Firebase admin credentials embedded in it — strictly
worse. The Cloud Function *is* the controlled boundary between the two
systems. Also: the old player had **zero** server-side capability — no
telemetry, no live updates — so this is new function, not a swap for
something PHP used to do. The one place the new player *does* call old PHP
(`sendStats.php` / `rejectTest.php`) is kept precisely so existing WP-side
emails keep working.

**"Blast radius if a function misbehaves?"**
Each runs with the project's Admin SDK, so in principle broad — but the code
paths are narrow: `storyline_events` (write) and a read of a handful of
`storyline_*` / `config/storyline` docs. They never touch scores,
certificates, people, or anything in the WordPress database.

**"Cost / DoS."**
Per-invocation billing, and these are tiny functions. A flood costs pennies
and trips Firebase's own quotas before it affects anything. App Check or a
lightweight shared token can be added if it's ever a real risk.
