# Admin tools  *(admin)*

The **Admin** tab groups setup tools and one-off jobs. Each tile opens its
own page.

## Canvas

- **Canvas Sync**: run this at the **start of every course**. It compares
  the Canvas course roster with People, matching on Canvas account first
  and then email. For each Canvas user it shows whether they're already set
  up ("Canvas login ready") or **Not in system**. From there you can add new
  people (choosing their role) or link existing ones, then apply the
  changes. This is how a Canvas user gets a People record before they can
  sign in. The page's settings panel also holds the Canvas API token, the
  **notification email** that receives "scores confirmed" alerts, and the
  list of Canvas courses the system works with. Add each year's new course
  there.
- **Enrol in Canvas**: a wizard for adding someone to a Canvas course
  section. It looks up existing accounts, warns about duplicates, and can
  move someone from a previous section.
- **Enrolment Log**: one log of every Canvas enrolment, whether from a
  WooCommerce purchase or the wizard. It flags probable duplicates and
  name-matched accounts for you to check.
- **Canvas Audit**: health checks. It scans for probable duplicate Canvas
  accounts, and for students enrolled in more than one section of the same
  course.

Course and section naming follows a convention: one course clone per year
and one section per cohort. Stick to it, or Canvas Sync and self-serve
entry can go wrong. Give each section an **end date** once its cohort
finishes. Sections that ended more than a week ago are hidden from the
pickers.

## Marking

- **Auto-assign Tests**: builds balanced exam sets for a whole cohort. See
  **Assignments → Creating assignments**.
- **Practice Sessions**: live in-class scoring exercises. See **Practice
  Sessions**.
- **Import Historical Scores**: fills in scores for people the original
  migration missed, from a scores CSV and a rater-number-to-name list. It
  only matches people who already exist and never creates new ones.

The Rasch analysis isn't here any more. It's run from the **Reports**
page (and viewed live on **Statistics**).

## Assets and content

- **Certificate Assets**: for each certificate type, upload a new template
  image, display image or source (PSD) artwork. New certificates and the
  public validation page use the change straight away.
- **Pronunciation Tool**: admin for the pronunciation charts at
  `lenguax.com/pronunciation/`. It manages each language's status, checks
  storage for missing audio files, and generates voice-actor scripts.
