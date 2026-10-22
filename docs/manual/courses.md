# Courses  *(trainers)*

A record of every Initial Rater Course and Refresher Course run: **who
attended**, **which audio was played**, and the **materials** trainers use.
Anyone on a course counts as having heard all of its audio. That lets you
pick recordings a new group hasn't heard before.

You see this tab if you're an admin, or if **Trainer** is ticked on your
People record. Running a session is covered in **Teaching a course**.

## How courses and audio fit together

- A **set** is a fixed list of recordings. The **Rater Course set** is the
  Training audio tagged with a day (1–5) in **Test Bank**. Each **RC set**
  (RC1, RC2…) is the Training audio tagged with that refresher number.
- A **course** is one run of a set for one group, on one date. RC1 has been
  run many times, and each run is its own course.
- A new course starts with a copy of its set. You can add or remove
  recordings for that course only.

## The course list

- **Tabs** along the top: **All**, **Initial**, and one per RC set, each
  with a count.
- **Find a person or course**: type a name to see every course that person
  was on, with their name shown under each course. It searches the tab
  you're on, so use **All** for someone's full history.
- The list is in three parts:
  - **Coming up**: running now or starting later, soonest first. A course
    only appears here if it has a start date.
  - **Recent**: the 3 most recently finished.
  - **Earlier**: everything else, folded. Click to open.
- The **Audio** column shows **none** in amber for a course with no
  recordings yet.
- **Teach** on a row opens the teaching view. Click anywhere else on the row
  to open the course page.

Along the top:

- **+ Rater course** / **+ Refresher course** create a new run. Fill in:
  - the **Start date** and **End date**
  - for refreshers, the **Refresher set** (RC number) this run delivers.
    The newest set is suggested.
  - the **Name**, or leave it blank for one like *Refresher Course 3 —
    June 2025*
  - the **Trainers**: anyone with the Trainer tick
  - **Notes**, if needed
- **Materials & documents**: see *Materials* below.
- **Import past courses**: see the end of this page.
- **Re-sync from sets** copies a set's current recordings into its courses:
  1. Choose the **Set**: Initial Rater Course or an RC set.
  2. Leave **Only courses starting on or after** blank to update every
     course of that set, or pick a date (see below).
  3. Check the preview: how many courses will be updated, how many already
     match, and any **skipped** because a trainer added or removed audio on
     them by hand. Use **Update from set** on those individually if you want
     the set there too.
  4. Click **Update**.

  Use it while you're tagging a set in Test Bank: tag Day 1, re-sync, tag
  Day 2, re-sync again. Once a set is settled, **always fill in the date**
  when you change it. Otherwise past courses would be credited with
  recordings they never heard.

## A course page

**Edit** changes the course's details or deletes it. **Teach** opens the
teaching view.

### Attendees

- **Link a Canvas section…** pulls in every student from that section and
  matches them to People records. Each linked section then has its own
  button for pulling it again, which picks up late enrolments. Sections
  that ended more than a week ago aren't listed, so add those attendees by
  hand.
- **Add a person by name or email**: pick from People, or type a name for
  someone who has no People record. They're tracked by name only and marked
  **not in People**.
- **✕** removes an attendee.

### Audio

- The course's recordings, grouped by day for a rater course. **▶** plays
  one and **✕** removes it from this course.
- **Update from set** copies the current set in again, replacing any
  changes made for this course.
- **Add audio** adds a recording for this course only. Search the Training
  pool; two filters are on by default:
  - **New to everyone on this course** hides anything an attendee has
    already heard on another course, so add the attendees first.
  - **Hide audio already in a course set** hides recordings that belong to
    a set.

  A **heard by N** label shows how many attendees have heard a recording.
  Hover it to see who.
- Recordings you add show **added for this run**. Adding or removing audio
  by hand also means **Re-sync from sets** leaves this course alone.

### Materials

This course's own files and notes, plus everything shared with its course
type (see below). **Add to: This course only** is for material that only
applies to this group.

## Materials & documents

Open it from the course list. It has three sections:

- **General documents**: documents that stand on their own, such as the
  rater documents.
- **Rater courses**: shown on every rater course.
- **Refresher courses**: shown on every refresher course.

In any section:

- **Upload files** for PDFs, slides and so on. Several at once is fine.
- **New note** opens a written note with a live preview (see *Writing
  notes* below).
- **Import .md** turns existing Markdown files into editable notes, one
  note per file.
- For rater-course material, pick the **day** before adding (*Any day* or
  Day 1–5). Each item's **Day** drop-down changes it afterwards, for example
  if a note was filed under the wrong day.
- **Make plan** turns a note into the **session plan** for its day (see
  **Teaching a course**). **Unset plan** turns it back into an ordinary
  note.
- The pencil renames an item and the bin deletes it.

### Showing a general document on courses

A general document isn't on any course until you say so. Click **Show in…**
on it and choose:

- **Rater courses: Any day**, or particular days (Day 1–5)
- **Refresher courses: All refreshers**

Click **Save**. Badges on the row show where it appears (*Rater · Day 2*,
*Refreshers*), or *Not on any course*. It stays a single document, so an
edit shows everywhere it appears. In the teaching view, every general
document is also listed at the bottom, whether or not it's shown on the
course.

### Writing notes

Notes use **Markdown**: `# Heading`, `**bold**`, `*italic*`, `- list`,
and tables. The editor shows a live preview beside the text.

- **Ctrl+S** or **Save** saves. You're warned before leaving with unsaved
  changes.
- **Print / PDF** opens a Lenguax-branded page with the logo, date and page
  numbers. Choose **Save as PDF** in the print dialog to get a PDF to send.
  (Page numbers appear in Chrome and Edge.)
- **.md** downloads the note as a Markdown file.
- The **Day** drop-down and the **Session plan** tick box save straight
  away.

## Importing past courses

1. Paste from a spreadsheet, including the header row, or upload a CSV.
   Use one row per attendee per course. Only the **name** and **course
   type** are required: "Initial", "RC3", "RC1 (2022) & RC2 (2023)",
   "Refresher 3"… A row naming two courses goes into both. Dates can be in
   most formats (*12th March 2025*, *19-Jun-26*, *12/03/2025*). Click
   **Read**.
2. Under **Columns**, check that each column has been recognised (a
   separate **Surname** column is fine), and change it if not.
3. Check the preview. Each set + date becomes one course. **Adds to
   existing course** means the rows join a course that's already recorded
   instead of creating a duplicate. **Notes** lists anything the importer
   had to guess, such as a date with no year (taken from the rows around
   it) or a blank course type, and any rows it skipped.
4. For each person, check who they've been matched to. A **Maybe:**
   suggestion is never linked unless you choose it. **Name only (not in
   People)** keeps them as a name.
5. Click **Import**. Running it again is safe: people already on a course
   aren't added twice. **Start again** clears the page.

Imported courses have no audio until their sets are tagged in Test Bank and
you use **Re-sync from sets**.

## Good to know

- Who has heard what is also shown elsewhere: **Heard on courses** on a
  Training test in **Test Bank**, and **Courses attended** on a person in
  **People**.
- Course audio always comes from the **Training** pool. It can never end
  up in an exam.
- A newly ticked **Trainer** who isn't an admin needs to sign out and back
  in once before they can upload files.
