const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const { resolveItems } = require('./resolveItems')

admin.initializeApp()

const CANVAS_CLIENT_SECRET = defineSecret('CANVAS_CLIENT_SECRET')
const WEBHOOK_SECRET = defineSecret('ENROLLMENT_WEBHOOK_SECRET')
const RESEND_API_KEY = defineSecret('RESEND_API_KEY')
const STORYLINE_SYNC_SECRET = defineSecret('STORYLINE_SYNC_SECRET')
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

// ── syncAdminClaim ────────────────────────────────────────────────────────────
// Mirrors people/{uid}.role onto an `admin: true` Auth custom claim, so
// Storage Security Rules can check request.auth.token.admin directly instead
// of doing a cross-service Firestore read (firestore.get()/exists() from
// Storage rules was found to silently fail in this project — root cause
// unresolved, but custom claims are the standard, documented pattern for
// this anyway and sidestep it entirely). Firestore rules keep using the
// direct people/{uid} lookup as before — this only affects Storage.
// Custom claims only take effect on a user's NEXT ID token — an already
// signed-in session needs to sign out/in (or wait for the ~hourly refresh)
// to pick up a change made here.
exports.syncAdminClaim = onDocumentWritten('people/{personId}', async (event) => {
  const uid = event.params.personId
  const isAdmin = event.data.after?.data()?.role === 'admin'
  try {
    await admin.auth().setCustomUserClaims(uid, isAdmin ? { admin: true } : null)
  } catch (err) {
    // Auth user may not exist yet (e.g. people doc created before first login) — safe to ignore.
    console.error(`syncAdminClaim: failed to set claim for ${uid}`, err.message)
  }
})

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

  // The access token is only needed for the profile lookup above — revoke it
  // immediately so Canvas doesn't accumulate a never-expiring "RaterSystem"
  // entry under Approved Integrations on every single SSO login. Best-effort:
  // a failed revoke shouldn't block sign-in.
  fetch(`${CANVAS_URL}/login/oauth2/token`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${access_token}` },
  }).catch(() => {})
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

// Creates a centre login: a Firebase Auth user in the benchmark project plus
// its matching centre_accounts/{uid} doc, so an admin never has to do the
// manual Console + Firestore two-step described in the README by hand.
exports.createBenchmarkCentreAccount = onCall({ secrets: [BENCHMARK_SERVICE_ACCOUNT_KEY] }, async (request) => {
  await assertAdmin(request)
  const { email, password, centreId, centreName } = request.data
  if (!email || !password || !centreId || !centreName) {
    throw new HttpsError('invalid-argument', 'email, password, centreId, and centreName are all required')
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters')
  }

  const benchmarkApp = getBenchmarkAdminApp()
  const benchmarkDb = admin.firestore(benchmarkApp)

  const existing = await benchmarkDb.collection('centre_accounts').where('centreId', '==', centreId).get()
  if (!existing.empty) {
    throw new HttpsError('already-exists', `centreId "${centreId}" is already in use by another account`)
  }

  const userRecord = await admin.auth(benchmarkApp).createUser({ email, password })
  await benchmarkDb.doc(`centre_accounts/${userRecord.uid}`).set({ centreId, centreName })
  return { uid: userRecord.uid }
})

exports.deleteBenchmarkCentreAccount = onCall({ secrets: [BENCHMARK_SERVICE_ACCOUNT_KEY] }, async (request) => {
  await assertAdmin(request)
  const { uid } = request.data
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required')

  const benchmarkApp = getBenchmarkAdminApp()
  await admin.firestore(benchmarkApp).doc(`centre_accounts/${uid}`).delete()
  await admin.auth(benchmarkApp).deleteUser(uid).catch(() => {})   // account may already be gone
  return { ok: true }
})

// Creates a RaterSystem login: a Firebase Auth user in this project plus its
// matching people/{uid} doc, then emails a password-reset link so the person
// can set their own password — replaces the manual Console + Firestore +
// "send reset email" three-step process described in the README by hand.
// Works for any role (admin/senior_rater/trainee/examiner); Canvas SSO
// users still get provisioned automatically via canvasAuth/Canvas Sync and
// never need this, since they never set a password at all.
exports.invitePerson = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  await assertAdmin(request)
  const { name, email, role, canStandardize } = request.data
  if (!name || !email || !role) {
    throw new HttpsError('invalid-argument', 'name, email, and role are all required')
  }
  if (!['admin', 'senior_rater', 'trainee', 'examiner'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Invalid role')
  }

  const db = admin.firestore()
  const dup = await db.collection('people').where('email', '==', email).limit(1).get()
  if (!dup.empty) throw new HttpsError('already-exists', 'A person with this email already exists')

  let userRecord
  try {
    userRecord = await admin.auth().createUser({ email, displayName: name })
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'This email is already registered in Firebase Auth')
    }
    throw new HttpsError('internal', 'Failed to create account')
  }

  await db.doc(`people/${userRecord.uid}`).set({
    name,
    email,
    role,
    status: 'active',
    canStandardize: !!canStandardize,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // The account + people doc above are the important part and are already
  // durably created — nothing past this point should throw and undo the
  // caller's success. generatePasswordResetLink can fail on its own (e.g. an
  // unauthorized continue-URI domain), so it's wrapped alongside the email
  // send rather than left to crash the whole call; either way the admin can
  // fall back to "Forgot password" on the login page, which doesn't need a
  // custom continue URL at all.
  let inviteEmailSent = false
  try {
    const resetLink = await admin.auth().generatePasswordResetLink(email, {
      url: 'https://lenguax.com/ratersystem/login',
    })
    const apiKey = RESEND_API_KEY.value()
    if (apiKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'RaterSystem <notifications@lenguax.com>',
          to: email,
          subject: 'Set your RaterSystem password',
          text: `You've been added to the Lenguax RaterSystem. Set your password here:\n\n${resetLink}`,
        }),
      })
      inviteEmailSent = res.ok
    }
  } catch (err) {
    console.error('invitePerson: failed to generate/send invite email', err)
  }

  return { uid: userRecord.uid, inviteEmailSent }
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

