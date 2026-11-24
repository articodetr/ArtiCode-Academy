import { Body, Catch, Controller, Get, HttpCode, HttpException, HttpStatus, Injectable, Logger, Post, Req, Res, UseFilters } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.schema.js';
import { AuthErrorDto } from '../auth.dto.js';
import { requestContext } from '../cookies.js';
import type { RefreshCookieOptions } from '../cookies.js';
import { Public } from '../decorators.js';
import { presentSession, sessionCookieOptions } from '../session.presenter.js';
import { TokenService } from '../token.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import type { GoogleCallbackOutcome } from './google-auth.service.js';
import { GoogleStartDto, GoogleStartResponseDto } from './google-auth.dto.js';
import { clearGoogleStateCookie, googleCookiePath, readGoogleStateCookie, setGoogleStateCookie } from './google.cookie.js';
import type { GoogleCookieOptions } from './google.cookie.js';
import { DEFAULT_RETURN_TO, doneRedirect, failureRedirect, mfaRedirect } from './google-state.js';
import { GoogleCallbackThrottle, GoogleStartThrottle } from './google-throttle.js';

function googleCookieOptions(config: ConfigService<Env, true>): GoogleCookieOptions {
  return { secure: config.get('AUTH_COOKIE_SECURE', { infer: true }), path: googleCookiePath(config.get('API_PREFIX', { infer: true })) };
}

/** No cache may keep an answer of these routes (a URL with a fresh state, a redirect after a code). */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * The callback never answers JSON: whatever is thrown on its way — the rate
 * limit (429) included, or an unexpected error — becomes
 * `302 /login?google=failed&returnTo=/` with the state cookie cleared.
 */
@Catch()
@Injectable()
export class GoogleCallbackExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GoogleCallback');
  private readonly cookie: GoogleCookieOptions;

  constructor(config: ConfigService<Env, true>) {
    this.cookie = googleCookieOptions(config);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse() as { code?: unknown } | string;
      const code = typeof body === 'object' && typeof body.code === 'string' ? body.code : exception.getStatus();
      this.logger.warn(`Google callback refused before the sign-in ran: ${code}`);
    } else {
      this.logger.error('Google callback failed', exception instanceof Error ? exception.stack : undefined);
    }
    if (res.headersSent) return;
    clearGoogleStateCookie(res, this.cookie);
    noStore(res);
    res.redirect(HttpStatus.FOUND, failureRedirect('failed', DEFAULT_RETURN_TO));
  }
}

@ApiTags('auth')
@Controller('auth/google')
// The rate limits live on each route (google-throttle.ts): the callback's guard adds a per-IP ceiling of its own.
export class GoogleAuthController {
  private readonly sessionCookie: RefreshCookieOptions;
  private readonly stateCookie: GoogleCookieOptions;

  constructor(
    private readonly google: GoogleAuthService,
    tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    this.sessionCookie = sessionCookieOptions(config, tokens);
    this.stateCookie = googleCookieOptions(config);
  }

