import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { UPDATE_USERS_PERMISSION } from '../users/users.policy.js';
import { IssuePasswordResetResponseDto } from './account.dto.js';
import { AccountService } from './account.service.js';

/** Administrative side of password resets (MOD-03-T05): lives under the user resource. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/:id/password-reset')
@RequirePermissions(UPDATE_USERS_PERMISSION)
@ApiUnauthorizedResponse({
  type: AuthErrorDto,
  description:
    'unauthenticated | token_expired | token_invalid | session_invalid',
})
export class PasswordResetController {
  constructor(private readonly account: AccountService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a password-reset token for an active user',
    description:
      'Retires any pending reset of the account, flags it `mustChangePassword` and returns a fresh one-time token (and the link to hand over) ONCE; only its SHA-256 is stored. ' +
      'Requires `users.update`; the roles of the target may not confer a permission the caller lacks (SEC-R-15, same rule as invitations). ' +
      'Existing sessions keep working until the reset is confirmed. With `MAIL_TRANSPORT=none` (default until launch) no e-mail is sent — `delivery.status` says so.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'The user whose password is reset (status must be `active`)',
  })
  @ApiCreatedResponse({ type: IssuePasswordResetResponseDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiForbiddenResponse({
    type: AuthErrorDto,
    description:
      'permission_denied — `users.update`, or the exceeding permission keys in `missing` (SEC-R-15); origin_forbidden',
  })
  @ApiNotFoundResponse({
    description: 'user_not_found (unknown or soft-deleted)',
  })
  @ApiConflictResponse({
    description:
      'user_not_resettable — the account is not `active` (`status` in the body); an `invited` account is re-invited instead',
  })
  issue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<IssuePasswordResetResponseDto> {
    return this.account.issuePasswordReset(id, caller, requestContext(req));
  }
}
