const CANVAS_OAUTH_URL = 'https://courses.lenguax.com/login/oauth2/auth'
const CANVAS_CLIENT_ID = '10000000000002'
const REDIRECT_URI = 'https://lenguax.com/ratersystem/auth/canvas/callback'

// `state` round-trips through Canvas unmodified and comes back as a query
// param on the callback — used to distinguish a normal login from the
// self-serve "take a test" entry point.
export function canvasOAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: CANVAS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
  })
  if (state) params.set('state', state)
  return `${CANVAS_OAUTH_URL}?${params.toString()}`
}
