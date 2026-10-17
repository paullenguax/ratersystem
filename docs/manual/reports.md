# Reports  *(admin)*

This is where you write the **feedback email** for a rater who has finished
the course, and issue their certificate. For one rater, the page puts these
in one place:

- their scores next to everyone else's for the same recordings,
- a ready-written paragraph about each candidate they scored,
- their Rasch statistics (how strict they are and how consistent they are),
  with a table and a chart you attach to the email,
- the outcome (pass, pass with an advisory, or not yet) and the certificate.

The email draft on the right builds itself as you go. You copy it into
Gmail or Outlook at the end.

> **Nothing on this page is saved** except the Rasch run (step 1) and any
> certificate you generate. If you switch to another event, rater or attempt,
> or leave the page, your edits to the email are lost. Finish one rater's
> email, send it, then move to the next.

---

## Before you start

You need:

1. **The rater's four scores entered.** It doesn't matter if they're
   unpublished. The page reads them straight from the event.
2. **Senior-rater scores for the same recordings.** Most recordings already
   have them. The candidate comments compare the rater against senior raters
   (and admins), not against other trainees. If a recording has no
   senior-rater scores, the comment falls back to comparing against everyone.
3. **A saved Rasch run that includes this event.** See step 1 below. Without
   one, the statistics boxes stay empty and the email shows placeholders such
   as `[MEASURE]`.

---

## Step 1: run the Rasch analysis

Rasch analysis is the statistical model that estimates each rater's
**strictness** ("Measure") and **consistency** ("Infit") from every score
in the system, taking into account that some recordings are harder than
others. You only need to do this **once per event**, not once per rater.

