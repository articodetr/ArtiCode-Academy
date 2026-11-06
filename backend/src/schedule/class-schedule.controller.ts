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
import { READ_CLASSES_PERMISSION } from '../classes/classes.policy.js';
import { ClassScheduleDto, ReplaceClassScheduleDto } from './class-schedule.dto.js';
import { ClassScheduleService } from './class-schedule.service.js';
import { MANAGE_SCHEDULE_PERMISSION } from './schedule.policy.js';

/**
 * MOD-07-T03 (O9) — the weekly schedule of a class (roadmap §4e, API-088/089).
 * Reading needs `classes.read` and follows the class's visibility (D-R16);
 * writing needs `schedule.manage` (D-R27). The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('schedule')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class ClassScheduleController {
  constructor(private readonly schedule: ClassScheduleService) {}

  @Get(':id/schedule')
  @RequirePermissions(READ_CLASSES_PERMISSION)
  @ApiOperation({
    summary: 'Read the weekly schedule of a class',
    description:
      'The class’s weekly slots by weekday, start time and id, each with its room (and the room’s branch) and teacher by name. ' +
      'Needs `classes.read`; a class the caller may not see (not assigned, without `classes.manage` — D-R16) is 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: ClassScheduleDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `classes.read`' })
  @ApiNotFoundResponse({ description: 'class_not_found — unknown class, or one the caller may not see' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ClassScheduleDto> {
    return this.schedule.get(id, caller);
  }

  @Put(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_SCHEDULE_PERMISSION)
  @ApiOperation({
    summary: 'Replace the weekly schedule of a class',
    description:
      'Full replacement `{ slots: [{ id?, weekday, startTime, endTime, roomId?, teacherUserId?, effectiveFrom, effectiveTo? }] }` (up to 50; `[]` removes every slot), applied as a diff: ' +
      'slots with an id are kept (updated when a value differs), slots without one are created, rows not listed are deleted. ' +
      'Refused before any write when the class is completed or cancelled (`class_not_schedulable`), an id is unknown or repeated (`schedule_invalid`), a weekday is outside `settings.scheduling.workingDays` (`non_working_day` — D-R28), ' +
      'a room is unknown or inactive (`room_not_found` / `room_inactive`), a teacher is not one of the class’s teachers (`teacher_not_assigned` — D-R26), or two slots of the request book the same room or teacher at overlapping times (`schedule_conflict`). ' +
      'A double booking against another class is refused by the database (`schedule_conflict` with the conflicting slot). Adjacent slots (10:00–11:00, 11:00–12:00) do not overlap. ' +
      'One audit event `classes.schedule.changed { added, updated, removed, slots }`; an identical list writes nothing. Requires `schedule.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: ClassScheduleDto, description: 'The schedule after the replacement' })
  @ApiBadRequestResponse({ description: 'Validation failed (HH:MM, dates, endTime ≤ startTime, …) or `schedule_invalid` — `{ unknown, duplicates }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `schedule.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found | room_not_found — `{ roomId }`' })
  @ApiUnprocessableEntityResponse({ description: 'non_working_day — `{ weekday }` | room_inactive — `{ roomId }` | teacher_not_assigned — `{ userId }`' })
  @ApiConflictResponse({ description: 'class_not_schedulable — `{ status }` | schedule_conflict — `{ kind: room|teacher, slot, conflictingSlotId, conflictingClassId }`' })
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ReplaceClassScheduleDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<ClassScheduleDto> {
    return this.schedule.replace(id, body, caller, requestContext(req));
  }
}
