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
import { CreateLevelDto, LevelDto, LevelListDto, ReorderLevelsDto, UpdateLevelDto } from './levels.dto.js';
import { LevelsService } from './levels.service.js';

/**
 * MOD-04-T02 — course levels (roadmap §4c.4). Reading needs `courses.read`
 * (every system role); every write needs `courses.manage` (method-level
 * @RequirePermissions replaces the class-level key). The global guards
 * (Origin → Auth → Permissions) run first.
 */
@ApiTags('levels')
@ApiBearerAuth()
@Controller('levels')
@RequirePermissions(READ_COURSES_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description: 'permission_denied — `courses.read` for the list, `courses.manage` for every write; origin_forbidden',
})
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  @Get()
  @ApiOperation({
    summary: 'List levels',
    description:
      'Levels by sort order. Holders of `courses.read` alone see the active levels with `courseCount: null`; ' +
      'holders of `courses.manage` also see inactive levels and the number of courses using each one.',
  })
  @ApiOkResponse({ type: LevelListDto })
  list(@CurrentUser() caller: AuthPrincipal): Promise<LevelListDto> {
    return this.levels.list(caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Create a level',
    description:
      'Creates a level at the end of the order (`sortOrder` = last + 1) with the audit event `levels.created` in the same transaction. ' +
      'The code is trimmed and upper-cased and must be unique. Requires `courses.manage`.',
  })
  @ApiCreatedResponse({ type: LevelDto })
  @ApiBadRequestResponse({ description: 'Validation failed (code format, name without `ar`, non-boolean `isActive`, …)' })
  @ApiConflictResponse({ description: 'level_code_taken' })
  create(@Body() body: CreateLevelDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<LevelDto> {
    return this.levels.create(body, caller, requestContext(req));
  }

  @Put('order')
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Reorder levels',
    description:
      '`levelIds` lists every level exactly once in the new order; positions become 0..n-1 in one transaction with the audit event `levels.reordered`. ' +
      'The current order again writes nothing and records nothing. Requires `courses.manage`.',
  })
  @ApiOkResponse({ type: LevelListDto, description: 'Every level in the new order (manager view)' })
  @ApiBadRequestResponse({ description: 'Validation failed, or `level_order_invalid` with `missing`, `unknown` and `duplicates`' })
  reorder(@Body() body: ReorderLevelsDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<LevelListDto> {
    return this.levels.reorder(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Update a level',
    description:
      'Partial update of `code`, `name` (whole localized object), `description` (`null` clears it) and `isActive`. Only fields whose value changes are written, ' +
      'in one transaction with the audit event `levels.updated` (field names, no values). Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LevelDto, description: 'The level after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed or `nothing_to_update` (no field in the body)' })
  @ApiNotFoundResponse({ description: 'level_not_found' })
  @ApiConflictResponse({ description: 'level_code_taken' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLevelDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<LevelDto> {
    return this.levels.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Delete a level',
    description:
      'Deletes a level that no course uses, with the audit event `levels.deleted` in the same transaction; a level in use answers `level_in_use` ' +
      '(deactivate it instead). Requires `courses.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'level_not_found' })
  @ApiConflictResponse({ description: 'level_in_use — `courseCount` courses still use it' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.levels.remove(id, caller, requestContext(req));
  }
}