// ── resendEnrollmentEmail ──────────────────────────────────────────────────────
// Re-sends the "welcome to your course" email for an entry in canvasEnrollmentLog.
// Ports the WordPress plugin's cce_send_enrollment_email/cce_get_email_wrapper
// template (canvas-cohort-enrollment.php) so this works from a single place for
// both WooCommerce-sourced and manually-enrolled entries — the WP plugin's own
// enrollment log only ever contains the former, so manual entries have nowhere
// else to trigger this from.

function enrollmentEmailHtml({ firstName, courseName, canvasUrl }) {
  const body = `
    <p>Hi ${firstName},</p>
    <p>🎉 Welcome to ${courseName}!</p>
    <p>You have been successfully enrolled and can start learning immediately.</p>
    <div class="highlight">
      <p><strong>🚀 Access your course:</strong><br/><a href="${canvasUrl}">${canvasUrl}</a></p>
    </div>
    <p><strong>📚 What's next:</strong></p>
    <ul>
      <li>Check your email for Canvas login instructions (if it's your first time)</li>
      <li>Complete your profile setup</li>
      <li>Start with the course introduction</li>
    </ul>
    <p><strong>💡 Need help?</strong><br/>Reply to this email — course support is available 24/7.</p>
    <p>Happy learning!<br/>The Lenguax Team</p>
  `
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .email-container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .email-header { text-align: center; border-bottom: 2px solid #007cba; padding-bottom: 20px; margin-bottom: 20px; }
        .email-footer { text-align: center; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 20px; font-size: 12px; color: #666; }
        .highlight { background: #f8f9fa; padding: 15px; border-left: 4px solid #007cba; margin: 15px 0; }
        a { color: #007cba; }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header"><h1>Lenguax</h1></div>
        <div class="email-content">${body}</div>
        <div class="email-footer">
          <p>This email was sent by <a href="https://lenguax.com">Lenguax</a></p>
        </div>
      </div>
    </body>
    </html>
  `
}

exports.resendEnrollmentEmail = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  await assertAdmin(request)
  const { email, sectionId, name } = request.data
  if (!email) throw new HttpsError('invalid-argument', 'Missing email')
  if (!sectionId) throw new HttpsError('invalid-argument', 'Missing sectionId')

  const apiToken = await getCanvasToken()

  let courseName = 'Your Course'
  try {
    const sectionRes = await canvasFetch(`/api/v1/sections/${sectionId}`, apiToken)
    if (sectionRes.ok) {
      const section = await sectionRes.json()
      const courseRes = await canvasFetch(`/api/v1/courses/${section.course_id}`, apiToken)
      if (courseRes.ok) {
        const course = await courseRes.json()
        courseName = course.name || courseName
      }
    }
  } catch (err) {
    console.error('resendEnrollmentEmail: failed to look up course name', err)
  }

  const firstName = (name || '').trim().split(/\s+/)[0] || email.split('@')[0]
  const canvasUrl = `${CANVAS_URL}/login/canvas`

  const apiKey = RESEND_API_KEY.value()
  if (!apiKey) throw new HttpsError('failed-precondition', 'Email sending is not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Lenguax <notifications@lenguax.com>',
      to: email,
      subject: `Welcome to ${courseName}! 🎓`,
      html: enrollmentEmailHtml({ firstName, courseName, canvasUrl }),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new HttpsError('internal', `Failed to send email: ${body}`)
  }

  return { sent: true }
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
    .filter(t => t.status === 'active' && !t.excludeFromPool && (t.category ?? 'rater_course') !== 'standardization')

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

// ── notifyStandardizationSubmission ────────────────────────────────────────────
// Same shape as notifySelfServeSubmission above, but for standardization
// assignments (examiners don't have a `source: 'self_serve'` — every
// standardization assignment is admin-created — so this keys off `category`
// instead). Reuses the same `config/canvas.notificationEmail` admin address;
// split into its own config field later if a different recipient is ever needed.

exports.notifyStandardizationSubmission = onDocumentUpdated(
  { document: 'assignments/{assignmentId}', secrets: [RESEND_API_KEY] },
  async (event) => {
    const before = event.data.before.data()
    const after = event.data.after.data()

    if ((after.category ?? 'rater_course') !== 'standardization') return
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
          subject: `Standardization submission — ${after.raterName}`,
          text: `${after.raterName} has confirmed their standardization scores for "${after.sessionName}".\n\nReview it here: https://lenguax.com/ratersystem/assignments/${event.params.assignmentId}`,
        }),
      })
    } catch (err) {
      console.error('notifyStandardizationSubmission: failed to send email', err)
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

// ── reportStorylineEvent ────────────────────────────────────────────────────
// The exported Storyline player's only channel back to us — player-src/ is a
// standalone bundle with no Firebase SDK/session (see dataSource.ts), so this
// is a plain unauthenticated fetch straight from an examiner's browser at a
// random test centre. No auth check is possible (nowhere to hold a secret);
// it's shaped-input-only, matching the already-public nature of the exported
// player.
//
// Two request shapes are accepted:
//   • { events: [ { event, runId, playerBuild, clientTs, ...context, data } ] }
//     — the current telemetry batch from player-src/shared/telemetry.ts. The
//     player emits a broad stream (session_start, slide_view, audio_play/
//     ended, checklist toggles, connectivity, accept/reject/finish, …); we
//     store all of it in storyline_events and let the rules below decide what,
//     if anything, is worth an email. Adding a new event name never needs a
//     player change on our side — only re-export of the tests that emit it.
//   • { type: 'violation' | 'completed', subtype, ...context, details }
//     — the legacy single-event shape from players exported before the batch
//     endpoint. Normalised to one event ('completed' → test_finished,
//     'violation' → its subtype) and handled identically from there.
//
// Email routing: config/storyline (separate from config/canvas's own
// notificationEmail) carries `notificationEmail` (ops) and `complianceEmail`.
// STORYLINE_EMAIL_RULES maps an event name to which of those inboxes it
// reaches; anything not in the map is stored only. Either address may be
// unset (skipped); with neither set, or no API key, events are still logged.
const STORYLINE_EMAIL_RULES = {
  test_finished:           ['ops'],
  test_rejected:           ['ops'],
  audio_replay_limit:      ['ops', 'compliance'],
  candidate_window_closed: ['ops', 'compliance'],
  connectivity_online:     ['ops'],
  connectivity_dropped:    ['ops'], // legacy name for the same concern
}

function normalizeStorylineEvents(body) {
  const ctx = (e) => ({
    testDisplayName: e.testDisplayName || null,
    centreName: e.centreName || null,
    testNumber: e.testNumber || null,
    examinerName: e.examinerName || null,
    candidateName: e.candidateName || null,
    ungated: typeof e.ungated === 'boolean' ? e.ungated : null,
    hasLiveContent: typeof e.hasLiveContent === 'boolean' ? e.hasLiveContent : null,
  })
  if (Array.isArray(body.events)) {
    return body.events
      .filter((e) => e && typeof e.event === 'string')
      .slice(0, 300)
      .map((e) => ({
        event: e.event,
        runId: e.runId || null,
        playerBuild: e.playerBuild || null,
        clientTs: e.clientTs || null,
        ...ctx(e),
        data: e.data && typeof e.data === 'object' ? e.data : null,
      }))
  }
  const { type, subtype } = body
  if (type === 'violation' || type === 'completed') {
    return [{
      event: type === 'completed' ? 'test_finished' : (subtype || 'violation'),
      runId: null,
      playerBuild: 'legacy',
      clientTs: null,
      ...ctx(body),
      data: body.details ? { details: body.details } : null,
    }]
  }
  return null
}

exports.reportStorylineEvent = onRequest(
  { secrets: [RESEND_API_KEY], cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed')
      return
    }

    const events = normalizeStorylineEvents(req.body || {})
    if (!events || events.length === 0) {
      res.status(400).send('No valid events')
      return
    }

    const db = admin.firestore()
    try {
      const writer = db.batch()
      for (const e of events) {
        writer.set(db.collection('storyline_events').doc(), {
          ...e,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await writer.commit()
    } catch (err) {
      console.error('reportStorylineEvent: failed to log events', err)
      res.status(500).send('Internal error')
      return
    }

    try {
      const emailable = events.filter((e) => STORYLINE_EMAIL_RULES[e.event])
      if (emailable.length > 0) {
        const cfg = (await db.doc('config/storyline').get()).data() || {}
        const apiKey = RESEND_API_KEY.value()
        const addr = { ops: cfg.notificationEmail, compliance: cfg.complianceEmail }
        if (apiKey) {
          // One email per recipient so ops and compliance never see each
          // other's address and one bad address can't block the other.
          await Promise.all(emailable.flatMap((e) => {
            const tos = [...new Set(STORYLINE_EMAIL_RULES[e.event].map((r) => addr[r]).filter(Boolean))]
            const testLabel = e.testDisplayName || 'Unknown test'
            const isCompletion = e.event === 'test_finished'
            const subject = isCompletion
              ? `Test completed — ${testLabel}`
              : `Test event — ${testLabel} (${e.event})`
            const extra = e.data && e.data.details ? `\n\n${e.data.details}` : ''
            const text = `${isCompletion ? 'A test was completed.' : `Reported: ${e.event}.`}\n\n`
              + `Test: ${e.testDisplayName || '—'}\nCentre: ${e.centreName || '—'}\n`
              + `Test number: ${e.testNumber || '—'}\nExaminer: ${e.examinerName || '—'}\n`
              + `Candidate: ${e.candidateName || '—'}${extra}`
            return tos.map((to) =>
              fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: 'RaterSystem <notifications@lenguax.com>', to, subject, text }),
              }).catch((err) => console.error(`reportStorylineEvent: email to ${to} failed`, err)),
            )
          }))
        }
      }
    } catch (err) {
      // Never fail the request over email — events are already logged.
      console.error('reportStorylineEvent: email pass failed', err)
    }

    res.status(200).json({ ok: true })
  }
)

