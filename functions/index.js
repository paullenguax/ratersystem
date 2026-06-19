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
