import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto, SessionResponseDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import type { RefreshCookieOptions } from '../auth/cookies.js';
import { Public } from '../auth/decorators.js';
import { presentSession, sessionCookieOptions } from '../auth/session.presenter.js';
import { TokenService } from '../auth/token.service.js';
import type { Env } from '../config/env.schema.js';
import { AcceptInvitationDto, ConfirmPasswordResetDto, InvitationPreviewDto, RequestPasswordResetDto } from './account.dto.js';
import { AccountService } from './account.service.js';

/** 60 previews per minute per IP (a page load each). */
const PREVIEW_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };
/** 20 acceptance attempts per 15 minutes per IP (several people may activate from one network). */
const ACCEPT_LIMIT = { login: { limit: 20, ttl: 15 * 60 * 1000 } };
/** 5 "forgot my password" requests per 15 minutes per (IP, identifier) — AuthThrottlerGuard reads `identifier` from the body. */
const REQUEST_RESET_LIMIT = { login: { limit: 5, ttl: 15 * 60 * 1000 } };
/** 20 confirmation attempts per 15 minutes per IP, like invitation acceptance. */
const CONFIRM_RESET_LIMIT = ACCEPT_LIMIT;

/**
 * Public account routes (MOD-03-T03 invitations, MOD-03-T05 password reset):
 * what the invitation and reset pages need. Rate limited like the auth routes;
 * the only credential is the one-time token in the path, which identifies
 * nothing until it matches a stored hash.
 */
@ApiTags('account')
@Controller('account')
@Public()
@UseGuards(AuthThrottlerGuard)
@ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
export class AccountController {
  private readonly cookie: RefreshCookieOptions;

  constructor(
    private readonly account: AccountService,
    tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = sessionCookieOptions(config, tokens);
  }

  @Get('invitations/:token')
  @Throttle(PREVIEW_LIMIT)
  @ApiOperation({
    summary: 'Preview an invitation (public)',
    description:
      'Tells the holder of an invitation link which account it activates: name, masked identifiers, roles and expiry. No authentication; rate limited per IP.',
  })
  @ApiParam({ name: 'token', description: 'The raw invitation token from the link' })
  @ApiOkResponse({ type: InvitationPreviewDto })
  @ApiNotFoundResponse({ type: AuthErrorDto, description: 'invitation_invalid (malformed, unknown, or the account can no longer be activated)' })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'invitation_consumed (already used, or replaced by a newer invitation)' })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'invitation_expired' })
  preview(@Param('token') token: string): Promise<InvitationPreviewDto> {
    return this.account.previewInvitation(token);
  }

  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle(ACCEPT_LIMIT)
  @ApiOperation({
    summary: 'Accept an invitation: choose the password and sign in (public)',
    description:
      'Consumes the one-time token, stores the password (argon2id), sets the account to `active` and opens a session exactly like login (access token + httpOnly refresh cookie). ' +
      '`emailVerifiedAt` stays null: a manually delivered link does not prove ownership of the address (D-R08).',
  })
  @ApiParam({ name: 'token', description: 'The raw invitation token from the link' })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'Validation failed, or password_weak' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiNotFoundResponse({ type: AuthErrorDto, description: 'invitation_invalid' })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'invitation_consumed' })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'invitation_expired' })
  async accept(
    @Param('token') token: string,
    @Body() body: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const session = await this.account.acceptInvitation(token, body.password, requestContext(req));
    return presentSession(res, session, this.cookie);
  }

  // ----------------------------------------------- password reset (T05)

  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(REQUEST_RESET_LIMIT)
  @ApiOperation({
    summary: 'Request a password-reset e-mail (public, "forgot my password")',
    description:
      'Always 202 whether or not the identifier matches an account — nothing is revealed, and the token is created and mailed after the response. ' +
      'Refused as a whole with 403 `reset_disabled` while `AUTH_SELF_SERVICE_RESET_ENABLED` is false (the default until a mail transport that reaches the user exists — launch task LR-01); ' +
      'until then an administrator issues the reset through `POST /users/{id}/password-reset`.',
  })
  @ApiAcceptedResponse({ description: 'Accepted — an e-mail is on its way if the identifier belongs to an active account with an address' })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'Validation failed' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'reset_disabled (self-service reset is off) | origin_forbidden' })
  async requestReset(@Body() body: RequestPasswordResetDto, @Req() req: Request): Promise<void> {
    await this.account.requestPasswordReset(body.identifier, requestContext(req));
  }

  @Post('password-reset/:token/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(CONFIRM_RESET_LIMIT)
  @ApiOperation({
    summary: 'Confirm a password reset: set the new password and sign in (public)',
    description:
      'Consumes the one-time token, stores the new password (argon2id), unlocks the account, signs it out of EVERY device (all refresh tokens revoked; older access tokens stop working) ' +
      'and opens a fresh session exactly like login (access token + httpOnly refresh cookie).',
  })
  @ApiParam({ name: 'token', description: 'The raw reset token from the link' })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'Validation failed, or password_weak (policy, or same as the current password)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiNotFoundResponse({ type: AuthErrorDto, description: 'reset_invalid (malformed, unknown, already used or replaced, or the account can no longer sign in)' })
  @ApiGoneResponse({ type: AuthErrorDto, description: 'reset_expired' })
  async confirmReset(
    @Param('token') token: string,
    @Body() body: ConfirmPasswordResetDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const session = await this.account.confirmPasswordReset(token, body.newPassword, requestContext(req));
    return presentSession(res, session, this.cookie);
  }
}