// ── getStorylineLiveContent ──────────────────────────────────────────────
// Called by examiner.ts at boot, for exported Versions with
// versionType === 'live' only (see flags.json's liveContentId, set by
// exportStorylineVersion() in exportStoryline.ts) — lets an admin's edit to
// a Test's shared template wording or a Part's content apply to every
// already-deployed live exam immediately, without a re-Publish/re-Export/
// re-upload cycle. Backup and Practice exports never carry a
// liveContentId, so they never call this — fully static, exactly as
// before this function existed.
//
// Same "no real auth possible" situation as reportStorylineEvent above
// (browser at a random test centre) — gated only by requiring the exact
// Firestore Version id (a random ~20-char auto-ID, only ever embedded
// inside that specific exam's own already-access-controlled zip) plus the
// versionType/status checks below. A deliberate, accepted narrowing of
// confidentiality versus the PHP session/booking-hash gate examiner.php
// itself provides — see /home/paul/.claude/plans/deep-wibbling-flurry.md
// for the full reasoning; do not "fix" this by adding a secret that a
// client-side fetch can't safely hold anyway.
//
// Returns only examinerText/notes per resolved item id — deliberately not
// the full StorylineItem (which would include live Firebase Storage URLs
// in .media, not the zip's bundled relative media/ paths). This makes it
// structurally impossible for the player's merge step to accidentally pull
// in live media and quietly break offline-resilience for images/audio,
// which must stay bundled/static even for Live Versions.
//
// A missing referenced doc (template/test/any of the 4 Parts) is treated
// as a hard failure, not a partial resolve — a partial result would be
// silently *wrong* text, worse than the client's safe fallback to its
// bundled static snapshot. An inactive/backup/archived-but-still-existing
// Part is NOT an error: those flags govern future selection eligibility,
// not whether an already-assigned reference still resolves.
exports.getStorylineLiveContent = onRequest(
  { cors: true, maxInstances: 10 },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }

    const versionId = req.query.versionId
    if (!versionId || typeof versionId !== 'string') {
      res.status(400).send('Missing versionId')
      return
    }

    const db = admin.firestore()
    try {
      const versionSnap = await db.collection('storyline_versions').doc(versionId).get()
      if (!versionSnap.exists) {
        res.status(404).send('Not found')
        return
      }
      const version = versionSnap.data()
      if ((version.versionType ?? 'live') !== 'live' || version.status !== 'published') {
        res.status(404).send('Not found')
        return
      }

      const partIds = version.partRefs ?? {}
      const [testSnap, templateSnap, part1Snap, part2Snap, part3Snap, part4Snap] = await Promise.all([
        db.collection('storyline_tests').doc(version.testId).get(),
        db.collection('storyline_template').doc('current').get(),
        partIds[1] ? db.collection('storyline_parts').doc(partIds[1]).get() : Promise.resolve(null),
        partIds[2] ? db.collection('storyline_parts').doc(partIds[2]).get() : Promise.resolve(null),
        partIds[3] ? db.collection('storyline_parts').doc(partIds[3]).get() : Promise.resolve(null),
        partIds[4] ? db.collection('storyline_parts').doc(partIds[4]).get() : Promise.resolve(null),
      ])

      const partSnaps = { 1: part1Snap, 2: part2Snap, 3: part3Snap, 4: part4Snap }
      const missing = []
      if (!testSnap.exists) missing.push(`storyline_tests/${version.testId}`)
      if (!templateSnap.exists) missing.push('storyline_template/current')
      for (const n of [1, 2, 3, 4]) {
        if (partIds[n] && !partSnaps[n].exists) missing.push(`storyline_parts/${partIds[n]}`)
      }
      if (missing.length > 0) {
        console.error(`getStorylineLiveContent: missing referenced doc(s) for version ${versionId}:`, missing)
        res.status(404).send('Not found')
        return
      }

      const test = testSnap.data()
      const template = templateSnap.data()
      const parts = {}
      for (const n of [1, 2, 3, 4]) {
        if (partIds[n]) parts[n] = { slotContent: partSnaps[n].data().slotContent }
      }

      const resolved = resolveItems(
        template.slides,
        test.variables,
        version.slotContent ?? {},
        parts,
        `${test.name}: ${version.versionLabel}`,
      )

      const items = resolved.map(item => ({
        id: item.id,
        examinerText: item.examinerText,
        notes: item.notes ?? null,
      }))

      res.set('Cache-Control', 'no-store')
      res.status(200).json({ items })
    } catch (err) {
      console.error('getStorylineLiveContent error:', err)
      res.status(500).send('Internal error')
    }
  }
)

