import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ClassCertificatesDto, IssueCertificatesDto, IssueCertificatesResultDto } from './certificates.dto.js';
import { certificatesReadMissing, ISSUE_CERTIFICATES_PERMISSION } from './certificates.policy.js';
import { CertificatesService } from './certificates.service.js';

/**
 * MOD-10-T02 — the certificates of a class (roadmap §4h.10.4 API-132/API-136;
 * D-R52). Issuing needs `certificates.issue` (academy-wide — no class
 * visibility); the preview needs `certificates.read_all` or
 * `certificates.issue` — no key at the guard (it needs every listed one), the
 * controller checks either. The global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class ClassCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get(':id/certificates')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Preview the certificates of a class',
    description:
      'Every active or completed enrollment of the class with its final grade (percent, band, pass, `stale`), its issued certificate if any, and the reason an issuing request would skip it now ' +
      '(`already_issued` | `not_completed` | `no_final_grade` | `not_passed` | `stale`; null = eligible), plus `issuable` (0 unless the class is completed). Needs `certificates.read_all` or `certificates.issue`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: ClassCertificatesDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["certificates.read_all", "certificates.issue"] }` (either one suffices)' })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  preview(@Param('id', new ParseUUIDPipe()) classId: string, @CurrentUser() caller: AuthPrincipal): Promise<ClassCertificatesDto> {
    const missing = certificatesReadMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.certificates.classPreview(classId, caller);
  }

  @Post(':id/certificates')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(ISSUE_CERTIFICATES_PERMISSION)
  @ApiOperation({
    summary: 'Issue the certificates of a completed class',
    description:
      'Under the class-row lock: a completed class (`class_not_completed`) gets one certificate per completed enrollment with a passing, non-stale final grade and no issued certificate (D-R52) — ' +
      'every eligible one, or the `enrollmentIds` named (each of the class and once — `certificate_request_invalid { unknown, duplicates }`). Serials `PREFIX-YYYY-NNNNN` (D-R53), a random verification code and a snapshot of what is printed (D-R50). ' +
      'One `certificates.issued` event; nothing eligible = 200 with `issued: []` and no event. Needs `certificates.issue`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: IssueCertificatesResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed | certificate_request_invalid' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `certificates.issue`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  @ApiConflictResponse({ description: 'class_not_completed — `{ classId, status }`' })
  issue(@Param('id', new ParseUUIDPipe()) classId: string, @Body() body: IssueCertificatesDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<IssueCertificatesResultDto> {
    return this.certificates.issue(classId, body, caller, requestContext(req));
  }
}
