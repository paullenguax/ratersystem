# Benchmark Check  *(admin)*

The admin screen for the ICAO screener test at `lenguax.com/benchmark/`.
It has five tabs.

## Results

Every completed Benchmark attempt, with: candidate, training centre, form
(A or B), the level the candidate gave themselves (**Self-reported**), the
indicative **Level** and **Score**, how many items they flagged, and the
date.

- Click the chevron on a row to see the candidate's email and every answer
  they gave.
- **Linked person**: search People to attach the result to someone in the
  system.
- The bin icon deletes a result (you're asked to confirm).

## Item analysis

How each item has performed in real attempts. Use it to find bad items.

- Filter by form (**Both forms / Form A / Form B**). Sort by item ID,
  **Hardest first**, or **Most flagged first**.
- Columns: how many candidates saw the item (**N**), how many got it right
  (**Correct** and **% correct**), how many flagged it, and their
  **Flag comments**.
- After you fix an item that candidates flagged, click **Mark corrected**. The
  **Since correction** column then counts only the attempts made after the
  fix, so you can see whether the change worked.

## Item bank

The questions themselves. **New item** creates one. Open an existing item
from its row to edit it. The **Active / Inactive** button on a row switches
an item on or off. In the editor, **Previous / Next** step through the list without
going back to it. Each item has:

- the form, band (4/5/6), construct, and modality (*Reading* or
  *Listening*; choose Listening to attach audio and set **Max plays**)
- an optional **Stimulus / passage**, the **Question stem**, 2 or 4
  options, and the **Correct answer**
- **Feedback / explanation**, and **Notes** for revision history
- **Active** (in use) and **Pilot (unscored field-test item)**. Pilot items are trial items shown to
  candidates but not scored. A **Pair key** groups related minimal-pair
  items so a candidate sees at most one per sitting.

Above the list, a coverage summary and **Answer key balance** show whether
the correct answers are spread evenly across A/B/C/D.

## Sections

The order candidates meet items in. Each section sets which items belong to
it (by modality, construct and band) and the transition text shown before
it. Use the arrows to reorder sections, the bin to remove one, and **Add
section** for a new one. **Pilot items per sitting** sets how many trial
items are mixed in. Click **Save changes** when you're done.

## Centres

Training centres that send candidates. **New centre** creates a shared
login (name, short ID, email and password) plus a tagged link. Each centre
then sees only its own trainees' results at
`lenguax.com/benchmark/centre`. Deleting a centre stops its link working.

## Good to know

The Benchmark test runs on a **separate Firebase project**. This page signs
your admin identity across every time it loads. If something briefly fails
right after opening, wait a second and refresh.
