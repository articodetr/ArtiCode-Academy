import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/roles'
import { NAV_ITEMS, canAccess, navFor } from './navigation'
import type { NavViewer } from './navigation'

/** The MOD-03/MOD-04/MOD-05/MOD-06/MOD-07/MOD-08/MOD-09/MOD-10/MOD-14 keys the seeded system roles hold (backend/src/authorization/system-roles.ts). */
const SEEDED: Readonly<Record<Role, string[]>> = {
  admin: [
    'users.read',
    'users.read_contact',
    'roles.manage',
    'audit.read',
    'academy.settings.read',
    'academy.settings.manage',
    'courses.read',
    'courses.manage',
    'classes.read',
    'classes.manage',
    'classes.teachers.assign',
    'schedule.read',
    'schedule.manage',
    'lessons.read',
    'lessons.manage',
    'assignments.read',
    'assignments.manage',
    'assignments.grade',
    'exams.read',
    'exams.manage',
    'exams.grade',
    'certificates.read_all',
    'certificates.issue',
    'certificates.revoke',
    // MOD-11 (the payments screen gates by these since the redesign).
    'fee_plans.manage',
    'invoices.read_all',
    'invoices.manage',
    'payments.record',
    'payments.refund',
    'reports.attendance.view',
    'reports.academic.view',
    'reports.financial.view',
  ],
  // Staff hold no assignments.* and no exams.* key (matrix 7.2); they issue certificates (MOD-10).
  staff: ['users.read', 'users.read_contact', 'users.create', 'users.update', 'guardians.link', 'courses.read', 'classes.read', 'classes.manage', 'schedule.read', 'lessons.read', 'certificates.issue', 'invoices.manage', 'payments.record', 'fee_plans.manage', 'reports.attendance.view', 'reports.financial.view'],
  // Teachers hold no certificates.* key (roadmap §4h.10.3).
  teacher: ['users.read', 'courses.read', 'classes.read', 'lessons.read', 'lessons.manage', 'schedule.read', 'assignments.read', 'assignments.manage', 'assignments.grade', 'exams.read', 'exams.manage', 'exams.grade'],
  student: ['courses.read', 'assignments.read', 'assignments.submit', 'schedule.read', 'lessons.read', 'exams.read', 'exams.take', 'certificates.read_own', 'invoices.read_own'],
  guardian: ['courses.read', 'assignments.read', 'grades.read_linked', 'schedule.read', 'attendance.read', 'exams.read', 'certificates.read_linked', 'invoices.read_linked'],
}

/** Server role keys of the UI roles (backend/src/authorization/system-roles.ts). */
const ROLE_KEYS: Readonly<Record<Role, string>> = { admin: 'academy_admin', staff: 'staff', teacher: 'teacher', student: 'student', guardian: 'guardian' }

function viewer(role: Role | null, permissions: string[] = role ? SEEDED[role] : [], roles: string[] = role ? [ROLE_KEYS[role]] : []): NavViewer {
  return { role, roles, permissions }
}

function keysFor(user: NavViewer): string[] {
  return navFor(user).map((item) => item.key)
}

