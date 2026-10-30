import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
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
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import {
  ChangeUserStatusDto,
  CreateUserDto,
  DeleteUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UserDetailDto,
  UserDetailQueryDto,
  UserListDto,
} from './users.dto.js';
import { CREATE_USERS_PERMISSION, DEACTIVATE_USERS_PERMISSION, READ_CONTACT_PERMISSION, UPDATE_USERS_PERMISSION } from './users.policy.js';
import { UsersService } from './users.service.js';
import type { UsersProjection } from './users.service.js';
import { missingPermissionFor } from './users.status.js';
import type { UserStatusAction } from './users.status.js';

/** Seeing soft-deleted users is reserved to whoever may delete them. */
export const INCLUDE_DELETED_PERMISSION = DEACTIVATE_USERS_PERMISSION;

/** The permission of a status action depends on the action itself (users.status.ts), so it is checked here, not by the guard. */
function assertMayPerform(caller: AuthPrincipal, action: UserStatusAction): void {
  const missing = missingPermissionFor(action, caller.permissions);
  if (missing) throw authError.permissionDenied([missing]);
}

function assertMayIncludeDeleted(caller: AuthPrincipal, includeDeleted: boolean | undefined): void {
  if (includeDeleted && !caller.permissions.includes(INCLUDE_DELETED_PERMISSION)) {
    throw authError.permissionDenied([INCLUDE_DELETED_PERMISSION]);
  }
}

