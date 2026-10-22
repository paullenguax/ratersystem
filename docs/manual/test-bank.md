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

A test that moves to another pool takes the **next number in that pool**
(S3 moved to Training becomes, say, T13). Its scores, courses and notes
follow it, because they're linked to the test, not the number. Moving a test
**into Certification** is deliberately a one-at-a-time job: open the test,
click **Edit**, and change its **Category**.

## Reading the table

- **Level**: the level an average rater would give this recording,
  calibrated by the Rasch analysis. **⚠ disagree** means raters vary on it
  more than expected. Click the level to see every rater's scores. A dash
  means it hasn't been calibrated yet (calibration is saved from
  **Statistics → Tests**).
- **Course**: for Training audio, the course set it belongs to: **Rater
  Course · Day 3** and/or **RC2**. Faint italic text is an old tag from
  before Courses existed. It's only a hint for sorting tests into pools.
- **Pool**: **Excluded** means **Auto-assign** and self-serve never pick
  this test, even if it's Certification.
- **▶** plays the audio. **Scores** shows everyone's scores for the
  recording. **Edit** opens the test.

Filters: search (candidate or nationality), test type, status
(Active / Retired), pool status, and **Course set** (a Rater Course day, an
RC set, or **Not in any course set**, which is handy when picking audio for
a new RC set).

## Working on several tests at once

Tick the rows (or the header box to tick everything shown). A bar appears:

- **Move to: Training / Standardization**. It asks you to confirm, then
  renumbers the tests in their new pool.
- **Tag: RC set…** puts the ticked Training tests in a refresher set (type
  the number, e.g. 6). Leave it blank to take them out of any RC set.
- **Tag: Rater Course day…** puts them on a day of the Initial Rater Course
  (1–5). Leave it blank to take them out of the Rater Course set.
- **Clear** unticks everything.

Only Training tests can be in a course set; any others ticked are left
alone. Tagging changes the *set*. To pass it on to courses, use **Re-sync
from sets** on **Courses**.

## Adding or editing a test

**Add test** (or **Edit** on a row) opens the form:

- **Recording**: paste a URL or upload the audio file.
- **Candidate name, Nationality, Test type.**
- **Status**: *Retired* tests stay on record but aren't assigned any more.
- **Category**: the pool (see above).
- **Initial Rater Course day** and **Refresher set** (Training tests only):
  which course set the recording belongs to. A recording can be in both.
- **Test number**: leave it blank for Standardization or Training tests and
  the next number is filled in. If you change the **Category**, the number
  clears and the test takes the next number in its new pool when you save.
  Switch back to restore the old one. The system blocks a duplicate number
  within the same pool.
- **Exclude from rater course pool**: keeps a Certification test out of
  exams without moving it.
- **Notes**: for admins only. Trainers don't see them.
- **Teaching notes** (Training tests only): what to point out to the class
  about this recording. Trainers see them in the teaching view and can edit
  them there too. Write a time as **m:ss** (e.g. *0:42*) and it becomes a
  button that jumps to that point.

For Training tests, the form also shows **Heard on courses**: which course
runs played it.

## Good to know

The TEAC speaking-test audio (Storyline replacement) is **not** here. It
has its own content system under **Test Versions**.
