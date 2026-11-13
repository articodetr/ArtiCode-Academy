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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requestContext } from '../../auth/cookies.js';
import { CurrentPlatformUser, PlatformRoles } from '../auth/platform.decorators.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { CreatePlanDto, ListPlansQueryDto, PlanDto, PlanListDto, UpdatePlanDto } from './plans.dto.js';
import { PlansService } from './plans.service.js';
import { RegistryErrorDto } from './registry.dto.js';

/** MOD-18-T04 — plans (API-191..193): read by any platform user, written by `super_admin`. */
@ApiTags('platform-plans')
@ApiBearerAuth()
@Controller('plans')
@ApiUnauthorizedResponse({ type: RegistryErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: RegistryErrorDto, description: 'role_forbidden `{ required }` — a write needs `super_admin`; account_suspended; origin_forbidden' })
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** API-191 */
  @Get()
  @ApiOperation({ summary: 'List the plans', description: 'By key; active plans only unless `includeInactive=true`. No pagination. Any platform user.' })
  @ApiOkResponse({ type: PlanListDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed' })
  list(@Query() query: ListPlansQueryDto): Promise<PlanListDto> {
    return this.plans.list(query);
  }

  /** API-192 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @PlatformRoles('super_admin')
  @ApiOperation({
    summary: 'Create a plan',
    description: 'A plan with a unique key (lower-cased), a localized name, flat `limits` (default `{}`) and `isActive` (default true), with `platform.plans.created { key }`. No price, no currency. `super_admin`.',
  })
  @ApiCreatedResponse({ type: PlanDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed or `plan_limits_invalid { problems, keys }`' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'plan_key_taken `{ key }`' })
  create(@Body() body: CreatePlanDto, @CurrentPlatformUser() caller: PlatformPrincipal, @Req() req: Request): Promise<PlanDto> {
    return this.plans.create(body, caller, requestContext(req));
  }

  /** API-193 */
  @Patch(':id')
  @PlatformRoles('super_admin')
  @ApiOperation({
    summary: 'Update a plan',
    description:
      'Partial update of `name`, `limits` (replaced as a whole) and `isActive`; the key is immutable (a 400). Only changed fields are written, with `platform.plans.updated { key, fields }`; no difference = 200 without a write or an event. `super_admin`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PlanDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed (a `key` field included), `nothing_to_update` or `plan_limits_invalid`' })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'plan_not_found' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePlanDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<PlanDto> {
    return this.plans.update(id, body, caller, requestContext(req));
  }
}
