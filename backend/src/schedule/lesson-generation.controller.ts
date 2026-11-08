import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
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
import { GenerateLessonsDto, GeneratedLessonsDto } from './lesson-generation.dto.js';
import { GENERATION_MAX_DAYS } from './lesson-generation.plan.js';
import { LessonGenerationService } from './lesson-generation.service.js';
import { MANAGE_SCHEDULE_PERMISSION } from './schedule.policy.js';

/**
 * MOD-07-T05 (O9) — lessons generated from the weekly schedule (roadmap §4e.5
 * T05, API-092, D-R29): `schedule.manage` writes the lessons through the
 * exported MOD-06 service, so every lesson rule (lead teacher by default,
 * active room, room/teacher double booking) is enforced by one writer. The
 * global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('schedule')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class LessonGenerationController {
  constructor(private readonly generation: LessonGenerationService) {}

  @Post(':id/schedule/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_SCHEDULE_PERMISSION)
  @ApiOperation({
    summary: 'Generate lessons from the weekly schedule of a class',
    description:
      `\`{ from, to }\` — inclusive calendar dates, at most ${GENERATION_MAX_DAYS} days. For every weekly slot effective on a date of its weekday inside the range, one lesson is created: ` +
      '`starts_at`/`ends_at` are the slot’s wall-clock times read in the room’s branch time zone (else the academy’s — daylight-saving transitions included), ' +
      '`schedule_id`, the room and the teacher come from the slot (no slot teacher = the class’s lead teacher at generation), the title is the class name, the delivery mode is `in_person`. ' +
      'Generation is repeatable: a (slot, local date) that already has a lesson — whatever its status — is skipped (`existing`), and so are the dates outside `settings.scheduling.workingDays` (`offDays`). ' +
      'The class must be planned, open or running. Everything is written in one transaction under the class-row lock with ONE audit event `lessons.created { count, lessonIds }`; nothing to create = 200 without write or event. ' +
      'A generated lesson that would double-book a room or a teacher against an existing lesson is refused by the database (`lesson_conflict` — fix the lesson or the slot and run again). Requires `schedule.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: GeneratedLessonsDto, description: 'The counts and the created lessons' })
  @ApiBadRequestResponse({ description: `Validation failed — dates \`YYYY-MM-DD\`, \`to\` not before \`from\`, at most ${GENERATION_MAX_DAYS} days` })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `schedule.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found | room_not_found — `{ roomId }` (a slot’s room was deleted meanwhile)' })
  @ApiUnprocessableEntityResponse({ description: 'room_inactive — `{ roomId }` | teacher_not_assigned — `{ userId }`' })
  @ApiConflictResponse({
    description: 'class_not_schedulable — `{ status }` | class_closed — `{ classId, status }` (the class changed under the lock) | lesson_conflict — `{ resource: room|teacher, conflictingLessonId, conflictingClassId }`',
  })
  generate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: GenerateLessonsDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<GeneratedLessonsDto> {
    return this.generation.generate(id, body, caller, requestContext(req));
  }
}
