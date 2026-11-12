// Error vocabulary of MOD-12 notifications (roadmap §4j.4, owner decisions
// D-R79..D-R86). One dictionary for the whole module, complete from T02 on so
// T05 only uses it. Same shape as the other module dictionaries: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code`. A detail is never named `code`.
//
//   -- «my notifications» and preferences (T02) --
//   notification_not_found  404 — no notification with this id among the caller's own
//   nothing_to_update       400 — a preferences body that names no category
//   -- announcements (T05) --
//   audience_invalid        400 — unknown kind, a class audience with role keys, an academy
//                                 audience with a class, or no recipient group ({ problems })
//   audience_empty          422 — the audience resolves to nobody
//   audience_too_large      422 — more recipients than one announcement may reach ({ recipients, max })
//   class_not_found         404 — no such class among those the caller may announce to ({ classId })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const NOTIFICATIONS_ERROR_CODES = [
  'notification_not_found',
  'nothing_to_update',
  'audience_invalid',
  'audience_empty',
  'audience_too_large',
  'class_not_found',
] as const;

export type NotificationsErrorCode = (typeof NOTIFICATIONS_ERROR_CODES)[number];

export interface NotificationsErrorBody {
  statusCode: number;
  error: string;
  code: NotificationsErrorCode;
  message: string;
  [detail: string]: unknown;
}

export class NotificationsHttpException extends HttpException {
  readonly code: NotificationsErrorCode;

  constructor(status: HttpStatus, code: NotificationsErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: NotificationsErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error', code, message, ...details };
    super(body, status);
    this.code = code;
  }
}

/** Recipients one announcement may reach (D-R85). */
export const ANNOUNCEMENT_MAX_RECIPIENTS = 5000;

export const notificationsError = {
  /** Also the answer for another user's notification: its existence is not revealed. */
  notificationNotFound: (notificationId: string) =>
    new NotificationsHttpException(HttpStatus.NOT_FOUND, 'notification_not_found', 'No notification with this id', { notificationId }),
  nothingToUpdate: () => new NotificationsHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body names no category to update'),
  audienceInvalid: (problems: readonly string[]) =>
    new NotificationsHttpException(HttpStatus.BAD_REQUEST, 'audience_invalid', 'The audience of the announcement is not valid', { problems: [...problems] }),
  audienceEmpty: () => new NotificationsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'audience_empty', 'The audience of the announcement has no recipient'),
  audienceTooLarge: (recipients: number) =>
    new NotificationsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'audience_too_large', 'The announcement would reach more recipients than allowed', {
      recipients,
      max: ANNOUNCEMENT_MAX_RECIPIENTS,
    }),
  classNotFound: (classId: string) => new NotificationsHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
};
