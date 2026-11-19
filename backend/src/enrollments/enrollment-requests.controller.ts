import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { MANAGE_ENROLLMENTS_PERMISSION } from '../classes/classes.policy.js';
import { EnrollmentRequestDto, EnrollmentRequestListDto, ListEnrollmentRequestsQueryDto } from './enrollment-requests.dto.js';
import { EnrollmentRequestsService } from './enrollment-requests.service.js';

/**
 * MOD-19 (roadmap §4p) — the office's enrollment requests: API-224 (list) and
 * API-225 (detail), both `enrollments.manage`. A request is approved or
 * rejected through API-059 (`POST /api/enrollments/:id/status`, actions
 * `approve` / `reject`); its payment is recorded through API-151 with
 * `payments.record`. Teachers hold neither key by seed.
 */
@ApiTags('enrollment-requests')
@ApiBearerAuth()
@Controller('enrollment-requests')
@RequirePermissions(MANAGE_ENROLLMENTS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `enrollments.manage`' })
export class EnrollmentRequestsController {
  constructor(private readonly requests: EnrollmentRequestsService) {}

  @Get()
  @ApiOperation({
    summary: 'List enrollment requests (API-224)',
    description:
      'Enrollments that were requested (MOD-19, D-R121), newest request first, keyset-paginated (`limit` 1–100, default 50). ' +
      '`state` (default `pending`): pending | pending_payment | pending_approval | approved | rejected | cancelled | all — the payment state is computed from the ' +
      'issued invoices of each enrollment on read (D-R125). Filters `classId`, `courseId`, `q` (student name or class code, literal). ' +
      'Each item carries the student in the caller’s D-R07 projection, the class and course, the payment summary (no payment lines in lists), ' +
      '`allowedActions` and `approveBlocker`; `pendingCount` counts every pending request of the academy.',
  })
  @ApiOkResponse({ type: EnrollmentRequestListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListEnrollmentRequestsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<EnrollmentRequestListDto> {
    return this.requests.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one enrollment request (API-225)',
    description:
      'The request (the enrollment id) with every invoice linked to it; the payment lines of each invoice need `invoices.read_all`, ' +
      '`invoices.manage` or `payments.record` (null otherwise).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The enrollment' })
  @ApiOkResponse({ type: EnrollmentRequestDto })
  @ApiNotFoundResponse({ description: 'request_not_found — no enrollment, or one that was never requested' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<EnrollmentRequestDto> {
    return this.requests.get(id, caller);
  }
}
