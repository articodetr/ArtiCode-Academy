// Error vocabulary of MOD-03 (users, invitations, password reset, roles,
// guardians) — fixed in MOD-03-T00. Same shape as AuthHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message. Only the factories below are in use;
// the remaining codes are reserved for the tasks named next to them.
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
  // T03 / T05 — invitations and password reset
  'user_not_invitable',
  'invitation_invalid',
  'invitation_expired',
  'invitation_consumed',
  'reset_invalid',
  'reset_expired',
  'reset_disabled',
  // T04 / T06 — update and account status
  'profile_mismatch',
  'invalid_transition',
  'self_forbidden',
  'last_admin',
  // T07 / T08 — roles and permissions
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
};
