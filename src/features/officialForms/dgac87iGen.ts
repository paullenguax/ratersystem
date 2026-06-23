import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export interface Dgac87iParams {
  candidateTitle: 'Mr' | 'Mrs'
  candidateName:  string   // will be UPPERCASED
  dateOfTest:     string   // ISO date input → formatted dd/mm/yyyy
  teacCity:       string   // will be UPPERCASED
  level:          '4' | '5' | '6'
  candidateEmail: string
  basePath:       string
}

const MM = (mm: number) => mm * 2.8346  // mm → PDF points

function formatDateDDMMYYYY(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB').replace(/\//g, '/')  // dd/mm/yyyy
}

function todayDDMMYYYY(): string {
  return new Date().toLocaleDateString('en-GB')
}

function safeTextField(form: ReturnType<PDFDocument['getForm']>, name: string, value: string, fontSize?: number) {
  try {
    const field = form.getTextField(name)
    field.setText(value)
    if (fontSize !== undefined) field.setFontSize(fontSize)
  } catch { /* field missing or wrong type */ }
}

function safeCheck(form: ReturnType<PDFDocument['getForm']>, name: string, on: boolean) {
  try {
    const cb = form.getCheckBox(name)
    on ? cb.check() : cb.uncheck()
  } catch {
    try {
      const rg = form.getRadioGroup(name)
      if (on) rg.select('On')
    } catch { /* ignore */ }
  }
}

export function buildDgac87iDisplayName(p: { candidateTitle: string; candidateName: string }) {
  return `${p.candidateTitle} ${p.candidateName}`.trim()
}

export function buildDgac87iFilename(p: Dgac87iParams) {
  const d = new Date()
  const dateStr = `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${d.getFullYear()}`
  return `87iFORMLIC - ${p.candidateName} - ${dateStr}.pdf`
}

export function buildDgac87iEmail(pdfUrl: string): string {
  return [
    `Hello and thank you for taking a TEAC test.`,
    ``,
    `You will have received an email confirming that your TEAC certificate is ready to view/download in your account.`,
    ``,
    `In your test booking, you indicated that you will present your certificate to the DGAC of France. The DGAC require the approved Language Proficiency Organisation - in this case, us at Lenguax Europe - to complete, sign and present you with a special DGAC Form - the 87iFORMLIC Form - for you to make your application to them for an English endorsement on your licence.`,
    ``,
    `The DGAC have advised our Head of Testing that in your application to the DGAC, you:`,
    ``,
    `1. must submit the attached 87iFORMLIC Form that we have completed and signed. You can also download it here: ${pdfUrl}`,
    ``,
    `2. complete, sign and submit the 86iFORMLIC Form* (*unless this form has now been updated). You can download it here: https://www.ecologie.gouv.fr/sites/default/files/documents/86iFormlic.pdf — In Section 2/3, you must select 'Oui' against Cas 2 (and nothing against Cas 1). This matches the 87iFORMLIC we have completed and means you will receive an English endorsement for both FCL.055 (b) and (d).`,
    ``,
    `3. must download and submit Lenguax Europe's EASA LAB Approval Certificate from https://www.lenguax.com/wp-content/uploads/2021/08/SVK.LAB_.006_Certificate_-_June_2021.pdf`,
    ``,
    `4. MUST NOT submit your Lenguax Europe/TEAC Certificate. The DGAC have been very clear that the wording of the Lenguax Europe/TEAC Certificate will not support your application.`,
    ``,
    `In summary, you must submit 3 documents, as described above, but NOT your Lenguax Europe/TEAC Certificate.`,
    ``,
    `If you have any questions, please reply to this email and we will support you.`,
    ``,
    `Many thanks and best wishes`,
    `Ben`,
  ].join('\n')
}

