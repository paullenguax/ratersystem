# Test Versions  *(admin)*

The authoring system for the **TEAC speaking test** — the examiner script,
the audio, the images and the candidate‑screen content. It replaces the old
Articulate Storyline files. It produces a self‑contained player (an examiner
console + a candidate window) that gets uploaded to a test centre.

## The pieces

Open **Test Versions** to see the **Test Types** list (Airline Pilot,
Aerodrome ATC, FISO/AFISO, …). Along the top:

- **Script Template** — the one shared examiner script, slide by slide:
  the fixed wording, the pre‑test screens (accept/reject, confirm data,
  room‑setup checklist), Part 1–4 structure, timers. Every test type uses
  this same template.
- **Parts Library** — the pooled content for Parts 1–4 (topics, question
  lists, recordings, images). Parts are shared across test types, not tied
  to one.
- **Unmixable Themes** — a topic-clash safeguard for Part 1 vs Part 4. See
  its own section below.
- **Test activity** — see below.

A **Version** (e.g. "Airline 020") is one assembled test: the template +
that test's whole‑test content + four chosen Parts.

## Writing the script

In the Script Template, the **Script text** box on each slide is what the
interlocutor reads aloud — it shows in **royal‑blue italic** in the player.

- `{Test Number}`, `{Centre Name}`, `{Candidate Name}`, `{Examiner Name}` —
  filled from the booking at test time.
- `[role]` and similar `[single‑bracket]` tokens — filled per test type.
- `{questions}` / `{topic}` — where a Version's question list / topic is
  slotted in.
- **`[[ double brackets ]]`** — a *stage direction*: something for the
  interlocutor to **do**, not say. It renders upright and black, with the
  brackets removed. Use it for lines like
  `[[ Invite the candidate into the room ]]`.

**Save the template** (button at the bottom) before exporting — exports use
the last saved version, not unsaved edits.

## Publishing and exporting a Version

Published Versions are **immutable** — their content is frozen at the moment
you publish. So to get a template or content change into a Version:

1. **Duplicate** the Version → you get a new draft.
2. **Preview** the draft to check it (a draft's preview resolves live from
   the current template).
3. **Publish** the draft — this is the step that re‑reads the template and
   freezes the new content into the Version.
4. **Export** — download the zip. Check `version.json` inside if you want to
   confirm a change landed.
5. Upload the zip to the test centre (see the `HOW‑TO‑ACTIVATE.txt` in the
   zip), then **Archive** the old Version.
6. An archived Version can be **Deleted** (a two‑step guard: archive first,
   then delete) once you're sure it's not needed.

## Version types

Set on each Version (metadata — changeable any time):

- **Live** — a real exam. Text edits to the template/Parts flow to
  already‑deployed Live exams automatically, without re‑exporting. (Other
  changes — layout, styling — still need a re‑export.)
- **Backup** — a frozen, offline‑resilient fallback copy. Can draw on
  Parts flagged as backup/reserve. Everything is baked in; any change needs
  a re‑export.
- **Practice** — an ungated sample for people to try. Exported through a
  separate, simpler player (no booking gate). Practice runs are never
  recorded.

Live and Backup always ship fully gated (the examiner can't skip the
audio/checklist confirmations). Practice defaults to ungated.

## Unmixable Themes

A safeguard so a candidate doesn't end up discussing basically the same
subject in **Part 1** and again in **Part 4**. It has two halves, both on the
**Unmixable Themes** page:

1. **Themes** — a plain list of subject labels you type in
   (`Weather`, `Radio Communications`, `Ground Operations`, …). One shared
   list, used for both Part 1 and Part 4.
2. **Unmixable pairs** — rows that say "if a candidate's Part 1 has theme X,
   their Part 4 must not have theme Y". To forbid the same subject twice, add
   a pair with the same theme on both sides (X ≠ X).

You then tag each Part 1 and Part 4 with a theme using the dropdown on each
row in the **Parts Library**.

### It is *not* the same as the Part 4 topic

The **`{topic}`** you set on a Version (the words the interlocutor actually
says — "…some questions about *Effective Radio Communications*") and a Part's
**theme** are separate fields. The theme is a coarse category for the
clash-check; the topic is the exact wording the candidate hears. You set both
by hand — nothing reads the topic text and works out a theme from it. In
practice you'd give a radio-comms Part 4 the topic
"Effective Radio Communications" *and* tag it with the theme
"Radio Communications".

### What it does today

Right now this is **setup for a mechanism that isn't switched on yet**:

- The themes and rules are saved, and they sync to the WordPress side, but
  the part that actually *acts* on them — refusing to hand a candidate a
  clashing Part 1 + Part 4 — is the automatic per-candidate Part selection
  that's still to be built.
- It only ever applies to that automatic selection. **Hand-assembled
  Versions get no theme checking** — the Part picker filters by test type
  only and won't warn you if you pick a clashing pair yourself.

So it's worth populating the vocabulary and tagging Parts if you're heading
towards automatic Part pooling, but it changes nothing a candidate sees today.

## Test activity

**Test activity** (top of the Test Types page) shows the telemetry stream
the exported player sends back: session start, every slide viewed, every
audio play, the candidate window opening/closing, connectivity drops,
accept/reject/finish. Filter by event or free text, or switch to
**group by test run** to see one sitting's whole timeline.

The same page has the **violation email** settings: an **ops** address
(gets an email for the events worth flagging, including "a test finished")
and a **compliance** address (gets the two integrity events —
audio replayed past its limit, candidate window closed mid‑test). Leave an
address blank to send nothing there.
