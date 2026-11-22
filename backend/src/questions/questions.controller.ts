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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { QuestionBanksService } from './question-banks.service.js';
import {
  CreateQuestionBankDto,
  CreateQuestionDto,
  ListQuestionBanksQueryDto,
  ListQuestionsQueryDto,
  QuestionBankDto,
  QuestionBankListDto,
  QuestionDto,
  QuestionListDto,
  UpdateQuestionBankDto,
  UpdateQuestionDto,
} from './questions.dto.js';
import { MANAGE_QUESTIONS_PERMISSION } from './questions.policy.js';
import { QuestionsService } from './questions.service.js';

const UNAUTHORIZED = 'unauthenticated | token_expired | token_invalid | session_invalid';
const FORBIDDEN = 'permission_denied — `questions.manage`; origin_forbidden';
const VISIBILITY =
  'A holder of `questions.manage` sees the banks they created and those filed under a course they teach a class of; with `classes.manage` too, every bank (D-R162). Anything else is 404.';

/**
 * MOD-09 phase 2 — question banks (roadmap §4r.6 API-260..API-264) and the
 * creation of a question inside one (API-266). Every route needs
 * `questions.manage`; the global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('question banks')
@ApiBearerAuth()
@Controller('question-banks')
@RequirePermissions(MANAGE_QUESTIONS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
@ApiForbiddenResponse({ type: AuthErrorDto, description: FORBIDDEN })
export class QuestionBanksController {
  constructor(
    private readonly banks: QuestionBanksService,
    private readonly questions: QuestionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List question banks',
    description: `Keyset-paginated (\`limit\` 1–100, opaque \`cursor\`), newest first, with \`q\` (the Arabic or English name) and \`courseId\` (a course id, or \`none\`). Each item carries its course, its author and how many questions it holds and how many are ready. ${VISIBILITY}`,
  })
  @ApiOkResponse({ type: QuestionBankListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListQuestionBanksQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<QuestionBankListDto> {
    return this.banks.list(query, caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a question bank',
    description:
      'A bank with a localized name, an optional description and, optionally, the course it is filed under: any course for a holder of `classes.manage`, else one the caller teaches a class of (`course_not_found` otherwise). The caller becomes its author. One audit event `question_banks.created`.',
  })
  @ApiCreatedResponse({ type: QuestionBankDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'course_not_found — `{ courseId }`' })
  create(@Body() body: CreateQuestionBankDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<QuestionBankDto> {
    return this.banks.create(body, caller, requestContext(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a question bank', description: VISIBILITY })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: QuestionBankDto })
  @ApiNotFoundResponse({ description: 'question_bank_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<QuestionBankDto> {
    return this.banks.get(id, caller);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a question bank',
    description:
      'PATCH semantics: absent = unchanged, null clears `description` and `courseId`. Only changed fields are written, with one `question_banks.updated { fields }` event; an identical body writes nothing. A new course must be one the caller may file a bank under.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: QuestionBankDto })
  @ApiBadRequestResponse({ description: 'Validation failed | nothing_to_update' })
  @ApiNotFoundResponse({ description: 'question_bank_not_found | course_not_found' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateQuestionBankDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<QuestionBankDto> {
    return this.banks.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a question bank',
    description:
      'Deletes the bank with its questions and their options — unless an exam links one of them (`question_bank_in_use { linkedQuestionCount }`): archive those questions instead. One audit event `question_banks.deleted { questionCount }`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'question_bank_not_found' })
  @ApiConflictResponse({ description: 'question_bank_in_use — `{ linkedQuestionCount }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.banks.remove(id, caller, requestContext(req));
  }

  @Post(':id/questions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a question in a bank',
    description:
      'A `single_choice` question (2–10 options, exactly one correct) or a `true_false` one (no options, the key in `correctAnswer`), as a `draft` — which may be incomplete — or `ready`, which must pass every rule of its type: `question_invalid { problems }` otherwise, before any write. ' +
      'The type is fixed once created. One audit event `questions.created`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The bank' })
  @ApiCreatedResponse({ type: QuestionDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed | question_invalid — `{ problems }` out of options_not_allowed, correct_answer_not_allowed, options_too_many, multiple_correct_options, duplicate_options, options_too_few, correct_option_required, correct_answer_required',
  })
  @ApiNotFoundResponse({ description: 'question_bank_not_found' })
  createQuestion(@Param('id', new ParseUUIDPipe()) bankId: string, @Body() body: CreateQuestionDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<QuestionDto> {
    return this.questions.create(bankId, body, caller, requestContext(req));
  }
}

/**
 * MOD-09 phase 2 — the questions of the banks (roadmap §4r.6 API-265,
 * API-267..API-269). `questions.manage`, and only the questions of the banks
 * the caller sees. The responses carry the answer key: no learner route is
 * built on this controller.
 */
@ApiTags('question banks')
@ApiBearerAuth()
@Controller('questions')
@RequirePermissions(MANAGE_QUESTIONS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: UNAUTHORIZED })
@ApiForbiddenResponse({ type: AuthErrorDto, description: FORBIDDEN })
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List questions',
    description:
      'Keyset-paginated (`limit` 1–100, opaque `cursor`), newest first, across the banks the caller sees or inside one (`bankId`), with `q` (the Arabic or English text), `type`, `status` (archived questions only when asked for), `difficulty` and `tag`. ' +
      'Each item carries its options with the answer key, what still keeps it from being ready (`missing`) and how many exams link it.',
  })
  @ApiOkResponse({ type: QuestionListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListQuestionsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<QuestionListDto> {
    return this.questions.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a question', description: 'With its options, its key and the number of exams that link it. A question of a bank the caller may not see is 404.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: QuestionDto })
  @ApiNotFoundResponse({ description: 'question_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<QuestionDto> {
    return this.questions.get(id, caller);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a question',
    description:
      'PATCH semantics: absent = unchanged, null clears `explanation`, `difficulty` and `correctAnswer`; `options` replaces the whole ordered list; the type is fixed. The merged question must be valid for its resulting status (`question_invalid`). ' +
      'Only changed fields are written, with one `questions.updated { fields }` event; an identical body writes nothing. An exam that was already made available keeps its own frozen copy, so this never changes it or a counted result (D-R158).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: QuestionDto })
  @ApiBadRequestResponse({ description: 'Validation failed | nothing_to_update | question_invalid — `{ problems }`' })
  @ApiNotFoundResponse({ description: 'question_not_found' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateQuestionDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<QuestionDto> {
    return this.questions.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a question',
    description: 'Only a question no exam links; a linked one is `question_in_use { examCount }` — archive it instead (`status: archived`). One audit event `questions.deleted`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'question_not_found' })
  @ApiConflictResponse({ description: 'question_in_use — `{ examCount }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.questions.remove(id, caller, requestContext(req));
  }
}
