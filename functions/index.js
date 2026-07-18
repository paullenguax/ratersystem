const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')

admin.initializeApp()

const CANVAS_CLIENT_SECRET = defineSecret('CANVAS_CLIENT_SECRET')
const WEBHOOK_SECRET = defineSecret('ENROLLMENT_WEBHOOK_SECRET')
const RESEND_API_KEY = defineSecret('RESEND_API_KEY')
const BENCHMARK_SERVICE_ACCOUNT_KEY = defineSecret('BENCHMARK_SERVICE_ACCOUNT_KEY')
const CANVAS_URL = 'https://courses.lenguax.com'
const CANVAS_CLIENT_ID = '10000000000002'
const REDIRECT_URI = 'https://lenguax.com/ratersystem/auth/canvas/callback'
const SECTION_END_GRACE_DAYS = 7
const WELL_KNOWN_RATER_THRESHOLD = 100
const SELF_SERVE_TESTS_PER_RATER = 4

// ── helpers ───────────────────────────────────────────────────────────────────

async function getCanvasToken() {
  const db = admin.firestore()
  const snap = await db.doc('config/canvas').get()
  if (!snap.exists) throw new HttpsError('not-found', 'Canvas config not set up')
  const token = snap.data().apiToken
  if (!token) throw new HttpsError('not-found', 'Canvas API token not configured')
  return token
}

async function assertAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in')
  const db = admin.firestore()
  const snap = await db.collection('people').doc(request.auth.uid).get()
  if (!snap.exists || snap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required')
  }
}

function getBenchmarkAdminApp() {
  const existing = admin.apps.find(a => a?.name === 'benchmarkAdmin')
  if (existing) return existing
  return admin.initializeApp(
    { credential: admin.credential.cert(JSON.parse(BENCHMARK_SERVICE_ACCOUNT_KEY.value())) },
    'benchmarkAdmin'
  )
}

