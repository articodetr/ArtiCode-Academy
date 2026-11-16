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
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthThrottlerGuard } from '../auth-throttler.guard.js';
import { AuthErrorDto } from '../auth.dto.js';
import { readRefreshCookie, requestContext } from '../cookies.js';
import { CurrentUser } from '../decorators.js';
import type { AuthPrincipal } from '../principal.js';
import {
  MfaDisableRequestDto,
  MfaDisabledDto,
  MfaEnableRequestDto,
  MfaEnabledDto,
  MfaRecoveryCodesDto,
  MfaRegenerateRequestDto,
  MfaSetupDto,
  MfaSetupRequestDto,
  MfaStatusDto,
} from './mfa.dto.js';
import { MfaService } from './mfa.service.js';

/** 10 attempts per 15 minutes — the LOGIN_LIMIT of auth.controller.ts (the throttler is named "login"). */
const MFA_WRITE_LIMIT = { login: { limit: 10, ttl: 15 * 60 * 1000 } };

/**
 * MOD-01-H06 MFA-T02 — the caller's own two-step verification (TOTP, roadmap
 * §4n): status (API-206), setup (API-207), enabling (API-208), disabling
 * (API-209) and new recovery codes (API-210). Every route needs a signed-in
 * caller (the global AuthGuard; no permission key — ownership), the POSTs an
 * acceptable Origin (OriginGuard). The four POSTs are rate-limited like
 * sign-in; the GET is exempt (KI-082: the throttler is named "login"). The
 * routes live under `/api/auth`, so the browser sends the `aca_refresh`
 * cookie: it only tells which session is this device's (kept on enable and
 * disable) and is never required.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/mfa')
@UseGuards(AuthThrottlerGuard)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get()
  @SkipThrottle({ login: true })
  @ApiOperation({
    summary: 'My two-step verification status',
    description:
      'Whether the server can use two-step verification (`available`), whether it is on for the caller, since when, how many unused recovery codes are left, and whether a setup awaits its confirmation. ' +
      'Never 503: without `AUTH_MFA_ENCRYPTION_KEY` it answers `available: false`. No permission key; no audit event.',
  })
  @ApiOkResponse({ type: MfaStatusDto })
  status(@CurrentUser() caller: AuthPrincipal): Promise<MfaStatusDto> {
    return this.mfa.status(caller.id);
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_WRITE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start setting up two-step verification',
    description:
      'Checks the current password and creates a new TOTP secret (RFC 6238: SHA-1, 6 digits, 30 s), returned once as Base32 and as an `otpauth://` URI for a QR code; the server keeps it sealed (AES-256-GCM) only. ' +
      'Confirm it within 10 minutes with `POST /api/auth/mfa/enable`; a new setup replaces an unconfirmed one. A wrong password does not count towards the sign-in lockout. No audit event (nothing is on yet). ' +
      'Errors in this order: 503 `mfa_unavailable`, 400 `password_invalid`, 409 `mfa_already_enabled`.',
  })
  @ApiOkResponse({ type: MfaSetupDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'password_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'mfa_already_enabled' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'mfa_unavailable — the server has no AUTH_MFA_ENCRYPTION_KEY' })
  setup(@CurrentUser() caller: AuthPrincipal, @Body() body: MfaSetupRequestDto): Promise<MfaSetupDto> {
    return this.mfa.setup(caller, body.password);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_WRITE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Turn two-step verification on',
    description:
      'Confirms the pending setup with a current code of its secret. Returns ten one-time recovery codes once (stored as hashes). ' +
      'Every other session of the caller is signed out; the session of the `aca_refresh` cookie sent with the request stays (access tokens already issued elsewhere live until they expire). ' +
      'Records one `auth.mfa.enabled { revokedSessions }`. Errors in this order: 503 `mfa_unavailable`, 409 `mfa_already_enabled`, 409 `mfa_setup_required` (no setup, or older than 10 minutes), 400 `mfa_code_invalid`.',
  })
  @ApiOkResponse({ type: MfaEnabledDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'mfa_code_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'mfa_already_enabled | mfa_setup_required' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'mfa_unavailable — the server has no AUTH_MFA_ENCRYPTION_KEY' })
  enable(@CurrentUser() caller: AuthPrincipal, @Body() body: MfaEnableRequestDto, @Req() req: Request): Promise<MfaEnabledDto> {
    return this.mfa.enable(caller.id, body.code, readRefreshCookie(req), requestContext(req));
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_WRITE_LIMIT)
  @ApiOperation({
    summary: 'Turn two-step verification off',
    description:
      'Needs the current password and exactly one second factor: a current code (`code`) or an unused recovery code (`recoveryCode`, which is spent). ' +
      'Removes the secret, every recovery code and any open sign-in step, and signs out every other session of the caller; the session of the `aca_refresh` cookie sent with the request stays. ' +
      'A wrong password or code does not count towards the sign-in lockout. Records one `auth.mfa.disabled { via: code | recovery_code, revokedSessions }`. ' +
      'Errors in this order: 503 `mfa_unavailable`, 400 `mfa_factor_required`, 400 `password_invalid`, 409 `mfa_not_enabled`, 400 `mfa_code_invalid`.',
  })
  @ApiOkResponse({ type: MfaDisabledDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'mfa_factor_required | password_invalid | mfa_code_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'mfa_not_enabled' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'mfa_unavailable — the server has no AUTH_MFA_ENCRYPTION_KEY' })
  disable(@CurrentUser() caller: AuthPrincipal, @Body() body: MfaDisableRequestDto, @Req() req: Request): Promise<MfaDisabledDto> {
    return this.mfa.disable(caller.id, body, readRefreshCookie(req), requestContext(req));
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_WRITE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Replace my recovery codes',
    description:
      'Needs the current password and a current code. Returns ten new one-time recovery codes once; every earlier code stops working. Sessions are not touched. ' +
      'Records one `auth.mfa.recovery_codes.regenerated { count }`. Errors in this order: 503 `mfa_unavailable`, 400 `password_invalid`, 409 `mfa_not_enabled`, 400 `mfa_code_invalid`.',
  })
  @ApiOkResponse({ type: MfaRecoveryCodesDto })
  @ApiBadRequestResponse({ type: AuthErrorDto, description: 'password_invalid | mfa_code_invalid; or a body that fails validation' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiConflictResponse({ type: AuthErrorDto, description: 'mfa_not_enabled' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'mfa_unavailable — the server has no AUTH_MFA_ENCRYPTION_KEY' })
  regenerate(@CurrentUser() caller: AuthPrincipal, @Body() body: MfaRegenerateRequestDto, @Req() req: Request): Promise<MfaRecoveryCodesDto> {
    return this.mfa.regenerateRecoveryCodes(caller.id, body.password, body.code, requestContext(req));
  }
}
