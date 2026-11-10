import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ExamResultsSheetDto, RecordExamResultsDto } from './exam-results.dto.js';
import { ExamResultsService } from './exam-results.service.js';
import { GRADE_EXAMS_PERMISSION, READ_EXAMS_PERMISSION } from './exams.policy.js';
import { ListMyExamsQueryDto, MyExamListDto } from './my-exams.dto.js';
import { MyExamsService } from './my-exams.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';

/**
 * MOD-09-T04 — the results sheet of an exam (roadmap §4h.4 API-119/API-120).
 * Reading needs `exams.read`, recording `exams.grade` (method-level keys),
 * both through the exam's class visibility (D-R16; others 404).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class ExamResultsController {
  constructor(private readonly results: ExamResultsService) {}

  @Get(':id/results')
  @RequirePermissions(READ_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Read the results sheet of an exam',
    description:
      'Every student with an active or completed enrollment in the class plus anyone holding a result (a withdrawn student keeps it), in enrollment order and the caller’s D-R07 projection, each with their result or null; ' +
      '`recordable`/`closedReason` say whether the exam takes results now (a draft is `not_scheduled`, a cancelled class `class_cancelled`). Needs `exams.read` and the class’s visibility.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamResultsSheetDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.read`' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  sheet(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ExamResultsSheetDto> {
    return this.results.sheet(id, caller);
  }

  @Put(':id/results')
  @RequirePermissions(GRADE_EXAMS_PERMISSION)
  @ApiOperation({
    summary: 'Record exam results',
    description:
      'A batch of 1–500 results, each the WHOLE new state of one student’s result (`scored` with a score in 0..maxScore, `absent` or `excused` without one; an absent feedback clears it); unmentioned students are never touched and nothing is deleted. ' +
      'Refused before any write: the same student twice (`results_invalid`), a draft exam (`exam_not_recordable`), a cancelled class (`class_closed`), a score above the maximum (`score_out_of_range`), a student without an active or completed enrollment (`not_enrolled`). ' +
      'An identical batch writes nothing; otherwise one audit event `exams.results.recorded`. A completed class keeps its results open for corrections. Needs `exams.grade` and the class’s visibility. JSON bodies up to 1 MB.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExamResultsSheetDto, description: 'The sheet after the batch' })
  @ApiBadRequestResponse({ description: 'Validation failed | results_invalid — `{ duplicates }` | score_out_of_range — `{ score, maxScore, studentId }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `exams.grade`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'exam_not_found' })
  @ApiConflictResponse({ description: 'exam_not_recordable — `{ reason: not_scheduled }` | class_closed — `{ classId, status }`' })
  @ApiUnprocessableEntityResponse({ description: 'not_enrolled — `{ studentIds }`' })
  @ApiPayloadTooLargeResponse({ description: 'Body above 1 MB' })
  record(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RecordExamResultsDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ExamResultsSheetDto> {
    return this.results.record(id, body, caller, requestContext(req));
  }
}

/**
 * MOD-09-T04 — the caller's exams (roadmap §4h.4 API-121). No
 * `@RequirePermissions`: every signed-in user may call it and sees only the
 * exams of their own classes and their linked children's (ownership — D-R48),
 * with their own results once published.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
export class MyExamsController {
  constructor(private readonly myExams: MyExamsService) {}

  @Get('exams')
  @ApiOperation({
    summary: 'List my exams',
    description:
      'The scheduled and published exams (never drafts) of the classes the caller is enrolled in, now or finished (`relation: self`), and of the classes the students linked to the caller as guardian are enrolled in — while the caller holds the `guardian` role (`relation: child`). ' +
      'One item per exam and student, by exam date — undated last — then id (`order` asc by default), keyset-paginated (`limit` counts exams, `cursor`), with filters `classId`, `studentId`, `status` (scheduled|published), `from` and `to`. ' +
      'Each item carries the exam, the class and course, the lesson, the student (identity only) and that student’s own result (status, score, feedback) once the results are published — never the weight, the recorder or anyone else’s result. ' +
      'No permission key is needed (ownership); a user without an owned enrollment gets an empty list.',
  })
  @ApiOkResponse({ type: MyExamListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListMyExamsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyExamListDto> {
    return this.myExams.list(query, caller);
  }
}
