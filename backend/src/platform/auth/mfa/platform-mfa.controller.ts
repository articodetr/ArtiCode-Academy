// PMFA-T02 (roadmap §4o, D-R113..D-R120) — the platform user's own two-step
// verification (TOTP): status (API-213), setup (API-214), enabling (API-215),
// disabling (API-216) and new recovery codes (API-217) — the academy's
// MfaController (src/auth/mfa/mfa.controller.ts, API-206..API-210) on the
// platform's accounts and its `pla_refresh` cookie.
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { requestContext } from '../../../auth/cookies.js';
import { readPlatformRefreshCookie } from '../platform-cookies.js';
import { CurrentPlatformUser } from '../platform.decorators.js';
import type { PlatformPrincipal } from '../platform-principal.js';
import { PlatformAuthErrorDto } from '../platform-session.dto.js';
import { PLATFORM_AUTH_THROTTLER, PlatformThrottlerGuard } from '../platform-throttler.guard.js';
import {
  PlatformMfaDisableRequestDto,
  PlatformMfaDisabledDto,
  PlatformMfaEnableRequestDto,
  PlatformMfaEnabledDto,
  PlatformMfaRecoveryCodesDto,
  PlatformMfaRegenerateRequestDto,
  PlatformMfaSetupDto,
  PlatformMfaSetupRequestDto,
  PlatformMfaStatusDto,
} from './platform-mfa.dto.js';
import { PlatformMfaService } from './platform-mfa.service.js';

/** 10 attempts per 15 minutes per (IP, platform user) on each write — the academy MFA_WRITE_LIMIT. */
export const PLATFORM_MFA_WRITE_LIMIT = { [PLATFORM_AUTH_THROTTLER]: { limit: 10, ttl: 15 * 60 * 1000 } };

const UNAVAILABLE = 'mfa_unavailable — the platform server has no PLATFORM_MFA_ENCRYPTION_KEY';