async function canvasFetch(path, token, options = {}) {
  const res = await fetch(`${CANVAS_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  return res
}

// Follows Canvas Link header pagination, returns all results
async function canvasFetchAll(path, token) {
  const results = []
  let url = `${CANVAS_URL}${path}`
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new HttpsError('internal', `Canvas API error: ${res.status} ${res.statusText}`)
    const data = await res.json()
    results.push(...data)
    const link = res.headers.get('Link')
    const next = link?.match(/<([^>]+)>;\s*rel="next"/)
    url = next ? next[1] : null
  }
  return results
}

async function writeEnrollmentLog(entry) {
  const db = admin.firestore()
  await db.collection('canvasEnrollmentLog').add({
    ...entry,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
}

function namesLikelyMatch(a, b) {
  const na = (a || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const nb = (b || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!na || !nb) return false
  if (na === nb) return true
  const wa = na.split(' ')
  const wb = nb.split(' ')
  const overlap = wa.filter(w => wb.includes(w)).length
  return overlap >= 2 || (overlap >= 1 && Math.min(wa.length, wb.length) === 1)
}

// Resolves a Canvas identity by email, then their most-recently-started active
// student section enrollment (with the full section + course objects, not just
// IDs). Returns null if no Canvas account or no active section is found.
// Shared by requestSelfAssignment and canvasAuth's self-serve auto-provisioning.
async function resolveActiveRaterSection(email, apiToken) {
  const searchRes = await canvasFetch(
    `/api/v1/accounts/self/users?search_term=${encodeURIComponent(email)}&per_page=10`,
    apiToken
  )
  if (!searchRes.ok) throw new HttpsError('internal', `Canvas API error: ${searchRes.status}`)
  const candidates = await searchRes.json()
  const normalEmail = email.toLowerCase().trim()
  const canvasUser = candidates.find(u =>
    (u.login_id || '').toLowerCase() === normalEmail || (u.email || '').toLowerCase() === normalEmail
  )
  if (!canvasUser) return null

  const enrollments = await canvasFetchAll(
    `/api/v1/users/${canvasUser.id}/enrollments?type[]=StudentEnrollment&state[]=active&per_page=100`,
    apiToken
  )
  if (enrollments.length === 0) return null

  const courseById = new Map()
  for (const e of enrollments) {
    if (courseById.has(e.course_id)) continue
    const courseRes = await canvasFetch(`/api/v1/courses/${e.course_id}`, apiToken)
    if (courseRes.ok) courseById.set(e.course_id, await courseRes.json())
  }

  const withCourse = enrollments
    .map(e => ({ enrollment: e, course: courseById.get(e.course_id) }))
    .filter(x => x.course)
    .sort((a, b) => {
      const da = a.course.start_at || a.course.created_at || null
      const dbb = b.course.start_at || b.course.created_at || null
      if (da && dbb) return new Date(dbb) - new Date(da)
      if (!da && dbb) return 1
      if (da && !dbb) return -1
      return 0
    })
  if (withCourse.length === 0) return null

  const { enrollment, course } = withCourse[0]
  const sectionRes = await canvasFetch(`/api/v1/sections/${enrollment.course_section_id}`, apiToken)
  if (!sectionRes.ok) return null
  const section = await sectionRes.json()

  return { canvasUser, course, section }
}

// ── existing: canvasAuth ──────────────────────────────────────────────────────

exports.canvasAuth = onCall({ secrets: [CANVAS_CLIENT_SECRET] }, async (request) => {
  const { code, selfServe } = request.data
  if (!code) throw new HttpsError('invalid-argument', 'Missing OAuth code')

  const tokenRes = await fetch(`${CANVAS_URL}/login/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CANVAS_CLIENT_ID,
      client_secret: CANVAS_CLIENT_SECRET.value(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    throw new HttpsError('unauthenticated', `Canvas token exchange failed: ${body}`)
  }

  const { access_token } = await tokenRes.json()

  // Note: /api/v1/users/self does NOT reliably return login_id/email — those
  // fields belong to the separate profile endpoint.
  const userRes = await fetch(`${CANVAS_URL}/api/v1/users/self/profile`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })

  if (!userRes.ok) throw new HttpsError('internal', 'Failed to fetch Canvas user profile')

  const canvasUser = await userRes.json()
  const email = (canvasUser.login_id || canvasUser.primary_email || '').toLowerCase().trim()

  if (!email) throw new HttpsError('internal', 'Could not determine email from Canvas profile')

  const db = admin.firestore()
  const snap = await db.collection('people').where('email', '==', email).limit(1).get()

  let personId, personName

  if (!snap.empty) {
    personId = snap.docs[0].id
    personName = snap.docs[0].data().name
  } else if (selfServe) {
    // Failsafe for "Canvas Sync wasn't run before this person tried to take
    // their exam": auto-provision a trainee record, but only if they're
    // actively enrolled in one of our known rater/refresher courses
    // (config/canvas.courses — the same curated list Canvas Sync itself
    // uses), and only if nobody with a similar name already exists (that's
    // a possible-duplicate case for an admin to link manually, not something
    // to silently fork into two records).
    const apiToken = await getCanvasToken()
    const configSnap = await db.doc('config/canvas').get()
    const knownCourseIds = new Set((configSnap.data()?.courses || []).map(c => Number(c.id)))

    const resolved = await resolveActiveRaterSection(email, apiToken)
    if (!resolved || !knownCourseIds.has(resolved.course.id)) {
      throw new HttpsError('not-found', 'No RaterSystem account found for this Canvas user. Contact your administrator.')
    }

    const allPeople = await db.collection('people').get()
    const possibleDuplicate = allPeople.docs.find(d => namesLikelyMatch(d.data().name, resolved.canvasUser.name))
    if (possibleDuplicate) {
      throw new HttpsError('failed-precondition', 'It looks like you may already have an account under a different email. Contact your administrator to link it.')
    }

    personName = resolved.canvasUser.name
    const newPersonRef = db.collection('people').doc()
    await newPersonRef.set({
      name: personName,
      email,
      role: 'trainee',
      status: 'active',
      createdVia: 'self_serve_auto',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    personId = newPersonRef.id
  } else {
    throw new HttpsError('not-found', 'No RaterSystem account found for this Canvas user. Contact your administrator.')
  }

  try {
    await admin.auth().getUser(personId)
  } catch {
    const existingByEmail = await admin.auth().getUserByEmail(email).catch(() => null)
    if (existingByEmail) {
      const token = await admin.auth().createCustomToken(existingByEmail.uid)
      return { token }
    }
    await admin.auth().createUser({
      uid: personId,
      email,
      displayName: personName,
    })
  }

  const token = await admin.auth().createCustomToken(personId)
  return { token }
})

// ── existing: canvasEnrollments ───────────────────────────────────────────────

// Bridges a RaterSystemNew admin's identity into the separate Benchmark Check
// Firebase project (lenguax-benchmark-32392) so benchmark_results/benchmark_flags
// reads can require request.auth != null instead of being world-readable.
exports.mintBenchmarkAdminToken = onCall({ secrets: [BENCHMARK_SERVICE_ACCOUNT_KEY] }, async (request) => {
  await assertAdmin(request)
  const benchmarkApp = getBenchmarkAdminApp()
  // The admin:true claim is what benchmark-project Firestore rules check to
  // distinguish an admin session from a centre account login.
  const token = await admin.auth(benchmarkApp).createCustomToken(request.auth.uid, { admin: true })
  return { token }
})

exports.canvasEnrollments = onCall(async (request) => {
  const { courseId } = request.data
  if (!courseId) throw new HttpsError('invalid-argument', 'Missing courseId')

  const apiToken = await getCanvasToken()

  const users = []
  let url = `${CANVAS_URL}/api/v1/courses/${courseId}/enrollments?type[]=StudentEnrollment&per_page=100&include[]=email`

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } })
    if (!res.ok) throw new HttpsError('internal', `Canvas API error: ${res.status} ${res.statusText}`)

    const data = await res.json()
    for (const e of data) {
      if (e.user) {
        users.push({
          canvasId: e.user.id,
          name: e.user.name ?? '',
          email: (e.user.login_id || e.user.email || '').toLowerCase().trim(),
        })
      }
    }

    const link = res.headers.get('Link')
    const next = link?.match(/<([^>]+)>;\s*rel="next"/)
    url = next ? next[1] : null
  }

  const seen = new Set()
  return {
    users: users.filter(u => {
      if (seen.has(u.canvasId)) return false
      seen.add(u.canvasId)
      return true
    }),
  }
})

