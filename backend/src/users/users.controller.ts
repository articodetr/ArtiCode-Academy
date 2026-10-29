import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
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
import { CreateUserDto, ListUsersQueryDto, UserDetailDto, UserDetailQueryDto, UserListDto } from './users.dto.js';
import { CREATE_USERS_PERMISSION, READ_CONTACT_PERMISSION } from './users.policy.js';
import { UsersService } from './users.service.js';
import type { UsersProjection } from './users.service.js';

/** Seeing soft-deleted users is reserved to whoever may delete them. */
export const INCLUDE_DELETED_PERMISSION = 'users.deactivate';

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
  description: 'permission_denied — `users.read` (or `users.deactivate` for includeDeleted); `users.create` / `users.roles.assign` / exceeding permissions for POST',
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
}
