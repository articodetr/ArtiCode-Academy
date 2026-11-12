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
import { MyAssignmentsPage } from '../pages/MyAssignmentsPage'
import { MyClassesPage } from '../pages/MyClassesPage'
import { MyInvoicesPage } from '../pages/MyInvoicesPage'
import { MyLessonsPage } from '../pages/MyLessonsPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { PaymentsPage } from '../pages/PaymentsPage'
import { ProfilePage } from '../pages/ProfilePage'
import { MyReceiptPage, ReceiptPage } from '../pages/ReceiptPage'
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
  // Receipt print pages (J-F52 — MOD-11-T07): signed-in, outside the app chrome, so the browser prints the receipt alone.
  { path: '/payments/:id/receipt', element: <RequireAuth>{guarded('payments', <ReceiptPage />)}</RequireAuth> }, // the read keys of the invoices (API-153)
  { path: '/my-invoices/receipts/:id', element: <RequireAuth>{guarded('myInvoices', <MyReceiptPage />)}</RequireAuth> }, // ownership (API-155)
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
      { path: 'my-classes', element: guarded('myClasses', <MyClassesPage />) }, // `student`/`guardian` role keys (J-F04, API-060 — ownership)
      { path: 'schedule', element: guarded('schedule', <SchedulePage />) },
      { path: 'lessons', element: guarded('lessons', <LessonsPage />) },
      { path: 'my-lessons', element: guarded('myLessons', <MyLessonsPage />) }, // `student`/`guardian` role keys (J-F11, API-101 — ownership)
      { path: 'assignments', element: guarded('assignments', <AssignmentsPage />) },
      { path: 'my-assignments', element: guarded('myAssignments', <MyAssignmentsPage />) }, // `student`/`guardian` role keys (J-F42, API-112 — ownership)
      { path: 'my-invoices', element: guarded('myInvoices', <MyInvoicesPage />) }, // `student`/`guardian` role keys (J-F52, API-155 — ownership + read_own/read_linked)
      { path: 'exams', element: guarded('exams', <ExamsPage />) },
      { path: 'certificates', element: guarded('certificates', <CertificatesPage />) },
      { path: 'payments', element: guarded('payments', <PaymentsPage />) },
      { path: 'notifications', element: guarded('notifications', <NotificationsPage />) },
      { path: 'reports', element: guarded('reports', <ReportsPage />) },
      { path: 'audit-logs', element: guarded('audit', <AuditLogPage />) }, // `audit.read` (MOD-03-T15)
      { path: 'settings', element: guarded('settings', <SettingsPage />) },
      { path: 'settings/roles', element: guarded('roles', <SettingsPage section="roles" />) }, // `roles.manage` alone, not the settings role (D-R06, MOD-03-T13/T15)
      { path: 'settings/branches', element: guarded('branches', <SettingsPage section="branches" />) }, // `branches.manage` alone (MOD-02-T06 screen)
      { path: 'settings/rooms', element: guarded('rooms', <SettingsPage section="rooms" />) }, // `schedule.manage` alone (J-F06 — MOD-07-T02 screen)
      { path: 'settings/grade-schemes', element: guarded('gradeSchemes', <SettingsPage section="gradeSchemes" />) }, // `academy.settings.manage` alone (J-F44 — MOD-09-T08 part a)
      { path: 'settings/fee-plans', element: guarded('feePlans', <SettingsPage section="feePlans" />) }, // `fee_plans.manage` or `invoices.manage` (J-F52 — MOD-11-T07)
      // Own profile: every signed-in user, whatever the role.
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
