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
- **Unmixable Themes** — tag Part 1 and Part 4 content with a theme and mark
  theme pairs that must not appear together for one candidate.
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
