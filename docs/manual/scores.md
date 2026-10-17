# Scores  *(admin)*

Every rater-course (Certification) score in the system, published and
unpublished. This is where you look scores up, fix one, assign rater
numbers, and export data for Facets.

## The table

Each row is one rater's score for one test: the event, the rater, the test,
the six criteria, the overall level (OVL) and a status of **Published** or
**Unpublished**.

- **Search** by rater, candidate or event. Click a heading to sort by it.
- The counter on the right shows how many rows match and how many are
  published.
- **Edit** appears on unpublished scores only. Published scores are
  locked.
- **Add score** records a single score by hand against an existing
  assignment. For a whole set, **Assignments → Quick entry** is faster.

## Assign numbers

Every rater needs a **permanent rater number** to be included in the Rasch
analysis. If anyone with published scores doesn't have one yet, an
**Assign numbers (N)** button appears. Click it to give each of them the
next free number. Do this after each round of publishing.

Raters who are in the current event but not yet published don't need
numbers. The analysis gives them temporary ones.

## Exporting for Facets

These exports are only needed if you run the analysis in the Facets
desktop program. **Reports** can run the same analysis in the browser.

1. Set **Export includes:** to *Published scores only*, or to an event
   (*"… (+ unpublished)"*) to add that event's unpublished scores.
2. **Export Rasch CSV** downloads the data file.
3. **Facets spec** downloads a matching Facets specification file.

## Good to know

Standardization scores aren't here. They're in **Standardization
Results**.
