// Error factories of MOD-05-T04 that need enrollment wording. The codes and
// the exception class belong to the MOD-05 dictionary (classes/classes.errors.ts
// — one dictionary per module); this file adds no code, only a factory whose
// message names an enrollment instead of a class (the guardians.errors.ts
// pattern). Every other T04 error uses `classesError` directly:
//
//   class_not_found       404 { classId }                      — unknown class, or a roster the caller may not read
//   user_not_found        404 { userId }                       — unknown or soft-deleted student
//   user_not_eligible     422 { userId, status }               — the student is neither invited nor active
//   not_a_student         422 { userId }                       — no `student` role row
//   already_enrolled      409 { enrollmentId, status }         — the student has an enrollment in this class, whatever its status
//   class_not_enrollable  409 { status }                       — the class is neither open nor running (enroll, reactivate)
//   class_full            409 { capacity, enrolledCount }      — no free seat (enroll, reactivate)
//   enrollment_not_found  404 { enrollmentId }
//   invalid_transition    409 { from, action, allowed }        — below
import { HttpStatus } from '@nestjs/common';
import { ClassesHttpException } from '../classes/classes.errors.js';

export const enrollmentsError = {
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new ClassesHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} enrollment`, {
      from,
      action,
      allowed: [...allowed],
    }),
};
