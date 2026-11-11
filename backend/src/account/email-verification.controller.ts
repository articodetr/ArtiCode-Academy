import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { RequestEmailVerificationResponseDto } from './account.dto.js';
import { AccountService } from './account.service.js';

/**
 * LR-01-T02 (D-R78) — the signed-in side of e-mail verification: a user asks
 * for a confirmation e-mail to their own address. Signed-in users only, no
 * permission key; the public confirmation route lives in AccountController.
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller('account/email-verification')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class EmailVerificationController {
  constructor(private readonly account: AccountService) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send me a confirmation e-mail for my address (API-165)',
    description:
      'Retires any pending confirmation of the account, stores the SHA-256 of a fresh one-time token tied to the current address and e-mails the link ' +
      '`<APP_PUBLIC_URL>/verify-email/<token>`. The token is NEVER returned — only the e-mail carries it, which is what makes the confirmation prove ownership (D-R78). ' +
      'At most 3 per account per 15 minutes. A delivery failure does not fail the request: `delivery.status` says `failed`.',
  })
  @ApiAcceptedResponse({ type: RequestEmailVerificationResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiUnprocessableEntityResponse({ description: 'email_missing — the account has no e-mail address' })
  @ApiConflictResponse({ description: 'email_already_verified (`emailVerifiedAt` in the body)' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited — 3 confirmation e-mails in the last 15 minutes' })
  @ApiServiceUnavailableResponse({ description: 'mail_unavailable — `MAIL_TRANSPORT=none`: no e-mail can reach the user' })
  request(@CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<RequestEmailVerificationResponseDto> {
    return this.account.requestEmailVerification(caller, requestContext(req));
  }
}
