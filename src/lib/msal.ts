import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

const msalConfig = {
  auth: {
    clientId: '3df1715f-f75b-412b-ae50-f8a2ac488fe4',
    authority: 'https://login.microsoftonline.com/afd620ce-eaf4-42f0-814f-4f8b48490c4f',
    redirectUri: window.location.origin,
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

export async function msSignIn(): Promise<AccountInfo> {
  await ensureInit()
  const result = await msalInstance.loginPopup({ scopes: GRAPH_SCOPES })
  return result.account
}

export async function msSignOut(): Promise<void> {
  await ensureInit()
  const account = msalInstance.getAllAccounts()[0]
  if (account) await msalInstance.logoutPopup({ account })
}

export function getMsAccount(): AccountInfo | null {
  return msalInstance.getAllAccounts()[0] ?? null
}

export async function getGraphToken(): Promise<string> {
  await ensureInit()
  const account = msalInstance.getAllAccounts()[0]
  if (!account) throw new Error('Not signed in to Microsoft')
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account })
    return result.accessToken
  } catch {
    // Silent acquisition fails when a browser extension blocks the hidden iframe — fall back to popup
    const result = await msalInstance.acquireTokenPopup({ scopes: GRAPH_SCOPES, account })
    return result.accessToken
  }
}
