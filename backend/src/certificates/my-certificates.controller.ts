import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { myCertificatesMissing, READ_OWN_CERTIFICATES_PERMISSION } from './certificates.policy.js';
import { ClaimCertificateResultDto, EnrollmentCompletionDto, ListMyCertificatesQueryDto, MyCertificateListDto } from './my-certificates.dto.js';
import { MyCertificatesService } from './my-certificates.service.js';
import { SelfCertificatesService } from './self-certificates.service.js';

/** ADR-049: a learner takes a certificate once, and a double click must not cost a retry — 30 per minute per (IP, user). */
const CLAIM_LIMIT = { login: { limit: 30, ttl: 60 * 1000 } };

/**
 * MOD-10-T04 — the caller's certificates (API-135; D-R57). No key at the guard
 * (either of two keys suffices): the controller refuses a caller who holds
 * neither `certificates.read_own` nor `certificates.read_linked`.
 */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyCertificatesController {
  constructor(
    private readonly myCertificates: MyCertificatesService,
    private readonly selfCertificates: SelfCertificatesService,
  ) {}

  @Get('certificates')
  @RequirePermissions()
  @ApiOperation({
    summary: 'List my certificates',
    description:
      'The caller’s own certificates with `certificates.read_own` (`relation: self`) and — while the caller holds the `guardian` role — their linked children’s with `certificates.read_linked` (`relation: child`); issued and revoked, newest first, ' +
      'with the serial, the verification code and the snapshot to print; never the issuer, the revoker or the revocation reason. Filters `classId` and `studentId`; no pagination.',
  })
  @ApiOkResponse({ type: MyCertificateListDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["certificates.read_own", "certificates.read_linked"] }` (either one suffices)' })
  list(@Query() query: ListMyCertificatesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyCertificateListDto> {
    const missing = myCertificatesMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.myCertificates.list(query, caller);
  }

  @Get('enrollments/:id/completion')
  @RequirePermissions(READ_OWN_CERTIFICATES_PERMISSION)
  @ApiOperation({
    summary: 'Where I stand on the way to my certificate',
    description:
      'For the caller’s OWN active or completed enrollment: the required lessons done, the class’s weighted assessments with the student’s visible score, the grade once every one is finished (never a running average), the certificate if any, ' +
      'and `state`, in the order the server checks it: issued → revoked → not_offered (`settings.certificates.selfIssue` is off) → class_not_running → lessons_pending → no_assessments → assessments_pending → not_passed → ready. Read-only. ADR-049.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The caller’s enrollment' })
  @ApiOkResponse({ type: EnrollmentCompletionDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `certificates.read_own`' })
  @ApiNotFoundResponse({ description: 'enrollment_not_found — not an active or completed enrollment of the caller' })
  completion(@Param('id', new ParseUUIDPipe()) enrollmentId: string, @CurrentUser() caller: AuthPrincipal): Promise<EnrollmentCompletionDto> {
    return this.selfCertificates.completion(enrollmentId, caller);
  }

  @Post('enrollments/:id/certificate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle(CLAIM_LIMIT)
  @RequirePermissions(READ_OWN_CERTIFICATES_PERMISSION)
  @ApiOperation({
    summary: 'Take my certificate',
    description:
      'When the state is `ready`: under the class-row lock, fixes the caller’s final grade, completes their enrollment and issues their certificate, with one `certificates.issued { via: self_service }` event and the usual notification. ' +
      'A second request answers the same certificate with `created: false` and writes nothing. Any other state is `409 certificate_not_ready { state }`; a revoked certificate is issued again by the office only. ADR-049.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The caller’s enrollment' })
  @ApiOkResponse({ type: ClaimCertificateResultDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `certificates.read_own`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'enrollment_not_found — not an active or completed enrollment of the caller' })
  @ApiConflictResponse({ description: 'certificate_not_ready — `{ state }`' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  claim(@Param('id', new ParseUUIDPipe()) enrollmentId: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<ClaimCertificateResultDto> {
    return this.selfCertificates.claim(enrollmentId, caller, requestContext(req));
  }
}
