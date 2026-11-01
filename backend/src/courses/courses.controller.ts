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
import { ChangeCourseStatusDto, CourseDto, CourseListDto, CreateCourseDto, ListCoursesQueryDto, UpdateCourseDto } from './courses.dto.js';
import { MANAGE_COURSES_PERMISSION, READ_COURSES_PERMISSION } from './courses.policy.js';
import { CoursesService } from './courses.service.js';

/**
 * MOD-04-T03 — courses (roadmap §4c.4). Reading needs `courses.read` and is
 * limited to published courses unless the caller holds `courses.manage`
 * (D-R13); every write needs `courses.manage` (method-level key). The global
 * guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('courses')
@ApiBearerAuth()
@Controller('courses')
@RequirePermissions(READ_COURSES_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description: 'permission_denied — `courses.read` to read, `courses.manage` to write or to filter by a non-published status; origin_forbidden',
})
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ApiOperation({
    summary: 'List courses',
    description:
      'Keyset-paginated list (`limit` 1–100, opaque `cursor`) sorted by `code` (default, ascending) or `createdAt` (newest first), with search `q` (code, Arabic or English name) and filters `status` and `levelId`. ' +
      'Holders of `courses.read` alone see published courses only (a `status` other than `published` is 403); holders of `courses.manage` see every state.',
  })
  @ApiOkResponse({ type: CourseListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListCoursesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<CourseListDto> {
    return this.courses.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a course', description: 'A course with its level and syllabus count. A non-published course is 404 unless the caller holds `courses.manage`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CourseDto })
  @ApiNotFoundResponse({ description: 'course_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<CourseDto> {
    return this.courses.get(id, caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Create a course',
    description:
      'Creates a `draft` course (code trimmed and upper-cased, unique) with the caller as `created_by`, in one transaction with the audit event `courses.created`. Requires `courses.manage`.',
  })
  @ApiCreatedResponse({ type: CourseDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `age_range_invalid`' })
  @ApiNotFoundResponse({ description: 'level_not_found — `levelId` does not exist' })
  @ApiConflictResponse({ description: 'course_code_taken' })
  create(@Body() body: CreateCourseDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<CourseDto> {
    return this.courses.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Update a course',
    description:
      'Partial update (absent = unchanged, `null` clears the optional fields). Only fields whose value changes are written, with the audit event `courses.updated` (field names). ' +
      'The status changes through `POST /api/courses/:id/status`. Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CourseDto })
  @ApiBadRequestResponse({ description: 'Validation failed, `nothing_to_update` or `age_range_invalid`' })
  @ApiNotFoundResponse({ description: 'course_not_found | level_not_found' })
  @ApiConflictResponse({ description: 'course_code_taken' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateCourseDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<CourseDto> {
    return this.courses.update(id, body, caller, requestContext(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Change the publication status',
    description:
      '`publish` (draft→published), `unpublish` (published→draft), `archive` (draft|published→archived — archiving replaces deletion), `restore` (archived→draft), ' +
      'with the audit event `courses.status.changed { action, from, to }`. Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CourseDto })
  @ApiNotFoundResponse({ description: 'course_not_found' })
  @ApiConflictResponse({ description: 'invalid_transition — `{ from, action, allowed }`' })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeCourseStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<CourseDto> {
    return this.courses.changeStatus(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Delete a draft course',
    description: 'Deletes a draft (its syllabus is removed with it) with the audit event `courses.deleted`; any other state is `course_not_deletable` — archive it instead. Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'course_not_found' })
  @ApiConflictResponse({ description: 'course_not_deletable — `{ status }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.courses.remove(id, caller, requestContext(req));
  }
}
