import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { FinalizeGradesDto, GradebookDto } from './gradebook.dto.js';
import { GradebookService } from './gradebook.service.js';

export const READ_ALL_GRADES_PERMISSION = 'grades.read_all';
export const MANAGE_GRADES_PERMISSION = 'grades.manage';

/**
 * MOD-09-T05 — the gradebook and the final grades of a class (roadmap §4h.4
 * API-126..API-128; D-R43..D-R45). Reading needs `grades.read_all`,
 * finalizing and withdrawing `grades.manage` (method-level keys), all through
 * the class's visibility (D-R16 — `classes.manage` or an assigned teacher;
 * others 404). The global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('grades')
@ApiBearerAuth()
@Controller('classes')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class GradebookController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get(':id/gradebook')
  @RequirePermissions(READ_ALL_GRADES_PERMISSION)
  @ApiOperation({
    summary: 'Read the gradebook of a class',
    description:
      'Computed on read (D-R44): the class’s non-draft assignments (each student’s latest graded attempt, with the late penalty) and exams (the recorded results); for every active or completed student the cells, ' +
      '`current` (missing work left out), `projected` (missing work and absences as 0, an excused exam left out — what a finalization would fix) and the fixed `final` grade with `stale` when a source changed after it; ' +
      'plus `readiness` (open weighted assignments, attempts waiting for review, unpublished weighted exams) and the default grade scheme. Needs `grades.read_all` and the class’s visibility.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: GradebookDto })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `grades.read_all`' })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  read(@Param('id', new ParseUUIDPipe()) classId: string, @CurrentUser() caller: AuthPrincipal): Promise<GradebookDto> {
    return this.gradebook.gradebook(classId, caller);
  }

  @Post(':id/final-grades')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE_GRADES_PERMISSION)
  @ApiOperation({
    summary: 'Finalize the grades of a class',
    description:
      'Fixes, for every active or completed enrollment of a running or completed class (`class_not_gradable`), the weighted percentage (D-R43; missing work and absences 0, excused exams left out), ' +
      'the band of the default grade scheme or of `schemeId` (`grade_scheme_missing` / `grade_scheme_not_found`) and the breakdown — once nothing is pending (`grades_not_ready { openAssignments, awaitingReview, unpublishedExams, reason? }`). ' +
      'Repeatable: only what differs is written, with one `grades.finalized` event; an identical run writes nothing. Needs `grades.manage` and the class’s visibility.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: GradebookDto, description: 'The gradebook after the finalization' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `grades.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found | grade_scheme_not_found' })
  @ApiConflictResponse({ description: 'class_not_gradable — `{ classId, status }` | grade_scheme_missing | grades_not_ready' })
  finalize(@Param('id', new ParseUUIDPipe()) classId: string, @Body() body: FinalizeGradesDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<GradebookDto> {
    return this.gradebook.finalize(classId, body, caller, requestContext(req));
  }

  @Delete(':id/final-grades')
  @RequirePermissions(MANAGE_GRADES_PERMISSION)
  @ApiOperation({
    summary: 'Withdraw the final grades of a class',
    description: 'Deletes every final grade of the class with one `grades.withdrawn` event (none when there was nothing to withdraw). Needs `grades.manage` and the class’s visibility.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiOkResponse({ type: GradebookDto, description: 'The gradebook after the withdrawal' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `grades.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'class_not_found' })
  withdraw(@Param('id', new ParseUUIDPipe()) classId: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<GradebookDto> {
    return this.gradebook.withdraw(classId, caller, requestContext(req));
  }
}
