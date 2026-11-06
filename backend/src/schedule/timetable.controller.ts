import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { READ_SCHEDULE_PERMISSION } from './schedule.policy.js';
import { AcademyScheduleDto, AcademyScheduleQueryDto, MyScheduleDto, MyScheduleQueryDto } from './timetable.dto.js';
import { academyScheduleMissing } from './timetable.policy.js';
import { TimetableService } from './timetable.service.js';

/**
 * MOD-07-T04 (O9) — the academy's weekly schedule (roadmap §4e, API-090).
 * Read by holders of `schedule.manage` OR `classes.manage` (D-R27): the global
 * PermissionsGuard requires every listed key, so the any-of rule is checked
 * here behind authentication alone, as the users status actions do.
 */
@ApiTags('schedule')
@ApiBearerAuth()
@Controller('schedule')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class AcademyScheduleController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the academy’s weekly schedule',
    description:
      'Every weekly slot effective on `on` (default: today in the academy’s time zone), by weekday, start time and id, each with its room (and branch), teacher by name, display time zone and class summary. ' +
      'ANDed filters: `branchId` (a branch, or `none` for the academy’s own site), `roomId`, `teacherUserId`, `classId`, `weekday`. ' +
      'Needs `schedule.manage` or `classes.manage` (either one). No pagination.',
  })
  @ApiOkResponse({ type: AcademyScheduleDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`on` not a calendar date, `weekday` outside 0–6, an id not a uuid, an unknown filter)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["schedule.manage", "classes.manage"] }` (one of them suffices)' })
  list(@Query() query: AcademyScheduleQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<AcademyScheduleDto> {
    const missing = academyScheduleMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.timetable.academy(query);
  }
}

/**
 * MOD-07-T04 (O9) — «my schedule» (API-091): `schedule.read` plus ownership
 * (D-R27) — the caller's active enrollments, their linked children's while
 * they hold the `guardian` role, and the classes they teach.
 */
@ApiTags('schedule')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyScheduleController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('schedule')
  @RequirePermissions(READ_SCHEDULE_PERMISSION)
  @ApiOperation({
    summary: 'Read my weekly schedule',
    description:
      'The weekly slots, effective on `on` (default: today in the academy’s time zone), of the classes the caller is enrolled in (`relation: self`, active enrollments), ' +
      'of the classes the students linked to the caller as guardian are enrolled in (`relation: child`, while the caller holds the `guardian` role), ' +
      'and of the classes the caller teaches as lead or assistant (`relation: teacher`). One item per slot and relation; teachers by name only, no contact fields. ' +
      'Needs `schedule.read`; a user with no enrollment, linked child or class gets an empty list.',
  })
  @ApiOkResponse({ type: MyScheduleDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`on` not a calendar date, an unknown parameter)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `schedule.read`' })
  mine(@Query() query: MyScheduleQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyScheduleDto> {
    return this.timetable.mine(query, caller);
  }
}
