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
import { CreateRoleDto, RoleDto, RoleListDto, UpdateRoleDto } from './roles.dto.js';
import { MANAGE_ROLES_PERMISSION, READ_ROLES_PERMISSION } from './roles.policy.js';
import { RolesService } from './roles.service.js';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description:
    'permission_denied — `users.read` for the list, `roles.manage` for everything else, plus the keys a grant would confer that the caller does not hold; ' +
    'role_immutable — `academy_admin` (any change), other system roles (label/description) or deleting a system role; origin_forbidden',
})
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(READ_ROLES_PERMISSION)
  @ApiOperation({
    summary: 'List roles',
    description:
      'Every role with its localized label and description, `isSystem`, the number of users holding it and its active permission keys. ' +
      'System roles first, then custom roles, each by key. Requires `users.read`.',
  })
  @ApiOkResponse({ type: RoleListDto })
  list(): Promise<RoleListDto> {
    return this.roles.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_ROLES_PERMISSION)
  @ApiOperation({
    summary: 'Create a custom role',
    description:
      'Creates a custom role (`isSystem: false`) with the given permission set in one transaction with the audit event `roles.created`. ' +
      'The key must not be a system role key; every permission must be in the active catalog and held by the caller (learner baseline excepted). Requires `roles.manage`.',
  })
  @ApiCreatedResponse({ type: RoleDto })
  @ApiBadRequestResponse({ description: 'Validation failed, or `permission_unknown` (unknown or deprecated keys in `permissions`)' })
  @ApiConflictResponse({ description: 'role_in_use — the key is already taken or reserved for a system role' })
  create(@Body() body: CreateRoleDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<RoleDto> {
    return this.roles.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_ROLES_PERMISSION)
  @ApiOperation({
    summary: 'Update a role',
    description:
      'Label and description of custom roles; `permissions` (the complete new set) of every role except `academy_admin`. ' +
      'Absent fields are left alone, `description: null` clears it. Only what differs is written, in one transaction with exactly one audit event: ' +
      '`roles.permissions.changed` (`added`/`removed`) when the permission set changes, otherwise `roles.updated` (field names). ' +
      'Added keys must be in the active catalog and held by the caller. Requires `roles.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RoleDto, description: 'The role after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed, `nothing_to_update` (no field in the body) or `permission_unknown`' })
  @ApiNotFoundResponse({ description: 'role_unknown' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRoleDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<RoleDto> {
    return this.roles.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_ROLES_PERMISSION)
  @ApiOperation({
    summary: 'Delete a custom role',
    description:
      'Deletes a custom role that no user holds, with the audit event `roles.deleted` in the same transaction. ' +
      'System roles cannot be deleted (`role_immutable`); a role still granted to users answers `role_in_use`. Requires `roles.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'role_unknown' })
  @ApiConflictResponse({ description: 'role_in_use — the role is granted to `userCount` users' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    await this.roles.remove(id, caller, requestContext(req));
  }
}
