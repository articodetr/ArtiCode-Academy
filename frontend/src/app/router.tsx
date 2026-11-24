import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router'
import { VerifyEmailPage } from '../account/VerifyEmailPage'
import { ForgotPasswordPage } from '../account/ForgotPasswordPage'
import { InvitationPage } from '../account/InvitationPage'
import { ResetPasswordPage } from '../account/ResetPasswordPage'
import { RequireAccess, RequireAuth } from '../auth/RequireAuth'
import { AppLayout } from '../layout/AppLayout'
import { AssignmentsPage } from '../pages/AssignmentsPage'
import { AuditLogPage } from '../pages/AuditLogPage'
import { CatalogCoursePage } from '../pages/CatalogCoursePage'
import { CatalogPage } from '../pages/CatalogPage'
import { EnrollmentRequestsPage } from '../pages/EnrollmentRequestsPage'
import { LearnPage } from '../pages/LearnPage'
import { LearnPreviewPage } from '../pages/LearnPreviewPage'
import { PublicCatalogPage } from '../pages/PublicCatalogPage'
import { PublicHomePage } from '../pages/PublicHomePage'
import { PublicCoursePage } from '../pages/PublicCoursePage'
import { CertificatePrintPage } from '../pages/CertificatePrintPage'
import { CertificatesPage } from '../pages/CertificatesPage'
import { ClassesPage } from '../pages/ClassesPage'
import { CoursesPage } from '../pages/CoursesPage'
import { DashboardPage } from '../pages/DashboardPage'
import { ExamsPage } from '../pages/ExamsPage'
import { GoogleDonePage } from '../pages/GoogleDonePage'
import { LessonsPage } from '../pages/LessonsPage'
import { LoginPage } from '../pages/LoginPage'
import { MyAssignmentsPage } from '../pages/MyAssignmentsPage'
import { MyCertificatesPage } from '../pages/MyCertificatesPage'
import { MyClassLessonsPage } from '../pages/MyClassLessonsPage'
import { MyClassesPage } from '../pages/MyClassesPage'
import { MyExamsPage } from '../pages/MyExamsPage'
import { MyGradesPage } from '../pages/MyGradesPage'
import { MyLessonsPage } from '../pages/MyLessonsPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { PaymentsPage } from '../pages/PaymentsPage'
import { ProfilePage } from '../pages/ProfilePage'
import { QuestionBanksPage } from '../pages/QuestionBanksPage'
import { ReportsPage } from '../pages/ReportsPage'
import { SchedulePage } from '../pages/SchedulePage'
import { SettingsPage } from '../pages/SettingsPage'
import { StudentRegisterCompletePage } from '../pages/StudentRegisterCompletePage'
import { StudentRegisterPage } from '../pages/StudentRegisterPage'
import { TakeExamPage } from '../pages/TakeExamPage'
import { UsersPage } from '../pages/UsersPage'
import { VerifyCertificatePage } from '../pages/VerifyCertificatePage'

/** The entry of NAV_ITEMS decides: permission keys where the module has an API, the role matrix elsewhere. */
function guarded(navKey: string, page: ReactNode) {
  return <RequireAccess navKey={navKey}>{page}</RequireAccess>
}

/** An old address of «مدرستي»: «فصولي», keeping the query so `?section=requests` still opens the requests. */
function ToMyClasses() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/my-classes', search }} replace />
}

