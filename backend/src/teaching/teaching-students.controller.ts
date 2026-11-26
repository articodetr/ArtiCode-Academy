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
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListTeachingStudentsQueryDto, TeachingStudentDetailDto, TeachingStudentListDto } from './teaching-students.dto.js';
import { TeachingStudentsService } from './teaching-students.service.js';

const READ_ENROLLMENTS = 'enrollments.read';

/**
 * «طلابي» for a teacher (CH-0370): the students of the classes the caller
 * teaches (lead or assistant), read only. `enrollments.read` at the guard (the
 * seeded teacher holds it); attendance needs `attendance.read` and the marks
 * `grades.read_all`, else those parts are null. Records no audit event.
 */
@ApiTags('teaching')
@ApiBearerAuth()
@Controller('teaching/students')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied { missing: [enrollments.read] }' })
export class TeachingStudentsController {
  constructor(private readonly students: TeachingStudentsService) {}

  @Get()
  @RequirePermissions(READ_ENROLLMENTS)
  @ApiOperation({
    summary: 'List the students I teach (API-301)',
    description:
      'Every student (not deleted) enrolled in a class the caller teaches, sorted by name, each with those classes and an attendance summary across them. ' +
      'Filters: `q` (name, e-mail or phone), `classId`, `status` (`active` by default, `completed`, `withdrawn`, `all`). At most 1,000 students (`truncated`). ' +
      'Contact fields are included: the caller teaches these students.',
  })
  @ApiOkResponse({ type: TeachingStudentListDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  list(@Query() query: ListTeachingStudentsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<TeachingStudentListDto> {
    return this.students.list(query, caller);
  }

  @Get(':id')
  @RequirePermissions(READ_ENROLLMENTS)
  @ApiOperation({
    summary: 'One student I teach (API-302)',
    description:
      'The student with contact fields and guardians, and for each class the caller teaches that the student is (or was) in: the attendance of every lesson that has started, ' +
      'and the student’s row of the class gradebook (API-126 — the same numbers). A student the caller does not teach is 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The student (a user id)' })
  @ApiOkResponse({ type: TeachingStudentDetailDto })
  @ApiBadRequestResponse({ description: 'Validation failed (a malformed id)' })
  @ApiNotFoundResponse({ description: 'student_not_found { studentId } — not a student of the caller’s classes' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<TeachingStudentDetailDto> {
    return this.students.detail(id, caller);
  }
}
