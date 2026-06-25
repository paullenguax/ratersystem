import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

const msalConfig = {
  auth: {
    clientId: '3df1715f-f75b-412b-ae50-f8a2ac488fe4',
    authority: 'https://login.microsoftonline.com/afd620ce-eaf4-42f0-814f-4f8b48490c4f',
    redirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: { cacheLocation: 'sessionStorage' as const },
}

export const msalInstance = new PublicClientApplication(msalConfig)

let initialised = false
async function ensureInit() {
  if (!initialised) {
    await msalInstance.initialize()
    initialised = true
  }
}

export const GRAPH_SCOPES = ['Files.ReadWrite']

// Cache the token in memory so we never need a hidden iframe
let tokenCache: { token: string; expiry: number } | null = null

export async function msSignIn(): Promise<AccountInfo> {
  await ensureInit()
  // Clear any stuck interaction lock left by previous failed/timed-out attempts
  for (const key of Object.keys(sessionStorage)) {
    if (key.includes('interaction')) sessionStorage.removeItem(key)
  }
  const result = await msalInstance.loginPopup({ scopes: GRAPH_SCOPES })
  tokenCache = { token: result.accessToken, expiry: result.expiresOn?.getTime() ?? 0 }
  return result.account
}

export async function msSignOut(): Promise<void> {
  await ensureInit()
  tokenCache = null
  const account = msalInstance.getAllAccounts()[0]
  if (account) await msalInstance.logoutPopup({ account })
}

export function getMsAccount(): AccountInfo | null {
  return msalInstance.getAllAccounts()[0] ?? null
}

export async function getGraphToken(): Promise<string> {
  // Use cached token if valid for at least another 5 minutes
  if (tokenCache && tokenCache.expiry > Date.now() + 5 * 60 * 1000) {
    return tokenCache.token
  }
  // Token expired — ask the user to reconnect (avoids iframe-based silent refresh)
  throw new Error('OneDrive session expired — please disconnect and reconnect.')
}
