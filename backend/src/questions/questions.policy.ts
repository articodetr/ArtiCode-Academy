// Permission key and visibility of the question banks (MOD-09 phase 2 —
// roadmap §4r.5; decision D-R162). `questions.manage` — seeded to teachers,
// and to the academy admin with every key — is needed for every route of the
// banks; no new key. What a holder sees and writes follows their assignment,
// not their role (the D-R16 pattern):
//
//   - with `classes.manage` too: every bank of the academy;
//   - otherwise: the banks they created, and the banks filed under a course
//     of which they teach a class (lead or assistant, whatever the class's
//     status) — so the teachers of one course share its banks.
//
// A bank the caller may not see is 404, never 403. Students and guardians hold
// no such key: a question reaches a learner only as the frozen copy of an exam
// they are taking, without its key (exams/attempts.*).
import type { AuthPrincipal } from '../auth/principal.js';
import { canManageClasses } from '../classes/classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';

export const MANAGE_QUESTIONS_PERMISSION = 'questions.manage';

type Caller = Pick<AuthPrincipal, 'id' | 'permissions'>;

/** True when the caller sees every bank, not only their own and their courses'. */
export function seesEveryBank(caller: Pick<AuthPrincipal, 'permissions'>): boolean {
  return canManageClasses(caller.permissions);
}

/** The courses the caller teaches a class of (D-R162). */
export function taughtCoursesWhere(caller: Pick<AuthPrincipal, 'id'>): Prisma.CourseWhereInput {
  return { classes: { some: { teachers: { some: { teacherUserId: caller.id } } } } };
}

/** D-R162 as a Prisma filter on `question_banks`. */
export function visibleBanksWhere(caller: Caller): Prisma.QuestionBankWhereInput {
  if (seesEveryBank(caller)) return {};
  return { OR: [{ createdById: caller.id }, { course: taughtCoursesWhere(caller) }] };
}

/** D-R162 as a Prisma filter on `questions` (through their bank). */
export function visibleQuestionsWhere(caller: Caller): Prisma.QuestionWhereInput {
  return seesEveryBank(caller) ? {} : { bank: visibleBanksWhere(caller) };
}

/** The courses a bank may be filed under by the caller: any course with `classes.manage`, else one they teach. */
export function fileableCoursesWhere(caller: Caller): Prisma.CourseWhereInput {
  return seesEveryBank(caller) ? {} : taughtCoursesWhere(caller);
}