export async function buildDgac87iPDF(p: Dgac87iParams): Promise<Uint8Array> {
  const name      = p.candidateName.trim().toUpperCase()
  const city      = p.teacCity.trim().toUpperCase()
  const testDate  = formatDateDDMMYYYY(p.dateOfTest)
  const todayDate = todayDDMMYYYY()

  const [templateBytes, sigBytes, stampBytes] = await Promise.all([
    fetch(`${p.basePath}/87iFormlic.pdf`).then(r => r.arrayBuffer()),
    fetch(`${p.basePath}/Ben_Rimrom_Siganture_Transparent.png`).then(r => r.arrayBuffer()),
    fetch(`${p.basePath}/LE.png`).then(r => r.arrayBuffer()),
  ])

  const pdfDoc  = await PDFDocument.load(templateBytes, { ignoreEncryption: true })
  const form    = pdfDoc.getForm()
  const helv    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const sigImg  = await pdfDoc.embedPng(sigBytes)
  const stamImg = await pdfDoc.embedPng(stampBytes)

  const F = 10  // font size for all fields

  // ── Fixed / LPO fields ────────────────────────────────────────────────────
  safeTextField(form, 'Name of the person in charge',       'BEN RIMRON',               F)
  safeTextField(form, 'Quality',                            'HEAD OF TESTING',           F)
  safeTextField(form, 'Full name LPO',                      'LENGUAX EUROPE, SRO',       F)
  safeTextField(form, 'Approval number',                    'SVK.LAB.006',               F)
  safeTextField(form, 'Approval number_2',                  'SVK.LAB.006',               F)
  safeTextField(form, 'Authority that issued the approval', 'SK CAA',                    F)
  safeTextField(form, 'Expiry date if applicable_2',        'N/A',                       F)
  safeTextField(form, 'Adress_2',                           'Tolstého 5, Bratislava',    F)
  safeTextField(form, 'Postal code_2',                      '811 06',                    F)
  safeTextField(form, 'Country_2',                          'Slovakia',                  F)
  safeTextField(form, 'Mail_2',                             'teac@lenguax.com',          F)
  safeTextField(form, 'I the undersigned Mr Mrs',           'BEN RIMRON',               F)
  safeTextField(form, 'N LPO_2',                            'SVK.LAB.006',              F)

  // ── Variable / candidate fields ───────────────────────────────────────────
  safeTextField(form, 'certifies that the candidate Mr Mrs', name,      F)
  safeTextField(form, 'Date of the test',                    testDate,  F)
  safeTextField(form, 'Done at',                             city,      F)
  safeTextField(form, 'On the',                              testDate,  F)
  safeTextField(form, 'Done at_2',                           'BRATISLAVA', F)
  safeTextField(form, 'On the_2',                            todayDate, F)

  // ── Checkboxes / radio buttons ────────────────────────────────────────────
  safeCheck(form, 'If evaluated by an LPE  Please provide a copy of your LPE agreement certificate', false)
  safeCheck(form, 'If evaluated by an LPO  Please provide a copy of your LPO agreement certificate', true)
  safeCheck(form, 'N LPO', true)
  safeCheck(form, 'certifies that the', p.candidateTitle === 'Mrs')
  safeCheck(form, 'Mr_2',               p.candidateTitle === 'Mr')
  safeCheck(form, '4', p.level === '4')
  safeCheck(form, '5', p.level === '5')
  safeCheck(form, '6', p.level === '6')
  safeCheck(form, 'LPE', false)
  safeCheck(form, 'LPO certified that all the information entered in the section 1a3 section 1b3 and 23 are correct', true)

  // NeedAppearances so viewers re-render fields
  try {
    const acroForm = pdfDoc.catalog.lookup(pdfDoc.catalog.get('AcroForm' as any) as any, {} as any) as any
    if (acroForm) acroForm.set('NeedAppearances' as any, true as any)
  } catch { /* non-critical */ }

  // ── Overlays on page 2 ────────────────────────────────────────────────────
  const pages  = pdfDoc.getPages()
  const page2  = pages[1]

  // Hardcoded X ticks (positions from fill_87i.py — y is from BOTTOM of page)
  const tickOpts = { size: 8, font: helv, color: rgb(0, 0, 0) }
  page2.drawText('X', { x: MM(59),  y: MM(151), ...tickOpts })   // FCL.055(b) Yes
  page2.drawText('X', { x: MM(147), y: MM(137), ...tickOpts })   // FCL.055(d) Yes
  page2.drawText('X', { x: MM(15),  y: MM(251), ...tickOpts })   // Examiner Mr

  // Signature (page 2) — Python: SIG at x=112, y=72 (from bottom), 55×18mm
  page2.drawImage(sigImg, { x: MM(112), y: MM(72), width: MM(55), height: MM(18) })

  // Stamp (page 2) — Python: STAMP at x=160, y=60 (from bottom), 28×42mm
  page2.drawImage(stamImg, { x: MM(160), y: MM(60), width: MM(28), height: MM(42) })

  return pdfDoc.save()
}