// ── getStorylineSyncData ─────────────────────────────────────────────────
// Polled by a WordPress cron job (see TEAC-Plugin-master/includes/
// class-teac-storyline-sync.php in the sibling Storyline-Replacement repo)
// to sync Part/theme/rule *metadata* (never content) down into WP-adjacent
// MySQL for dynamic Part-pooling selection — see /home/paul/.claude/plans/
// encapsulated-drifting-corbato.md §4. WordPress polls rather than
// Firestore pushing: no mysql driver or outbound-DB precedent exists in
// this codebase, and the droplet is self-hosted (not a managed Cloud SQL
// instance reachable via a proxy), so an outbound connection from here
// would mean exposing MySQL's port or building a tunnel that doesn't exist
// today, for no real gain over polling.
//
// Resolves each Part's `testTypes` (a list of TEAC role-type *labels*, e.g.
// "Approach ATC") into concrete `wpTestId`s here, server-side, so
// WordPress never needs to understand Firestore's testType-label matching
// — it just gets a flat list of (part, wpTestId) pairs to upsert. A Part
// with no testTypes (undefined/empty = eligible for every type, the
// established convention — see StorylinePart.testTypes) is expanded
// against every synced Test, not skipped. Only published Parts are
// included (drafts/archived excluded) — themes/rules have no publish
// lifecycle of their own, so all of them sync.
exports.getStorylineSyncData = onRequest(
  { secrets: [STORYLINE_SYNC_SECRET] },
  async (req, res) => {
    const secret = req.headers['x-sync-secret']
    if (!secret || secret !== STORYLINE_SYNC_SECRET.value()) {
      res.status(401).send('Unauthorized')
      return
    }

    const db = admin.firestore()
    try {
      const [partsSnap, themesSnap, rulesSnap, testsSnap] = await Promise.all([
        db.collection('storyline_parts').where('status', '==', 'published').get(),
        db.collection('storyline_themes').get(),
        db.collection('storyline_theme_rules').get(),
        db.collection('storyline_tests').get(),
      ])

      const testsWithWpId = testsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => t.wpTestId != null)

      const parts = partsSnap.docs.map(d => {
        const p = d.data()
        return {
          firestoreId: d.id,
          partNumber: p.partNumber,
          // Active for selection purposes: not explicitly deactivated, not
          // a reserve/backup, and not retired-to-practice-only content —
          // matches the eligibility posture already used in
          // StorylinePartsPage/StorylineVersionEditorPage. Real candidates
          // must never be assigned backup or retired content by the future
          // dynamic Part-pooling selection this feeds.
          active: p.active !== false && !p.isBackup && !p.retired,
          themeFirestoreId: p.themeId ?? null,
          // Only ever consumed by the one-off legacy exposure backfill
          // (Phase D) — lets that script map an old content-pool code
          // (parsed from a historical booking's TestVersion) to a specific
          // synced wp_teac_storyline_parts row, without WordPress needing
          // any Firestore access of its own.
          legacyCode: p.legacyCode ?? null,
        }
      })

      const partTestTypePairs = []
      for (const d of partsSnap.docs) {
        const p = d.data()
        const eligibleTests = p.testTypes?.length
          ? testsWithWpId.filter(t => p.testTypes.includes(t.testType))
          : testsWithWpId
        for (const t of eligibleTests) {
          partTestTypePairs.push({ partFirestoreId: d.id, wpTestId: t.wpTestId })
        }
      }

      const themes = themesSnap.docs.map(d => ({ firestoreId: d.id, label: d.data().label }))
      const themeRules = rulesSnap.docs.map(d => ({
        firestoreId: d.id,
        part1ThemeFirestoreId: d.data().part1ThemeId,
        part4ThemeFirestoreId: d.data().part4ThemeId,
      }))

      res.status(200).json({ parts, partTestTypePairs, themes, themeRules })
    } catch (err) {
      console.error('getStorylineSyncData error:', err)
      res.status(500).send('Internal error')
    }
  }
)
