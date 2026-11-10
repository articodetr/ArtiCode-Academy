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
import { ChangeExamStatusDto, CreateExamDto, ExamDto, ExamListDto, ListExamsQueryDto, UpdateExamDto } from './exams.dto.js';
import { MANAGE_EXAMS_PERMISSION, READ_EXAMS_PERMISSION } from './exams.policy.js';
import { ExamsService } from './exams.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/**
 * MOD-09-T03 — creating an exam for a class (roadmap §4h.4 API-115). Needs
 * `exams.manage`; the class must be visible to the caller (D-R16: assigned,
 * or `classes.manage`), else 404. The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ClassExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Post(':id/exams')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Create an exam for a class',
    description:
      'A draft exam whose results the teacher records (D-R42): a planned, open or running class (`class_closed` otherwise), a localized title and optional description (4,000 characters per locale), a type, ' +
      'an optional date, duration and lesson of the same class (`lesson_mismatch`), a maximum score, an optional pass score within it (`pass_score_invalid`) and weight. One audit event `exams.created`. ' +
      'Needs `exams.manage`; the class must be assigned to the caller unless they hold `classes.manage` (404 otherwise).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiCreatedResponse({ type: ExamDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `pass_score_invalid` — `{ passScore, maxScore }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found | lesson_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'lesson_mismatch — `{ lessonId, classId }`' })
  @ApiConflictResponse({ description: 'class_closed — `{ classId, status }` (completed or cancelled class)' })
  create(@Param('id', new ParseUUIDPipe()) classId: string, @Body() body: CreateExamDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ExamDto> {
    return this.exams.create(classId, body, caller, requestContext(req));
  }
}

/**
 * MOD-09-T03 — exams (roadmap §4h.4 API-113/114/116/117/118). Reading needs
 * `exams.read` and is limited to the exams of the caller's assigned classes
 * unless they hold `classes.manage` (D-R16); every write needs `exams.manage`
 * (method-level key) and the same visibility.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
@RequirePermissions(READ_EXAMS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.read` to read, `exams.manage` to write; origin_forbidden' })
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get()
  @ApiOperation({
    summary: 'List exams',
    description:
      'Keyset-paginated list (`limit` 1–100, opaque `cursor`) by exam date — undated exams last — then id (`order` asc by default), with filters `classId`, `lessonId`, `status`, `type`, `from` and `to` (inclusive instants; an undated exam never matches them). ' +
      'Holders of `exams.read` alone see only the exams of the classes they are assigned to; holders of `classes.manage` see every exam. ' +
      'Each item carries its class and course, the lesson, the recorded results by status and the active enrollments of the class.',
  })
  @ApiOkResponse({ type: ExamListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListExamsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<ExamListDto> {
    return this.exams.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read an exam', description: 'An exam with its class and course, the lesson and the result counts. An exam of a class the caller may not see is 404.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamDto })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ExamDto> {
    return this.exams.get(id, caller);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Update an exam',
    description:
      'PATCH semantics: absent = unchanged, null clears `description`, `lessonId`, `scheduledAt`, `durationMinutes`, `passScore` and `weight`. Only changed fields are written, with one `exams.updated` event; an identical body writes nothing. ' +
      '`maxScore` is locked once a result exists (`exam_locked`); an exam of a cancelled class is frozen (`class_closed`) — a completed class keeps its exams open. The merged pass score stays within the maximum (`pass_score_invalid`) and a new lesson must belong to the class.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamDto })
  @ApiBadRequestResponse({ description: 'Validation failed | nothing_to_update | pass_score_invalid' })
  @ApiNotFoundResponse({ description: 'exam_not_found | lesson_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'lesson_mismatch' })
  @ApiConflictResponse({ description: 'exam_locked — `{ status, fields, resultCount }` | class_closed — `{ classId, status }`' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateExamDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ExamDto> {
    return this.exams.update(id, body, caller, requestContext(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Change the exam status',
    description:
      '`schedule`: draft → scheduled (the learners see the exam) · `unschedule`: scheduled → draft (`exam_has_results` when results exist) · `publish`: scheduled → published (sets `publishedAt`; the learners see their results) · `unpublish`: published → scheduled. ' +
      'Anything else is `invalid_transition { from, action, allowed }`; `schedule` and `publish` are refused for a cancelled class (`class_closed`). One audit event `exams.status.changed`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  @ApiConflictResponse({ description: 'invalid_transition — `{ from, action, allowed }` | exam_has_results — `{ action, resultCount }` | class_closed' })
  changeStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ChangeExamStatusDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ExamDto> {
    return this.exams.changeStatus(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Delete an exam',
    description: 'Only a draft or scheduled exam without any result (whatever the class status); anything else is `exam_not_deletable`. One audit event `exams.deleted`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  @ApiConflictResponse({ description: 'exam_not_deletable — `{ status, resultCount }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.exams.remove(id, caller, requestContext(req));
  }
}
