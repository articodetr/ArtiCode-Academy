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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { READ_CONTACT_PERMISSION } from '../users/users.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import { GuardianLinkItemDto, GuardianLinkListDto, LinkGuardianDto, UpdateGuardianLinkDto } from './guardians.dto.js';
import { LINK_GUARDIANS_PERMISSION, READ_GUARDIANS_PERMISSION } from './guardians.policy.js';
import { GuardiansService } from './guardians.service.js';

/** Contact and login identifiers of the linked user are shown to holders of `users.read_contact` only (D-R07). */
function projectionFor(caller: AuthPrincipal): UsersProjection {
  return caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced';
}

const NOT_FOUND = 'user_not_found — the student or guardian is unknown or soft-deleted (`party`), or they are not linked (`reason: "not_linked"`)';
const WRITE_FORBIDDEN =
  'permission_denied — `guardians.link`, or the active permission keys the roles of either party confer that the caller does not hold (`missing`, learner baseline excepted); origin_forbidden';

/** Guardian ↔ student links (MOD-03-T09): live under the user resource. */
@ApiTags('guardians')
@ApiBearerAuth()
@Controller('users')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get(':studentId/guardians')
  @RequirePermissions(READ_GUARDIANS_PERMISSION)
  @ApiOperation({
    summary: 'Guardians of a student',
    description:
      'Every guardian linked to the user, primary first, each with the relationship, `isPrimary` and the link date. ' +
      'Any existing user may be asked (a user without links yields an empty list); links to soft-deleted guardians are hidden. ' +
      'Requires `users.read`; the `user` of each item follows the caller’s projection (`users.read_contact`).',
  })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiOkResponse({ type: GuardianLinkListDto })
  @ApiBadRequestResponse({ description: '`studentId` is not a UUID' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `users.read`' })
  @ApiNotFoundResponse({ description: 'user_not_found (unknown or soft-deleted)' })
  listGuardians(@Param('studentId', new ParseUUIDPipe()) studentId: string, @CurrentUser() caller: AuthPrincipal): Promise<GuardianLinkListDto> {
    return this.guardians.listGuardians(studentId, projectionFor(caller));
  }

  @Get(':guardianId/students')
  @RequirePermissions(READ_GUARDIANS_PERMISSION)
  @ApiOperation({
    summary: 'Students of a guardian',
    description:
      'Every student linked to the user, by link date, each with the relationship, whether this guardian is that student’s primary guardian, and the link date. ' +
      'Links to soft-deleted students are hidden. Requires `users.read`; projection as for the guardians list.',
  })
  @ApiParam({ name: 'guardianId', format: 'uuid' })
  @ApiOkResponse({ type: GuardianLinkListDto })
  @ApiBadRequestResponse({ description: '`guardianId` is not a UUID' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `users.read`' })
  @ApiNotFoundResponse({ description: 'user_not_found (unknown or soft-deleted)' })
  listStudents(@Param('guardianId', new ParseUUIDPipe()) guardianId: string, @CurrentUser() caller: AuthPrincipal): Promise<GuardianLinkListDto> {
    return this.guardians.listStudents(guardianId, projectionFor(caller));
  }

  @Post(':studentId/guardians')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(LINK_GUARDIANS_PERMISSION)
  @ApiOperation({
    summary: 'Link a guardian to a student',
    description:
      'Creates the link in one transaction with the audit event `guardians.linked`. The guardian must hold the `guardian` role and the student the `student` role (actual role rows); ' +
      'neither may be soft-deleted, and the roles of neither party may confer a permission the caller lacks. `isPrimary: true` demotes the student’s current primary guardian in the same transaction. ' +
      'Requires `guardians.link`.',
  })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiCreatedResponse({ type: GuardianLinkItemDto, description: 'The new link with the guardian in the caller’s projection' })
  @ApiBadRequestResponse({ description: 'Validation failed (`studentId` not a UUID, body fields, unknown fields), or `guardianId` is the student' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: WRITE_FORBIDDEN })
  @ApiNotFoundResponse({ description: 'user_not_found — the student or the guardian is unknown or soft-deleted (`party`)' })
  @ApiConflictResponse({ description: 'already_linked' })
  @ApiUnprocessableEntityResponse({ description: 'not_a_guardian | not_a_student' })
  link(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: LinkGuardianDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<GuardianLinkItemDto> {
    return this.guardians.link(studentId, body, caller, requestContext(req), projectionFor(caller));
  }

  @Patch(':studentId/guardians/:guardianId')
  @RequirePermissions(LINK_GUARDIANS_PERMISSION)
  @ApiOperation({
    summary: 'Change a link',
    description:
      '`relationship` and/or `isPrimary`; absent fields are left alone, `{}` is refused. Only what differs is written, in one transaction with the audit event `guardians.updated` (field names and the resulting state); ' +
      'an idempotent PATCH writes nothing. `isPrimary: true` demotes the current primary guardian; `isPrimary: false` leaves the student without one. Requires `guardians.link`.',
  })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiParam({ name: 'guardianId', format: 'uuid' })
  @ApiOkResponse({ type: GuardianLinkItemDto, description: 'The link after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed, or `nothing_to_update` (no field in the body)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: WRITE_FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  update(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
    @Body() body: UpdateGuardianLinkDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<GuardianLinkItemDto> {
    return this.guardians.update(studentId, guardianId, body, caller, requestContext(req), projectionFor(caller));
  }

  @Delete(':studentId/guardians/:guardianId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(LINK_GUARDIANS_PERMISSION)
  @ApiOperation({
    summary: 'Unlink a guardian from a student',
    description: 'Deletes the link row, with the audit event `guardians.unlinked` (last relationship and `isPrimary`) in the same transaction. Requires `guardians.link`.',
  })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiParam({ name: 'guardianId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Unlinked' })
  @ApiBadRequestResponse({ description: '`studentId` or `guardianId` is not a UUID' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: WRITE_FORBIDDEN })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  async unlink(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<void> {
    await this.guardians.unlink(studentId, guardianId, caller, requestContext(req));
  }
}
