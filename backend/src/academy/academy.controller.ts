import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { AcademyDto, UpdateAcademyDto } from './academy.dto.js';
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from './academy.policy.js';
import { AcademyService } from './academy.service.js';

/**
 * MOD-02/MOD-14 minimum (ADR-044): `GET /api/academy` for every signed-in user
 * (D-R09 — no permission key) and `PATCH /api/academy` for holders of
 * `academy.settings.manage` (D-R10). The global guards (Origin → Auth →
 * Permissions) run before both.
 */
@ApiTags('academy')
@ApiBearerAuth()
@Controller('academy')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiServiceUnavailableResponse({ description: 'academy_not_configured — the database holds no academy row (seed not run)' })
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the academy',
    description:
      'Identity and settings of this deployment: `slug`, localized `name`, `logoUrl`, `defaultLocale`, `timezone`, `currency`, contact details. ' +
      'Every authenticated user may read it (the frontend needs the name, logo, locale, time zone and currency in every role); `settings` and `platformAcademyId` are not exposed.',
  })
  @ApiOkResponse({ type: AcademyDto })
  get(): Promise<AcademyDto> {
    return this.academy.get();
  }

  @Patch()
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiOperation({
    summary: 'Update the academy',
    description:
      'Partial update of `name` (whole localized object, `ar` required), `logoUrl`, `defaultLocale`, `timezone` (canonical IANA name or `UTC`), `currency` (ISO 4217), `contactEmail`, `contactPhone`. ' +
      'Absent fields are left alone, `null` clears `logoUrl`/`contactEmail`/`contactPhone`; only fields whose value changes are written, in one transaction with the audit event `academy.updated` (field names, no values). ' +
      '`slug`, `platformAcademyId` and `settings` are out of scope (400). Requires `academy.settings.manage`.',
  })
  @ApiOkResponse({ type: AcademyDto, description: 'The academy after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown time zone, currency not ISO 4217, name without `ar`, …) or `nothing_to_update` (empty body)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `academy.settings.manage`; origin_forbidden' })
  update(@Body() body: UpdateAcademyDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<AcademyDto> {
    return this.academy.update(body, caller, requestContext(req));
  }
}