describe('NAV_ITEMS', () => {
  it('has unique keys and paths, and every entry is gated by exactly one of: permissions, server role keys, the role matrix', () => {
    const keys = NAV_ITEMS.map((item) => item.key)
    const paths = NAV_ITEMS.map((item) => item.path)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(paths).size).toBe(paths.length)
    for (const item of NAV_ITEMS) {
      expect([item.permissions, item.roleKeys, item.roles].filter(Boolean)).toHaveLength(1)
    }
  })

  it('gates «my classes» by the student/guardian server role keys since API-060 is ownership without a permission key (J-F04)', () => {
    const myClasses = NAV_ITEMS.find((item) => item.key === 'myClasses')!
    expect(myClasses.roleKeys).toEqual(['student', 'guardian'])
    expect(myClasses.path).toBe('/my-classes')
    expect(keysFor(viewer('student'))).toContain('myClasses')
    expect(keysFor(viewer('guardian'))).toContain('myClasses')
    // The server rule looks at the role keys, not the single UI role: a teacher who is also a guardian keeps the entry…
    expect(keysFor(viewer('teacher', SEEDED.teacher, ['teacher', 'guardian']))).toContain('myClasses')
    expect(canAccess(viewer('teacher', SEEDED.teacher, ['teacher', 'guardian']), 'myClasses')).toBe(true)
    // …and an admin, a teacher or a custom role without those keys gets no entry (the server would answer an empty list).
    expect(keysFor(viewer('admin'))).not.toContain('myClasses')
    expect(keysFor(viewer('teacher'))).not.toContain('myClasses')
    expect(canAccess(viewer(null, ['users.read'], ['auditor']), 'myClasses')).toBe(false)
    // Permissions never open it: the entry mirrors ownership, not a key.
    expect(canAccess(viewer(null, ['enrollments.read', 'enrollments.manage']), 'myClasses')).toBe(false)
  })

  it('gates the MOD-03 screens by the keys the server enforces', () => {
    const byKey = Object.fromEntries(NAV_ITEMS.map((item) => [item.key, item]))
    expect(byKey.users.permissions).toEqual(['users.read'])
    expect(byKey.roles.permissions).toEqual(['roles.manage'])
    expect(byKey.roles.path).toBe('/settings/roles')
    expect(byKey.audit.permissions).toEqual(['audit.read'])
    expect(byKey.audit.path).toBe('/audit-logs')
  })

  it('gates the settings screen by the academy settings keys since the general tab is real (MOD-02/MOD-14)', () => {
    const settings = NAV_ITEMS.find((item) => item.key === 'settings')!
    expect(settings.permissions).toEqual(['academy.settings.read', 'academy.settings.manage'])
    expect(keysFor(viewer(null, ['academy.settings.read']))).toEqual(['dashboard', 'settings'])
    expect(keysFor(viewer(null, ['academy.settings.manage']))).toEqual(['dashboard', 'settings', 'gradeSchemes'])
    expect(canAccess(viewer('admin', []), 'settings')).toBe(false)
  })

  it('gates the courses screen by courses.read since its API is real (MOD-04-T05) — any role holding it sees it', () => {
    const courses = NAV_ITEMS.find((item) => item.key === 'courses')!
    expect(courses.permissions).toEqual(['courses.read'])
    expect(keysFor(viewer(null, ['courses.read']))).toEqual(['dashboard', 'courses'])
    expect(keysFor(viewer(null, ['courses.manage']))).toEqual(['dashboard'])
    expect(canAccess(viewer('student', []), 'courses')).toBe(false)
  })

  it('gates the schedule screen by schedule.read, schedule.manage or classes.manage since its API is real (J-F05, D-R27)', () => {
    const schedule = NAV_ITEMS.find((item) => item.key === 'schedule')!
    expect(schedule.permissions).toEqual(['schedule.read', 'schedule.manage', 'classes.manage'])
    expect(keysFor(viewer(null, ['schedule.read']))).toEqual(['dashboard', 'schedule'])
    expect(keysFor(viewer(null, ['classes.manage']))).toEqual(['dashboard', 'schedule'])
    // schedule.manage also opens the rooms tab (J-F06).
    expect(keysFor(viewer(null, ['schedule.manage']))).toEqual(['dashboard', 'schedule', 'rooms'])
    expect(canAccess(viewer('student', []), 'schedule')).toBe(false)
  })

  it('gates the classes screen by classes.read alone since every read of /api/classes requires it (J-F01, PR #26 review) — students and guardians do not hold it', () => {
    const classes = NAV_ITEMS.find((item) => item.key === 'classes')!
    expect(classes.permissions).toEqual(['classes.read'])
    expect(keysFor(viewer(null, ['classes.read']))).toEqual(['dashboard', 'classes'])
    // A custom role holding classes.manage without classes.read would get 403 on the list — the entry stays hidden
    // (classes.manage does open the academy schedule — J-F05).
    expect(keysFor(viewer(null, ['classes.manage']))).toEqual(['dashboard', 'schedule'])
    expect(keysFor(viewer(null, ['classes.manage', 'classes.teachers.assign']))).toEqual(['dashboard', 'schedule'])
    expect(canAccess(viewer(null, ['classes.manage']), 'classes')).toBe(false)
    expect(keysFor(viewer(null, ['classes.teachers.assign']))).toEqual(['dashboard'])
    expect(canAccess(viewer('student'), 'classes')).toBe(false)
    expect(canAccess(viewer('guardian'), 'classes')).toBe(false)
  })

  it('gates the branches screen (/settings/branches) by branches.manage alone — the one key the server enforces for writes (MOD-02-T06 screen)', () => {
    const branches = NAV_ITEMS.find((item) => item.key === 'branches')!
    expect(branches.permissions).toEqual(['branches.manage'])
    expect(branches.path).toBe('/settings/branches')
    expect(keysFor(viewer(null, ['branches.manage']))).toEqual(['dashboard', 'branches'])
    // The settings keys alone do not open the branches tab, and the role alone never does.
    expect(keysFor(viewer(null, ['academy.settings.manage']))).toEqual(['dashboard', 'settings', 'gradeSchemes'])
    expect(canAccess(viewer('admin', []), 'branches')).toBe(false)
    expect(canAccess(viewer('staff', ['branches.manage']), 'branches')).toBe(true)
  })

  it('gates the rooms tab (/settings/rooms) by schedule.manage alone — the key every write of /api/rooms requires (J-F06); reads need none, the screen is management', () => {
    const rooms = NAV_ITEMS.find((item) => item.key === 'rooms')!
    expect(rooms.permissions).toEqual(['schedule.manage'])
    expect(rooms.path).toBe('/settings/rooms')
    expect(rooms.module).toBe('MOD-07')
    // The schedule entry comes from J-F05 (schedule.read, schedule.manage or classes.manage).
    expect(keysFor(viewer(null, ['schedule.manage']))).toEqual(['dashboard', 'schedule', 'rooms'])
    expect(keysFor(viewer(null, ['schedule.read']))).toEqual(['dashboard', 'schedule'])
    // By seed only academy_admin holds the key; the role alone grants nothing.
    expect(canAccess(viewer('admin', []), 'rooms')).toBe(false)
    expect(canAccess(viewer('staff'), 'rooms')).toBe(false)
    expect(canAccess(viewer('teacher'), 'rooms')).toBe(false)
  })

  it('gates the grade schemes tab (/settings/grade-schemes) by academy.settings.manage alone — the key every write of /api/grade-schemes requires (J-F44); reads need none, the screen is management', () => {
    const gradeSchemes = NAV_ITEMS.find((item) => item.key === 'gradeSchemes')!
    expect(gradeSchemes.permissions).toEqual(['academy.settings.manage'])
    expect(gradeSchemes.path).toBe('/settings/grade-schemes')
    expect(gradeSchemes.module).toBe('MOD-09')
    // academy.settings.read opens the general tab only — not the schemes, which it could read but never write.
    expect(keysFor(viewer(null, ['academy.settings.read']))).toEqual(['dashboard', 'settings'])
    expect(canAccess(viewer(null, ['academy.settings.read']), 'gradeSchemes')).toBe(false)
    expect(canAccess(viewer(null, ['academy.settings.manage'], ['registrar']), 'gradeSchemes')).toBe(true)
    // By seed only academy_admin holds the key; the role alone grants nothing, and the grades keys do not open it.
    expect(canAccess(viewer('admin'), 'gradeSchemes')).toBe(true)
    expect(canAccess(viewer('admin', []), 'gradeSchemes')).toBe(false)
    expect(canAccess(viewer('teacher', [...SEEDED.teacher, 'grades.read_all', 'grades.manage']), 'gradeSchemes')).toBe(false)
    expect(canAccess(viewer('staff'), 'gradeSchemes')).toBe(false)
    expect(canAccess(viewer('student'), 'gradeSchemes')).toBe(false)
  })

  it('gates the lessons screen by lessons.read alone since its API is real (J-F09) — lessons.manage only adds writes', () => {
    const lessons = NAV_ITEMS.find((item) => item.key === 'lessons')!
    expect(lessons.permissions).toEqual(['lessons.read'])
    expect(keysFor(viewer(null, ['lessons.read']))).toEqual(['dashboard', 'lessons'])
    // A custom role holding lessons.manage without lessons.read would get 403 on the list — the entry stays hidden.
    expect(keysFor(viewer(null, ['lessons.manage']))).toEqual(['dashboard'])
    expect(canAccess(viewer('student'), 'lessons')).toBe(true)
    expect(canAccess(viewer('guardian'), 'lessons')).toBe(false)
    expect(canAccess(viewer('admin', []), 'lessons')).toBe(false)
  })

  it('gates «my lessons» by the student/guardian server role keys since API-101 is ownership without a permission key (J-F11)', () => {
    const myLessons = NAV_ITEMS.find((item) => item.key === 'myLessons')!
    expect(myLessons.roleKeys).toEqual(['student', 'guardian'])
    expect(myLessons.path).toBe('/my-lessons')
    expect(myLessons.module).toBe('MOD-06')
    expect(canAccess(viewer('student'), 'myLessons')).toBe(true)
    expect(canAccess(viewer('guardian'), 'myLessons')).toBe(true)
    // A teacher holding lessons.read keeps «lessons» (the classes they teach) and gets no «my lessons»…
    expect(keysFor(viewer('teacher'))).toContain('lessons')
    expect(keysFor(viewer('teacher'))).not.toContain('myLessons')
    // …unless they also hold a learner role key: a teacher who is also a guardian sees both, «my lessons» right after «lessons».
    const teacherGuardian = keysFor(viewer('teacher', SEEDED.teacher, ['teacher', 'guardian']))
    expect(teacherGuardian.indexOf('myLessons')).toBe(teacherGuardian.indexOf('lessons') + 1)
    // Staff, an admin and a custom role without those keys get no entry (the server would answer an empty list).
    expect(canAccess(viewer('staff'), 'myLessons')).toBe(false)
    expect(canAccess(viewer('admin'), 'myLessons')).toBe(false)
    expect(canAccess(viewer(null, ['lessons.read'], ['auditor']), 'myLessons')).toBe(false)
    // Permissions never open it: the entry mirrors ownership, not a key.
    expect(canAccess(viewer(null, ['lessons.read', 'lessons.manage', 'attendance.read', 'attendance.record']), 'myLessons')).toBe(false)
  })

  it('gates the assignments screen by assignments.read with the learners excepted (J-F38, roadmap §4g T06) — the route follows the same rule', () => {
    const assignments = NAV_ITEMS.find((item) => item.key === 'assignments')!
    expect(assignments.permissions).toEqual(['assignments.read'])
    expect(assignments.exceptRoleKeysOnly).toEqual(['student', 'guardian'])
    expect(assignments.module).toBe('MOD-08')
    expect(keysFor(viewer(null, ['assignments.read']))).toEqual(['dashboard', 'assignments'])
    // A custom role holding assignments.manage without assignments.read would get 403 on the list — the entry stays hidden.
    expect(keysFor(viewer(null, ['assignments.manage']))).toEqual(['dashboard'])
    expect(canAccess(viewer('admin'), 'assignments')).toBe(true)
    expect(canAccess(viewer('teacher'), 'assignments')).toBe(true)
    // Students and guardians hold assignments.read by seed but teach no class (an empty list — D-R16, D-R40), so no entry and the 403 page…
    expect(canAccess(viewer('student'), 'assignments')).toBe(false)
    expect(canAccess(viewer('guardian'), 'assignments')).toBe(false)
    expect(canAccess(viewer('student', [...SEEDED.student, ...SEEDED.guardian], ['student', 'guardian']), 'assignments')).toBe(false)
    // …while any other role key keeps it: a teacher who is also a guardian, or a custom role holding the key.
    expect(canAccess(viewer('teacher', [...SEEDED.teacher, ...SEEDED.guardian], ['teacher', 'guardian']), 'assignments')).toBe(true)
    expect(canAccess(viewer(null, ['assignments.read'], ['auditor']), 'assignments')).toBe(true)
    // Staff hold no assignments.* key, and a role that lost the key loses the entry.
    expect(canAccess(viewer('staff'), 'assignments')).toBe(false)
    expect(canAccess(viewer('admin', []), 'assignments')).toBe(false)
  })

  it('gates «my assignments» by the student/guardian server role keys since API-112 is ownership without a permission key (J-F42, D-R40)', () => {
    const myAssignments = NAV_ITEMS.find((item) => item.key === 'myAssignments')!
    expect(myAssignments.roleKeys).toEqual(['student', 'guardian'])
    expect(myAssignments.path).toBe('/my-assignments')
    expect(myAssignments.module).toBe('MOD-08')
    expect(canAccess(viewer('student'), 'myAssignments')).toBe(true)
    // A guardian sees it too — to read the children's assignments (they hold no assignments.submit).
    expect(canAccess(viewer('guardian'), 'myAssignments')).toBe(true)
    // A teacher keeps «assignments» (the classes they teach) and gets no «my assignments»…
    expect(keysFor(viewer('teacher'))).toContain('assignments')
    expect(keysFor(viewer('teacher'))).not.toContain('myAssignments')
    // …unless they also hold a learner role key: a teacher who is also a guardian sees both, «my assignments» right after «assignments».
    const teacherGuardian = keysFor(viewer('teacher', [...SEEDED.teacher, ...SEEDED.guardian], ['teacher', 'guardian']))
    expect(teacherGuardian.indexOf('myAssignments')).toBe(teacherGuardian.indexOf('assignments') + 1)
    // Staff, an admin and a custom role without those keys get no entry (the server would answer an empty list).
    expect(canAccess(viewer('staff'), 'myAssignments')).toBe(false)
    expect(canAccess(viewer('admin'), 'myAssignments')).toBe(false)
    expect(canAccess(viewer(null, ['assignments.read'], ['auditor']), 'myAssignments')).toBe(false)
    // Permissions never open it, not even the submit key: the entry mirrors ownership.
    expect(canAccess(viewer(null, ['assignments.read', 'assignments.submit', 'assignments.grade']), 'myAssignments')).toBe(false)
  })

  it('gates the exams screen by exams.read with the learners excepted, like «assignments» (J-F45) — the route follows the same rule', () => {
    const exams = NAV_ITEMS.find((item) => item.key === 'exams')!
    expect(exams.permissions).toEqual(['exams.read'])
    expect(exams.exceptRoleKeysOnly).toEqual(['student', 'guardian'])
    expect(exams.roles).toBeUndefined()
    expect(exams.module).toBe('MOD-09')
    expect(keysFor(viewer(null, ['exams.read']))).toEqual(['dashboard', 'exams'])
    // A custom role holding exams.manage or exams.grade without exams.read would get 403 on the list — the entry stays hidden.
    expect(keysFor(viewer(null, ['exams.manage', 'exams.grade']))).toEqual(['dashboard'])
    expect(canAccess(viewer('admin'), 'exams')).toBe(true)
    expect(canAccess(viewer('teacher'), 'exams')).toBe(true)
    // Students and guardians hold exams.read by seed but teach no class (an empty list — D-R16, D-R48), so no entry and the 403 page…
    expect(canAccess(viewer('student'), 'exams')).toBe(false)
    expect(canAccess(viewer('guardian'), 'exams')).toBe(false)
    expect(canAccess(viewer('student', [...SEEDED.student, ...SEEDED.guardian], ['student', 'guardian']), 'exams')).toBe(false)
    // …while any other role key keeps it: a teacher who is also a guardian, or a custom role holding the key.
    expect(canAccess(viewer('teacher', [...SEEDED.teacher, ...SEEDED.guardian], ['teacher', 'guardian']), 'exams')).toBe(true)
    expect(canAccess(viewer(null, ['exams.read'], ['auditor']), 'exams')).toBe(true)
    // Staff hold no exams.* key, and an admin whose role lost the key loses the entry (the role matrix no longer decides).
    expect(canAccess(viewer('staff'), 'exams')).toBe(false)
    expect(canAccess(viewer('admin', []), 'exams')).toBe(false)
  })

  it('gates «my exams» and «my grades» by the student/guardian server role keys, right after «my assignments» (J-F50, API-121/API-129, D-R48)', () => {
    const myExams = NAV_ITEMS.find((item) => item.key === 'myExams')!
    const myGrades = NAV_ITEMS.find((item) => item.key === 'myGrades')!
    expect(myExams.roleKeys).toEqual(['student', 'guardian'])
    expect(myExams.path).toBe('/my-exams')
    expect(myExams.module).toBe('MOD-09')
    expect(myGrades.roleKeys).toEqual(['student', 'guardian'])
    expect(myGrades.path).toBe('/my-grades')
    expect(myGrades.module).toBe('MOD-09')
    const keys = NAV_ITEMS.map((item) => item.key)
    expect(keys.slice(keys.indexOf('myAssignments'), keys.indexOf('myAssignments') + 3)).toEqual(['myAssignments', 'myExams', 'myGrades'])
    for (const key of ['myExams', 'myGrades']) {
      expect(canAccess(viewer('student'), key)).toBe(true)
      expect(canAccess(viewer('guardian'), key)).toBe(true)
      // A teacher who is also a guardian keeps them; a teacher, staff, an admin or a custom role alone get no entry.
      expect(canAccess(viewer('teacher', [...SEEDED.teacher, ...SEEDED.guardian], ['teacher', 'guardian']), key)).toBe(true)
      expect(canAccess(viewer('teacher'), key)).toBe(false)
      expect(canAccess(viewer('staff'), key)).toBe(false)
      expect(canAccess(viewer('admin'), key)).toBe(false)
      // Permissions never open them — not even the grades keys «my grades» needs on top of the ownership (the server's 403 is
      // worded by the page for a learner role that lost both).
      expect(canAccess(viewer(null, ['exams.read', 'exams.take', 'grades.read_own', 'grades.read_linked', 'grades.read_all'], ['auditor']), key)).toBe(false)
    }
    // A learner role that lost both grades keys still reaches «my grades»: the entry follows the role keys, the page words the refusal.
    expect(canAccess(viewer('student', ['courses.read'], ['student']), 'myGrades')).toBe(true)
  })

  it('gates the certificates screen by certificates.read_all or certificates.issue and «my certificates» by the learner role keys (J-F51, D-R57)', () => {
    const certificates = NAV_ITEMS.find((item) => item.key === 'certificates')!
    expect(certificates.permissions).toEqual(['certificates.read_all', 'certificates.issue'])
    expect(certificates.exceptRoleKeysOnly).toBeUndefined()
    expect(certificates.module).toBe('MOD-10')
    // Either key opens the list (staff issue without read_all); revoke alone, or a learner key, does not.
    expect(keysFor(viewer(null, ['certificates.read_all']))).toEqual(['dashboard', 'certificates'])
    expect(keysFor(viewer(null, ['certificates.issue']))).toEqual(['dashboard', 'certificates'])
    expect(keysFor(viewer(null, ['certificates.revoke', 'certificates.read_own']))).toEqual(['dashboard'])
    expect(canAccess(viewer('staff'), 'certificates')).toBe(true)
    expect(canAccess(viewer('teacher'), 'certificates')).toBe(false)
    expect(canAccess(viewer('student'), 'certificates')).toBe(false)

    const mine = NAV_ITEMS.find((item) => item.key === 'myCertificates')!
    expect(mine.roleKeys).toEqual(['student', 'guardian'])
    expect(mine.path).toBe('/my-certificates')
    expect(mine.module).toBe('MOD-10')
    expect(NAV_ITEMS.indexOf(mine)).toBe(NAV_ITEMS.findIndex((item) => item.key === 'myGrades') + 1)
    expect(canAccess(viewer('student'), 'myCertificates')).toBe(true)
    expect(canAccess(viewer('guardian'), 'myCertificates')).toBe(true)
    expect(canAccess(viewer('teacher', [...SEEDED.teacher, ...SEEDED.guardian], ['teacher', 'guardian']), 'myCertificates')).toBe(true)
    // The keys never open it — ownership decides (an admin holding every certificates key reads them on /certificates).
    expect(canAccess(viewer('admin'), 'myCertificates')).toBe(false)
    expect(canAccess(viewer(null, ['certificates.read_own', 'certificates.read_linked']), 'myCertificates')).toBe(false)
  })
})

