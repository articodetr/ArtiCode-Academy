import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { missingAny } from '../finance/finance.policy.js';
import { ListStudentEnrollmentsQueryDto, StudentEnrollmentListDto } from './student-enrollments.dto.js';
import { STUDENT_ENROLLMENTS_READ_PERMISSIONS, StudentEnrollmentsService } from './student-enrollments.service.js';

/**
 * API-200 (CH-0226) — one student's enrollments across every class. The guard
 * needs every listed key, so the route lists none and the controller asks for
 * ANY of `enrollments.manage` / `invoices.manage` (the `missingAny()` pattern
 * of the finance reads).
 */
@ApiTags('enrollments')
@ApiBearerAuth()
@Controller('users')
export class StudentEnrollmentsController {
  constructor(private readonly enrollments: StudentEnrollmentsService) {}

  @Get(':id/enrollments')
  @RequirePermissions()
  @ApiOperation({
    summary: 'List the enrollments of one student',
    description:
      'Every enrollment of the student in every class (any status unless `status` is given), newest first, no pagination — each with the class, its course and its lead teacher by name. ' +
      'Needs `enrollments.manage` OR `invoices.manage` (picking the enrollment of an invoice draft, API-144); academy-wide, no class visibility. ' +
      '`withdrawalReason` needs `enrollments.manage`. A soft-deleted student keeps their history; a user who is not a student gets an empty list. Records no audit event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The student (a user id)' })
  @ApiOkResponse({ type: StudentEnrollmentListDto })
  @ApiBadRequestResponse({ description: 'Validation failed (a malformed id or an unknown `status`)' })
  @ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied { missing: [enrollments.manage, invoices.manage] } — neither key' })
  @ApiNotFoundResponse({ description: 'user_not_found { userId } — no user with this id' })
  list(
    @Param('id', new ParseUUIDPipe()) studentId: string,
    @Query() query: ListStudentEnrollmentsQueryDto,
    @CurrentUser() caller: AuthPrincipal,
  ): Promise<StudentEnrollmentListDto> {
    const missing = missingAny(caller.permissions, STUDENT_ENROLLMENTS_READ_PERMISSIONS);
    if (missing) throw authError.permissionDenied(missing);
    return this.enrollments.list(studentId, query, caller);
  }
}
