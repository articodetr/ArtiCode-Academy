import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { CreateFeePlanDto, FeePlanDto, FeePlanListDto, ListFeePlansQueryDto, UpdateFeePlanDto } from './fee-plans.dto.js';
import { FeePlansService } from './fee-plans.service.js';
import { FEE_PLAN_READ_PERMISSIONS, FEE_PLANS_MANAGE_PERMISSION, missingAny } from './finance.policy.js';

/**
 * MOD-11-T02 — fee plans (roadmap §4i.4 API-140..API-143; D-R60). Reading
 * needs `fee_plans.manage` or `invoices.manage` (either — checked here, the
 * guard needs every listed key); writing needs `fee_plans.manage`.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('fee-plans')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class FeePlansController {
  constructor(private readonly plans: FeePlansService) {}

  @Get()
  @RequirePermissions()
  @ApiOperation({ summary: 'List fee plans', description: 'Active plans; inactive ones and the invoice counts for `fee_plans.manage`. Filters `courseId`, `classId`. Needs `fee_plans.manage` or `invoices.manage`.' })
  @ApiOkResponse({ type: FeePlanListDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["fee_plans.manage", "invoices.manage"] }` (either one suffices)' })
  list(@Query() query: ListFeePlansQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<FeePlanListDto> {
    const missing = missingAny(caller.permissions, FEE_PLAN_READ_PERMISSIONS);
    if (missing) throw authError.permissionDenied(missing);
    return this.plans.list(query, caller);
  }

  @Post()
  @RequirePermissions(FEE_PLANS_MANAGE_PERMISSION)
  @ApiOperation({
    summary: 'Create a fee plan',
    description: 'A template (D-R60): localized name, a course or a class (not both), 1–50 lines with positive amounts and 1–24 installment shares summing to 100 with non-decreasing day offsets. One `fee_plans.created` event.',
  })
  @ApiCreatedResponse({ type: FeePlanDto })
  @ApiBadRequestResponse({ description: 'Validation failed | fee_plan_invalid — `{ problems }`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `fee_plans.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'course_not_found | class_not_found' })
  create(@Body() body: CreateFeePlanDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<FeePlanDto> {
    return this.plans.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(FEE_PLANS_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Update a fee plan', description: 'Smallest change; `null` clears the course or the class; lines and installments are replaced whole; issued invoices keep their copy. One `fee_plans.updated { fields }` event; no difference = no write, no event.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FeePlanDto })
  @ApiBadRequestResponse({ description: 'Validation failed | nothing_to_update | fee_plan_invalid' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `fee_plans.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'fee_plan_not_found | course_not_found | class_not_found' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateFeePlanDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<FeePlanDto> {
    return this.plans.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(FEE_PLANS_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Delete a fee plan', description: 'Only a plan no invoice was created from (`fee_plan_in_use { invoiceCount }` — deactivate it instead). One `fee_plans.deleted` event.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `fee_plans.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'fee_plan_not_found' })
  @ApiConflictResponse({ description: 'fee_plan_in_use — `{ invoiceCount }`' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.plans.remove(id, caller, requestContext(req));
  }
}