  @Post('start')
  @Public()
  @HttpCode(HttpStatus.OK)
  @GoogleStartThrottle()
  @ApiOperation({
    summary: 'Start a Google sign-in (PORTAL-04)',
    description:
      'Answers the Google authorization URL (authorization code with PKCE S256, scope `openid email profile`, `state`, `nonce`, `prompt=select_account`) and sets the httpOnly cookie `aca_google` ' +
      '(SameSite=Lax — it must come back on Google’s redirect —, Secure like the session cookie, Path `/api/auth/google`, 10 minutes) holding the signed state, nonce, PKCE verifier and `returnTo`. ' +
      'The frontend then navigates to `url`. Public; needs an acceptable Origin like every POST; 200 per 15 minutes per IP. Records nothing.',
  })
  @ApiOkResponse({ type: GoogleStartResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed (a field other than `returnTo`)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  @ApiServiceUnavailableResponse({ type: AuthErrorDto, description: 'google_unavailable — Google sign-in is not configured on this server' })
  async start(@Body() body: GoogleStartDto, @Res({ passthrough: true }) res: Response): Promise<GoogleStartResponseDto> {
    noStore(res);
    const { url, stateToken } = await this.google.start(body.returnTo);
    setGoogleStateCookie(res, stateToken, this.stateCookie);
    return { url };
  }

  @Get('callback')
  @Public()
  @GoogleCallbackThrottle()
  @UseFilters(GoogleCallbackExceptionFilter)
  @ApiOperation({
    summary: 'Google’s redirect back after the sign-in (PORTAL-04)',
    description:
      'Always a 302 to the frontend, never JSON; the `aca_google` cookie is cleared in every outcome. ' +
      'Success: the session cookie `aca_refresh` is set exactly as a password sign-in sets it, then `/auth/google/done?returnTo=<path>`. ' +
      'An account with two-step verification: no session, `/login#google-mfa=<challenge>&expiresAt=<ISO>&returnTo=<path>` (a fragment — finish with `POST /api/auth/login/mfa`). ' +
      'Failure: `/login?google=<code>&returnTo=<path>` with `cancelled` (refused at Google), `failed` (state or cookie missing, forged or expired, the token exchange or the ID-token check failed, or the rate limit), ' +
      '`unavailable` (not configured), `registration_closed` (a new person — or a self-registered account awaiting completion — while the academy accepts no self-registration), ' +
      '`link_required` (an account with this e-mail exists but is not linked automatically: Google is not authoritative for the address, the account holds a role other than student/guardian, ' +
      'or its address is not confirmed — sign in with the password), `link_conflict` (that account is already linked to another Google account), ' +
      '`account_unavailable` (suspended, archived, deleted or locked), `mfa_unavailable` (the account has two-step verification and the server has no usable key) or ' +
      '`email_not_authoritative` (a new person whose address Google is not authoritative for — register by e-mail). ' +
      'Google is authoritative for a Gmail address (`@gmail.com`, `@googlemail.com`) or when the ID token’s `hd` is the address’s own domain. ' +
      'A new account is a student account (the `student` role and a student profile) with a confirmed address and no password. ' +
      '30 per 15 minutes per (IP, state cookie — a digest of it) and 300 per 15 minutes per IP; a refusal is the `failed` redirect too. ' +
      'Events: `auth.google.linked { via }` when an identity is linked, `users.self_registered { via: google }` for a new account, `auth.login.succeeded { via: google }` for a session.',
  })
  @ApiQuery({ name: 'code', required: false, type: String, description: 'The authorization code Google issued' })
  @ApiQuery({ name: 'state', required: false, type: String, description: 'The `state` of the attempt, compared with the cookie' })
  @ApiQuery({ name: 'error', required: false, type: String, description: 'Set by Google instead of a code (`access_denied` when the user refused)' })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description: 'Redirect to the frontend (`Location`: `/auth/google/done?…`, `/login#google-mfa=…` or `/login?google=<code>&…`)',
    headers: { Location: { description: 'A root-relative path on the frontend origin', schema: { type: 'string' } } },
  })
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const outcome = await this.google.callback(req.query as Record<string, unknown>, readGoogleStateCookie(req), requestContext(req));
    clearGoogleStateCookie(res, this.stateCookie);
    noStore(res);
    res.redirect(HttpStatus.FOUND, this.locationOf(res, outcome));
  }

  private locationOf(res: Response, outcome: GoogleCallbackOutcome): string {
    switch (outcome.kind) {
      case 'session':
        // The very cookie of a password sign-in; the body it builds is not sent (the frontend refreshes).
        presentSession(res, outcome.session, this.sessionCookie);
        return doneRedirect(outcome.returnTo);
      case 'mfa':
        return mfaRedirect(outcome.challenge, outcome.expiresAt, outcome.returnTo);
      case 'failure':
        return failureRedirect(outcome.code, outcome.returnTo);
    }
  }
}
