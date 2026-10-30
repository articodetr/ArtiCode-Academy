// Error factories of guardian ↔ student links (MOD-03-T09). The codes belong to
// the MOD-03 dictionary fixed in T00 (users.errors.ts — `not_a_guardian`,
// `not_a_student`, `already_linked`, `user_not_found`); only the factories live
// here. One code carries two situations, told apart by the details:
//   user_not_found   404 { userId, party }                     — a party is unknown or soft-deleted
//                    404 { studentId, guardianId, reason }     — both exist but are not linked
//   not_a_guardian   422 { userId }                            — the guardian lacks the `guardian` role
//   not_a_student    422 { userId }                            — the student lacks the `student` role
//   already_linked   409 { studentId, guardianId }             — the pair is already linked
// Linking someone to themself is a cross-field validation failure (body vs
// path) and answers like the ValidationPipe does: 400 with a message list and
// no code — the database CHECK `ck_guardian_students_distinct` is the backstop.
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { UsersHttpException } from '../users/users.errors.js';

export type LinkParty = 'student' | 'guardian';

export const guardiansError = {
  partyNotFound: (party: LinkParty, userId: string) =>
    new UsersHttpException(HttpStatus.NOT_FOUND, 'user_not_found', `The ${party} was not found`, { userId, party }),
  linkNotFound: (studentId: string, guardianId: string) =>
    new UsersHttpException(HttpStatus.NOT_FOUND, 'user_not_found', 'This guardian is not linked to this student', {
      studentId,
      guardianId,
      reason: 'not_linked',
    }),
  notAGuardian: (userId: string) =>
    new UsersHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_a_guardian', 'This user does not hold the guardian role', {
      userId,
    }),
  notAStudent: (userId: string) =>
    new UsersHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_a_student', 'This user does not hold the student role', {
      userId,
    }),
  alreadyLinked: (studentId: string, guardianId: string) =>
    new UsersHttpException(HttpStatus.CONFLICT, 'already_linked', 'This guardian is already linked to this student', {
      studentId,
      guardianId,
    }),
  selfLink: () => new BadRequestException(['guardianId must be a different user than the student in the path']),
};
