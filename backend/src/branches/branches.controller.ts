import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
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
import { BranchDto, BranchListDto, CreateBranchDto, UpdateBranchDto } from './branches.dto.js';
import { MANAGE_BRANCHES_PERMISSION } from './branches.policy.js';
import { BranchesService } from './branches.service.js';

/**
 * MOD-02-T06 (O8) — the branches of the academy (roadmap §4b.5). Reading needs
 * no permission key (D-R21 — every signed-in user, like GET /api/academy);
 * every write needs `branches.manage`. The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({
    summary: 'List branches',
    description:
      'The main branch first, then by code. Every authenticated user sees the active branches; holders of `branches.manage` also see inactive ones. No pagination (a short list).',
  })
  @ApiOkResponse({ type: BranchListDto })
  list(@CurrentUser() caller: AuthPrincipal): Promise<BranchListDto> {
    return this.branches.list(caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_BRANCHES_PERMISSION)
  @ApiOperation({
    summary: 'Create a branch',
    description:
      'Creates a branch with the audit event `branches.created` in the same transaction. The code is trimmed and upper-cased and must be unique. ' +
      '`isMain: true` makes it the main branch and the current main branch steps down in the same transaction (`demotedBranchId` in the event). Requires `branches.manage`.',
  })
  @ApiCreatedResponse({ type: BranchDto })
  @ApiBadRequestResponse({ description: 'Validation failed (code format, name or address without `ar`, phone not E.164, unknown time zone, non-boolean flags, …)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `branches.manage`; origin_forbidden' })
  @ApiConflictResponse({ description: 'branch_code_taken; branch_is_main (`action: promote_inactive` — a main branch must be active)' })
  create(@Body() body: CreateBranchDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<BranchDto> {
    return this.branches.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_BRANCHES_PERMISSION)
  @ApiOperation({
    summary: 'Update a branch',
    description:
      'Partial update of `code`, `name` (whole localized object), `address`, `phone` and `timezone` (`null` clears them), `isMain` and `isActive`. ' +
      'Only fields whose value changes are written, in one transaction with the audit event `branches.updated` (field names, no values). ' +
      '`isMain: true` makes the current main branch step down in the same transaction and event (`demotedBranchId`). ' +
      'A main branch must be active: deactivating it needs `isMain: false` in the same request. Requires `branches.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BranchDto, description: 'The branch after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed or `nothing_to_update` (no field in the body)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `branches.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'branch_not_found' })
  @ApiConflictResponse({ description: 'branch_code_taken; branch_is_main (`action: deactivate | promote_inactive`)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBranchDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<BranchDto> {
    return this.branches.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_BRANCHES_PERMISSION)
  @ApiOperation({
    summary: 'Delete a branch',
    description:
      'Deletes a branch that is not the main one and that nothing uses, with the audit event `branches.deleted` in the same transaction ' +
      '(deactivate a branch in use instead; rooms point to branches from MOD-07). Requires `branches.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `branches.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'branch_not_found' })
  @ApiConflictResponse({ description: 'branch_is_main (`action: delete`); branch_in_use — `roomCount` rooms still belong to it' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.branches.remove(id, caller, requestContext(req));
  }
}
