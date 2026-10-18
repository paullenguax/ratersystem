# Assignments  *(admin)*

An assignment is one unit of marking work: **one rater + one event + a set
of tests**. This is where you set marking up, track it, review it and
publish it.

## The list

Each row shows the event, the rater, how many tests they have, the status
and any notes. Labels next to the name: **SR** means a senior rater, and
amber **self-serve** means the trainee created the assignment themselves
through the exam link.

Filters: **Hide published**, **Senior raters only**, and the type
(**Certification** or **Standardization**).

Buttons on each row:

- **Publish**: see below. Only on Certification assignments that aren't
  published yet.
- **Issue another set**: only on self-serve assignments that are confirmed
  or published. It gives the trainee a fresh set of 4 tests they haven't
  heard, for a resit. Their self-serve link then opens the new set.
- **View**: the score review page.
- **Edit**: change the tests, status or notes.

## Creating assignments

There are four ways:

- **Self-serve** (most exams): a trainee using `/take-test` gets a 4-test
  Certification set built automatically. You don't need to do anything.
- **New assignment**: pick the **Assignment type** (Certification or
  Standardization), an open **Event**, the **Rater**, and tick the **Tests**.
  Tests the rater has already scored are hidden, so you don't repeat one by
  accident. The type can't be changed afterwards. If you edit an assignment
  and untick every test, the assignment is deleted.
- **Auto-assign** (**Admin → Auto-assign Tests**), for building a whole
  cohort's sets in one go:
  1. Pick the **Session**, the number of **Tests per rater**, and the
     raters.
  2. Click **Generate preview**. Each rater gets one well-calibrated
     **anchor** test (returnees get one they've heard before), a spread of
     easy, mid and hard recordings, and as little overlap with the rest of
     the cohort as possible.
  3. **Reshuffle** if you don't like the result, then click **Create
     assignments**.
- **Quick entry**, for typing in scores someone gave on paper or by email:
  pick the rater and event, choose each test and enter its six scores. This
  creates the assignment and its scores in one go, already **submitted**
  and **unpublished**.

## Status vs confirmed

These are two different things:

- **Submitted** status: every test has a score. This does *not* mean the
  rater has finished. They can still change their answers.
- **Confirmed**: the rater has clicked **Yes, that's my scores** on their
  review screen. Only then is the assignment really done, and only then are
  you emailed.

Wait for **confirmed**, not just submitted.

## Reviewing (View)

**View** opens a per-test breakdown: the rater's six scores and overall for
each test, next to the **mean of all raters** for that recording. The
chevron on a row shows each senior rater's score for comparison. For
standardization tests, it shows everyone who scored it.

While an assignment is still **pending**, a test with no score yet can be
removed with **✕**.

## Publishing

For Certification assignments, **Publish** makes the scores official. They
join the main pool that **Scores**, **Statistics** and future Rasch
analyses count as established. It **can't be undone**, so do it after
you've sent the feedback (**Reports**).

Standardization assignments have no publish step. Their scores
count as soon as they're saved, so the button doesn't appear.