// Paths mirror NAV_ITEMS in ../layout/navigation.ts.
const router = createBrowserRouter([
  // `?returnTo=` (a path of this site — auth/returnPath.ts), and Google's verdicts `?google=<code>` and `#google-mfa=…`.
  { path: '/login', element: <LoginPage /> },
  // PORTAL-04: Google's callback set the session cookie and sent the browser here (`?returnTo=`); waits for the session.
  { path: '/auth/google/done', element: <GoogleDonePage /> },
  // Public token pages (MOD-03-T12): the one-time link is the only credential.
  { path: '/invite/:token', element: <InvitationPage /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage /> },
  // PORTAL-04 (#207): the e-mail way is closed unless API-205 says selfRegistration, Google's unless it says googleSignUp.
  { path: '/register', element: <StudentRegisterPage /> },
  { path: '/register/complete/:token', element: <StudentRegisterCompletePage /> }, // the e-mailed link; opens no session
  // Public certificate verification (J-F51 — API-134, D-R56): no sign-in; the printed code is the only input.
  // E-mail confirmation (API-166 — the link the server e-mails is <APP_PUBLIC_URL>/verify-email/<token>) and the
  // self-service reset request (API-021).
  { path: '/verify-email/:token', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/verify', element: <VerifyCertificatePage /> },
  { path: '/verify/:code', element: <VerifyCertificatePage /> },
  // MOD-20 (D-R138): the public catalog for visitors — the server answers 404 catalog_not_public unless the academy offers it.
  // PORTAL-04 (#208): the academy's public home page — for visitors and signed-in users alike; `/` stays the dashboard.
  { path: '/home', element: <PublicHomePage /> },
  { path: '/explore', element: <PublicCatalogPage /> },
  { path: '/explore/:courseId', element: <PublicCoursePage /> },
  // MOD-20: the learning workspace, outside the layout (a focused course player). Signed in; the server opens a course's
  // lessons only with an own active or completed enrollment (D-R132) and answers 403 not_enrolled otherwise.
  { path: '/learn/:courseId', element: <RequireAuth><LearnPage /></RequireAuth> },
  // «معاينة كطالب» (D-R144): the author's view of the player from API-226 (`courses.manage` or a teacher of the course —
  // anyone else 404); it records nothing. Listed before /learn/:courseId/:itemId (the static segment ranks first anyway).
  { path: '/learn/:courseId/preview', element: <RequireAuth><LearnPreviewPage /></RequireAuth> },
  { path: '/learn/:courseId/preview/:itemId', element: <RequireAuth><LearnPreviewPage /></RequireAuth> },
  { path: '/learn/:courseId/:itemId', element: <RequireAuth><LearnPage /></RequireAuth> },
  // MOD-09 phase 2 (roadmap §4r): taking an online exam, outside the layout (a focused page with the server's clock).
  // Signed in; the server answers an attempt to its owner alone (API-277 — anybody else's is 404).
  { path: '/take-exam/:attemptId', element: <RequireAuth><TakeExamPage /></RequireAuth> },
  // Certificate print pages (J-F51 — D-R50): signed in, outside the layout so neither the screen nor the paper has the
  // menu; API-131 for `certificates.read_all`/`certificates.issue`, API-135 for a student's or a guardian's own.
  { path: '/certificates/:id/print', element: <RequireAuth>{guarded('certificates', <CertificatePrintPage source="academy" />)}</RequireAuth> },
  { path: '/my-certificates/:id/print', element: <RequireAuth>{guarded('myCertificates', <CertificatePrintPage source="own" />)}</RequireAuth> },
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
      { path: 'my-classes/:classId', element: guarded('myClasses', <MyClassLessonsPage />) }, // J-F62: one class's lessons (API-101 with classId)
      { path: 'catalog', element: guarded('catalog', <CatalogPage />) }, // MOD-19: `student`/`guardian` role keys (API-219 reads with courses.read)
      { path: 'catalog/:courseId', element: guarded('catalog', <CatalogCoursePage />) }, // MOD-19: API-220/221
      // J-F61: «مدرستي» was folded into «فصولي». The notifications already stored link to these two addresses.
      { path: 'my-school', element: <ToMyClasses /> },
      { path: 'my-courses', element: <ToMyClasses /> },
      { path: 'enrollment-requests', element: guarded('enrollmentRequests', <EnrollmentRequestsPage />) }, // MOD-19: `enrollments.manage` (API-224/225)
      { path: 'schedule', element: guarded('schedule', <SchedulePage />) },
      { path: 'lessons', element: guarded('lessons', <LessonsPage />) },
      { path: 'my-lessons', element: guarded('myLessons', <MyLessonsPage />) }, // `student`/`guardian` role keys (J-F11, API-101 — ownership)
      { path: 'assignments', element: guarded('assignments', <AssignmentsPage />) },
      { path: 'my-assignments', element: guarded('myAssignments', <MyAssignmentsPage />) }, // `student`/`guardian` role keys (J-F42, API-112 — ownership)
      { path: 'my-exams', element: guarded('myExams', <MyExamsPage />) }, // `student`/`guardian` role keys (J-F50, API-121 — ownership)
      { path: 'my-grades', element: guarded('myGrades', <MyGradesPage />) }, // `student`/`guardian` role keys (J-F50, API-129 — ownership + grades.read_own/read_linked)
      { path: 'my-certificates', element: guarded('myCertificates', <MyCertificatesPage />) }, // `student`/`guardian` role keys (J-F51, API-135 — ownership + read_own/read_linked)
      { path: 'exams', element: guarded('exams', <ExamsPage />) },
      { path: 'question-banks', element: guarded('questionBanks', <QuestionBanksPage />) }, // MOD-09 phase 2: `questions.manage` (API-260..API-269)
      { path: 'certificates', element: guarded('certificates', <CertificatesPage />) },
      { path: 'payments', element: guarded('payments', <PaymentsPage />) },
      { path: 'notifications', element: guarded('notifications', <NotificationsPage />) },
      // MOD-12 finance notifications link to /my-invoices (notifications.events.ts); «my invoices» lives on /payments.
      { path: 'my-invoices', element: <Navigate to="/payments" replace /> },
      { path: 'reports', element: guarded('reports', <ReportsPage />) },
      { path: 'audit-logs', element: guarded('audit', <AuditLogPage />) }, // `audit.read` (MOD-03-T15)
      { path: 'settings', element: guarded('settings', <SettingsPage />) },
      { path: 'settings/roles', element: guarded('roles', <SettingsPage section="roles" />) }, // `roles.manage` alone, not the settings role (D-R06, MOD-03-T13/T15)
      { path: 'settings/branches', element: guarded('branches', <SettingsPage section="branches" />) }, // `branches.manage` alone (MOD-02-T06 screen)
      { path: 'settings/rooms', element: guarded('rooms', <SettingsPage section="rooms" />) }, // `schedule.manage` alone (J-F06 — MOD-07-T02 screen)
      { path: 'settings/grade-schemes', element: guarded('gradeSchemes', <SettingsPage section="gradeSchemes" />) }, // `academy.settings.manage` alone (J-F44 — MOD-09-T08 part a)
      // Own profile: every signed-in user, whatever the role.
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
