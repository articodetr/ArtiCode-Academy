import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
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
import { MANAGE_COURSES_PERMISSION, READ_COURSES_PERMISSION } from '../courses/courses.policy.js';
import { CreateSubjectDto, ReorderSubjectsDto, SubjectDto, SubjectListDto, UpdateSubjectDto } from './subjects.dto.js';
import { SubjectsService } from './subjects.service.js';

/**
 * PORTAL-04 — the school subjects of the courses (a mirror of the MOD-04
 * levels, API-037..041). Reading needs `courses.read` (every system role);
 * every write needs `courses.manage` (method-level @RequirePermissions
 * replaces the class-level key). The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('subjects')
@ApiBearerAuth()
@Controller('subjects')
@RequirePermissions(READ_COURSES_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description: 'permission_denied — `courses.read` for the list, `courses.manage` for every write; origin_forbidden',
})
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List subjects',
    description:
      'Subjects by sort order. Holders of `courses.read` alone see the active subjects with `courseCount: null`; ' +
      'holders of `courses.manage` also see inactive subjects and the number of courses using each one.',
  })
  @ApiOkResponse({ type: SubjectListDto })
  list(@CurrentUser() caller: AuthPrincipal): Promise<SubjectListDto> {
    return this.subjects.list(caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Create a subject',
    description:
      'Creates a subject at the end of the order (`sortOrder` = last + 1) with the audit event `subjects.created` in the same transaction. ' +
      'The code is trimmed and upper-cased and must be unique. Requires `courses.manage`.',
  })
  @ApiCreatedResponse({ type: SubjectDto })
  @ApiBadRequestResponse({ description: 'Validation failed (code format, name without `ar`, non-boolean `isActive`, unknown field, …)' })
  @ApiConflictResponse({ description: 'subject_code_taken' })
  create(@Body() body: CreateSubjectDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<SubjectDto> {
    return this.subjects.create(body, caller, requestContext(req));
  }

  @Put('order')
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Reorder subjects',
    description:
      '`subjectIds` lists every subject exactly once in the new order; positions become 0..n-1 in one transaction with the audit event `subjects.reordered`. ' +
      'The current order again writes nothing and records nothing. Requires `courses.manage`.',
  })
  @ApiOkResponse({ type: SubjectListDto, description: 'Every subject in the new order (manager view)' })
  @ApiBadRequestResponse({ description: 'Validation failed, or `subject_order_invalid` with `missing`, `unknown` and `duplicates`' })
  reorder(@Body() body: ReorderSubjectsDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<SubjectListDto> {
    return this.subjects.reorder(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Update a subject',
    description:
      'Partial update of `code`, `name` (whole localized object) and `isActive`. Only fields whose value changes are written, ' +
      'in one transaction with the audit event `subjects.updated` (field names, no values). A deactivated subject stays on its courses ' +
      'but can no longer be given to a course. Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubjectDto, description: 'The subject after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed or `nothing_to_update` (no field in the body)' })
  @ApiNotFoundResponse({ description: 'subject_not_found' })
  @ApiConflictResponse({ description: 'subject_code_taken' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateSubjectDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<SubjectDto> {
    return this.subjects.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Delete a subject',
    description:
      'Deletes a subject that no course uses, with the audit event `subjects.deleted` in the same transaction; a subject in use answers `subject_in_use` ' +
      '(deactivate it instead). Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'subject_not_found' })
  @ApiConflictResponse({ description: 'subject_in_use — `courseCount` courses still use it' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.subjects.remove(id, caller, requestContext(req));
  }
}
