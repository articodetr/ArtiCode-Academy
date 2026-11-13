import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
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
import { RegistryErrorDto } from './registry.dto.js';
import { CreateSubscriptionDto, SubscriptionDto, UpdateSubscriptionDto } from './subscriptions.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** MOD-18-T04 — subscriptions (API-194/195), `super_admin` only; they are read through the academy detail (API-185). */
@ApiTags('platform-subscriptions')
@ApiBearerAuth()
@Controller()
@PlatformRoles('super_admin')
@ApiUnauthorizedResponse({ type: RegistryErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: RegistryErrorDto, description: 'role_forbidden `{ required: [super_admin] }`; account_suspended; origin_forbidden' })
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** API-194 */
  @Post('academies/:id/subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Subscribe an academy to a plan',
    description:
      'A current subscription (`trial`, `active` or `past_due`) on an active plan; the academy may hold one current subscription at a time — end it first with PATCH /api/subscriptions/:id. `endsAt` and `trialEndsAt` after `startsAt`, `trialEndsAt` only with `trial`. Event `platform.subscriptions.created { academyId, planKey, status }`. `super_admin`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The academy' })
  @ApiCreatedResponse({ type: SubscriptionDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed or `subscription_invalid { problems }`' })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'academy_not_found | plan_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'subscription_current_exists `{ subscriptionId }` | academy_archived' })
  @ApiUnprocessableEntityResponse({ type: RegistryErrorDto, description: 'plan_inactive `{ planId, key }`' })
  create(
    @Param('id', new ParseUUIDPipe()) academyId: string,
    @Body() body: CreateSubscriptionDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<SubscriptionDto> {
    return this.subscriptions.create(academyId, body, caller, requestContext(req));
  }

  /** API-195 */
  @Patch('subscriptions/:id')
  @ApiOperation({
    summary: 'Update a subscription',
    description:
      'Partial update of `status` (trial→active|canceled|expired, active→past_due|canceled|expired, past_due→active|canceled|expired; canceled and expired are terminal), `endsAt`, `trialEndsAt`, `notes` (`null` clears); the dates are checked again after the merge. Only changed fields are written, with `platform.subscriptions.updated { academyId, planKey, status, fields, from? }`; no difference = 200 without a write or an event. On an archived academy only a PATCH that ends the subscription (canceled | expired) is accepted. `super_admin`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The subscription' })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiBadRequestResponse({ type: RegistryErrorDto, description: 'Validation failed, `nothing_to_update` or `subscription_invalid { problems }`' })
  @ApiNotFoundResponse({ type: RegistryErrorDto, description: 'subscription_not_found' })
  @ApiConflictResponse({ type: RegistryErrorDto, description: 'invalid_transition `{ entity: subscription, from, to, allowed }` | academy_archived' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateSubscriptionDto,
    @CurrentPlatformUser() caller: PlatformPrincipal,
    @Req() req: Request,
  ): Promise<SubscriptionDto> {
    return this.subscriptions.update(id, body, caller, requestContext(req));
  }
}
