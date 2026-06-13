import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

type Role = 'admin' | 'senior_rater' | 'trainee'

interface AuthState {
  user: User | null
  role: Role | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({ user: null, role: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, role: null, loading: true })

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, role: null, loading: false })
        return
      }
      const snap = await getDoc(doc(db, 'people', user.uid))
      const role = (snap.data()?.role ?? null) as Role | null
      setState({ user, role, loading: false })
    })
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
