# People  *(admin)*

The register of everyone who can use the system: trainees, senior raters,
examiners and admins. It also records people who have only ever been rated
and never sign in.

## Finding someone

Search by name or email, and filter by **role** or **status**. Click any
row to open that person's record.

## Adding someone

There are three ways, depending on how they'll sign in:

- **Canvas users** (most trainees): you don't usually add them here. Run
  **Admin → Canvas Sync** at the start of a course, and it creates People
  records for everyone on the Canvas roster. If a trainee takes the
  self-serve exam before Sync has been run, the system creates their record
  at login and marks it with an **auto** badge. Check those records for
  duplicates.
- **Invite**, for people who'll sign in with email and password: enter
  their name, email and role, then click **Send invite**. This creates their
  login and emails them a link to set a password. If the email fails, an
  amber note says so. They can then use **Forgot password?** on the login
  page instead.
- **Add person**, for a record with no login (for example, someone from an
  older course you need to record scores for).

## Editing someone

| Field | What it does |
|---|---|
| **Name / Email** | Changing the name also updates it on their existing scores and assignments. |
| **Role** | Admin, Senior Rater, Trainee or Examiner. This decides which tabs they see (see **Overview**). |
| **Can do standardization work** | Gives a trainee or senior rater the **Standardization** tab without making them an examiner. |
| **Trainer** | Gives them the **Courses** tab. Admins always have it. |
| **Status** | Active, Inactive or Suspended. |
| **Rater number** | Their permanent number in the Rasch analysis. Leave it blank: it's set by **Assign numbers** on **Scores** once their scores are published. |
| **Notes** | Free text for admins. |

Below the form, **Courses attended** lists the course runs they're recorded
on (see **Courses**).

### Firebase account

If someone's login was created separately (for example, in the Firebase
console), paste their **Firebase UID** to link the account to their record.
All their scores and assignments move across, so nothing is lost. Once it's
done, the record shows **✓ Account linked**.

## Good to know

- **Don't delete someone who has scored tests.** Deleting removes only
  their People record. Their scores and assignments stay behind with nobody
  attached. Set them to **Inactive** instead.
- A role change applies the next time they open or reload the app.
