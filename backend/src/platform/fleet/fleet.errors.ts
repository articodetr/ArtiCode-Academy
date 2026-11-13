// MOD-18-T05 — error vocabulary of the fleet routes (API-196..198), on the
// platform's shared body shape `{ statusCode, error, code, message, ...details }`
// (PlatformHttpException, src/platform/platform.errors.ts).
//
//   academy_not_found      404 — `{ academyId }`: no academy with this id in the registry
//   academy_not_probeable  409 — `{ academyId, reason }`: `archived` (an archived academy
//                                 is never probed) or `no_origin` (no public origin stored)
//   cursor_invalid         400 — the history cursor is not a `nextCursor` of this list
//
// `400` validation failures (a malformed id, `limit` out of range, an unknown
// query parameter) keep the shape of the global ValidationPipe / ParseUUIDPipe.
import { HttpStatus } from '@nestjs/common';
import { PlatformHttpException } from '../platform.errors.js';

export const FLEET_ERROR_CODES = ['academy_not_found', 'academy_not_probeable', 'cursor_invalid'] as const;

export type FleetErrorCode = (typeof FLEET_ERROR_CODES)[number];

/** Why an academy cannot be probed (API-196). */
export type NotProbeableReason = 'archived' | 'no_origin';

function fleetException(status: HttpStatus, code: FleetErrorCode, message: string, details?: Record<string, unknown>) {
  return new PlatformHttpException<FleetErrorCode>(status, code, message, details);
}

export const fleetError = {
  academyNotFound: (academyId: string) =>
    fleetException(HttpStatus.NOT_FOUND, 'academy_not_found', 'No academy with this id', { academyId }),
  academyNotProbeable: (academyId: string, reason: NotProbeableReason) =>
    fleetException(
      HttpStatus.CONFLICT,
      'academy_not_probeable',
      reason === 'archived'
        ? 'An archived academy is not probed'
        : 'The academy has no public origin to probe; set its origin first',
      { academyId, reason },
    ),
  cursorInvalid: () =>
    fleetException(
      HttpStatus.BAD_REQUEST,
      'cursor_invalid',
      'The cursor is invalid or belongs to another list; restart from the first page',
    ),
};
