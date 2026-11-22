import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { CorrectKeyDto, ExamAttemptDetailDto, ExamAttemptsDto, KeyCorrectionResultDto, RegradeExamDto, RegradeSummaryDto } from './exam-attempts.dto.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { GRADE_EXAMS_PERMISSION, READ_EXAMS_PERMISSION } from './exams.policy.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';
const CORRECTION_REFUSALS =
  'exam_not_online | exam_not_frozen — `{ status }` (a draft has no frozen questions) | class_closed — `{ classId, status }` | grades_certified — `{ classId, certificateCount }` (the class holds an issued certificate)';

/**
 * MOD-09 phase 2 — the attempts at an online exam as the teacher and the
 * office see them, and the audited corrections (roadmap §4r.6 API-272..API-274).
 * Reading needs `exams.read`, correcting a key and regrading `exams.grade`;
 * everything goes through the exam's class visibility (D-R16 — an exam of a
 * class the caller is not assigned to is 404 unless they hold
 * `classes.manage`). A learner holds `exams.read` but is assigned to no class,
 * so nothing here reaches them.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ExamAttemptsController {
  constructor(private readonly attempts: ExamAttemptsService) {}

  @Get(':id/attempts')
  @RequirePermissions(READ_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Read the attempts at an online exam',
    description:
      'Every student with an active or completed enrollment plus anyone holding an attempt, in enrollment order and in the caller’s D-R07 projection, each with their attempts (the counted one marked — the highest finished attempt, D-R153) and their counted result with its `source`. ' +
      '`stats` counts who started, who is in progress, who finished and who did not start, and gives the mean, the range and the pass rate of the counted scores; `questions` says how each question went over the counted attempts. ' +
      'Read-only: an attempt whose deadline has passed and that the server has not closed yet shows `timeUp: true`. A manual exam answers the roster with no attempts.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamAttemptsDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.read`' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  roster(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ExamAttemptsDto> {
    return this.attempts.roster(id, caller);
  }

  @Post(':id/questions/:examQuestionId/key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(GRADE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Correct the answer key of a frozen question and grade the attempts again',
    description:
      'For a question of an online exam that has been made available (D-R161): `correctOptionId` — one of the question’s own options — for a `single_choice` question, `correctAnswer` (a JSON boolean) for a `true_false` one, and a required `reason`. ' +
      'In one transaction under the exam-row lock the frozen copy takes the new key (the previous key joins the copy’s own history), every finished attempt is graded again and the counted results that change are rewritten; a final grade fixed earlier then shows as stale. ' +
      'Exactly one `exams.questions.key_corrected` event with the reason and the counts — never a key. The key the question already has writes and records nothing (`changed: false`). The question in its bank is not touched.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The exam' })
  @ApiParam({ name: 'examQuestionId', format: 'uuid', description: 'The exam’s question (the `id` of an API-270 item)' })
  @ApiOkResponse({ type: KeyCorrectionResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed | key_invalid — `{ problem: option_required|option_unknown|answer_required|not_allowed_for_type }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.grade`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'exam_not_found | question_not_found — `{ questionIds }`' })
  @ApiConflictResponse({ description: CORRECTION_REFUSALS })
  correctKey(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('examQuestionId', new ParseUUIDPipe()) examQuestionId: string,
    @Body() body: CorrectKeyDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<KeyCorrectionResultDto> {
    return this.attempts.correctKey(id, examQuestionId, body, caller, requestContext(req));
  }

  @Post(':id/regrade')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(GRADE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Grade the finished attempts of an online exam again',
    description:
      'Grades every finished attempt again from the frozen questions as they are and rewrites the counted results that change, under the exam-row lock; a required `reason`. ' +
      'The grading is deterministic, so this normally changes nothing — then nothing is written and no event is recorded; otherwise one `exams.attempts.regraded` event with the counts and the reason.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RegradeSummaryDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.grade`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  @ApiConflictResponse({ description: CORRECTION_REFUSALS })
  regrade(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RegradeExamDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<RegradeSummaryDto> {
    return this.attempts.regrade(id, body, caller, requestContext(req));
  }
}

/**
 * MOD-09 phase 2 — one attempt with the key and the student's answers (roadmap
 * §4r.6 API-275), for a holder of `exams.read` who sees the exam's class. The
 * learner's own reading of an attempt is `GET /api/me/exam-attempts/:id`,
 * which never carries a key.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exam-attempts')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ExamAttemptDetailController {
  constructor(private readonly attempts: ExamAttemptsService) {}

  @Get(':id')
  @RequirePermissions(READ_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Read one attempt with the key and the student’s answers',
    description:
      'The frozen questions in the exam’s order with their key, the student’s answer to each and — once the attempt is finished — whether it was correct and the points it earned. The student in the caller’s D-R07 projection. ' +
      'Through the exam’s class visibility: an attempt at an exam of a class the caller is not assigned to is 404 unless they hold `classes.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The attempt' })
  @ApiOkResponse({ type: ExamAttemptDetailDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.read`' })
  @ApiNotFoundResponse({ description: 'attempt_not_found' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ExamAttemptDetailDto> {
    return this.attempts.detail(id, caller);
  }
}
