# Test Bank  *(admin)*

Every candidate recording the system knows about, with its details and
audio.

## The three pools

Every test belongs to exactly one pool. The pool decides where a recording
may be used. The buttons along the top (**All / Certification /
Standardization / Training**) switch between them.

| Pool | Numbered | Used for |
|---|---|---|
| **Certification** | 1, 2, 3… | **Exams only.** These are the only recordings that end-of-course exams (self-serve or Auto-assign) can hand out. Keep them unheard before the exam. |
| **Standardization** | S1, S2… | Standardization exercises (the **Standardization** pipeline). |
| **Training** | T1, T2… | Audio played on courses, and the only pool offered in **Practice Sessions**. It can never reach an exam. |

Moving a test into Standardization or Training gives it the next number in that
pool. Moving a test **into Certification** is deliberately a one-at-a-time
job: open the test, click **Edit**, and change its **Category**.

## Reading the table

- **Level**: the level an average rater would give this recording,
  calibrated by the Rasch analysis. **⚠ disagree** means raters vary on it
  more than expected. Click the level to see every rater's scores. A dash
  means it hasn't been calibrated yet (calibration is saved from
  **Statistics → Tests**).
- **Course**: for Training audio, the day of the Initial Rater Course it's
  played on (**Rater Course · Day 3**). Faint italic text is an old tag
  from before Courses existed. It's only a hint for sorting tests into
  pools.
- **Pool**: **Excluded** means **Auto-assign** and self-serve never pick
  this test, even if it's Certification.
- **▶** plays the audio. **Scores** shows everyone's scores for the
  recording. **Edit** opens the test.

Filters: search (candidate or nationality), test type, status
(Active / Retired), pool status, and Rater Course day.

## Moving several tests at once

Tick the rows (or the header box to tick everything shown). A bar appears:
**Move to: Training / Standardization**. It asks you to confirm, then renumbers
the tests in their new pool. **Clear** unticks everything.

## Adding or editing a test

**Add test** (or **Edit** on a row) opens the form:

- **Recording**: paste a URL or upload the audio file.
- **Candidate name, Nationality, Test type.**
- **Status**: *Retired* tests stay on record but aren't assigned any more.
- **Category**: the pool (see above).
- **Initial Rater Course day**: for Training tests only. This marks a
  recording as part of the fixed Initial Rater Course audio set. Refresher
  audio isn't tagged here. It's chosen for each refresher run on
  **Courses**.
- **Test number**: leave it blank for Standardization or Training tests and the
  next number is filled in. The system blocks a duplicate number within the
  same pool.
- **Exclude from rater course pool**: keeps a Certification test out of
  exams without moving it.
- **Notes.**

For Training tests, the form also shows **Heard on courses**: which course
runs played it.

## Good to know

The TEAC speaking-test audio (Storyline replacement) is **not** here. It
has its own content system under **Test Versions**.
