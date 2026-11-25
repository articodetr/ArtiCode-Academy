import { common, labels, days, roles, errors, nav, server } from './ar/common'
import { login, forgotPassword, account, emailVerification, profile } from './ar/account'
import { users, rolesAdmin, audit } from './ar/people'
import { settings, branches, rooms } from './ar/setup'
import { courses } from './ar/courses'
import { classes, myClasses } from './ar/classes'
import { schedule, classSchedule } from './ar/schedule'
import { lessons, attendance, myLessons } from './ar/lessons'
import { assignments, myAssignments } from './ar/assignments'
import { exams, myExams, gradebook, gradeSchemes, myGrades } from './ar/grades'
import { certificates } from './ar/certificates'
import { payments } from './ar/payments'
import { reports, dashboard } from './ar/reports'
import { notifications } from './ar/notifications'
import { search } from './ar/search'
import { catalog, myCourses } from './ar/catalog'
import { mySchool } from './ar/mySchool'
import { learn } from './ar/learn'
import { curriculum, learningProgress, publicCatalog } from './ar/curriculum'
import { enrollmentRequests } from './ar/enrollmentRequests'
import { questionBanks } from './ar/questionBanks'
import { examOnline } from './ar/examOnline'
import { examAttempts } from './ar/examAttempts'
import { takeExam } from './ar/takeExam'
import { courseCover } from './ar/courseCover'
import { courseEnrollmentPanel } from './ar/courseEnrollmentPanel'
import { studentRegistration } from './ar/studentRegistration'
import { publicHome } from './ar/publicHome'
import { homepageImages } from './ar/homepageImages'

export const ar = {
  common,
  roles,
  nav,
  labels,
  days,
  login,
  profile,
  account,
  search,
  dashboard,
  users,
  courses,
  classes,
  classSchedule,
  schedule,
  lessons,
  attendance,
  assignments,
  exams,
  certificates,
  payments,
  notifications,
  reports,
  settings,
  branches,
  rolesAdmin,
  myClasses,
  rooms,
  gradeSchemes,
  gradebook,
  myLessons,
  myAssignments,
  myExams,
  myGrades,
  audit,
  errors,
  server,
  emailVerification,
  forgotPassword,
  // MOD-19 (roadmap §4p): the catalog, «my courses» and the office's enrollment requests.
  catalog,
  myCourses,
  enrollmentRequests,
  // MOD-20 (roadmap §4q): «My School», the learning workspace, the curriculum editor, the class learning progress and the public catalog.
  mySchool,
  learn,
  curriculum,
  learningProgress,
  publicCatalog,
  // MOD-09 phase 2 (roadmap §4r): question banks, the online side of an exam for its teacher, and taking an exam.
  questionBanks,
  examOnline,
  examAttempts,
  takeExam,
  // PORTAL-04 (#208): the academy's public home page (/home).
  publicHome,
  courseCover,
  courseEnrollmentPanel,
  studentRegistration,
  // Settings → «صور الصفحة الرئيسية»: the four pictures of /home the administration may replace.
  homepageImages,
}

export type Translation = typeof ar
