import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
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
import { AcceptInvitationDto, InvitationPreviewDto } from './account.dto.js';
import { AccountService } from './account.service.js';

/** 60 previews per minute per IP (a page load each). */
const PREVIEW_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };
/** 20 acceptance attempts per 15 minutes per IP (several people may activate from one network). */
const ACCEPT_LIMIT = { login: { limit: 20, ttl: 15 * 60 * 1000 } };

/**
 * Public account routes (MOD-03-T03): what the invitation page needs. Rate
 * limited like the auth routes; the only credential is the one-time token in
 * the path, which identifies nothing until it matches a stored hash.
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
}
