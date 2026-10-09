import { useState, useEffect } from 'react'
import { msSignIn, msSignOut, getMsAccount, getTokenStatus } from '@/lib/msal'

// Microsoft (SharePoint) sign-in state for pages that upload to SharePoint.
export function useMsConnection() {
  const [account, setAccount] = useState(() => getMsAccount())
  const [status, setStatus]   = useState(() => getTokenStatus())
  const [signInErr, setSignInErr] = useState<string | null>(null)

  useEffect(() => {
    function refresh() {
      setAccount(getMsAccount())
      setStatus(getTokenStatus())
    }
    refresh()
    // Catches the token quietly expiring while the page just sits open —
    // not just on mount/sign-in/sign-out.
    const interval = setInterval(refresh, 60_000)
    return () => clearInterval(interval)
  }, [])

  async function signIn() {
    setSignInErr(null)
    try {
      const signedIn = await msSignIn()
      setAccount(signedIn)
      setStatus(getTokenStatus())
    } catch (err) {
      setSignInErr(err instanceof Error ? err.message : 'Microsoft sign-in failed')
    }
  }

  async function signOut() {
    await msSignOut()
    setAccount(null)
    setStatus('signed-out')
  }

  return { account, status, signInErr, signIn, signOut }
}

export type MsConnection = ReturnType<typeof useMsConnection>
