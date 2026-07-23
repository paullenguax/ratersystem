import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

export type Role = 'admin' | 'senior_rater' | 'trainee' | 'interlocutor'

interface AuthState {
  user: User | null
  role: Role | null
  canStandardize: boolean
  loading: boolean
}

const initialState: AuthState = { user: null, role: null, canStandardize: false, loading: true }

const AuthContext = createContext<AuthState>(initialState)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState)

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, role: null, canStandardize: false, loading: false })
        return
      }
      setState({ user: null, role: null, canStandardize: false, loading: true })
      const snap = await getDoc(doc(db, 'people', user.uid))
      const role = (snap.data()?.role ?? null) as Role | null
      const canStandardize = Boolean(snap.data()?.canStandardize)
      setState({ user, role, canStandardize, loading: false })
    })
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
