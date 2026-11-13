import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
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
import type { Request } from 'express';
import { requestContext } from '../../auth/cookies.js';
import { CurrentPlatformUser, PlatformRoles } from '../auth/platform.decorators.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { AcademyDetailDto, AddDomainDto, UpdateDomainDto } from './academies.dto.js';
import { DomainsService } from './domains.service.js';
import { RegistryErrorDto } from './registry.dto.js';

/**
 * MOD-18-T04 — the domains of an academy (API-188..190). `super_admin` only;
 * each write answers with the academy's detail, its domains in their new
 * order. An archived academy refuses them (`409 academy_archived`).
 */
@ApiTags('platform-academies')
@ApiBearerAuth()
@Controller('academies/:id/domains')
@PlatformRoles('super_admin')
@ApiParam({ name: 'id', format: 'uuid', description: 'The academy' })
@ApiUnauthorizedResponse({ type: RegistryErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: RegistryErrorDto, description: 'role_forbidden `{ required: [super_admin] }`; account_suspended; origin_forbidden' })
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  /** API-188 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a domain to an academy',
    description:
      'Records a hostname (lower-cased, unique across every academy; `platform_subdomain` or `custom`; no ownership check in v1). `isPrimary: true` makes the current primary step down in the same write. Event `platform.domains.added { domainId, hostname, kind, isPrimary, demotedDomainId? }` on the academy. `super_admin`.',
  })
  @ApiCreatedResponse({ type: AcademyDetailDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'domain_taken `{ hostname }` | academy_archived' })
  add(
    @Param('id', new ParseUUIDPipe()) academyId: string,
    @Body() body: AddDomainDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<AcademyDetailDto> {
    return this.domains.add(academyId, body, caller, requestContext(req));
  }

  /** API-190 */
  @Patch(':domainId')
  @ApiOperation({
    summary: 'Make a domain the primary one',
    description:
      'Body `{ isPrimary: true }`: the current primary steps down in the same write, with `platform.domains.updated { domainId, hostname, isPrimary, demotedDomainId? }`. An already primary domain = 200 without a write or an event. `false` is refused — make another domain primary instead. `super_admin`.',
  })
  @ApiParam({ name: 'domainId', format: 'uuid' })
  @ApiOkResponse({ type: AcademyDetailDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed or `domain_demote_forbidden`' })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found | domain_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'academy_archived' })
  update(
    @Param('id', new ParseUUIDPipe()) academyId: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @Body() body: UpdateDomainDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<AcademyDetailDto> {
    return this.domains.update(academyId, domainId, body, caller, requestContext(req));
  }

  /** API-189 */
  @Delete(':domainId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a domain from an academy',
    description:
      'Deletes the domain (a primary one too — the academy is then left without a primary) with `platform.domains.removed { domainId, hostname, kind, isPrimary }`; answers 200 with the academy detail. `super_admin`.',
  })
  @ApiParam({ name: 'domainId', format: 'uuid' })
  @ApiOkResponse({ type: AcademyDetailDto })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found | domain_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'academy_archived' })
  remove(
    @Param('id', new ParseUUIDPipe()) academyId: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<AcademyDetailDto> {
    return this.domains.remove(academyId, domainId, caller, requestContext(req));
  }
}
