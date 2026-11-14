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
| **Name / Email** | Changing the name also updates it on their existing scores and assignments. Changing the email also changes the address they sign in with (see below). |
| **Role** | Admin, Senior Rater, Trainee or Examiner. This decides which tabs they see (see **Overview**). |
| **Can do standardization work** | Gives a trainee or senior rater the **Standardization** tab without making them an examiner. |
| **Trainer** | Gives them the **Courses** tab. Admins always have it. |
| **Status** | Active, Inactive or Suspended. |
| **Rater number** | Their permanent number in the Rasch analysis. Leave it blank: it's set by **Assign numbers** on **Scores** once their scores are published. |
| **Notes** | Free text for admins. |

Below the form, **Courses attended** lists the course runs they're recorded
on (see **Courses**).

### Changing someone's email

- **Email-and-password users**: saving a new email moves their sign-in to
  it too, so they sign in and reset their password with the address shown
  here. If the new address is already another account's sign-in, the save
  is refused.
- **Canvas users**: their next Canvas sign-in resets the email here to the
  one in Canvas. The drawer warns you about this. To change it for good,
  change it in Canvas.

### Email a sign-in link

**Email a sign-in link** (under **Firebase account**) emails the person a
link to set a password. The email also tells them which address they sign
in with, which helps people who've forgotten which email they used. If they
have no login yet, for example a rater from an older course recorded only
for their scores, it creates one first, and their past scores stay attached.
If their sign-in is still on an older address (because the email was
changed before email changes moved the sign-in too), it moves the sign-in to
the address on the record first.
Save any changes to the record before sending.

### Emailing many people at once

**Email sign-in links** at the top of People (also in **Admin Tools**)
does the same for a whole list:

1. Paste the people, one per line: a name, an email, or both (*Jane Smith,
   jane@example.com*). A list copied from a spreadsheet works.
2. Click **Check list**. Each line is matched to a People record by email,
   then by name, and shows what will happen:
   - **send link**: they're in People. It notes if it will create their
     login, move their sign-in to a new address, or change their email (untick
     **use …** to keep the one on the record).
   - **invite**: not in People, so they're added with the role in **New people
     join as**, given a login and emailed. Names from the course-records
     import are found this way, and their course history attaches by name.
   - **sort out**: something needs you. Several people share the name, a
     similar name was found (pick them, or **New person**), or there's no
     email to send to. Fix the line in the box and click **Check list**
     again, or untick it.
3. Click **Email N sign-in links**. Each line then shows sent or the reason
   it failed.

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
