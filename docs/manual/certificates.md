# Certificates & Official Forms  *(admin)*

## Certificates

Generates Lenguax certificates. Each one has a number like `LA3X7K2` and a
4-digit PIN.

> For a rater finishing a course, it's usually quicker to issue the
> certificate from **Reports**, at the bottom of their feedback email.
> It's the same certificate, recorded in the same place.

### Issuing one here

1. Check the bar at the top. If it says you're **not signed in** to
   SharePoint, sign in first, or the PDF won't be saved there and no
   shareable link will be made.
2. Under **New certificate**, choose the **Certificate type** (Full Rater,
   Rater Interlocutor, Refresher, Refresher Interlocutor, or Teacher).
   Then enter the **Full name** and **Course date(s)** exactly as they
   should be printed, e.g. "12–14 March 2026".
3. The **Certificate number** and **PIN** fill in automatically.
4. Click **Generate certificate**. You then get a **Download PDF** button, the **Validation
   URL**, and (if you're signed in to SharePoint) a **shareable link**.

### Recent certificates

The records table lists every certificate issued. Icons on each row:

- copy, create or **regenerate (↻)** the shareable link
- open or copy the SharePoint copy
- **re-download** the PDF
- **delete** the record (you're asked to confirm)

**Shareable links** are read-only and need no sign-in, so they're safe to
email to someone outside our Microsoft tenant. They expire after **90
days**. Regenerate one once it has expired, or to extend one that's about
to.

**Validation**: anyone can check a certificate at `/validate/<number>` by
entering the number and PIN. It shows the real PDF.

**Templates**: to change a template image or its artwork, go to **Admin →
Certificate Assets**. New certificates use the change straight away, and so
does the public validation page.

## Official Forms

Two tabs:

- **UK CAA 5012**: enter the candidate's forenames and surname, the dates
  of assessment and issue, the level achieved, and the evaluator. The form
  is filled by overlaying the text onto the blank form image.
- **DGAC 87i-Formlic**: enter the candidate's title, full name (e.g.
  "DUPONT Jean-Pierre"), the test date, the TEAC centre city, the level, and
  the candidate's email. It's filled as a proper PDF form, with the fixed
  ticks, signature and stamp added on page 2. The tab also shows a **Draft
  email** to the candidate, with **Open in Outlook** and **Copy body**
  buttons. **Attach the 87iFORMLIC yourself before sending.**

Both forms save a record (listed under **Records**) when generated, for
audit and deletion. Like certificates, they're saved to SharePoint if
you're signed in.
