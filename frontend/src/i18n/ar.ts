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
}

export type Translation = typeof ar