// ── canvasSections ────────────────────────────────────────────────────────────
// Returns all active sections across all accessible courses, sorted newest first.
// Sections whose end_at is more than SECTION_END_GRACE_DAYS ago are excluded.

exports.canvasSections = onCall(async (request) => {
  await assertAdmin(request)
  const apiToken = await getCanvasToken()

  const db = admin.firestore()
  const configSnap = await db.doc('config/canvas').get()
  const excludedCourseIds = new Set((configSnap.data()?.excludedCourseIds || []).map(Number))

  const courses = await canvasFetchAll(
    '/api/v1/courses?per_page=100&include[]=term',
    apiToken
  )

  // Sort courses newest first
  courses.sort((a, b) => {
    const da = a.start_at || a.created_at || null
    const db_ = b.start_at || b.created_at || null
    if (da && db_) return new Date(db_) - new Date(da)
    if (!da && db_) return 1
    if (da && !db_) return -1
    return a.name.localeCompare(b.name)
  })

  const cutoff = Date.now() - SECTION_END_GRACE_DAYS * 24 * 60 * 60 * 1000
  const sections = []

  for (const course of courses) {
    if (excludedCourseIds.has(course.id)) continue

    let courseSections
    try {
      courseSections = await canvasFetchAll(
        `/api/v1/courses/${course.id}/sections?per_page=100`,
        apiToken
      )
    } catch {
      continue // skip courses we can't read sections for
    }

    const courseDate = course.start_at
      ? new Date(course.start_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : course.term?.name || ''

    for (const section of courseSections) {
      if (section.end_at && new Date(section.end_at).getTime() < cutoff) continue

      sections.push({
        id: section.id,
        name: section.name,
        courseId: course.id,
        courseName: course.name,
        courseDate,
        courseStartAt: course.start_at || null,
        sectionEndAt: section.end_at || null,
        displayName: `${course.name} → ${section.name}`,
      })
    }
  }

  return { sections }
})

// ── canvasLookupUser ──────────────────────────────────────────────────────────
// Looks up a Canvas user by exact email. Returns the user if found, null if not.

exports.canvasLookupUser = onCall(async (request) => {
  await assertAdmin(request)
  const { email } = request.data
  if (!email) throw new HttpsError('invalid-argument', 'Missing email')

  const apiToken = await getCanvasToken()
  const res = await canvasFetch(
    `/api/v1/accounts/self/users?search_term=${encodeURIComponent(email)}&per_page=10`,
    apiToken
  )

  if (!res.ok) throw new HttpsError('internal', `Canvas API error: ${res.status}`)
  const users = await res.json()

  // search_term matches on name/email/login_id — filter to exact email match only
  const normalEmail = email.toLowerCase().trim()
  const match = users.find(u =>
    (u.login_id || '').toLowerCase() === normalEmail ||
    (u.email || '').toLowerCase() === normalEmail
  )

  if (!match) return { found: false }

  return {
    found: true,
    user: {
      canvasId: match.id,
      name: match.name,
      email: (match.login_id || match.email || '').toLowerCase().trim(),
    },
  }
})

// ── canvasUserSearch ──────────────────────────────────────────────────────────
// Searches Canvas users by name. Returns a list of possible matches.
// Used when email lookup fails — lets the admin pick the right person.

exports.canvasUserSearch = onCall(async (request) => {
  await assertAdmin(request)
  const { name } = request.data
  if (!name) throw new HttpsError('invalid-argument', 'Missing name')

  const apiToken = await getCanvasToken()
  const res = await canvasFetch(
    `/api/v1/accounts/self/users?search_term=${encodeURIComponent(name)}&per_page=20`,
    apiToken
  )

  if (!res.ok) throw new HttpsError('internal', `Canvas API error: ${res.status}`)
  const users = await res.json()

  return {
    users: users.map(u => ({
      canvasId: u.id,
      name: u.name,
      email: (u.login_id || u.email || '').toLowerCase().trim(),
    })),
  }
})

// ── canvasEnroll ──────────────────────────────────────────────────────────────
// Performs the full enrollment action after the wizard has resolved who the person is.
//
// Input:
//   canvasUserId?      — if provided, use this existing Canvas user
//   email              — used to create account if no canvasUserId
//   firstName          — used to create account if no canvasUserId
//   lastName           — used to create account if no canvasUserId
//   sectionId          — Canvas section to enroll in
//   updateEmail?       — if true, update the Canvas login email to `email`
//   concludeOldSection? — if true, conclude any existing student enrollments in the
//                         same course (other than the target section)
//
// Returns: { canvasUserId, created, alreadyEnrolled, concludedSections, emailUpdated }

exports.canvasEnroll = onCall(async (request) => {
  await assertAdmin(request)
  const {
    canvasUserId: inputUserId,
    email,
    firstName,
    lastName,
    sectionId,
    updateEmail = false,
    concludeOldSection = false,
  } = request.data

  if (!sectionId) throw new HttpsError('invalid-argument', 'Missing sectionId')
  if (!email) throw new HttpsError('invalid-argument', 'Missing email')

  const apiToken = await getCanvasToken()
  let canvasUserId = inputUserId
  let created = false
  let emailUpdated = false
  let concludedSections = []

  // ── 1. Create Canvas user if no existing ID provided ─────────────────────
  if (!canvasUserId) {
    if (!firstName || !lastName) throw new HttpsError('invalid-argument', 'Missing firstName or lastName for new user')

    const accountRes = await canvasFetch('/api/v1/accounts/self', apiToken)
    if (!accountRes.ok) throw new HttpsError('internal', 'Could not determine Canvas account ID')
    const account = await accountRes.json()
    const accountId = account.id

    const createRes = await canvasFetch(`/api/v1/accounts/${accountId}/users`, apiToken, {
      method: 'POST',
      body: JSON.stringify({
        user: {
          name: `${firstName} ${lastName}`.trim(),
          short_name: firstName,
          sortable_name: `${lastName}, ${firstName}`.trim(),
        },
        pseudonym: {
          unique_id: email,
          send_confirmation: true,
        },
      }),
    })

    if (!createRes.ok) {
      const body = await createRes.text()
      throw new HttpsError('internal', `Failed to create Canvas user: ${body}`)
    }

    const newUser = await createRes.json()
    canvasUserId = newUser.id
    created = true
  }

  // ── 2. Optionally update Canvas login email ───────────────────────────────
  if (updateEmail && !created) {
    const loginsRes = await canvasFetch(`/api/v1/users/${canvasUserId}/logins`, apiToken)
    if (loginsRes.ok) {
      const logins = await loginsRes.json()
      const login = logins[0]
      if (login) {
        const accountRes = await canvasFetch('/api/v1/accounts/self', apiToken)
        const account = await accountRes.json()
        const updateRes = await canvasFetch(
          `/api/v1/accounts/${account.id}/logins/${login.id}`,
          apiToken,
          {
            method: 'PUT',
            body: JSON.stringify({ login: { unique_id: email } }),
          }
        )
        emailUpdated = updateRes.ok
      }
    }
  }

  // ── 3. Optionally conclude old section enrollments in the same course ─────
  if (concludeOldSection) {
    const sectionRes = await canvasFetch(`/api/v1/sections/${sectionId}`, apiToken)
    if (sectionRes.ok) {
      const section = await sectionRes.json()
      const courseId = section.course_id

      const existingRes = await canvasFetch(
        `/api/v1/courses/${courseId}/enrollments?user_id=${canvasUserId}&type[]=StudentEnrollment&per_page=100`,
        apiToken
      )
      if (existingRes.ok) {
        const existing = await existingRes.json()
        for (const enrollment of existing) {
          if (enrollment.course_section_id !== sectionId) {
            const concludeRes = await canvasFetch(
              `/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=conclude`,
              apiToken,
              { method: 'DELETE' }
            )
            if (concludeRes.ok) concludedSections.push(enrollment.course_section_id)
          }
        }
      }
    }
  }

  // ── 4. Check if already enrolled in target section ────────────────────────
  const checkRes = await canvasFetch(
    `/api/v1/sections/${sectionId}/enrollments?user_id=${canvasUserId}&per_page=10`,
    apiToken
  )
  let alreadyEnrolled = false
  if (checkRes.ok) {
    const existing = await checkRes.json()
    alreadyEnrolled = existing.length > 0
  }

  // ── 5. Enroll in target section ───────────────────────────────────────────
  if (!alreadyEnrolled) {
    const enrollRes = await canvasFetch(`/api/v1/sections/${sectionId}/enrollments`, apiToken, {
      method: 'POST',
      body: JSON.stringify({
        enrollment: {
          user_id: canvasUserId,
          type: 'StudentEnrollment',
          enrollment_state: 'active',
        },
      }),
    })

    if (!enrollRes.ok) {
      const body = await enrollRes.text()
      throw new HttpsError('internal', `Enrollment failed: ${body}`)
    }
  }

  // ── 6. Log to Firestore ───────────────────────────────────────────────────
  await writeEnrollmentLog({
    source: 'manual',
    email,
    canvasUserId,
    sectionId,
    status: alreadyEnrolled ? 'already_enrolled' : created ? 'new_account' : 'enrolled',
    emailUpdated,
    concludedSections,
    enrolledBy: request.auth.uid,
  })

  return { canvasUserId, created, alreadyEnrolled, concludedSections, emailUpdated }
})

// ── requestSelfAssignment ──────────────────────────────────────────────────────
// Called right after a Canvas SSO login flagged as a self-serve exam request
// (see the `state=self_serve` param round-tripped through the OAuth flow).
// Resolves the caller's active Canvas section, finds-or-creates the matching
// RaterSystem session, and builds them a 4-test assignment.
//
// Selection mirrors AutoAssignPage's pickTests(): unseen-by-this-rater tests,
// spread across difficulty tiers, with a preference for a well-known anchor
// test (calibrated + seen by >= WELL_KNOWN_RATER_THRESHOLD distinct raters).

// Fisher-Yates shuffle — used to break ties among equally-eligible tests so
// two trainees with identical (empty) scoring history don't get an identical
// assignment.
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Prefers whichever candidates have been assigned least often within this
// specific cohort so far, breaking ties (including the common "nobody in
// this section has this test yet" tie) with a random pick.
function pickLeastUsed(candidates, cohortFreq) {
  if (candidates.length === 0) return null
  const minFreq = Math.min(...candidates.map(t => cohortFreq.get(t.id) ?? 0))
  const leastUsed = candidates.filter(t => (cohortFreq.get(t.id) ?? 0) === minFreq)
  return shuffle(leastUsed)[0]
}

function pickSelfServeTests({ pool, seenTestIds, raterCountByTest, cohortFreq }) {
  const chosen = []
  const unseen = pool.filter(t => !seenTestIds.has(t.id))

  const calibratedUnseen = unseen
    .filter(t => t.canonicalDifficulty != null)
    .sort((a, b) => (a.canonicalDifficulty ?? 0) - (b.canonicalDifficulty ?? 0))

  const wellCalibrated = [...calibratedUnseen]
    .filter(t => t.canonicalSE != null)
    .sort((a, b) => (a.canonicalSE ?? 99) - (b.canonicalSE ?? 99))

  const popularWellCalibrated = wellCalibrated.filter(
    t => (raterCountByTest.get(t.id) ?? 0) >= WELL_KNOWN_RATER_THRESHOLD
  )

  // Anchor: prefer one this cohort hasn't already been given, among the
  // best-calibrated few — not deterministically the single lowest-SE test,
  // which would otherwise be handed to everyone in the section.
  const anchorPool = (popularWellCalibrated.length ? popularWellCalibrated : wellCalibrated).slice(0, 5)
  const anchor = pickLeastUsed(anchorPool, cohortFreq)
  if (anchor) chosen.push(anchor)

  const excluded = new Set(chosen.map(t => t.id))
  function pickFrom(candidates) {
    return pickLeastUsed(candidates.filter(t => !excluded.has(t.id)), cohortFreq)
  }

  const remaining = SELF_SERVE_TESTS_PER_RATER - chosen.length
  const n = calibratedUnseen.length
  const third = Math.max(1, Math.floor(n / 3))
  const tiers = [
    calibratedUnseen.slice(0, third),
    calibratedUnseen.slice(third, 2 * third),
    calibratedUnseen.slice(2 * third),
    unseen.filter(t => t.canonicalDifficulty == null),
    unseen,
  ]

  let filled = 0
  let attempt = 0
  while (filled < remaining && attempt < tiers.length * 4) {
    const pick = pickFrom(tiers[attempt % tiers.length])
    if (pick) {
      chosen.push(pick)
      excluded.add(pick.id)
      filled++
    }
    attempt++
  }

  return chosen
}

exports.requestSelfAssignment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in')
  const db = admin.firestore()
  const uid = request.auth.uid

  const personSnap = await db.collection('people').doc(uid).get()
  if (!personSnap.exists) throw new HttpsError('not-found', 'No RaterSystem account found for this user')
  const person = personSnap.data()
  if (!person.email) throw new HttpsError('failed-precondition', 'No email on file for this account')

  const apiToken = await getCanvasToken()

  // ── 1–2. Resolve Canvas identity + their active section enrollment ────────
  const resolved = await resolveActiveRaterSection(person.email, apiToken)
  if (!resolved) {
    throw new HttpsError('failed-precondition', 'Not currently enrolled in an active course section. Contact your administrator.')
  }
  const { course, section } = resolved
  const sectionId = section.id

  // ── 3. Find-or-create the RaterSystem session for this section ───────────
  const sessionsSnap = await db.collection('sessions').where('canvasSectionId', '==', sectionId).limit(1).get()
  let sessionId, sessionName
  if (!sessionsSnap.empty) {
    sessionId = sessionsSnap.docs[0].id
    sessionName = sessionsSnap.docs[0].data().name
  } else {
    sessionName = `${course.name} — ${section.name}`
    const newSession = await db.collection('sessions').add({
      name: sessionName,
      type: 'rater_course',
      status: 'open',
      canvasSectionId: sectionId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    sessionId = newSession.id
  }

  // ── 4. Idempotency — reuse an existing open assignment for this rater+session ──
  const existingSnap = await db.collection('assignments')
    .where('raterId', '==', uid)
    .where('sessionId', '==', sessionId)
    .get()
  const existing = existingSnap.docs.find(d => d.data().status !== 'published')
  if (existing) return { assignmentId: existing.id }

  // ── 5. Build selection inputs ──────────────────────────────────────────────
  const [testsSnap, scoresSnap, sessionAssignmentsSnap] = await Promise.all([
    db.collection('test_bank').get(),
    db.collection('scores').get(),
    db.collection('assignments').where('sessionId', '==', sessionId).get(),
  ])
  const pool = testsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.status === 'active' && !t.excludeFromPool)

  const seenTestIds = new Set()
  const ratersByTest = new Map()
  scoresSnap.docs.forEach(d => {
    const s = d.data()
    if (s.raterId === uid) seenTestIds.add(s.testDocId)
    if (!ratersByTest.has(s.testDocId)) ratersByTest.set(s.testDocId, new Set())
    ratersByTest.get(s.testDocId).add(s.raterId)
  })
  const raterCountByTest = new Map([...ratersByTest].map(([id, set]) => [id, set.size]))

  // How many times each test has already been handed out within this same
  // section/cohort — anyone's assignment, self-serve or admin-built — so
  // different trainees in the same section fan out across the test bank
  // rather than converging on the same handful of tests.
  const cohortFreq = new Map()
  sessionAssignmentsSnap.docs.forEach(d => {
    for (const testDocId of d.data().testDocIds ?? []) {
      cohortFreq.set(testDocId, (cohortFreq.get(testDocId) ?? 0) + 1)
    }
  })

  const tests = pickSelfServeTests({ pool, seenTestIds, raterCountByTest, cohortFreq })

  // ── 6. Create the assignment ───────────────────────────────────────────────
  const assignRef = await db.collection('assignments').add({
    raterId: uid,
    raterName: person.name,
    sessionId,
    sessionName,
    testDocIds: tests.map(t => t.id),
    status: 'pending',
    source: 'self_serve',
    notes: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { assignmentId: assignRef.id }
})

// ── notifySelfServeSubmission ──────────────────────────────────────────────────
// Fires when a self-serve rater explicitly confirms their scores (not just
// when the 4th test is saved — `status` flips to 'submitted' at that point,
// but the rater can still review/change answers until they hit "confirm").
// Emails the admin; silently no-ops if email isn't configured, matching the
// WP plugin's precedent for its own webhook.

exports.notifySelfServeSubmission = onDocumentUpdated(
  { document: 'assignments/{assignmentId}', secrets: [RESEND_API_KEY] },
  async (event) => {
    const before = event.data.before.data()
    const after = event.data.after.data()

    if (after.source !== 'self_serve') return
    if (before.confirmedAt || !after.confirmedAt) return

    const db = admin.firestore()
    const configSnap = await db.doc('config/canvas').get()
    const notificationEmail = configSnap.data()?.notificationEmail
    const apiKey = RESEND_API_KEY.value()

    if (!notificationEmail || !apiKey) return // not configured — skip silently

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'RaterSystem <notifications@lenguax.com>',
          to: notificationEmail,
          subject: `Self-serve submission — ${after.raterName}`,
          text: `${after.raterName} has confirmed their self-serve rater exam for "${after.sessionName}".\n\nReview it here: https://lenguax.com/ratersystem/assignments/${event.params.assignmentId}`,
        }),
      })
    } catch (err) {
      console.error('notifySelfServeSubmission: failed to send email', err)
    }
  }
)

