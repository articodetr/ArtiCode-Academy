import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
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
import { MANAGE_QUESTIONS_PERMISSION } from '../questions/questions.policy.js';
import { ExamQuestionsDto, ReplaceExamQuestionsDto } from './exam-questions.dto.js';
import { ExamQuestionsService } from './exam-questions.service.js';
import { MANAGE_EXAMS_PERMISSION, READ_EXAMS_PERMISSION } from './exams.policy.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/**
 * MOD-09 phase 2 — the questions of an online exam (roadmap §4r.6 API-270 and
 * API-271). Reading needs `exams.read`, replacing the set `exams.manage` AND
 * `questions.manage`; both go through the exam's class visibility (D-R16 —
 * an exam of a class the caller is not assigned to is 404 unless they hold
 * `classes.manage`). The answers carry the key: a learner holds `exams.read`
 * but is assigned to no class, so nothing here reaches them.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ExamQuestionsController {
  constructor(private readonly examQuestions: ExamQuestionsService) {}

  @Get(':id/questions')
  @RequirePermissions(READ_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Read the questions of an exam',
    description:
      'The linked questions in display order with their points and their answer key, the sum of the points against `maxScore`, and what would keep `schedule` from making a draft available (`problems`). ' +
      'While the exam is a draft the content is the bank’s; once it is scheduled the items are the frozen copies (`frozen: true`) the attempts are served and graded from (D-R158). A manual exam answers an empty list.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamQuestionsDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.read`' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  list(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ExamQuestionsDto> {
    return this.examQuestions.list(id, caller);
  }

  @Put(':id/questions')
  @RequirePermissions(MANAGE_EXAMS_PERMISSION, MANAGE_QUESTIONS_PERMISSION)
  @ApiOperation({
    summary: 'Replace the questions of an online exam',
    description:
      'The whole ordered list `{ questions: [{ questionId, points? }] }` (0–200; no question twice — `exam_questions_invalid`): an entry without `points` takes the question’s own default. Only for an online exam (`exam_not_online`) that is a draft (`exam_questions_locked`) of a class that is not cancelled (`class_closed`); ' +
      'every question must be in a bank the caller sees (`question_not_found { questionIds }`) and `ready` (`question_not_ready { questionIds }`), all checked before any write. ' +
      'Written as a diff under the exam-row lock with one `exams.questions.changed` event; an identical list writes nothing. The points need not sum to `maxScore` here — `schedule` requires it (D-R159).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamQuestionsDto })
  @ApiBadRequestResponse({ description: 'Validation failed | exam_questions_invalid — `{ duplicates }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.manage` and `questions.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'exam_not_found | question_not_found — `{ questionIds }`' })
  @ApiUnprocessableEntityResponse({ description: 'question_not_ready — `{ questionIds }`' })
  @ApiConflictResponse({ description: 'exam_not_online | exam_questions_locked — `{ status }` | class_closed' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReplaceExamQuestionsDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ExamQuestionsDto> {
    return this.examQuestions.replace(id, body, caller, requestContext(req));
  }
}
