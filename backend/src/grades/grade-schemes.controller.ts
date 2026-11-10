import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
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
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from '../academy/academy.policy.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { CreateGradeSchemeDto, GradeSchemeDto, GradeSchemeListDto, UpdateGradeSchemeDto } from './grade-schemes.dto.js';
import { GradeSchemesService } from './grade-schemes.service.js';

/**
 * MOD-09-T02 — the academy's grade schemes (roadmap §4h.4 API-122..API-125;
 * owner decision D-R46). Reading needs no permission key (every signed-in
 * user — the band labels are what a learner's final grade shows); every write
 * needs `academy.settings.manage`. The global guards (Origin → Auth →
 * Permissions) run first.
 */
@ApiTags('grade-schemes')
@ApiBearerAuth()
@Controller('grade-schemes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class GradeSchemesController {
  constructor(private readonly schemes: GradeSchemesService) {}

  @Get()
  @ApiOperation({
    summary: 'List grade schemes',
    description:
      'The default scheme first, then by creation, each with its bands ascending. Every authenticated user sees the active schemes; holders of `academy.settings.manage` also see inactive ones and the final-grade count of each. No pagination (a short list).',
  })
  @ApiOkResponse({ type: GradeSchemeListDto })
  list(@CurrentUser() caller: AuthPrincipal): Promise<GradeSchemeListDto> {
    return this.schemes.list(caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiOperation({
    summary: 'Create a grade scheme',
    description:
      'A scheme with its whole band list (2–20 bands: one at 0, distinct minimums, at least one passing band, every band above a passing one passes) and the audit event `grade_schemes.created` in the same transaction. ' +
      '`isDefault: true` makes it the default and the previous default steps down in the same transaction (`demotedSchemeId` in the event); the first scheme of the academy is the default anyway. Requires `academy.settings.manage`.',
  })
  @ApiCreatedResponse({ type: GradeSchemeDto })
  @ApiBadRequestResponse({ description: 'Validation failed (name or label without `ar`, minimum outside 0..100 or with more than two decimals, non-boolean flags, too few or too many bands) or grade_scheme_invalid ({ problems, duplicates })' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `academy.settings.manage`; origin_forbidden' })
  create(@Body() body: CreateGradeSchemeDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<GradeSchemeDto> {
    return this.schemes.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiOperation({
    summary: 'Update a grade scheme',
    description:
      'Partial update of `name`, `bands` (the whole list), `isDefault` (promotion only — the previous default steps down in the same transaction and event) and `isActive`. ' +
      'Only what changes is written, in one transaction with the audit event `grade_schemes.updated` (field names). The default cannot be deactivated or stop being the default, and an inactive scheme is promoted only together with its activation. ' +
      'Final grades already fixed keep their snapshot. Requires `academy.settings.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GradeSchemeDto, description: 'The scheme after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed, grade_scheme_invalid, or nothing_to_update (no field in the body)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `academy.settings.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'grade_scheme_not_found' })
  @ApiConflictResponse({ description: 'grade_scheme_is_default (`action: deactivate | unset_default | promote_inactive`)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateGradeSchemeDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<GradeSchemeDto> {
    return this.schemes.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_ACADEMY_SETTINGS_PERMISSION)
  @ApiOperation({
    summary: 'Delete a grade scheme',
    description:
      'Deletes a scheme that is not the default and that no final grade uses (deactivate a used one instead), with its bands and the audit event `grade_schemes.deleted` in the same transaction. Requires `academy.settings.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `academy.settings.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'grade_scheme_not_found' })
  @ApiConflictResponse({ description: 'grade_scheme_is_default (`action: delete`); grade_scheme_in_use — `finalGradeCount` final grades use it' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.schemes.remove(id, caller, requestContext(req));
  }
}