1. Click the **Rasch analysis** bar at the top of the page to open it.
2. Leave **Run analysis** selected. (The other option, *Import from
   Facets*, is explained further down. You won't usually need it.)
3. In the dropdown, pick **the event you're writing feedback for**.
   - If you've already chosen an event in the **Event** box below, it's
     picked here for you.
   - **Active** events still have unpublished scores. **Completed** events
     are fully published.
   - *Published scores only* leaves out every unpublished score. Don't use
     it for feedback, because the raters you're writing to won't be in it.
4. Click **Run analysis**. It runs in your browser and takes a few seconds.
   It uses **all published scores ever** plus **this event's scores**, so
   the new raters are compared against the whole history of raters.
5. Check the results that appear:
   - **Raters / Criteria / Reliability / RMSE**: a quick summary of the
     cohort. **Criteria** should be **6**, and the chips underneath should
     list the six ICAO criteria.
   - The grey status line: how many ratings were used, whether the run
     was **anchored to** a baseline (see *Statistics → Anchors*), and
     **converged in N iterations**. If it says **"did not converge — treat
     with caution"** in red, don't send feedback based on it. Ask for help.
   - An amber note about **score rows skipped because their rater has no
     permanent number** means some past raters were left out. Go to
     **Scores**, click **Assign numbers**, then come back and run again.
6. Click **Save as active run**. "Saved — this run is now active" appears.
   **Until you save, the rest of the page still uses the previous run.**

### What "active run" means

Only **one** run is active at a time, for everyone using the system: the
most recently saved one. Everything further down the page reads the active
run. If someone else analyses a different event and saves it after you, your
event's raters may no longer be in the active run. If the Measure boxes stop
filling in, run and save the analysis for your event again. Old runs are
kept, but you can't switch back to one.

### Import from Facets (optional)

This is only for when you've run the analysis in the Facets desktop program
yourself.

1. On **Scores**, set **Export includes:** to the event, then click
   **Export Rasch CSV** and **Facets spec**. Run these in Facets.
2. Back here, choose **Import from Facets**, paste the **whole `.out`
   file** into the box, and click **Parse file**. It reads Table 7 (rater
   measures) and Table 6 (Wright map).
3. Check the summary, then click **Save to Firestore** to make it the
   active run.

Facets imports don't include **criterion habits** or **unexpected
scores** (see step 4), so those boxes won't appear.

---

## Step 2: choose the event and rater

- **Event**: the course or cohort. Changing it clears everything below.
- **Rater**: everyone who has scores in that event.
- **Attempt**: this only appears if the rater **resat** (scored more than
  one set in the same event). *Set 1* is the first try, and the last one is
  marked *latest (resit)*. Each set is written up separately and has its own
  rater number in the Rasch run.
- **Refresher course**: tick this for refresher-course raters. The
  feedback link in the email then points to the refresher course page, and
  the certificate type defaults to *Refresher Certificate*.

---

## Step 3: check the score comparison

The **Score comparison** table has one row per candidate. Rows are labelled
**A, B, C, D** in the order the rater scored them, and the email uses the
same letters.

| Part of the table | What it shows |
|---|---|
| Left block (rater's name) | This rater's six criteria (PRO STR VOC FLU COM INT) and overall (OVL). Colours: green = 5+, blue = 4, amber = 3, red = 2 or below. |
| Right block (*All raters (mean)*) | The average of **every** score ever given to that recording, from any event. **n** is how many scores that is. |
| OVL average colour | **Amber** means this rater was more generous than average (by more than 0.3). **Blue** means stricter. |
| **›** chevron (far left) | Click it to show each **senior rater's** score for that recording. This rater's own row is highlighted. |
| **Average** row | The rater's means compared with everyone's. |

**Export senior scores** downloads those senior-rater scores as a CSV, in
case you want to send or check them. It's greyed out if no senior rater has
scored these recordings.

---

## Step 4: edit the candidate comments

Under **Candidate commentary** there's an editable paragraph per candidate.
Each one is written automatically by comparing the rater's **overall** score
with the **senior-rater average** for that recording:

| Difference from senior average | Wording |
|---|---|
| less than 0.3 | "closely in line with the general consensus" |
| 0.3 – 0.8 | "a little more generous / a little stricter" |
| 0.8 or more | "notably more generous / notably stricter", plus a sentence naming the criterion that caused it |

- **Type in the box** to rewrite a paragraph. Your text replaces the
  automatic one.
- **↺ Reset to auto** appears once you've edited a paragraph. It throws
  your edits away and restores the automatic text.
- **Hand-wave (skip criterion detail)**: tick this when a difference isn't
  worth dwelling on. It removes the "mainly driven by…" sentence, and it
  also leaves that candidate out of the summary line ("…although you were
  more generous than the average rater to Candidate B").

---

## Step 5: check the Rasch results

The **Rasch results** section fills itself in from the active run.

- **Rater number**: the rater's number **in this event's run**. A returning
  rater gets a **new** number for each event (e.g. 235 the first time, 412
  now), so this may differ from the number on their People record. Leave it
  as filled in unless you know it's wrong. Changing it looks up a different
  rater.
- **Measure (leniency)**: strictness. 0 is the average rater, positive is
  stricter, negative is more generous. The target is **between −1 and +1**.
  ✓/✗ shows whether they're inside the target.
- **Infit MnSq (reliability)**: consistency. 1.0 is ideal. The target is
  **0.7 – 1.3**. Above 1.3 means erratic scoring, below 0.7 means very
  uniform scoring.

These three boxes are what the email quotes. You can type over them. If a
box is left blank, the email shows a placeholder such as `[MEASURE]`.

**If Measure and Infit stay empty**, the rater isn't in the active run. Go
back to step 1, run the analysis **for this event**, and click **Save as
active run**.

Below that are extra figures **for you only**. They don't go into the email:

- **Outfit MnSq**, **Discrimination**, **PtMea / PtExp**: other signs of
  how the rater behaves. A red ✗ is worth a closer look. The **What do
  these stats mean?** section at the bottom of the page explains each one,
  and which combinations point to which kind of problem.
- **Criterion habits**: a criterion where the rater is consistently more
  generous or stricter than their overall pattern (e.g. always high on
  Pronunciation). Tick **Mention in email** to add a sentence about it.
- **Unexpected individual scores**: single scores the model found
  surprising, e.g. "Candidate C, Fluency: gave 6, expected about 4.1". These
  are useful to know about when you write the comments.

---

## Step 6: download the attachments

The email says "see attachment" and refers to a table and a chart, so attach
**both** of these:

- **Rater measurement table → Download PNG**: the rater's row from the
  Rasch table (in the Facets "Table 7" layout), with the cohort around it.
  If the score, count and average columns are blank, the run is an old one.
  Run the analysis again and save it.
- **Wright map → Download PNG**: a chart that places this rater among all
  the other raters, alongside the candidates and the criteria. For a
  returning rater (step 8), it also shows where they were last time.

---

## Step 7: choose the outcome and issue the certificate

**Outcome** sets the end of the email:

- **Certificate awarded**: "we are happy to award your certificate, with
  no real advisories".
- **Certificate with advisory**: a box appears. Type the advisory (e.g.
  "Please keep an eye on your Fluency scores, which tend to run high."), and
  it's added after "we are happy to award your certificate".
- **Not yet**: a box appears for the reason. The email says the certificate
  can't be awarded yet and drops the "certificate will follow /
  congratulations" lines.

Unless the outcome is *Not yet*, a **Certificate** panel appears:

- Any certificates this rater **already has** are listed at the top, with
  buttons to download each PDF or copy its links.
- **Certificate type** follows the *Refresher* tick, but you can change it,
  for example to an Interlocutor certificate.
- Fill in **Course date(s)** (e.g. "12–14 March 2026") and check the **Name
  on certificate**.
- Click **Generate certificate**. This gives you the certificate number and
  PIN, a **Download PDF** button, the **Validation URL** and, if you're
  signed in to Microsoft, a saved copy in SharePoint with a **shareable
  link**. If the rater already has a certificate for this event, the button
  says **Issue another certificate** and asks you to confirm first.

---

## Step 8: returning raters (if applicable)

Tick **Returning rater (has previous certification)** if the rater has been
certified with us before.

- **Previous rater number** is suggested from their People record.
- **Previous measure** fills in from the active run when that number is in
  it. Otherwise, type it in.

The email then gains a sentence giving their old measure and saying whether
they are now **more severe**, **less severe** or **similarly severe**
(a change of more than 0.3 counts). The Wright map shows both positions.

---

## Step 9: copy and send the email

The **Email draft** on the right can't be typed in. It updates live from
everything on the left, so make changes there.

1. Read it through. **Search for `[` before sending.** Anything still in
   square brackets, such as `[MEASURE]`, `[RATER NUMBER]` or
   `[ADVISORY DETAIL]`, is a gap you haven't filled in.
2. Click **Copy to clipboard**.
3. Paste it into a new email in Gmail or Outlook. The links stay
   clickable.
4. Attach the two PNGs from step 6 (and the certificate PDF if you're
   sending it now. The email says "the certificate will follow
   separately").
5. Add your name or signature under "Best wishes" and send.

### What the email says, in order

Greeting → one paragraph per candidate (A, B, C, D) → an overall summary
line → *(criterion habit, if ticked)* → an explanation of the Rasch table
quoting their rater number, measure and whether it's inside ±1 → a note on
the Wright map → their Infit figure and whether it's inside 0.7–1.3 → the
outcome → *(congratulations, unless Not yet)* → *(returning-rater
comparison, if ticked)* → requests for a public review and private feedback.

---

## Quick checklist

1. Open **Rasch analysis**, pick the event, **Run analysis**, then **Save as
   active run** (once per event).
2. Pick the **Event**, the **Rater** and, if the rater resat, the
   **Attempt**. Tick **Refresher** if needed.
3. Look over the score table, and edit or hand-wave the candidate
   comments.
4. Check that Measure and Infit filled in. Tick *Mention in email* for
   habits if you want them included.
5. Download the **table PNG** and the **Wright map PNG**.
6. Set the **Outcome** and generate the **certificate**.
7. Tick **Returning rater** if it applies.
8. Check for `[` gaps, **Copy to clipboard**, paste, attach, sign and send.
