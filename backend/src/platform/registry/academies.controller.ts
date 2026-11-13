import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requestContext } from '../../auth/cookies.js';
import { CurrentPlatformUser, PlatformRoles } from '../auth/platform.decorators.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { AcademiesService } from './academies.service.js';
import { AcademyDetailDto, AcademyListDto, ChangeAcademyStatusDto, CreateAcademyDto, ListAcademiesQueryDto, UpdateAcademyDto } from './academies.dto.js';
import { RegistryErrorDto } from './registry.dto.js';

/**
 * MOD-18-T04 — the academies registry (API-183..187, roadmap §4m.4). Reading
 * needs any signed-in platform user (`support` or `super_admin`); every write
 * needs `super_admin` (`403 role_forbidden` for `support`). The global guards
 * run first: OriginGuard → PlatformAuthGuard → PlatformRolesGuard.
 */
@ApiTags('platform-academies')
@ApiBearerAuth()
@Controller('academies')
@ApiUnauthorizedResponse({ type: RegistryErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: RegistryErrorDto, description: 'role_forbidden `{ required }` — a write needs `super_admin`; account_suspended; origin_forbidden' })
export class AcademiesController {
  constructor(private readonly academies: AcademiesService) {}

  /** API-183 */
  @Get()
  @ApiOperation({
    summary: 'List the registered academies',
    description:
      'Keyset pages newest first (`limit` 1–100, default 20, opaque `cursor`), search `q` (slug or Arabic/English name, literal and case-insensitive), filter `status`; archived academies only with `status=archived` or `includeArchived=true`. ' +
      'Each item carries its primary domain, its current subscription and its newest health check. Any platform user.',
  })
  @ApiOkResponse({ type: AcademyListDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListAcademiesQueryDto): Promise<AcademyListDto> {
    return this.academies.list(query);
  }

  /** API-184 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @PlatformRoles('super_admin')
  @ApiOperation({
    summary: 'Register an academy',
    description:
      'Registers a `provisioning` academy (slug lower-cased and unique, the compose project `academy-<slug>` of MOD-17; optional origin, contact e-mail and notes) with the caller as creator and the event `platform.academies.created { slug }`. `super_admin`.',
  })
  @ApiCreatedResponse({ type: AcademyDetailDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'academy_slug_taken `{ slug }`' })
  create(@Body() body: CreateAcademyDto, @CurrentPlatformUser() caller: PlatformPrincipal, @Req() req: Request): Promise<AcademyDetailDto> {
    return this.academies.create(body, caller, requestContext(req));
  }

  /** API-185 */
  @Get(':id')
  @ApiOperation({
    summary: 'Read an academy',
    description: 'The list item plus its notes, `archivedAt`, creator, every domain (primary first) and every subscription (newest first). Any platform user.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademyDetailDto })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found' })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<AcademyDetailDto> {
    return this.academies.get(id);
  }

  /** API-186 */
  @Patch(':id')
  @PlatformRoles('super_admin')
  @ApiOperation({
    summary: 'Update an academy',
    description:
      'Partial update (absent = unchanged, `null` clears `origin`, `contactEmail`, `notes`; `name` replaced as a whole). The slug is immutable (a 400). Only changed fields are written, with `platform.academies.updated { slug, fields }`; no difference = 200 without a write or an event. An archived academy is read-only. `super_admin`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademyDetailDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed (a `slug` field included) or `nothing_to_update`' })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'academy_archived' })
  @ApiUnprocessableEntityResponse({ type: RegistryErrorDto, description: 'origin_required `{ action: clear_origin }` — an active academy keeps an origin' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAcademyDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<AcademyDetailDto> {
    return this.academies.update(id, body, caller, requestContext(req));
  }

  /** API-187 */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @PlatformRoles('super_admin')
  @ApiOperation({
    summary: 'Change the lifecycle status of an academy',
    description:
      '`activate` (provisioning|suspended→active; needs an origin), `suspend` (active→suspended), `archive` (provisioning|active|suspended→archived; sets `archivedAt`), `restore` (archived→suspended; clears it), with `platform.academies.status.changed { slug, action, from, to, reason? }`. `super_admin`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AcademyDetailDto })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'invalid_transition `{ entity: academy, from, action, allowed }`' })
  @ApiUnprocessableEntityResponse({ type: RegistryErrorDto, description: 'origin_required `{ action: activate }`' })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeAcademyStatusDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<AcademyDetailDto> {
    return this.academies.changeStatus(id, body, caller, requestContext(req));
  }
}
