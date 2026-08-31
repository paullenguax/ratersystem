# Part 1 / Part 4 themes — proposal

Worked out from the questions in `Part 1s (for Ed 2).xlsx`, `Part 4s.xlsx`
(Ed 1) and `Part 4s (for Ed 2).xlsx` — 329 part instances across 11 role
sheets. This is a **proposal for you to adjust**, not a final answer;
theme granularity is a judgement call.

## How the spreadsheets are laid out

Each role sheet has one column per part instance: a **version code**
(`001-A-1-001`, `A-4-005`), a **Topic** label, and the questions. The same
Topic label is reused across roles, so there are only ~28 distinct
`(part, topic)` combinations even though there are 329 instances.

Key finding: **the Part 1 "Topic" labels are accurate to the discussion
questions in almost every case** — the one real exception is
`"That role's procedures"` (see divergences below). The Part 4 labels are
all accurate. So this is mostly a *consolidation* job (merging near-duplicate
labels into broader themes), not a re-reading.

---

## Recommended theme vocabulary

15 themes. "Used by" shows whether the theme ever appears in Part 1, Part 4,
or both — only **both**-themes can ever produce an unmixable clash.

| # | Theme | Used by | Consolidates these spreadsheet Topic labels |
|---|---|---|---|
| 1 | **ATC Communication** | P1 | Communicating with ATC · Communicating with Pilots *(same theme, pilot-side vs controller-side wording)* |
| 2 | **Clearances** | P1 | Clearance procedures |
| 3 | **Airport Signs & Taxiing** | P1 | "That role's procedures" *(mislabelled — see divergences)* |
| 4 | **Pre-flight Checks** | P1 | Pre-flight procedures |
| 5 | **Navigation & Equipment** | P1 + **P4** | Navigation aids · Navigation procedures *(P1)* — Technology *(P4)* |
| 6 | **Weather** | P1 | Effect of Bad Weather · Effect of Bad Weather 2 · Effect of Bad Weather 3 *(clouds / rain / general — one theme)* |
| 7 | **Flight Routes & Deviations** | P1 | Flight Routes (and Deviations) |
| 8 | **Separation & Traffic Safety** | P1 + **P4** | Aircraft Separation · Safety Monitoring procedures *(P1)* — Airspace Infringements · Traffic Movements · Aerodrome Dangers *(P4)* |
| 9 | **Delays & Disruptions** | P1 | Managing Delays & Disruptions |
| 10 | **Aerodrome Ground Operations** | P1 | Aerodrome Ground Ops *(only 2 codes — small)* |
| 11 | **Contingencies & Unexpected Events** | P1 + **P4** | Contingency procedures *(P1)* — Managing Unexpected Events · Emergency Actions *(P4)* |
| 12 | **Emergencies & Fire** | P4 | Emergency Training · Fire |
| 13 | **Medical & Fitness to Operate** | P4 | Passenger Health Emergencies · Health of Aviation Personnel |
| 14 | **Human Performance & CRM** | P4 | Maintaining Focus / Concentration |
| 15 | **Environmental Impact** | P4 | Effects on the Environment |

### Optional finer splits

- **Fire** out of #12 if you want to guarantee a candidate never gets Fire
  in Part 4 twice / near a fire-related Part 1 (there isn't one, so probably
  not worth it).
- **Airspace Infringements** and **Traffic Movements** out of #8 as their own
  themes if #8 ends up too broad in practice.

---

## Part 1 — topic → theme

| Spreadsheet Topic | # codes | → Theme |
|---|---|---|
| Communicating with ATC | 6 | ATC Communication |
| Communicating with Pilots | 5 | ATC Communication |
| Clearance procedures | 10 | Clearances |
| That role's procedures | 11 | **Airport Signs & Taxiing** *(relabel)* |
| Pre-flight procedures | 7 | Pre-flight Checks |
| Navigation aids | 4 | Navigation & Equipment |
| Navigation procedures | 3 | Navigation & Equipment |
| Effect of Bad Weather (+ 2, + 3) | 11 + 7 + 4 | Weather |
| Flight Routes (and Deviations) | 7 | Flight Routes & Deviations |
| Aircraft Separation | 9 | Separation & Traffic Safety |
| Safety Monitoring procedures | 7 | Separation & Traffic Safety |
| Managing Delays & Disruptions | 8 | Delays & Disruptions |
| Aerodrome Ground Ops | 2 | Aerodrome Ground Operations |
| Contingency procedures | 7 | Contingencies & Unexpected Events |

## Part 4 — topic → theme  *(Ed 1 = the first 8; Ed 2 adds the last 4)*