/** Contact and login identifiers are shown to holders of `users.read_contact` only (D-R07). */
function projectionFor(caller: AuthPrincipal): UsersProjection {
  return caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced';
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@RequirePermissions('users.read')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description:
    'permission_denied — `users.read` (or `users.deactivate` for includeDeleted); `users.create` / `users.roles.assign` / exceeding permissions for POST; ' +
    '`users.update` for PATCH, plus exceeding permissions when changing the login identifiers of a more privileged user; ' +
    '`users.deactivate` for status changes and DELETE (`unlock`: `users.update` suffices), plus exceeding permissions when the target holds permissions the caller lacks; ' +
    'self_forbidden — suspend/archive/delete on one’s own account',
})
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Search (`q`), filters (`status`, `role`), cursor pagination (`limit`, `cursor`) and sorting (`sort`, `order`). ' +
      'Soft-deleted users are excluded unless `includeDeleted=true`, which additionally requires `users.deactivate`. ' +
      'Requires `users.read`; without `users.read_contact` the e-mail, username, phone and account-security timestamps are null and the search ignores e-mail/username.',
  })
  @ApiOkResponse({ type: UserListDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameter, or a cursor from another sort/order (`cursor_invalid`)' })
  list(@Query() query: ListUsersQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<UserListDto> {
    assertMayIncludeDeleted(caller, query.includeDeleted);
    return this.users.list(query, projectionFor(caller));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(CREATE_USERS_PERMISSION)
  @ApiOperation({
    summary: 'Create a user (invited, no password)',
    description:
      'Creates the account with `status: invited`, the profile matching `kind` and the kind’s system role — plus `roleKeys` extras for holders of `users.roles.assign` — in one transaction with the audit event `users.created`. ' +
      'No role may confer a permission the caller does not hold (learner baseline excepted). The account cannot sign in until its invitation is accepted. Requires `users.create`.',
  })
  @ApiCreatedResponse({ type: UserDetailDto, description: 'The created user (full projection — the caller supplied the identifiers)' })
  @ApiBadRequestResponse({ description: 'Validation failed, `identifier_required` (neither e-mail nor username) or `role_unknown`' })
  @ApiConflictResponse({ description: 'email_in_use | username_in_use | student_number_in_use | employee_number_in_use' })
  @ApiUnprocessableEntityResponse({ description: 'profile_mismatch (profile or extra role incompatible with `kind`) | employee_kind_required' })
  create(
    @Body() body: CreateUserDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDetailDto> {
    return this.users.create(body, caller, requestContext(req));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'User detail',
    description:
      'Identity, roles with labels, profile summaries, guardian/student links and last login. ' +
      'Soft-deleted users yield 404 unless `includeDeleted=true` (requires `users.deactivate`). Requires `users.read`; ' +
      'contact and login identifiers need `users.read_contact`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID, or an invalid query parameter' })
  @ApiNotFoundResponse({ description: 'user_not_found' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: UserDetailQueryDto,
    @CurrentUser() caller: AuthPrincipal,
  ): Promise<UserDetailDto> {
    assertMayIncludeDeleted(caller, query.includeDeleted);
    return this.users.getById(id, query.includeDeleted === true, projectionFor(caller));
  }

  @Patch(':id')
  @RequirePermissions(UPDATE_USERS_PERMISSION)
  @ApiOperation({
    summary: 'Update a user',
    description:
      'Partial update of the identity (`email`, `username`, `phone`, names, `displayName`, `avatarUrl`, `locale`) and of the fields of the profile the user already has. ' +
      'Absent fields are left alone, `null` clears an optional field; only fields whose value changes are written, in one transaction with the audit event `users.updated` (field names, no values). ' +
      'Changing the e-mail address resets its verification. Changing `email`/`username` of a user whose roles confer permissions the caller does not hold is refused. ' +
      'Requires `users.update`; the response follows the caller’s projection (`users.read_contact`).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailDto, description: 'The user after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({
    description: 'Validation failed, `nothing_to_update` (no field in the body) or `identifier_required` (the change would remove the last login identifier)',
  })
  @ApiNotFoundResponse({ description: 'user_not_found (unknown or soft-deleted)' })
  @ApiConflictResponse({ description: 'email_in_use | username_in_use | student_number_in_use | employee_number_in_use' })
  @ApiUnprocessableEntityResponse({ description: 'profile_mismatch (profile object for a profile the user does not have)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDetailDto> {
    return this.users.update(id, body, caller, requestContext(req), projectionFor(caller));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  // No static permission: `unlock` needs `users.update` (or `users.deactivate`), the other actions `users.deactivate` — see assertMayPerform().
  @RequirePermissions()
  @ApiOperation({
    summary: 'Change the account status',
    description:
      'Applies one action of the account state machine: `activate` (pending|suspended → active), `suspend` (active → suspended), ' +
      '`archive` (active|suspended → archived), `restore` (archived → active) or `unlock` (clears the failed-login lock of an active account). ' +
      '`suspend` and `archive` revoke every session of the user at once; an `unlock` with nothing to clear changes nothing. ' +
      'One audit event `users.status.changed` per transition `{ action, from, to, reason, revokedSessions? }`. ' +
      'Requires `users.deactivate` (`unlock`: `users.update` suffices); the target’s roles may not confer a permission the caller lacks; ' +
      'nobody can suspend or archive themself; the last active academy admin cannot be suspended or archived. The response follows the caller’s projection.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailDto, description: 'The user after the transition' })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown `action`, undeclared field, `reason` not 1–500 characters) or `id` is not a UUID' })
  @ApiNotFoundResponse({ description: 'user_not_found (unknown; or soft-deleted and the caller lacks `users.deactivate`)' })
  @ApiConflictResponse({ description: 'invalid_transition `{ from, action, allowed }` (also for a soft-deleted account, `from: "deleted"`) | last_admin' })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeUserStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDetailDto> {
    assertMayPerform(caller, body.action);
    return this.users.changeStatus(id, body, caller, requestContext(req), projectionFor(caller));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DEACTIVATE_USERS_PERMISSION)
  @ApiOperation({
    summary: 'Soft-delete a user',
    description:
      'Sets `deletedAt` and `status: archived`, revokes every session of the user and records one audit event `users.deleted` `{ from, to, reason, revokedSessions }`. ' +
      'The row stays and its e-mail/username remain reserved; the user disappears from the list and the detail (except with `includeDeleted=true`), cannot sign in, ' +
      'and no status action applies afterwards. Optional JSON body `{ reason }`. Requires `users.deactivate`; the target’s roles may not confer a permission the caller lacks; ' +
      'nobody can delete themself; the last active academy admin cannot be deleted. The response follows the caller’s projection.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailDto, description: 'The user after the deletion (`status: archived`, `deletedAt` set)' })
  @ApiBadRequestResponse({ description: 'Validation failed (undeclared field, `reason` not 1–500 characters) or `id` is not a UUID' })
  @ApiNotFoundResponse({ description: 'user_not_found' })
  @ApiConflictResponse({ description: 'invalid_transition `{ from: "deleted", action: "delete", allowed: [] }` (already deleted) | last_admin' })
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteUserDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDetailDto> {
    return this.users.softDelete(id, body, caller, requestContext(req), projectionFor(caller));
  }
}
