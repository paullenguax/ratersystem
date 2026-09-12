# Certificates & Official Forms  *(admin)*

## Certificates

Generates Lenguax certificates (numbers like `LA3X7K2`, each with a 4‑digit
PIN). The PDF is built from a template with the name, date, QR code and
number overlaid, saved to the certificate records, and re‑downloadable from
the table.

**Validation**: anyone can check a certificate at `/validate/<number>` by
entering the number and PIN — it shows the real PDF.

**Sharing with candidates**: once connected to SharePoint (see banner at the
top of the page), generating a certificate also creates a per-candidate,
read-only, no-sign-in link — safe to email or message to someone outside our
Microsoft tenant. It's shown under the result and also lives in the records
table (with its expiry date), where it can be copied or regenerated at any
time. Links expire after 90 days by default; use the regenerate button (↻)
once one has expired, or to extend one that's about to.

**Templates**: swap the template image or artwork under
**Admin → Cert Assets**; new certificates pick it up immediately, and so
does the public validation page.

## Official Forms

- **UK CAA 5012** — filled by overlaying text onto the blank form image.
- **DGAC 87i‑Formlic** — filled as a proper PDF form, with the fixed ticks,
  signature and stamp added on page 2. The DGAC tab also shows a draft
  covering email with copy / open‑in‑Outlook buttons.

Both save a record (for audit / deletion) when generated.
