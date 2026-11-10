import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { myCertificatesMissing } from './certificates.policy.js';
import { ListMyCertificatesQueryDto, MyCertificateListDto } from './my-certificates.dto.js';
import { MyCertificatesService } from './my-certificates.service.js';

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
  constructor(private readonly myCertificates: MyCertificatesService) {}

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
}
