import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { CertificateDto, CertificateListDto, CertificateVerificationDto, ListCertificatesQueryDto, RevokeCertificateDto } from './certificates.dto.js';
import { certificatesReadMissing, REVOKE_CERTIFICATES_PERMISSION } from './certificates.policy.js';
import { CertificatesService } from './certificates.service.js';

/** 60 verifications per minute per IP (D-R56 — a page load each, like the invitation preview). */
const VERIFY_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };

/**
 * MOD-10-T03 — reading and revoking certificates (roadmap §4h.10.4 API-130,
 * API-131, API-133; D-R55/D-R57). Reading needs `certificates.read_all` or
 * `certificates.issue` (either — checked here, the guard needs every listed
 * key); revoking needs `certificates.revoke`. Academy-wide, no class visibility.
 */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @RequirePermissions()
  @ApiOperation({
    summary: 'List certificates',
    description: 'Newest first, keyset pages. ANDed filters `classId`, `courseId`, `studentId`, `status`, `q` (part of the serial, literal, case-insensitive). Needs `certificates.read_all` or `certificates.issue`.',
  })
  @ApiOkResponse({ type: CertificateListDto })
  @ApiBadRequestResponse({ description: 'Validation failed | cursor_invalid' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["certificates.read_all", "certificates.issue"] }` (either one suffices)' })
  list(@Query() query: ListCertificatesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<CertificateListDto> {
    const missing = certificatesReadMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.certificates.list(query);
  }

  @Get(':id')
  @RequirePermissions()
  @ApiOperation({ summary: 'Read a certificate', description: 'The whole certificate with its snapshot and, once revoked, the reason. Needs `certificates.read_all` or `certificates.issue`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CertificateDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied' })
  @ApiNotFoundResponse({ description: 'certificate_not_found' })
  detail(@Param('id', new ParseUUIDPipe()) certificateId: string, @CurrentUser() caller: AuthPrincipal): Promise<CertificateDto> {
    const missing = certificatesReadMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.certificates.detail(certificateId);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(REVOKE_CERTIFICATES_PERMISSION)
  @ApiOperation({
    summary: 'Revoke a certificate',
    description:
      'Final (D-R55): issued → revoked with the required `reason`, under the certificate-row lock, one `certificates.revoked` event. The enrollment may receive a new certificate (new serial), and the class’s final grades unlock once none is issued (D-R54). Needs `certificates.revoke`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CertificateDto })
  @ApiBadRequestResponse({ description: 'Validation failed (reason 1–500 characters)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `certificates.revoke`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'certificate_not_found' })
  @ApiConflictResponse({ description: 'certificate_revoked — `{ certificateId, revokedAt }`' })
  revoke(@Param('id', new ParseUUIDPipe()) certificateId: string, @Body() body: RevokeCertificateDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<CertificateDto> {
    return this.certificates.revoke(certificateId, body, caller, requestContext(req));
  }
}

/**
 * MOD-10-T03 — the public verification (API-134, D-R56): no sign-in, rate
 * limited per IP. The answer comes from the snapshot: status, serial, the
 * student's name, course, grade, dates and the academy — never the
 * revocation reason or an internal id. A malformed and an unknown code read
 * the same 404.
 */
@ApiTags('certificates')
@Controller('certificates')
@Public()
@UseGuards(AuthThrottlerGuard)
@ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
export class CertificateVerificationController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('verify/:code')
  @Throttle(VERIFY_LIMIT)
  @ApiOperation({ summary: 'Verify a certificate (public)', description: 'By its verification code (case, spaces and hyphens ignored). 60 requests per minute per IP.' })
  @ApiParam({ name: 'code', description: 'The verification code printed on the certificate' })
  @ApiOkResponse({ type: CertificateVerificationDto })
  @ApiNotFoundResponse({ description: 'certificate_not_found' })
  verify(@Param('code') code: string): Promise<CertificateVerificationDto> {
    return this.certificates.verify(code.slice(0, 64));
  }
}
