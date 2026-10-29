import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListUsersQueryDto, UserDetailDto, UserDetailQueryDto, UserListDto } from './users.dto.js';
import { UsersService } from './users.service.js';

/** Seeing soft-deleted users is reserved to whoever may delete them. */
export const INCLUDE_DELETED_PERMISSION = 'users.deactivate';

function assertMayIncludeDeleted(caller: AuthPrincipal, includeDeleted: boolean | undefined): void {
  if (includeDeleted && !caller.permissions.includes(INCLUDE_DELETED_PERMISSION)) {
    throw authError.permissionDenied([INCLUDE_DELETED_PERMISSION]);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@RequirePermissions('users.read')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `users.read` (or `users.deactivate` for includeDeleted)' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Search (`q`), filters (`status`, `role`), cursor pagination (`limit`, `cursor`) and sorting (`sort`, `order`). ' +
      'Soft-deleted users are excluded unless `includeDeleted=true`, which additionally requires `users.deactivate`. ' +
      'Requires `users.read`.',
  })
  @ApiOkResponse({ type: UserListDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameter, or a cursor from another sort/order (`cursor_invalid`)' })
  list(@Query() query: ListUsersQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<UserListDto> {
    assertMayIncludeDeleted(caller, query.includeDeleted);
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'User detail',
    description:
      'Identity, roles with labels, profile summaries, guardian/student links and last login. ' +
      'Soft-deleted users yield 404 unless `includeDeleted=true` (requires `users.deactivate`). Requires `users.read`.',
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
    return this.users.getById(id, query.includeDeleted === true);
  }
}