| Spreadsheet Topic | Ed | → Theme |
|---|---|---|
| Emergency Training | 1 + 2 | Emergencies & Fire |
| Fire | 1 + 2 | Emergencies & Fire |
| Emergency Actions | 1 + 2 | Contingencies & Unexpected Events |
| Managing Unexpected Events | 1 + 2 | Contingencies & Unexpected Events |
| Passenger Health Emergencies | 1 + 2 | Medical & Fitness to Operate |
| Health of Aviation Personnel | 1 + 2 | Medical & Fitness to Operate |
| Maintaining Focus / Concentration | 1 + 2 | Human Performance & CRM |
| Aerodrome Dangers | 1 + 2 | Separation & Traffic Safety |
| Technology | 2 only | Navigation & Equipment |
| Airspace Infringements | 2 only | Separation & Traffic Safety |
| Traffic Movements | 2 only | Separation & Traffic Safety *(but see divergence — it's half about delays)* |
| Effects on the Environment | 2 only | Environmental Impact |

---

## Label vs content — things to know

1. **`"That role's procedures"` (Part 1) is a positional label — content
   varies by role.** For **9 of the 11 roles** (`002-*-1-002`) it's built on
   a taxiway-signage image and Q2–Q5 are all reading signs / safe taxiing
   (*"rely on signs like this"*, *"ensure safe taxiing"*, *"read airport
   signs accurately"*) → **Airport Signs & Taxiing**. But the same slot for
   the two en-route/approach controller roles is a different subject
   entirely:
   - **APP ATC `013-F-1-002`** — safe *approaches*, being too high on
     descent, aircraft performance → **Separation & Traffic Safety**.
   - **AREA ATC `015-G-1-002`** — *en-route* safety, wrong flight level,
     cruise phase, managing traffic → **Separation & Traffic Safety**.
   (Alternative for those two: **Flight Routes & Deviations**.)
   Every other Part 1 topic was checked and only varies in *wording* across
   roles, not subject — this is the only one that splits.

2. **`"Communicating with ATC"` and `"Communicating with Pilots"` are one
   theme.** They're the pilot-facing and controller-facing wording of the
   same questions (flight-plan comms, communicating changes to ATC,
   developing comms skills).

3. **`"Effect of Bad Weather"` / `2` / `3` are one theme.** `2` leans on
   clouds, `3` on rain/wet aerodromes, the base one is general — all
   "how does bad weather affect operations and how is it managed".

4. **`"Navigation aids"` vs `"Navigation procedures"` — one theme.** Both are
   reliance on nav technology and what to do when readings fail.

5. **Part 4 `"Traffic Movements"` straddles two themes.** Q1–Q2 are about
   **delays** (*"which aspects of normal traffic movement can create
   delays"*, *"a large percentage of flights are delayed"*); Q3–Q4 are about
   the **safety risk of rising traffic numbers**. Decide which overlap you
   care about more — tag it **Separation & Traffic Safety** (recommended) or
   **Delays & Disruptions**.

6. **Part 4 `"Managing Unexpected Events"` has a strong CRM streak.** Q3–Q4
   are division-of-labour / a co-pilot taking control / situational
   awareness. It's filed under Contingencies here, but if you'd rather it
   pair against Part 1 human-performance content, move it to **Human
   Performance & CRM**.

---

## Suggested unmixable rules

Only the three **both**-themes can clash as "same theme on both sides"
(`X ≠ X`). Then a few cross-theme pairs for near-overlaps. Ranked by how
strongly the two really cover the same ground.

### Same-theme (add as `X ≠ X`)

| Rule | Why | Strength |
|---|---|---|
| **Separation & Traffic Safety ≠ Separation & Traffic Safety** | P1 separation/monitoring vs P4 airspace/traffic/aerodrome-dangers — all "keeping traffic safely apart in controlled airspace" | **Strong** |
| **Navigation & Equipment ≠ Navigation & Equipment** | P1 nav-aids/procedures vs P4 Technology — both "reliance on equipment and coping when it fails" | **Strong** |
| **Contingencies & Unexpected Events ≠ Contingencies & Unexpected Events** | P1 contingency procedures vs P4 unexpected-events / emergency-actions — non-routine handling & diversions | Medium–strong |

### Cross-theme

| Part 1 theme | ≠ | Part 4 theme | Why | Strength |
|---|---|---|---|---|
| Delays & Disruptions | ≠ | Separation & Traffic Safety | P4 Traffic Movements' Q1–Q2 are squarely about flight delays — same as the whole P1 theme | Medium |
| Aerodrome Ground Operations | ≠ | Separation & Traffic Safety | P4 Aerodrome Dangers and P1 ground-ops share the "safe movement around the aerodrome" ground | Medium |
| Flight Routes & Deviations | ≠ | Contingencies & Unexpected Events | Re-routing / deviating from track appears prominently on both sides | Low–medium |
| ATC Communication | ≠ | Emergencies & Fire | P4 Emergency Training Q2 is about emergency-frequency comms — thin overlap | Low *(probably skip)* |

### No rule needed

Weather, Clearances, Airport Signs & Taxiing, Pre-flight Checks,
Medical & Fitness, Human Performance & CRM, Environmental Impact — each sits
only on one side, or has no counterpart on the other.

---

## If you go finer or coarser

- **Coarser** (fewer themes, more clashes): merge #12–#14 into one
  "Safety, Emergencies & Human Factors" P4 theme. Then most Part 4 content is
  one theme and you'd rarely need a rule — but you also lose the ability to
  say "not the same emergency subject twice".
- **Finer** (more themes, rules almost never bite): split every spreadsheet
  Topic 1:1. Then two parts almost never share a theme and the whole
  mechanism does nothing. Not recommended.

The 15 above is roughly the sweet spot: broad enough that the ~7 suggested
rules are meaningful, specific enough that they don't over-block.
