import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { authError } from '../auth/auth.errors.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListMyGradesQueryDto, MyGradeListDto } from './my-grades.dto.js';
import { myGradesMissing } from './my-grades.policy.js';
import { MyGradesService } from './my-grades.service.js';

/**
 * MOD-09-T06 — the caller's grades (roadmap §4h.4 API-129; D-R48). No key at
 * the guard (either of two keys suffices, and the guard needs every listed
 * one): the controller refuses a caller who holds neither `grades.read_own`
 * nor `grades.read_linked`; the service shows each relation only with its key.
 */
@ApiTags('grades')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyGradesController {
  constructor(private readonly myGrades: MyGradesService) {}

  @Get('grades')
  @ApiOperation({
    summary: 'List my grades',
    description:
      'One item per enrollment the caller owns (active or completed): their own with `grades.read_own` (`relation: self`), and — while the caller holds the `guardian` role — their linked children’s with `grades.read_linked` (`relation: child`). ' +
      'Each item carries the class and course, its assignments (no drafts — the latest graded attempt, the late penalty applied) and published exams (the result) with their weights, and the final grade once the class is finalized (percent, band label and letter, pass). ' +
      'No running average (D-R48), no pagination. Filters `classId` and `studentId`.',
  })
  @ApiOkResponse({ type: MyGradeListDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["grades.read_own", "grades.read_linked"] }` (either one suffices)' })
  list(@Query() query: ListMyGradesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyGradeListDto> {
    const missing = myGradesMissing(caller.permissions);
    if (missing) throw authError.permissionDenied(missing);
    return this.myGrades.list(query, caller);
  }
}
