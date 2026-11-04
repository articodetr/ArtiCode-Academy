import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
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
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { MANAGE_ENROLLMENTS_PERMISSION, READ_ENROLLMENTS_PERMISSION } from '../classes/classes.policy.js';
import { ChangeEnrollmentStatusDto, CreateEnrollmentDto, EnrollmentDto, EnrollmentListDto, ListEnrollmentsQueryDto } from './enrollments.dto.js';
import { EnrollmentsService } from './enrollments.service.js';

/**
 * MOD-05-T04 — enrollments (roadmap §4d.4). The roster lives under the class
 * (`/api/classes/:id/enrollments`), the enrollment actions under the
 * enrollment (`/api/enrollments/:id/status`). Each route names its own key;
 * the global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('enrollments')
@ApiBearerAuth()
@Controller()
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({
  type: AuthErrorDto,
  description: 'permission_denied — `enrollments.read` to read a roster, `enrollments.manage` to write; origin_forbidden',
})
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get('classes/:id/enrollments')
  @RequirePermissions(READ_ENROLLMENTS_PERMISSION)
  @ApiOperation({
    summary: 'List the enrollments of a class',
    description:
      'The roster of a class in enrollment order, every status unless `status` is given, keyset-paginated (`limit` 1–100, default 50, opaque `cursor`). ' +
      'Readable by holders of `enrollments.manage` and by the teachers assigned to the class; for anyone else the class is 404. ' +
      'The student is shown in the caller’s projection: `email`, `username` and `phone` need `users.read_contact`; ' +
      '`withdrawalReason` needs `enrollments.manage` (null for an assigned teacher), while `student.deletedAt` is shown to every reader.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: EnrollmentListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  @ApiNotFoundResponse({ description: 'class_not_found — unknown class, or a roster the caller may not read' })
  list(
    @Param('id', new ParseUUIDPipe()) classId: string,
    @Query() query: ListEnrollmentsQueryDto,
    @CurrentUser() caller: AuthPrincipal,
  ): Promise<EnrollmentListDto> {
    return this.enrollments.list(classId, query, caller);
  }

  @Post('classes/:id/enrollments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_ENROLLMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Enroll a student in a class',
    description:
      'Enrolls an invited or active user who holds the `student` role into an open or running class with a free seat; the enrollment starts `active` (source `admin`, `created_by` = caller) ' +
      'with the audit event `enrollments.created`. The capacity is checked behind a lock on the class row, so two requests for the last seat cannot both succeed. ' +
      'A student who already has an enrollment in the class (any status) is `already_enrolled` — reactivate it instead. Requires `enrollments.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiCreatedResponse({ type: EnrollmentDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'class_not_found | user_not_found — unknown or soft-deleted student' })
  @ApiConflictResponse({
    description:
      'already_enrolled — `{ enrollmentId, status }` | class_not_enrollable — `{ status }` | class_full — `{ capacity, enrolledCount }`',
  })
  @ApiUnprocessableEntityResponse({ description: 'user_not_eligible — `{ userId, status }` | not_a_student — `{ userId }`' })
  enroll(
    @Param('id', new ParseUUIDPipe()) classId: string,
    @Body() body: CreateEnrollmentDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<EnrollmentDto> {
    return this.enrollments.enroll(classId, body, caller, requestContext(req));
  }

  @Post('enrollments/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_ENROLLMENTS_PERMISSION)
  @ApiOperation({
    summary: 'Change the enrollment status',
    description:
      '`withdraw` (active→withdrawn; `withdrawnAt` and `withdrawalReason` = `reason`), `complete` (active→completed), `cancel` (active→cancelled), ' +
      '`reactivate` (withdrawn|cancelled→active; the class must be open or running and have a free seat; clears the withdrawal), ' +
      'with the audit event `enrollments.status.changed { action, from, to, reason? }`. Requires `enrollments.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The enrollment' })
  @ApiOkResponse({ type: EnrollmentDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'enrollment_not_found' })
  @ApiConflictResponse({
    description: 'invalid_transition — `{ from, action, allowed }` | class_not_enrollable | class_full (reactivate)',
  })
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeEnrollmentStatusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<EnrollmentDto> {
    return this.enrollments.changeStatus(id, body, caller, requestContext(req));
  }
}