describe('navFor', () => {
  it('shows a custom role holding users.read only the users page (plus the landing page) — AC1', () => {
    expect(keysFor(viewer(null, ['users.read']))).toEqual(['dashboard', 'users'])
  })

  it('shows a custom role each MOD-03 entry by its own key, whatever the role', () => {
    expect(keysFor(viewer(null, ['roles.manage']))).toEqual(['dashboard', 'roles'])
    expect(keysFor(viewer(null, ['audit.read']))).toEqual(['dashboard', 'audit'])
    expect(keysFor(viewer(null, []))).toEqual(['dashboard'])
  })

  it('ignores the role for permission-gated entries: an admin whose role lost users.read does not see the users (or courses, classes, lessons, assignments, exams, certificates, settings) page', () => {
    // Since J-F05 the schedule entry is permission-gated too (schedule.read / schedule.manage / classes.manage), since J-F09 the
    // lessons entry (lessons.read), since J-F38 the assignments entry (assignments.read), since J-F45 the exams entry (exams.read)
    // and since J-F51 the certificates entry (certificates.read_all / certificates.issue).
    expect(keysFor(viewer('admin', ['roles.manage']))).toEqual(['dashboard', 'notifications', 'roles'])
  })

  it('keeps the role matrix of the system roles for the screens without a server contract — AC3', () => {
    // academy.settings.manage also opens the grade schemes tab (J-F44), right after the rooms tab. Since the redesign
    // (2026-11-14) roles and the audit log close the list — they end the academy section of the side menu.
    expect(keysFor(viewer('admin'))).toEqual(['dashboard', 'users', 'courses', 'classes', 'schedule', 'lessons', 'assignments', 'exams', 'certificates', 'payments', 'notifications', 'reports', 'settings', 'rooms', 'gradeSchemes', 'roles', 'audit'])
    // Staff gain the courses entry (MOD-04-T05) and the lessons entry (J-F09): the seed grants them courses.read and lessons.read;
    // and the certificates entry (J-F51): the seed grants them certificates.issue, which opens the list too (D-R57).
    expect(keysFor(viewer('staff'))).toEqual(['dashboard', 'users', 'courses', 'classes', 'schedule', 'lessons', 'certificates', 'payments', 'notifications', 'reports'])
    // Students and guardians gain «my classes» (J-F04) and «my lessons» (J-F11): ownership, by their server role keys.
    // Students keep the lessons entry through lessons.read (an empty list there — their own lessons are in «my lessons», API-101).
    // Both lose the assignments entry (J-F38): assignments.read is theirs by seed, but the learners are excepted — and gain
    // «my assignments» (J-F42, API-112) in its place, by their server role keys. Both lose the exams entry too (J-F45): exams.read
    // is theirs by seed, but the learners are excepted — and gain «my exams» (API-121) and «my grades» (API-129) right after
    // «my assignments» (J-F50), by their server role keys. Since J-F51 the certificates entry follows
    // certificates.read_all/issue, which no learner holds: both see «my certificates» (API-135) instead, right after «my grades».
    expect(keysFor(viewer('student'))).toEqual(['dashboard', 'courses', 'myClasses', 'schedule', 'lessons', 'myLessons', 'myAssignments', 'myExams', 'myGrades', 'myCertificates', 'payments', 'notifications'])
    expect(keysFor(viewer('guardian'))).toEqual(['dashboard', 'courses', 'myClasses', 'schedule', 'myLessons', 'myAssignments', 'myExams', 'myGrades', 'myCertificates', 'payments', 'notifications'])
  })

  it('shows the users page to a teacher because the seed grants teachers users.read (reduced projection) (MOD-03-T15)', () => {
    expect(keysFor(viewer('teacher'))).toEqual(['dashboard', 'users', 'courses', 'classes', 'schedule', 'lessons', 'assignments', 'exams', 'notifications'])
    expect(keysFor(viewer('teacher', ['courses.read']))).not.toContain('users')
  })
})

describe('canAccess', () => {
  it('answers by the same rule as the menu, and false for an unknown key', () => {
    expect(canAccess(viewer(null, ['users.read']), 'users')).toBe(true)
    expect(canAccess(viewer(null, ['users.read']), 'roles')).toBe(false)
    expect(canAccess(viewer(null, []), 'dashboard')).toBe(true)
    expect(canAccess(viewer('staff'), 'settings')).toBe(false)
    expect(canAccess(viewer('admin'), 'settings')).toBe(true)
    expect(canAccess(viewer('admin'), 'nope')).toBe(false)
  })
})
