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
import { ChangeClassStatusDto, ClassDto, ClassListDto, CreateClassDto, ListClassesQueryDto, UpdateClassDto } from './classes.dto.js';
import { MANAGE_CLASSES_PERMISSION, READ_CLASSES_PERMISSION } from './classes.policy.js';
import { ClassesService } from './classes.service.js';

/**
 * MOD-05-T02 — classes (roadmap §4d.4). Reading needs `classes.read` and is
 * limited to the caller's assigned classes unless they hold `classes.manage`
 * (D-R16); every write needs `classes.manage` (method-level key). The global
 * guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('classes')
@ApiBearerAuth()
@Controller('classes')
@RequirePermissions(READ_CLASSES_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `classes.read` to read, `classes.manage` to write; origin_forbidden' })
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @ApiOperation({
    summary: 'List classes',
    description:
      'Keyset-paginated list (`limit` 1–100, opaque `cursor`) sorted by `code` (default, ascending) or `createdAt` (newest first), with search `q` (code, Arabic or English name) and filters `courseId`, `status` and `teacherId`. ' +
      'Holders of `classes.read` alone see only the classes they are assigned to (lead or assistant); holders of `classes.manage` see every class.',
  })
  @ApiOkResponse({ type: ClassListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListClassesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<ClassListDto> {
    return this.classes.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read a class',
    description: 'A class with its course, its teachers and the number of active enrollments. A class the caller is not assigned to is 404 unless they hold `classes.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClassDto })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<ClassDto> {
    return this.classes.get(id, caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_CLASSES_PERMISSION)
  @ApiOperation({
    summary: 'Create a class',
    description:
      'Creates a `planned` class of a published course (code trimmed and upper-cased, unique) with the caller as `created_by`, in one transaction with the audit event `classes.created`. Requires `classes.manage`.',
  })
  @ApiCreatedResponse({ type: ClassDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `date_range_invalid`' })
  @ApiNotFoundResponse({ description: 'course_not_found' })
  @ApiConflictResponse({ description: 'class_code_taken' })
  @ApiUnprocessableEntityResponse({ description: 'course_not_published — `{ courseId, status }`' })
  create(@Body() body: CreateClassDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ClassDto> {
    return this.classes.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_CLASSES_PERMISSION)
  @ApiOperation({
    summary: 'Update a class',
    description:
      'Partial update (absent = unchanged, `null` clears `startsOn`, `endsOn` and `notes`). Only fields whose value changes are written, with the audit event `classes.updated` (field names). ' +
      'The capacity may not drop below the active enrollments. The course is fixed; the status changes through `POST /api/classes/:id/status`. Requires `classes.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClassDto })
  @ApiBadRequestResponse({ description: 'Validation failed, `nothing_to_update` or `date_range_invalid`' })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  @ApiConflictResponse({ description: 'class_code_taken | capacity_below_enrolled — `{ capacity, enrolledCount }`' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateClassDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<ClassDto> {
    return this.classes.update(id, body, caller, requestContext(req));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_CLASSES_PERMISSION)
  @ApiOperation({
    summary: 'Change the class status',
    description:
      '`open` (planned→open), `start` (open→running), `complete` (running→completed; active enrollments → completed), `cancel` (planned|open|running→cancelled; active enrollments → cancelled), ' +
      '`restore` (cancelled→planned; enrollments unchanged), with the audit event `classes.status.changed { action, from, to, reason?, affectedEnrollments? }`. Requires `classes.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClassDto })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  @ApiConflictResponse({ description: 'invalid_transition — `{ from, action, allowed }`' })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeClassStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<ClassDto> {
    return this.classes.changeStatus(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_CLASSES_PERMISSION)
  @ApiOperation({
    summary: 'Delete a planned class',
    description:
      'Deletes a planned class without any enrollment (its teacher assignments are removed with it) with the audit event `classes.deleted`; any other class is `class_not_deletable` — cancel it instead. Requires `classes.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  @ApiConflictResponse({ description: 'class_not_deletable — `{ status, enrollmentCount }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.classes.remove(id, caller, requestContext(req));
  }
}
