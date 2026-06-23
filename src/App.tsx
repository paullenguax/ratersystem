import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/context/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { CanvasCallbackPage } from '@/features/auth/CanvasCallbackPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PeoplePage } from '@/features/people/PeoplePage'
import { TestBankPage } from '@/features/testBank/TestBankPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { AssignmentsPage } from '@/features/assignments/AssignmentsPage'
import { AssignmentReviewPage } from '@/features/assignments/AssignmentReviewPage'
import { QuickEntryPage } from '@/features/assignments/QuickEntryPage'
import { ScoringPage } from '@/features/scoring/ScoringPage'
import { StatisticsPage } from '@/features/statistics/StatisticsPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { ScoresPage } from '@/features/scores/ScoresPage'
import { AdminPage } from '@/features/admin/AdminPage'
import { ImportRatersPage } from '@/features/admin/ImportRatersPage'
import { ImportTestsPage } from '@/features/admin/ImportTestsPage'
import { ImportHistoricalScoresPage } from '@/features/admin/ImportHistoricalScoresPage'
import { CanvasSyncPage } from '@/features/admin/CanvasSyncPage'
import { AutoAssignPage } from '@/features/admin/AutoAssignPage'
import { ImportRaschPage } from '@/features/admin/ImportRaschPage'
import { CertAssetsPage } from '@/features/admin/CertAssetsPage'
import { CertificatesPage } from '@/features/certificates/CertificatesPage'
import { ValidatePage } from '@/features/certificates/ValidatePage'
import { FeedbackReportPage } from '@/features/feedbackReport/FeedbackReportPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter basename="/ratersystem">
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/validate/:certNumber" element={<ValidatePage />} />
              <Route path="/validate" element={<ValidatePage />} />
              <Route path="/auth/canvas/callback" element={<CanvasCallbackPage />} />

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
                <Route path="assignments/quick-entry" element={<ProtectedRoute allowedRoles={['admin']}><QuickEntryPage /></ProtectedRoute>} />
                <Route path="assignments/:assignmentId" element={<ProtectedRoute allowedRoles={['admin']}><AssignmentReviewPage /></ProtectedRoute>} />
                <Route path="scoring"     element={<ScoringPage />} />
                <Route path="scores"      element={<ProtectedRoute allowedRoles={['admin']}><ScoresPage /></ProtectedRoute>} />
                <Route path="statistics"  element={<ProtectedRoute allowedRoles={['admin']}><StatisticsPage /></ProtectedRoute>} />
                <Route path="reports"          element={<ProtectedRoute allowedRoles={['admin']}><ReportsPage /></ProtectedRoute>} />
                <Route path="feedback-report" element={<ProtectedRoute allowedRoles={['admin', 'senior_rater']}><FeedbackReportPage /></ProtectedRoute>} />
                <Route path="certificates" element={<ProtectedRoute allowedRoles={['admin']}><CertificatesPage /></ProtectedRoute>} />
                <Route path="admin"       element={<ProtectedRoute allowedRoles={['admin']}><AdminPage /></ProtectedRoute>} />
                <Route path="admin/import-raters" element={<ProtectedRoute allowedRoles={['admin']}><ImportRatersPage /></ProtectedRoute>} />
                <Route path="admin/import-tests"  element={<ProtectedRoute allowedRoles={['admin']}><ImportTestsPage /></ProtectedRoute>} />
                <Route path="admin/import-historical-scores" element={<ProtectedRoute allowedRoles={['admin']}><ImportHistoricalScoresPage /></ProtectedRoute>} />
                <Route path="admin/canvas-sync"   element={<ProtectedRoute allowedRoles={['admin']}><CanvasSyncPage /></ProtectedRoute>} />
                <Route path="admin/auto-assign"   element={<ProtectedRoute allowedRoles={['admin']}><AutoAssignPage /></ProtectedRoute>} />
                <Route path="admin/import-rasch"  element={<ProtectedRoute allowedRoles={['admin']}><ImportRaschPage /></ProtectedRoute>} />
                <Route path="admin/cert-assets"   element={<ProtectedRoute allowedRoles={['admin']}><CertAssetsPage /></ProtectedRoute>} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
