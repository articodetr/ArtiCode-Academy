import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ReportsOverviewDto } from './overview.dto.js';
import { OverviewService } from './overview.service.js';
import { reportsMissing } from './reports.policy.js';

/**
 * MOD-13-T04 — the dashboard overview (API-164). No key at the guard (any of
 * the three report keys suffices): the controller refuses a caller who holds
 * none of them, as «my invoices» does with its two keys.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('overview')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Dashboard overview',
    description:
      'A general section (active students, open and running classes, lessons today) for a holder of any report key, and one section per key held: attendance (the last 30 days — API-156’s totals), academic (the final grades of the last 30 days — API-158’s totals — and the attempts waiting for review), ' +
      'financial (this month’s collections — API-161 — and today’s balance and overdue amount per currency — API-162). A section whose key is missing is null.',
  })
  @ApiOkResponse({ type: ReportsOverviewDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["reports.attendance.view", "reports.academic.view", "reports.financial.view"] }` (any one suffices)' })
  get(@CurrentUser() caller: AuthPrincipal): Promise<ReportsOverviewDto> {
    const missing = reportsMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.overview.overview(caller);
  }
}