// ── enrollmentWebhook ─────────────────────────────────────────────────────────
// HTTP endpoint called by the WordPress plugin after each enrollment attempt.
// Validates a shared secret then writes the event to canvasEnrollmentLog.

// ── canvasSectionEnrollments ──────────────────────────────────────────────────
// Fetches students enrolled in a specific section (not the whole course).
// Used by the section membership audit.

exports.canvasSectionEnrollments = onCall(async (request) => {
  await assertAdmin(request)
  const { sectionId } = request.data
  if (!sectionId) throw new HttpsError('invalid-argument', 'Missing sectionId')

  const apiToken = await getCanvasToken()
  const users = await canvasFetchAll(
    `/api/v1/sections/${sectionId}/enrollments?type[]=StudentEnrollment&per_page=100&include[]=email`,
    apiToken
  )

  const seen = new Set()
  return {
    users: users
      .filter(e => e.user)
      .map(e => ({
        canvasId: e.user.id,
        name: e.user.name ?? '',
        email: (e.user.login_id || e.user.email || '').toLowerCase().trim(),
      }))
      .filter(u => {
        if (seen.has(u.canvasId)) return false
        seen.add(u.canvasId)
        return true
      }),
  }
})

// ── enrollmentWebhook ─────────────────────────────────────────────────────────
exports.enrollmentWebhook = onRequest(
  { secrets: [WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed')
      return
    }

    const secret = req.headers['x-webhook-secret']
    if (!secret || secret !== WEBHOOK_SECRET.value()) {
      res.status(401).send('Unauthorized')
      return
    }

    const { email, name, canvasUserId, sectionId, sectionName, status, orderId } = req.body

    if (!email || !status) {
      res.status(400).send('Missing required fields')
      return
    }

    try {
      await writeEnrollmentLog({
        source: 'woocommerce',
        email,
        name: name || '',
        canvasUserId: canvasUserId || null,
        sectionId: sectionId || null,
        sectionName: sectionName || '',
        status,
        orderId: orderId || null,
      })
      res.status(200).json({ ok: true })
    } catch (err) {
      console.error('enrollmentWebhook error:', err)
      res.status(500).send('Internal error')
    }
  }
)
