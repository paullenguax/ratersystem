import { Navigate } from 'react-router-dom'
import { useAuth, type Role } from '@/context/AuthContext'

interface Props {
  children: React.ReactNode
  allowedRoles?: Role[]
  // Gate for pages that any role can reach as long as they have standardization
  // capability — either the dedicated 'interlocutor' role or an existing
  // rater's canStandardize flag. Admins always pass, so they can QA the page.
  requireStandardization?: boolean
}

export function ProtectedRoute({ children, allowedRoles, requireStandardization }: Props) {
  const { user, role, canStandardize, loading } = useAuth()

  if (loading) return null

  if (!user) return <Navigate to="/login" replace />

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />
  }

  if (requireStandardization && role !== 'admin' && role !== 'interlocutor' && !canStandardize) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