/**
 * Every route sits behind the global PlatformAuthGuard (a platform Bearer
 * access token; no @PlatformRoles(), so `super_admin` and `support` alike —
 * ownership only), the POSTs behind OriginGuard too. The four POSTs are
 * rate-limited like the password change: PlatformThrottlerGuard is applied per
 * method (it is not global — platform-auth.module.ts), so the GET is never
 * limited, like `/me`, and needs no @SkipThrottle (KI-082). The routes live
 * under `/api/auth`, so the browser sends the `pla_refresh` cookie: it only
 * tells which session is this device's (kept on enable and disable) and is
 * never required.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/mfa')
@ApiUnauthorizedResponse({
  type: PlatformAuthErrorDto,
  description: 'unauthenticated | token_expired | token_invalid | session_invalid',
})
export class PlatformMfaController {
  constructor(private readonly mfa: PlatformMfaService) {}

  @Get()
  @ApiOperation({
    summary: 'My two-step verification status (API-213)',
    description:
      'Whether the platform server can use two-step verification (`available`), whether it is on for the caller, since when, how many unused recovery codes are left, and whether a setup awaits its confirmation. ' +
      'Never 503: without `PLATFORM_MFA_ENCRYPTION_KEY` it answers `available: false`. Any platform role; no audit event.',
  })
  @ApiOkResponse({ type: PlatformMfaStatusDto })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'account_suspended' })
  status(@CurrentPlatformUser() caller: PlatformPrincipal): Promise<PlatformMfaStatusDto> {
    return this.mfa.status(caller.id);
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_MFA_WRITE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start setting up two-step verification (API-214)',
    description:
      'Checks the current password and creates a new TOTP secret (RFC 6238: SHA-1, 6 digits, 30 s), returned once as Base32 and as an `otpauth://` URI for a QR code (issuer `ArtiCode Platform`, account = the caller’s e-mail); the server keeps it sealed (AES-256-GCM) only. ' +
      'Confirm it within 10 minutes with `POST /api/auth/mfa/enable`; a new setup replaces an unconfirmed one. A wrong password does not count towards the sign-in lockout. No audit event (nothing is on yet). ' +
      'Errors in this order: 503 `mfa_unavailable`, 400 `password_invalid`, 409 `mfa_already_enabled`.',
  })
  @ApiOkResponse({ type: PlatformMfaSetupDto })
  @ApiBadRequestResponse({ type: PlatformAuthErrorDto, description: 'password_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'origin_forbidden | account_suspended' })
  @ApiConflictResponse({ type: PlatformAuthErrorDto, description: 'mfa_already_enabled' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: PlatformAuthErrorDto, description: UNAVAILABLE })
  setup(@CurrentPlatformUser() caller: PlatformPrincipal, @Body() body: PlatformMfaSetupRequestDto): Promise<PlatformMfaSetupDto> {
    return this.mfa.setup(caller, body.password);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_MFA_WRITE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Turn two-step verification on (API-215)',
    description:
      'Confirms the pending setup with a current code of its secret. Returns ten one-time recovery codes once (stored as hashes). ' +
      'Every other platform session of the caller is signed out; the session of the `pla_refresh` cookie sent with the request stays (access tokens already issued elsewhere live until they expire). ' +
      'Records one `platform.auth.mfa.enabled { revokedSessions }`. Errors in this order: 503 `mfa_unavailable`, 409 `mfa_already_enabled`, 409 `mfa_setup_required` (no setup, or older than 10 minutes), 400 `mfa_code_invalid`.',
  })
  @ApiOkResponse({ type: PlatformMfaEnabledDto })
  @ApiBadRequestResponse({ type: PlatformAuthErrorDto, description: 'mfa_code_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'origin_forbidden | account_suspended' })
  @ApiConflictResponse({ type: PlatformAuthErrorDto, description: 'mfa_already_enabled | mfa_setup_required' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: PlatformAuthErrorDto, description: UNAVAILABLE })
  enable(
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Body() body: PlatformMfaEnableRequestDto,
    @Req() req: Request,
  ): Promise<PlatformMfaEnabledDto> {
    return this.mfa.enable(caller.id, body.code, readPlatformRefreshCookie(req), requestContext(req));
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_MFA_WRITE_LIMIT)
  @ApiOperation({
    summary: 'Turn two-step verification off (API-216)',
    description:
      'Needs the current password and exactly one second factor: a current code (`code`) or an unused recovery code (`recoveryCode`, which is spent). ' +
      'Removes the secret, every recovery code and any open sign-in step, and signs out every other platform session of the caller; the session of the `pla_refresh` cookie sent with the request stays. ' +
      'A wrong password or code does not count towards the sign-in lockout. Records one `platform.auth.mfa.disabled { via: code | recovery_code, revokedSessions }`. ' +
      'Errors in this order: 503 `mfa_unavailable`, 400 `mfa_factor_required`, 400 `password_invalid`, 409 `mfa_not_enabled`, 400 `mfa_code_invalid`.',
  })
  @ApiOkResponse({ type: PlatformMfaDisabledDto })
  @ApiBadRequestResponse({
    type: PlatformAuthErrorDto,
    description: 'mfa_factor_required | password_invalid | mfa_code_invalid; or a body that fails validation',
  })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'origin_forbidden | account_suspended' })
  @ApiConflictResponse({ type: PlatformAuthErrorDto, description: 'mfa_not_enabled' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: PlatformAuthErrorDto, description: UNAVAILABLE })
  disable(
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Body() body: PlatformMfaDisableRequestDto,
    @Req() req: Request,
  ): Promise<PlatformMfaDisabledDto> {
    return this.mfa.disable(caller.id, body, readPlatformRefreshCookie(req), requestContext(req));
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformThrottlerGuard)
  @Throttle(PLATFORM_MFA_WRITE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Replace my recovery codes (API-217)',
    description:
      'Needs the current password and a current code. Returns ten new one-time recovery codes once; every earlier code stops working. Sessions are not touched. ' +
      'Records one `platform.auth.mfa.recovery_codes.regenerated { count }`. Errors in this order: 503 `mfa_unavailable`, 400 `password_invalid`, 409 `mfa_not_enabled`, 400 `mfa_code_invalid`.',
  })
  @ApiOkResponse({ type: PlatformMfaRecoveryCodesDto })
  @ApiBadRequestResponse({ type: PlatformAuthErrorDto, description: 'password_invalid | mfa_code_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: PlatformAuthErrorDto, description: 'origin_forbidden | account_suspended' })
  @ApiConflictResponse({ type: PlatformAuthErrorDto, description: 'mfa_not_enabled' })
  @ApiTooManyRequestsResponse({ type: PlatformAuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: PlatformAuthErrorDto, description: UNAVAILABLE })
  regenerate(
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Body() body: PlatformMfaRegenerateRequestDto,
    @Req() req: Request,
  ): Promise<PlatformMfaRecoveryCodesDto> {
    return this.mfa.regenerateRecoveryCodes(caller.id, body.password, body.code, requestContext(req));
  }
}
