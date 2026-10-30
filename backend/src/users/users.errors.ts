// Error vocabulary of MOD-03 (users, invitations, password reset, roles,
// guardians) — fixed in MOD-03-T00, extended in T02, T03, T04, T05 and T06. Same shape as
// AuthHttpException: the body is `{ statusCode, error, code, message, ...details }`
// and the frontend maps the stable `code` to a localized message. Only the
// factories below are in use; the remaining codes are reserved for the tasks
// named next to them.
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const USERS_ERROR_CODES = [
  // T01 — list and detail
  'user_not_found',
  'cursor_invalid',
  // T02 — creation
  'identifier_required',
  'email_in_use',
  'username_in_use',
  'student_number_in_use',
  'employee_number_in_use',
  // T03 / T05 — invitations and password reset
  'user_not_invitable',
  'invitation_invalid',
  'invitation_expired',
  'invitation_consumed',
  'reset_invalid',
  'reset_expired',
  'reset_disabled',
  'user_not_resettable',
  // T02 / T04 / T06 — profiles, update and account status
  'profile_mismatch',
  'nothing_to_update',
  'invalid_transition',
  'self_forbidden',
  'last_admin',
  // T02 / T07 / T08 — roles and permissions
  'role_unknown',
  'role_in_use',
  'role_immutable',
  'permission_unknown',
  'employee_kind_required',
  // T09 — guardians
  'not_a_guardian',
  'not_a_student',
  'already_linked',
] as const;

export type UsersErrorCode = (typeof USERS_ERROR_CODES)[number];

export interface UsersErrorBody {
  statusCode: number;
  error: string;
  code: UsersErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class UsersHttpException extends HttpException {
  readonly code: UsersErrorCode;

  constructor(
    status: HttpStatus,
    code: UsersErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    const body: UsersErrorBody = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      code,
      message,
      ...details,
    };
    super(body, status);
    this.code = code;
  }
}

export const usersError = {
  userNotFound: () => new UsersHttpException(HttpStatus.NOT_FOUND, 'user_not_found', 'User not found'),
  cursorInvalid: () =>
    new UsersHttpException(
      HttpStatus.BAD_REQUEST,
      'cursor_invalid',
      'The pagination cursor is not valid for this sort order',
    ),
  // T02
  identifierRequired: () =>
    new UsersHttpException(
      HttpStatus.BAD_REQUEST,
      'identifier_required',
      'Either an e-mail address or a username is required',
    ),
  emailInUse: () =>
    new UsersHttpException(HttpStatus.CONFLICT, 'email_in_use', 'This e-mail address is already registered'),
  usernameInUse: () =>
    new UsersHttpException(HttpStatus.CONFLICT, 'username_in_use', 'This username is already taken'),
  studentNumberInUse: () =>
    new UsersHttpException(HttpStatus.CONFLICT, 'student_number_in_use', 'This student number is already assigned'),
  employeeNumberInUse: () =>
    new UsersHttpException(HttpStatus.CONFLICT, 'employee_number_in_use', 'This employee number is already assigned'),
  profileMismatch: (detail: string) =>
    new UsersHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'profile_mismatch', detail),
  employeeKindRequired: (roleKeys: readonly string[]) =>
    new UsersHttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'employee_kind_required',
      'An employee role needs an employee profile: create the user with kind "teacher" or "staff"',
      { roleKeys: [...roleKeys] },
    ),
  roleUnknown: (roleKeys: readonly string[]) =>
    new UsersHttpException(HttpStatus.BAD_REQUEST, 'role_unknown', 'Unknown role key', { roleKeys: [...roleKeys] }),
  // T03 — invitations
  userNotInvitable: (status: string) =>
    new UsersHttpException(
      HttpStatus.CONFLICT,
      'user_not_invitable',
      'Only an account that is awaiting activation (status "invited") can be invited',
      { status },
    ),
  invitationInvalid: () =>
    new UsersHttpException(HttpStatus.NOT_FOUND, 'invitation_invalid', 'This invitation link is not valid'),
  invitationExpired: (expiredAt: Date) =>
    new UsersHttpException(
      HttpStatus.GONE,
      'invitation_expired',
      'This invitation has expired; ask the academy for a new one',
      { expiredAt: expiredAt.toISOString() },
    ),
  invitationConsumed: () =>
    new UsersHttpException(
      HttpStatus.CONFLICT,
      'invitation_consumed',
      'This invitation has already been used or was replaced by a newer one',
    ),
  // T04 — update
  nothingToUpdate: () =>
    new UsersHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  // T06 — account status and soft delete
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new UsersHttpException(
      HttpStatus.CONFLICT,
      'invalid_transition',
      `Action "${action}" is not allowed for an account in state "${from}"`,
      { from, action, allowed: [...allowed] },
    ),
  selfForbidden: (action: string) =>
    new UsersHttpException(HttpStatus.FORBIDDEN, 'self_forbidden', 'You cannot apply this action to your own account', {
      action,
    }),
  lastAdmin: () =>
    new UsersHttpException(
      HttpStatus.CONFLICT,
      'last_admin',
      'This is the last active academy admin; make another admin active first',
    ),
  // T05 — password reset
  userNotResettable: (status: string) =>
    new UsersHttpException(
      HttpStatus.CONFLICT,
      'user_not_resettable',
      'Only an active account can have its password reset; an account awaiting activation is invited instead',
      { status },
    ),
  resetInvalid: () =>
    new UsersHttpException(HttpStatus.NOT_FOUND, 'reset_invalid', 'This password-reset link is not valid or has already been used'),
  resetExpired: (expiredAt: Date) =>
    new UsersHttpException(
      HttpStatus.GONE,
      'reset_expired',
      'This password-reset link has expired; request a new one',
      { expiredAt: expiredAt.toISOString() },
    ),
  resetDisabled: () =>
    new UsersHttpException(
      HttpStatus.FORBIDDEN,
      'reset_disabled',
      'Self-service password reset is not available; ask the academy to reset your password',
    ),
};
