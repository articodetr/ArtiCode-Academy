import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { GRADE_ASSIGNMENTS_PERMISSION, READ_ASSIGNMENTS_PERMISSION, SUBMIT_ASSIGNMENTS_PERMISSION } from './assignments.policy.js';
import { ReviewSubmissionDto, SubmissionDto, SubmissionRosterDto, SubmitAssignmentDto } from './submissions.dto.js';
import { SubmissionsService } from './submissions.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/**
 * MOD-08-T03 — the submissions of an assignment (roadmap §4g.4 API-108/109):
 * the roster for the class's teachers (`assignments.read` + D-R16) and one
 * attempt of the calling student (`assignments.submit` + an active
 * enrollment in the class). The global guards (Origin → Auth → Permissions)
 * run first.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@Controller('assignments')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class AssignmentSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get(':id/submissions')
  @RequirePermissions(READ_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Submission roster of an assignment',
    description:
      'Every student with an active or completed enrollment in the class, plus anyone holding a submission (a withdrawn student stays listed), in enrollment order, each in the caller’s projection (D-R07) ' +
      'with their attempts, the attempts allowed (maxAttempts plus one per returned attempt), their latest attempt (without the answer — API-110) and the score of their latest graded attempt. ' +
      'Holders of `assignments.read` alone see the assignments of the classes they are assigned to; holders of `classes.manage` every assignment.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The assignment' })
  @ApiOkResponse({ type: SubmissionRosterDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `assignments.read`' })
  @ApiNotFoundResponse({ description: 'assignment_not_found' })
  roster(@Param('id', new ParseUUIDPipe()) assignmentId: string, @CurrentUser() caller: AuthPrincipal): Promise<SubmissionRosterDto> {
    return this.submissions.roster(assignmentId, caller);
  }

  @Post(':id/submissions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SUBMIT_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Submit an attempt',
    description:
      'One attempt of the calling student: text and/or an https link (`submission_invalid` without either). The caller must hold an active enrollment in the class (`not_enrolled`), ' +
      'the assignment must be open (`assignment_closed { reason: not_published|closed }`), and after the due date only with allowLate (then marked late; `assignment_closed { reason: past_due }` otherwise). ' +
      'Each submission is a new attempt up to maxAttempts plus one per returned attempt (`attempts_exhausted`). One audit event `assignments.submitted` by the student.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The assignment' })
  @ApiCreatedResponse({ type: SubmissionDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `submission_invalid`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `assignments.submit`; not_enrolled — `{ classId }`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'assignment_not_found' })
  @ApiConflictResponse({ description: 'assignment_closed — `{ reason, dueAt }` | attempts_exhausted — `{ maxAttempts, attempts }`' })
  submit(
    @Param('id', new ParseUUIDPipe()) assignmentId: string,
    @Body() body: SubmitAssignmentDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<SubmissionDto> {
    return this.submissions.submit(assignmentId, body, caller, requestContext(req));
  }
}

/**
 * MOD-08-T03 — one submission (roadmap §4g.4 API-110/111): read by its
 * student, their guardian or the class's teachers (checked in the service —
 * no key at the guard, as «my classes»), reviewed by a teacher with
 * `assignments.grade` and the class's visibility.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@Controller('submissions')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get(':id')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Read a submission',
    description:
      'The attempt with its answer, status, score, feedback and reviewer by name, and the student’s attempt counts. Readable by its student, by their guardian (who holds the `guardian` role and is linked to the student), ' +
      'and by the class’s teachers with `assignments.read` (or any holder of `classes.manage` + `assignments.read`); anyone else gets 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubmissionDto })
  @ApiNotFoundResponse({ description: 'submission_not_found' })
  get(@Param('id', new ParseUUIDPipe()) submissionId: string, @CurrentUser() caller: AuthPrincipal): Promise<SubmissionDto> {
    return this.submissions.get(submissionId, caller);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(GRADE_ASSIGNMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Grade or return a submission',
    description:
      '`grade`: graded with `score` (0..maxScore — `score_out_of_range`) and optional feedback; repeatable to correct a grade. `return`: returned for rework with feedback (`feedback_required`), which grants the student one more attempt. ' +
      'Any attempt may be reviewed, also of a closed assignment; an identical review writes nothing. Needs `assignments.grade` and the class’s visibility (404 otherwise). One audit event `assignments.graded` or `assignments.returned`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubmissionDto })
  @ApiBadRequestResponse({ description: 'Validation failed | score_out_of_range — `{ score, maxScore }` | feedback_required' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `assignments.grade`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'submission_not_found' })
  review(
    @Param('id', new ParseUUIDPipe()) submissionId: string,
    @Body() body: ReviewSubmissionDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<SubmissionDto> {
    return this.submissions.review(submissionId, body, caller, requestContext(req));
  }
}
