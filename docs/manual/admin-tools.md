# Admin tools  *(admin)*

The **Admin** tab groups the setup and one‑off jobs.

## Canvas

- **Canvas Sync** — run at the **start of every course**. Matches the
  Canvas course roster to People records (by email, with a fuzzy name
  fallback) and creates records for anyone new. This is how a Canvas user
  gets a People record before they can sign in.
- **Canvas Enroll** — the manual enrolment wizard for adding someone to a
  Canvas course from here.
- **Canvas Audit** / **Enrollment Log** — history of enrolment activity
  (WooCommerce purchases, the wizard, and bulk sync all land in one log).

Course and section naming follows a convention (a course clone per year, a
section per cohort) — keep to it or Canvas Sync and self‑serve entry can
misfire.

## Marking setup

- **Auto‑assign Tests** — balanced test assignment across the raters in a
  session, avoiding repeats.
- **Import Rasch Results** — paste a Facets `.out` file to load rater
  measures and the Wright map for Statistics and Reports.
- **Import Historical Scores** — one‑off bulk import of older results.

## Assets and content

- **Cert Assets** — per certificate type: upload a new template image, a
  display image, or the source artwork. Changes apply to new certificates
  and the public validation page immediately.
- **Pronunciation** — admin for the pronunciation tool at
  `lenguax.com/pronunciation/`.

## Good to know

Migration tools (import raters / tests / historical scores) are mostly done
with; they're kept for the occasional backfill, not day‑to‑day use.
