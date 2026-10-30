import type { ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { InvitationPage } from '../account/InvitationPage'
import { ResetPasswordPage } from '../account/ResetPasswordPage'
import { RequireAccess, RequireAuth } from '../auth/RequireAuth'
import { AppLayout } from '../layout/AppLayout'
import { AssignmentsPage } from '../pages/AssignmentsPage'
import { AuditLogPage } from '../pages/AuditLogPage'
import { CertificatesPage } from '../pages/CertificatesPage'
import { ClassesPage } from '../pages/ClassesPage'
import { CoursesPage } from '../pages/CoursesPage'
import { DashboardPage } from '../pages/DashboardPage'
import { ExamsPage } from '../pages/ExamsPage'
import { LessonsPage } from '../pages/LessonsPage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { PaymentsPage } from '../pages/PaymentsPage'
import { ProfilePage } from '../pages/ProfilePage'
import { ReportsPage } from '../pages/ReportsPage'
import { SchedulePage } from '../pages/SchedulePage'
import { SettingsPage } from '../pages/SettingsPage'
import { UsersPage } from '../pages/UsersPage'

/** The entry of NAV_ITEMS decides: permission keys where the module has an API, the role matrix elsewhere. */
function guarded(navKey: string, page: ReactNode) {
  return <RequireAccess navKey={navKey}>{page}</RequireAccess>
}

// Paths mirror NAV_ITEMS in ../layout/navigation.ts.
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Public token pages (MOD-03-T12): the one-time link is the only credential.
  { path: '/invite/:token', element: <InvitationPage /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: guarded('dashboard', <DashboardPage />) },
      { path: 'users', element: guarded('users', <UsersPage />) },
      { path: 'courses', element: guarded('courses', <CoursesPage />) },
      { path: 'classes', element: guarded('classes', <ClassesPage />) },
      { path: 'schedule', element: guarded('schedule', <SchedulePage />) },
      { path: 'lessons', element: guarded('lessons', <LessonsPage />) },
      { path: 'assignments', element: guarded('assignments', <AssignmentsPage />) },
      { path: 'exams', element: guarded('exams', <ExamsPage />) },
      { path: 'certificates', element: guarded('certificates', <CertificatesPage />) },
      { path: 'payments', element: guarded('payments', <PaymentsPage />) },
      { path: 'notifications', element: guarded('notifications', <NotificationsPage />) },
      { path: 'reports', element: guarded('reports', <ReportsPage />) },
      { path: 'audit-logs', element: guarded('audit', <AuditLogPage />) }, // `audit.read` (MOD-03-T15)
      { path: 'settings', element: guarded('settings', <SettingsPage />) },
      { path: 'settings/roles', element: guarded('roles', <SettingsPage section="roles" />) }, // `roles.manage` alone, not the settings role (D-R06, MOD-03-T13/T15)
      // Own profile: every signed-in user, whatever the role.
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
