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
import { AssignmentDto, AssignmentListDto, ChangeAssignmentStatusDto, CreateAssignmentDto, ListAssignmentsQueryDto, UpdateAssignmentDto } from './assignments.dto.js';
import { MANAGE_ASSIGNMENTS_PERMISSION, READ_ASSIGNMENTS_PERMISSION } from './assignments.policy.js';
import { AssignmentsService } from './assignments.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/**
 * MOD-08-T02 — creating an assignment for a class (roadmap §4g.4 API-104).
 * Needs `assignments.manage`; the class must be visible to the caller (D-R16:
 * assigned, or `classes.manage`), else 404. The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ClassAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post(':id/assignments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Create an assignment for a class',
    description:
      'A draft of a planned, open or running class (`class_closed` otherwise) with a localized title, optional instructions (4,000 characters per locale), ' +
      'a maximum score, an optional weight, due date and lesson of the same class (`lesson_mismatch`), the late policy (`allowLate`; a late penalty needs it — `late_penalty_invalid`) and the number of attempts. ' +
      'One audit event `assignments.created`. Needs `assignments.manage`; the class must be assigned to the caller unless they hold `classes.manage` (404 otherwise).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiCreatedResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `late_penalty_invalid` — `{ allowLate, latePenaltyPercent }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `assignments.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found | lesson_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'lesson_mismatch — `{ lessonId, classId }`' })
  @ApiConflictResponse({ description: 'class_closed — `{ classId, status }` (completed or cancelled class)' })
  create(
    @Param('id', new ParseUUIDPipe()) classId: string,
    @Body() body: CreateAssignmentDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<AssignmentDto> {
    return this.assignments.create(classId, body, caller, requestContext(req));
  }
}

/**
 * MOD-08-T02 — assignments (roadmap §4g.4 API-102/103/105/106/107). Reading
 * needs `assignments.read` and is limited to the assignments of the caller's
 * assigned classes unless they hold `classes.manage` (D-R16); every write
 * needs `assignments.manage` (method-level key) and the same visibility.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@Controller('assignments')
@RequirePermissions(READ_ASSIGNMENTS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `assignments.read` to read, `assignments.manage` to write; origin_forbidden' })
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List assignments',
    description:
      'Keyset-paginated list (`limit` 1–100, opaque `cursor`) by due date — assignments without one last — then id (`order` asc by default), with filters `classId`, `lessonId`, `status`, `dueFrom` and `dueTo` (inclusive instants; an assignment without a due date never matches them). ' +
      'Holders of `assignments.read` alone see only the assignments of the classes they are assigned to; holders of `classes.manage` see every assignment. ' +
      'Each item carries its class and course, the linked lesson, the students’ latest submissions by status and the active enrollments of the class.',
  })
  @ApiOkResponse({ type: AssignmentListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListAssignmentsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<AssignmentListDto> {
    return this.assignments.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read an assignment', description: 'An assignment with its class and course, the linked lesson and the submission counts. An assignment of a class the caller may not see is 404.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiNotFoundResponse({ description: 'assignment_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<AssignmentDto> {
    return this.assignments.get(id, caller);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Update an assignment',
    description:
      'PATCH semantics: absent = unchanged, null clears `instructions`, `lessonId`, `weight`, `dueAt` and `latePenaltyPercent`. Only changed fields are written, with one `assignments.updated` event; an identical body writes nothing. ' +
      'A closed assignment accepts nothing and the grading rules (maxScore, maxAttempts, allowLate, latePenaltyPercent) are locked once a submission exists (`assignment_locked`); ' +
      'an assignment of a completed or cancelled class is frozen (`class_closed`). The merged late policy is checked (`late_penalty_invalid`) and a new lesson must belong to the class.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({ description: 'Validation failed | nothing_to_update | late_penalty_invalid' })
  @ApiNotFoundResponse({ description: 'assignment_not_found | lesson_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'lesson_mismatch' })
  @ApiConflictResponse({ description: 'assignment_locked — `{ status, fields, submissionCount }` | class_closed — `{ classId, status }`' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAssignmentDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<AssignmentDto> {
    return this.assignments.update(id, body, caller, requestContext(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Change the assignment status',
    description:
      '`publish`: draft → open (sets `publishedAt`) · `close`: open → closed (sets `closedAt`; also for a completed or cancelled class) · `reopen`: closed → open (clears `closedAt`). ' +
      'Anything else is `invalid_transition { from, action, allowed }`; `publish` and `reopen` need a planned, open or running class (`class_closed`). One audit event `assignments.status.changed`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'assignment_not_found' })
  @ApiConflictResponse({ description: 'invalid_transition — `{ from, action, allowed }` | class_closed — `{ classId, status }`' })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeAssignmentStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<AssignmentDto> {
    return this.assignments.changeStatus(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Delete a draft assignment',
    description: 'Only a draft without any submission (also of a completed or cancelled class); any other assignment is `assignment_not_deletable` — close it instead. One audit event `assignments.deleted`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'assignment_not_found' })
  @ApiConflictResponse({ description: 'assignment_not_deletable — `{ status, submissionCount }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.assignments.remove(id, caller, requestContext(req));
  }
}
