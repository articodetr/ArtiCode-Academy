// PORTAL-04 — `DELETE /api/users/:id/google-identity`: an administrator
// removes the Google identity linked to an account and gets the user detail
// back. Registered by UsersModule (it answers the users detail through
// UsersService); the rules live in GoogleIdentityService.
import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Req } from '@nestjs/common';
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
import type { Request } from 'express';
import { UserDetailDto } from '../../users/users.dto.js';
import { READ_CONTACT_PERMISSION, UPDATE_USERS_PERMISSION } from '../../users/users.policy.js';
import { UsersService } from '../../users/users.service.js';
import { AuthErrorDto } from '../auth.dto.js';
import { requestContext } from '../cookies.js';
import { CurrentUser, RequirePermissions } from '../decorators.js';
import type { AuthPrincipal } from '../principal.js';
import { GoogleIdentityService } from './google-identity.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class GoogleIdentityController {
  constructor(
    private readonly identities: GoogleIdentityService,
    private readonly users: UsersService,
  ) {}

  @Delete(':id/google-identity')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE_USERS_PERMISSION)
  @ApiOperation({
    summary: 'Unlink the Google account of a user (PORTAL-04)',
    description:
      'Removes the Google identity linked to the account; nothing else changes (password, sessions, roles and status stay). ' +
      'The user signs in with Google again only after a new link. Answers the user detail in the caller’s projection (`users.read_contact`). ' +
      'One audit event `users.identity.unlinked { provider: google }`; an account without a linked Google identity answers the detail with no write and no event. ' +
      'Requires `users.update`; the target’s roles may not confer a permission the caller lacks (checked before anything about the link — SEC-R-15). Allowed on one’s own account.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiForbiddenResponse({
    type: AuthErrorDto,
    description: 'permission_denied — `users.update`, or the target holds permissions the caller lacks; origin_forbidden',
  })
  @ApiNotFoundResponse({ description: 'user_not_found (unknown or soft-deleted)' })
  async unlink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<UserDetailDto> {
    await this.identities.unlink(id, caller, requestContext(req));
    return this.users.getById(id, false, caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced');
  }
}
