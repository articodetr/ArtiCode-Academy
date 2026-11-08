import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { AttendanceSheetDto, RecordAttendanceDto } from './attendance.dto.js';
import { AttendanceService } from './attendance.service.js';
import { READ_ATTENDANCE_PERMISSION, RECORD_ATTENDANCE_PERMISSION } from './lessons.policy.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/**
 * MOD-06-T03 — the attendance sheet of a lesson (roadmap §4f.4 API-099/API-100).
 * Reading needs `attendance.read`, writing `attendance.record` — method-level
 * keys, so neither needs `lessons.read`; both follow the lesson's class
 * visibility (D-R16/D-R32: assigned teachers, or `classes.manage`; others 404).
 * The global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('lessons')
@ApiBearerAuth()
@Controller('lessons')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `attendance.read` to read, `attendance.record` to write; origin_forbidden' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':id/attendance')
  @RequirePermissions(READ_ATTENDANCE_PERMISSION)
  @ApiOperation({
    summary: 'Read the attendance sheet of a lesson',
    description:
      'Every student with an active or completed enrollment in the lesson’s class, plus any other student holding a record in the lesson (a student withdrawn after the lesson keeps their record), ' +
      'in enrollment order, each with their record or null. Students are shown in the caller’s projection (`email`/`username`/`phone` need `users.read_contact`); the teacher’s note is shown here only. ' +
      '`recordable`/`closedReason` say whether a PUT would be accepted now (D-R33). Needs `attendance.read`; a lesson of a class the caller may not see is 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The lesson' })
  @ApiOkResponse({ type: AttendanceSheetDto })
  @ApiBadRequestResponse({ description: 'Validation failed (not a uuid)' })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  sheet(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<AttendanceSheetDto> {
    return this.attendance.sheet(id, caller);
  }

  @Put(':id/attendance')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(RECORD_ATTENDANCE_PERMISSION)
  @ApiOperation({
    summary: 'Record or correct attendance (batch upsert)',
    description:
      '`{ records: [{ studentId, status, minutesLate?, note? }] }` (1–500 entries, no student twice). Each entry is the whole new state of that student’s record — an absent `minutesLate` or `note` clears it; ' +
      'students absent from the request keep their records and nothing is ever deleted. Accepted for a lesson whose class is not cancelled (`class_closed`), that is not cancelled itself and whose start time has passed ' +
      '(`attendance_closed { reason: cancelled|not_started }` — D-R33); corrections stay open afterwards, for a completed class too. Every named student must hold an active or completed enrollment in the class, ' +
      'else the whole batch is refused (`not_enrolled { studentIds }`) and nothing is written. `minutesLate` is a whole number of 1–720 with status `late` only. ' +
      'The batch is applied as a diff under the lesson-row lock: records are created or updated only where a value differs, the first write sets `attendanceTakenAt`, `recordedBy` is the last writer, ' +
      'and exactly one audit event `attendance.recorded` is recorded — an identical batch writes nothing and records no event. Answers with the sheet. Needs `attendance.record` and the class visibility.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The lesson' })
  @ApiOkResponse({ type: AttendanceSheetDto })
  @ApiBadRequestResponse({ description: 'Validation failed: empty or oversized batch, a repeated studentId, `minutesLate` outside 1–720 or with a status other than late, a note above 500 characters' })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'not_enrolled — `{ studentIds }` (no active or completed enrollment in the class)' })
  @ApiConflictResponse({ description: 'attendance_closed — `{ reason: cancelled|not_started, startsAt }` | class_closed — `{ classId, status }` (cancelled class)' })
  record(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RecordAttendanceDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<AttendanceSheetDto> {
    return this.attendance.record(id, body, caller, requestContext(req));
  }
}
