import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { READ_ENROLLMENTS_PERMISSION } from '../classes/classes.policy.js';
import { ClassLearningProgressDto } from './learning-reports.dto.js';
import { LearningReportsService } from './learning-reports.service.js';

/**
 * MOD-20 (roadmap §4q, D-R137) — the learning progress of a class (API-235)
 * for the teachers of the class and the office. The global guards (Origin →
 * Auth → Permissions) run first; the class visibility is the roster's and is
 * checked in the service.
 */
@ApiTags('learning')
@ApiBearerAuth()
@Controller()
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class LearningReportsController {
  constructor(private readonly reports: LearningReportsService) {}

  @Get('classes/:id/learning-progress')
  @RequirePermissions(READ_ENROLLMENTS_PERMISSION)
  @ApiOperation({
    summary: 'The learning progress of a class (API-235)',
    description:
      'One row per `active` or `completed` enrollment, in enrollment order: the student in the caller’s projection (contact fields need `users.read_contact`), the ' +
      'student’s progress on the course (completed required published lessons ÷ required published lessons, floored; it follows the student across the classes of the ' +
      'course), the latest lesson opening or completion and the lesson opened last while it is still published — the same numbers the learner sees in «My School». ' +
      'Readable by holders of `enrollments.manage` and by the teachers assigned to the class; for anyone else the class is 404. Read-only, no audit event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: ClassLearningProgressDto })
  @ApiNotFoundResponse({ description: 'class_not_found — unknown class, or one the caller may not read' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `enrollments.read`' })
  classProgress(@Param('id', new ParseUUIDPipe()) classId: string, @CurrentUser() caller: AuthPrincipal): Promise<ClassLearningProgressDto> {
    return this.reports.classProgress(classId, caller);
  }
}
