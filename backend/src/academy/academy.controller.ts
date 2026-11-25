import { Body, Controller, Get, Header, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { AcademyDto, AcademyPublicDto, UpdateAcademyDto } from './academy.dto.js';
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from './academy.policy.js';
import { AcademyService } from './academy.service.js';

/** 60 reads per minute per IP (API-205): one per load of the sign-in page, like the certificate verification (API-134). */
const PUBLIC_READ_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };

const UNAUTHORIZED = { type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' } as const;

/**
 * MOD-02/MOD-14 minimum (ADR-044): `GET /api/academy` for every signed-in user
 * (D-R09 — no permission key) and `PATCH /api/academy` for holders of
 * `academy.settings.manage` (D-R10). The global guards (Origin → Auth →
 * Permissions) run before both. MOD-02-T04 (public part): `GET
 * /api/academy/public` (API-205) is `@Public()` and rate limited per IP — the
 * branding of the sign-in page, nothing else; the bearer scheme and the 401
 * are therefore documented per method, not on the class.
 */
@ApiTags('academy')
@Controller('academy')
@ApiServiceUnavailableResponse({ description: 'academy_not_configured — the database holds no academy row (seed not run)' })
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  @Get('public')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle(PUBLIC_READ_LIMIT)
  // Revalidated on every load (the ETag answers 304): a picture or name the academy changes shows at once.
  @Header('Cache-Control', 'no-cache')
  @ApiOperation({
    summary: 'Read the academy branding (public)',
    description:
      'No sign-in: the localized `name`, the `logoUrl` and the `defaultLocale` the sign-in page shows before anybody is authenticated, and `catalogPublic` ' +
      '(true when `settings.catalog.publicBrowsing` is true — visitors may browse the published courses, API-236/237), `homepageImages` ' +
      '(the root-relative URL of the academy’s own picture for each of the four places of the public home page, null = the built-in default), `selfRegistration` ' +
      '(true when `settings.selfRegistration.enabled` is true and the server has a mail transport — PORTAL-03), `googleSignIn` (Google sign-in is configured on this server) and `googleSignUp` (`googleSignIn` and `settings.selfRegistration.enabled` is true — a new student account may be created through Google) — nothing else ' +
      '(no id, slug, contact details, time zone, currency or settings). 60 requests per minute per IP; no audit event.',
  })
  @ApiOkResponse({ type: AcademyPublicDto })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  getPublic(): Promise<AcademyPublicDto> {
    return this.academy.getPublic();
  }

  @Get()
  @ApiBearerAuth()
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @ApiOperation({
    summary: 'Read the academy',
    description:
      'Identity and settings of this deployment: `slug`, localized `name`, `logoUrl`, `defaultLocale`, `timezone`, `currency`, contact details. ' +
      'Every authenticated user may read it (the frontend needs the name, logo, locale, time zone and currency in every role). ' +
      '`settings` carries every known key, `null` when not set (MOD-02-T03: `scheduling.weekStartsOn`, `scheduling.workingDays`; MOD-10: `certificates.serialPrefix`; ' +
      'MOD-20: `learning.videoCompletionPercent` (null = 90), `catalog.publicBrowsing` (null = off); PORTAL-03: `selfRegistration.enabled` (null = off)); `platformAcademyId` is not exposed.',
  })
  @ApiOkResponse({ type: AcademyDto })
  get(): Promise<AcademyDto> {
    return this.academy.get();
  }

  @Patch()
  @ApiBearerAuth()
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiOperation({
    summary: 'Update the academy',
    description:
      'Partial update of `name` (whole localized object, `ar` required), `logoUrl`, `defaultLocale`, `timezone` (canonical IANA name or `UTC`), `currency` (ISO 4217), `contactEmail`, `contactPhone`. ' +
      'Absent fields are left alone, `null` clears `logoUrl`/`contactEmail`/`contactPhone`; only fields whose value changes are written, in one transaction with the audit event `academy.updated` (field names, no values). ' +
      '`settings` is patched key by key (absent = unchanged, `null` = clear; the event names the dotted keys, e.g. `settings.scheduling.weekStartsOn`). ' +
      '`slug`, `platformAcademyId` and unknown settings keys are out of scope (400). Requires `academy.settings.manage`.',
  })
  @ApiOkResponse({ type: AcademyDto, description: 'The academy after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown time zone, currency not ISO 4217, name without `ar`, …) or `nothing_to_update` (empty body)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `academy.settings.manage`; origin_forbidden' })
  update(@Body() body: UpdateAcademyDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<AcademyDto> {
    return this.academy.update(body, caller, requestContext(req));
  }
}
