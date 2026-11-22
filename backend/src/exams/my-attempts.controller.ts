import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { TAKE_EXAMS_PERMISSION } from './exams.policy.js';
import { MyAttemptDto, SaveAnswersDto, SaveAnswersResultDto, StartAttemptDto } from './my-attempts.dto.js';
import { MyAttemptsService } from './my-attempts.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';
const NO_KEY = 'Never a key: the options come without `isCorrect`, the score only once the exam releases it (D-R156), the correct answers and explanations only once it reveals them and its window has closed (D-R157).';

/** 240 answer saves per minute per (IP, user): one per change of an answer, with room for a fast learner and a retry (D-R165). */
const ANSWER_SAVE_LIMIT = { login: { limit: 240, ttl: 60 * 1000 } };
/** 30 starts or submits per minute per (IP, user). */
const ATTEMPT_ACTION_LIMIT = { login: { limit: 30, ttl: 60 * 1000 } };

/**
 * MOD-09 phase 2 — taking an online exam (roadmap §4r.6 API-276..API-279).
 * Everything is the caller's own: the exam through their enrollment in its
 * class, the attempt by its owner — anything else is 404. The three writes
 * need `exams.take` (seeded to students); reading one's own attempt needs no
 * key, as «my exams». The global guards (Origin → Auth → Permissions) run
 * first; the writes are rate-limited per (IP, user).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class MyAttemptsController {
  constructor(private readonly attempts: MyAttemptsService) {}

  @Post('exams/:id/attempts')
  @RequirePermissions(TAKE_EXAMS_PERMISSION)
  @UseGuards(AuthThrottlerGuard)
  @Throttle(ATTEMPT_ACTION_LIMIT)
  @ApiOperation({
    summary: 'Start my attempt at an online exam, or resume the one in progress',
    description:
      'For an online exam the learners can see, in a class the caller has an `active` enrollment in, inside its window and while an attempt is left. The server fixes the deadline at the start: the time limit, never past the end of the window (D-R152). ' +
      '«Resume or create»: an attempt in progress is answered again (`200`) instead of opening another, so a double click or a repeated request never uses a second attempt; a new one is `201`. With `attemptNo` the server refuses any other number (`attempt_conflict`). ' +
      `One audit event \`exams.attempt.started\` per new attempt. ${NO_KEY}`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The exam' })
  @ApiCreatedResponse({ type: MyAttemptDto, description: 'A new attempt' })
  @ApiOkResponse({ type: MyAttemptDto, description: 'The attempt already in progress' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.take` | enrollment_required — `{ enrollmentStatus }` (the enrollment is not `active`) | origin_forbidden' })
  @ApiNotFoundResponse({ description: 'exam_not_found — unknown, a draft, a manual exam, or an exam of a class the caller is not enrolled in' })
  @ApiConflictResponse({
    description:
      'exam_not_open — `{ reason: not_open_yet|closed|results_published, opensAt, closesAt }` | attempts_exhausted — `{ attemptsAllowed, attempts }` | attempt_conflict — `{ expected, next }` | class_closed — `{ classId, status }`',
  })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited — 30 per minute per (IP, user)' })
  async start(
    @Param('id', new ParseUUIDPipe()) examId: string,
    @Body() body: StartAttemptDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MyAttemptDto> {
    const { attempt, created } = await this.attempts.start(examId, body, caller, requestContext(req));
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return attempt;
  }

  @Get('exam-attempts/:id')
  @ApiOperation({
    summary: 'Read one of my attempts',
    description:
      'The frozen questions in the exam’s order with the caller’s saved answers, the server’s deadline and clock (`expiresAt`, `serverNow`, `remainingSeconds` — the timer never trusts the device clock) and, once finished, the result when released and the review when revealed. ' +
      `Read-only: an attempt whose deadline has passed is shown with \`timeUp: true\` and closed by the next write or by the server’s sweeper. No permission key — ownership; somebody else’s attempt is 404. ${NO_KEY}`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The attempt' })
  @ApiOkResponse({ type: MyAttemptDto })
  @ApiNotFoundResponse({ description: 'attempt_not_found' })
  read(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<MyAttemptDto> {
    return this.attempts.read(id, caller);
  }

  @Put('exam-attempts/:id/answers')
  @RequirePermissions(TAKE_EXAMS_PERMISSION)
  @UseGuards(AuthThrottlerGuard)
  @Throttle(ANSWER_SAVE_LIMIT)
  @ApiOperation({
    summary: 'Save answers of my attempt',
    description:
      'One or more answers `{ examQuestionId, optionId | value }`, each the whole new answer to its question; an entry with neither field clears the answer. Checked against the frozen question: a question the exam does not ask, a question twice, an option that is not its own or the wrong field for its type are `answers_invalid` before any write. ' +
      'Only while the attempt is in progress and before its deadline (plus a 5 s network allowance): afterwards the server closes the attempt with what was saved and answers `attempt_closed`. No audit event (D-R165); 240 per minute per (IP, user).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The attempt' })
  @ApiOkResponse({ type: SaveAnswersResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed | answers_invalid — `{ unknown, duplicates, malformed }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.take`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'attempt_not_found' })
  @ApiConflictResponse({ description: 'attempt_closed — `{ status: submitted|timed_out }`' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  saveAnswers(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: SaveAnswersDto, @CurrentUser() caller: AuthPrincipal): Promise<SaveAnswersResultDto> {
    return this.attempts.saveAnswers(id, body, caller);
  }

  @Post('exam-attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(TAKE_EXAMS_PERMISSION)
  @UseGuards(AuthThrottlerGuard)
  @Throttle(ATTEMPT_ACTION_LIMIT)
  @ApiOperation({
    summary: 'Submit my attempt',
    description:
      'The final submit: the server grades the attempt from the frozen questions — a correct answer earns the question’s points, a wrong or missing one 0 — and writes the student’s counted result (the highest finished attempt — D-R153) into the exam’s results, in one transaction under the attempt’s row lock. ' +
      'Idempotent: submitting a finished attempt answers the same attempt without grading again. Past the deadline the server closes it as `timed_out` with what was saved. One audit event `exams.attempt.submitted` (or `exams.attempt.timed_out`, without an actor). ' +
      NO_KEY,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The attempt' })
  @ApiOkResponse({ type: MyAttemptDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.take`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'attempt_not_found' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<MyAttemptDto> {
    return this.attempts.submit(id, caller, requestContext(req));
  }
}
