import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { ChangeLessonStatusDto, CreateLessonDto, LessonDto, LessonListDto, ListLessonsQueryDto, UpdateLessonDto } from './lessons.dto.js';
import { MANAGE_LESSONS_PERMISSION, READ_LESSONS_PERMISSION } from './lessons.policy.js';
import { LessonsService } from './lessons.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';
const WRITE_ERRORS =
  'class_closed — `{ classId, status }` (completed or cancelled class) | lesson_conflict — `{ resource: room|teacher, conflictingLessonId, conflictingClassId }`';

/**
 * MOD-06-T02 — creating a lesson for a class (roadmap §4f.4 API-095). Needs
 * `lessons.manage`; the class must be visible to the caller (D-R16: assigned,
 * or `classes.manage`), else 404. The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('lessons')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ClassLessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Post(':id/lessons')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_LESSONS_PERMISSION)
  @ApiOperation({
    summary: 'Create a lesson for a class',
    description:
      'A scheduled lesson of a planned, open or running class (`class_closed` otherwise), with a localized title, a time range of at most 12 hours (`time_range_invalid`), ' +
      'an optional room (existing and active), an optional teacher who must be one of the class’s teachers (`teacher_not_assigned`; absent = the class’s lead teacher at creation, null = none), ' +
      'an optional syllabus item of the class’s course (`syllabus_item_mismatch`) and an optional https meeting link. ' +
      'A room or teacher already holding a non-cancelled lesson at an overlapping time is refused by the database (`lesson_conflict`); back-to-back lessons are fine. ' +
      'One audit event `lessons.created`. Needs `lessons.manage`; the class must be assigned to the caller unless they hold `classes.manage` (404 otherwise).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiCreatedResponse({ type: LessonDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `time_range_invalid` — `{ startsAt, endsAt, maxHours }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `lessons.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found | syllabus_item_not_found | room_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'teacher_not_assigned — `{ userId }` | syllabus_item_mismatch — `{ syllabusItemId, courseId }` | room_inactive — `{ roomId }`' })
  @ApiConflictResponse({ description: WRITE_ERRORS })
  create(
    @Param('id', new ParseUUIDPipe()) classId: string,
    @Body() body: CreateLessonDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<LessonDto> {
    return this.lessons.create(classId, body, caller, requestContext(req));
  }
}

/**
 * MOD-06-T02 — lessons (roadmap §4f.4 API-093/094/096/097/098). Reading needs
 * `lessons.read` and is limited to the lessons of the caller's assigned
 * classes unless they hold `classes.manage` (D-R16); every write needs
 * `lessons.manage` (method-level key) and the same visibility.
 */
@ApiTags('lessons')
@ApiBearerAuth()
@Controller('lessons')
@RequirePermissions(READ_LESSONS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `lessons.read` to read, `lessons.manage` to write; origin_forbidden' })
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get()
  @ApiOperation({
    summary: 'List lessons',
    description:
      'Keyset-paginated list (`limit` 1–100, opaque `cursor`) by start time then id (`order` asc by default), with filters `classId`, `teacherId`, `status`, `from` and `to` (lessons starting inside the instants, inclusive). ' +
      'Holders of `lessons.read` alone see only the lessons of the classes they are assigned to; holders of `classes.manage` see every lesson. Each item carries its class, course, room, teacher, syllabus item and attendance counts.',
  })
  @ApiOkResponse({ type: LessonListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListLessonsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<LessonListDto> {
    return this.lessons.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a lesson', description: 'A lesson with its class and course, room, teacher, syllabus item and attendance counts by status. A lesson of a class the caller may not see is 404.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LessonDto })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<LessonDto> {
    return this.lessons.get(id, caller);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_LESSONS_PERMISSION)
  @ApiOperation({
    summary: 'Update a lesson',
    description:
      'PATCH semantics: absent = unchanged, null clears `description`, `roomId`, `teacherUserId`, `syllabusItemId` and `meetingUrl`. Only changed fields are written, with one `lessons.updated` event; an identical body writes nothing. ' +
      'Time, room and teacher change for a scheduled lesson only; a cancelled lesson accepts nothing (`lesson_locked`); a lesson of a completed or cancelled class is frozen (`class_closed`). ' +
      'The merged time range is checked (`time_range_invalid`), a new teacher must be one of the class’s teachers, a new syllabus item one of the course’s, a new room active; a double booking is `lesson_conflict`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LessonDto })
  @ApiBadRequestResponse({ description: 'Validation failed | nothing_to_update | time_range_invalid' })
  @ApiNotFoundResponse({ description: 'lesson_not_found | syllabus_item_not_found | room_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'teacher_not_assigned | syllabus_item_mismatch | room_inactive' })
  @ApiConflictResponse({ description: `lesson_locked — \`{ status, fields }\` | ${WRITE_ERRORS}` })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLessonDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<LessonDto> {
    return this.lessons.update(id, body, caller, requestContext(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_LESSONS_PERMISSION)
  @ApiOperation({
    summary: 'Change the lesson status',
    description:
      '`complete`: scheduled → completed once the start time has passed (`lesson_not_started`) · `cancel`: scheduled → cancelled, the reason is stored as `cancellationReason` · ' +
      '`restore`: cancelled → scheduled, the room and teacher conflicts are checked again (`lesson_conflict`). Anything else is `invalid_transition { from, action, allowed }`. ' +
      'A lesson of a completed or cancelled class is frozen (`class_closed`). One audit event `lessons.status.changed`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LessonDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  @ApiConflictResponse({ description: `invalid_transition — \`{ from, action, allowed }\` | lesson_not_started — \`{ startsAt }\` | ${WRITE_ERRORS}` })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeLessonStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<LessonDto> {
    return this.lessons.changeStatus(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_LESSONS_PERMISSION)
  @ApiOperation({
    summary: 'Delete a scheduled lesson',
    description: 'Only a scheduled lesson without any attendance record, of a planned, open or running class; any other lesson is `lesson_not_deletable` — cancel it instead. One audit event `lessons.deleted`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  @ApiConflictResponse({ description: 'lesson_not_deletable — `{ status, attendanceCount }` | class_closed' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.lessons.remove(id, caller, requestContext(req));
  }
}
