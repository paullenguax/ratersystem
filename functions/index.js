const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')

admin.initializeApp()

const CANVAS_CLIENT_SECRET = defineSecret('CANVAS_CLIENT_SECRET')
const CANVAS_URL = 'https://courses.lenguax.com'
const CANVAS_CLIENT_ID = '10000000000002'
const REDIRECT_URI = 'https://lenguax.com/ratersystem/auth/canvas/callback'

exports.canvasAuth = onCall({ secrets: [CANVAS_CLIENT_SECRET] }, async (request) => {
  const { code } = request.data
  if (!code) throw new HttpsError('invalid-argument', 'Missing OAuth code')

  // Exchange code for Canvas access token
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

  // Fetch Canvas user profile
  const userRes = await fetch(`${CANVAS_URL}/api/v1/users/self`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })

  if (!userRes.ok) throw new HttpsError('internal', 'Failed to fetch Canvas user profile')

  const canvasUser = await userRes.json()
  const email = (canvasUser.login_id || canvasUser.primary_email || '').toLowerCase().trim()

  if (!email) throw new HttpsError('internal', 'Could not determine email from Canvas profile')

  // Look up person in Firestore by email
  const db = admin.firestore()
  const snap = await db.collection('people').where('email', '==', email).limit(1).get()

  if (snap.empty) {
    throw new HttpsError('not-found', 'No RaterSystem account found for this Canvas user. Contact your administrator.')
  }

  const personDoc = snap.docs[0]
  const personId = personDoc.id

  // Ensure a Firebase Auth user exists with UID === Firestore people doc ID
  try {
    await admin.auth().getUser(personId)
  } catch {
    // No Auth user with this UID yet — create one (sets UID = people doc ID)
    const existingByEmail = await admin.auth().getUserByEmail(email).catch(() => null)
    if (existingByEmail) {
      // Auth user exists but with a different UID — just use it
      const token = await admin.auth().createCustomToken(existingByEmail.uid)
      return { token }
    }
    await admin.auth().createUser({
      uid: personId,
      email,
      displayName: personDoc.data().name,
    })
  }

  const token = await admin.auth().createCustomToken(personId)
  return { token }
})

exports.canvasEnrollments = onCall(async (request) => {
  const { courseId } = request.data
  if (!courseId) throw new HttpsError('invalid-argument', 'Missing courseId')

  const db = admin.firestore()
  const configSnap = await db.doc('config/canvas').get()
  if (!configSnap.exists) throw new HttpsError('not-found', 'Canvas config not set up')

  const apiToken = configSnap.data().apiToken
  if (!apiToken) throw new HttpsError('not-found', 'Canvas API token not configured')

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
