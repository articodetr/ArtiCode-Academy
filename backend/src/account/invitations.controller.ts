import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
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
import { CREATE_USERS_PERMISSION } from '../users/users.policy.js';
import { IssueInvitationResponseDto } from './account.dto.js';
import { AccountService } from './account.service.js';

/** Administrative side of invitations (MOD-03-T03): lives under the user resource. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/:id/invitations')
@RequirePermissions(CREATE_USERS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class InvitationsController {
  constructor(private readonly account: AccountService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue an invitation token for an invited user',
    description:
      'Retires any pending invitation of the account and returns a fresh one-time token (and the link to hand over) ONCE; only its SHA-256 is stored. ' +
      'Requires `users.create`; the roles of the invitee may not confer a permission the caller lacks (SEC-R-13, same rule as creation). ' +
      'With `MAIL_TRANSPORT=none` (default until launch) no e-mail is sent — `delivery.status` says so.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The user to invite (status must be `invited`)' })
  @ApiCreatedResponse({ type: IssueInvitationResponseDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `users.create`, or the exceeding permission keys in `missing` (SEC-R-13); origin_forbidden' })
  @ApiNotFoundResponse({ description: 'user_not_found (unknown or soft-deleted)' })
  @ApiConflictResponse({ description: 'user_not_invitable — the account is not awaiting activation (`status` in the body)' })
  issue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<IssueInvitationResponseDto> {
    return this.account.issueInvitation(id, caller, requestContext(req));
  }
}
