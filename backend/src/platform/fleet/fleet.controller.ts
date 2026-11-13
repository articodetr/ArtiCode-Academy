import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlatformUser } from '../auth/platform.decorators.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { platformAuthError } from '../platform.errors.js';
import { FleetDto, HealthCheckDto, HealthCheckListDto, ListHealthChecksQueryDto } from './fleet.dto.js';
import { FleetService } from './fleet.service.js';

/**
 * MOD-18-T05 — fleet health (roadmap §4m.4 API-196..198, D-R103). Any signed-in
 * platform user (`super_admin` or `support`) — no @PlatformRoles(). A probe
 * asks only the academy's STORED origin; the global guards (OriginGuard →
 * PlatformAuthGuard → PlatformRolesGuard) run first. Probes and reads record
 * no audit event: the health-check row is the record.
 */
@ApiTags('fleet')
@ApiBearerAuth()
@Controller()
@ApiUnauthorizedResponse({ description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ description: 'account_suspended | origin_forbidden (POST without an allowed Origin)' })
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  /** API-196 */
  @Post('academies/:id/probe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Probe an academy now',
    description:
      'Asks the academy’s two public endpoints at its stored origin — `GET <origin>/api/health`, then `GET <origin>/api/health/ready` — and records the snapshot (one `academy_health_checks` row, `triggeredBy` = the caller). ' +
      'https only (http on localhost / 127.0.0.1 outside production), no redirect followed, PLATFORM_PROBE_TIMEOUT_MS per request, at most 64 KB read per answer, no credentials sent. ' +
      'An unreachable or invalid academy is a 201 with that outcome, not an error. The academy’s checks beyond its newest 500 are deleted. No audit event.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: HealthCheckDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiNotFoundResponse({ description: 'academy_not_found — `{ academyId }`' })
  @ApiConflictResponse({ description: 'academy_not_probeable — `{ academyId, reason: archived | no_origin }`' })
  probe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPlatformUser() user: PlatformPrincipal | undefined,
  ): Promise<HealthCheckDto> {
    if (!user) throw platformAuthError.unauthenticated();
    return this.fleet.probeAcademy(id, { id: user.id, fullName: user.fullName });
  }

  /** API-197 */
  @Get('academies/:id/health-checks')
  @ApiOperation({
    summary: 'List an academy’s health checks',
    description:
      'The academy’s probes, newest first, keyset-paginated (`limit` 1–100, default 20; `cursor` = `nextCursor` of the previous page). An archived academy keeps its history. ' +
      '`behind` is computed against the newest academy migration of this platform build.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: HealthCheckListDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`id` not a UUID, `limit` out of range, an unknown parameter) | cursor_invalid' })
  @ApiNotFoundResponse({ description: 'academy_not_found — `{ academyId }`' })
  history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListHealthChecksQueryDto,
  ): Promise<HealthCheckListDto> {
    return this.fleet.history(id, query);
  }

  /** API-198 */
  @Get('fleet')
  @ApiOperation({
    summary: 'The fleet at a glance',
    description:
      'Every academy that is not archived, by slug, with its newest check (`latest`, null when never probed), `behind` (its applied schema is older than the newest academy migration of this build) and `stale` (no check in the last 3 × PLATFORM_PROBE_INTERVAL_SECONDS), ' +
      'plus the counts `{ total, ready, notReady, unreachable, invalid, never, behind }`. Reads the platform database only — it probes nothing.',
  })
  @ApiOkResponse({ type: FleetDto })
  fleetView(): Promise<FleetDto> {
    return this.fleet.fleet();
  }
}
