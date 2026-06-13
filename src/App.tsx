import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/context/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PeoplePage } from '@/features/people/PeoplePage'
import { TestBankPage } from '@/features/testBank/TestBankPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { AssignmentsPage } from '@/features/assignments/AssignmentsPage'
import { ScoringPage } from '@/features/scoring/ScoringPage'
import { StatisticsPage } from '@/features/statistics/StatisticsPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { AdminPage } from '@/features/admin/AdminPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="people"      element={<ProtectedRoute allowedRoles={['admin']}><PeoplePage /></ProtectedRoute>} />
                <Route path="test-bank"   element={<ProtectedRoute allowedRoles={['admin']}><TestBankPage /></ProtectedRoute>} />
                <Route path="sessions"    element={<ProtectedRoute allowedRoles={['admin']}><SessionsPage /></ProtectedRoute>} />
                <Route path="assignments" element={<AssignmentsPage />} />
                <Route path="scoring"     element={<ScoringPage />} />
                <Route path="statistics"  element={<ProtectedRoute allowedRoles={['admin']}><StatisticsPage /></ProtectedRoute>} />
                <Route path="reports"     element={<ProtectedRoute allowedRoles={['admin']}><ReportsPage /></ProtectedRoute>} />
                <Route path="admin"       element={<ProtectedRoute allowedRoles={['admin']}><AdminPage /></ProtectedRoute>} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
