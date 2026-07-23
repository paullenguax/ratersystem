import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken } from 'firebase/auth'
import { functions, auth } from '@/lib/firebase'

export function CanvasCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const isSelfServeExam = state === 'self_serve'
    // Practice Sessions round-trips its own code through the same `state`
    // channel (Canvas always redirects to this one fixed callback URL, so
    // `state` is the only way the originating page says "come back to X").
    const practiceCode = state?.startsWith('practice:') ? decodeURIComponent(state.slice('practice:'.length)) : null
    const selfServe = isSelfServeExam || !!practiceCode
    if (!code) { setError('No authorisation code received from Canvas.'); return }

    const canvasAuth = httpsCallable<{ code: string; selfServe: boolean }, { token: string }>(functions, 'canvasAuth')
    const requestSelfAssignment = httpsCallable<Record<string, never>, { assignmentId: string }>(functions, 'requestSelfAssignment')

    canvasAuth({ code, selfServe })
      .then(result => signInWithCustomToken(auth, result.data.token))
      .then(async () => {
        if (isSelfServeExam) {
          const result = await requestSelfAssignment({})
          navigate('/scoring', { replace: true, state: { assignmentId: result.data.assignmentId } })
        } else if (practiceCode) {
          navigate(`/practice/${practiceCode}`, { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      })
      .catch(err => setError(err.message ?? 'Sign-in failed. Please try again.'))
  }, [navigate])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#B3C8D9]/30">
        <div className="bg-white rounded-2xl shadow-lg px-8 py-10 space-y-4 max-w-sm text-center">
          <p className="text-sm text-destructive">{error}</p>
          <a href="/ratersystem/login" className="text-sm text-primary underline">Back to login</a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#B3C8D9]/30">
      <p className="text-sm text-muted-foreground">Signing in with Canvas…</p>
    </div>
  )
}
