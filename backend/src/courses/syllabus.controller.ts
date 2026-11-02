import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
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
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { MANAGE_COURSES_PERMISSION, READ_COURSES_PERMISSION } from './courses.policy.js';
import { ReplaceSyllabusDto, SyllabusDto } from './syllabus.dto.js';
import { SyllabusService } from './syllabus.service.js';

/**
 * MOD-04-T04 — course syllabus (roadmap §4c.4). Reading needs `courses.read`
 * and follows the course's visibility; replacing needs `courses.manage`.
 */
@ApiTags('courses')
@ApiBearerAuth()
@Controller('courses/:id/syllabus')
@RequirePermissions(READ_COURSES_PERMISSION)
@ApiParam({ name: 'id', format: 'uuid', description: 'Course id' })
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `courses.read` to read, `courses.manage` to replace; origin_forbidden' })
@ApiNotFoundResponse({ description: 'course_not_found — also for a non-published course without `courses.manage`' })
export class SyllabusController {
  constructor(private readonly syllabus: SyllabusService) {}

  @Get()
  @ApiOperation({ summary: 'Read a course syllabus', description: 'The ordered syllabus items of a course.' })
  @ApiOkResponse({ type: SyllabusDto })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<SyllabusDto> {
    return this.syllabus.get(id, caller);
  }

  @Put()
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Replace a course syllabus',
    description:
      '`items` is the complete syllabus in its new order: items with an `id` (of this course) are kept and updated, items without one are created, unlisted items are deleted, ' +
      'positions become 0..n-1. One transaction (the course row is locked) with the audit event `courses.syllabus.changed { added, updated, removed, reordered, items }`; ' +
      'the current syllabus again writes nothing and records nothing. Requires `courses.manage`.',
  })
  @ApiOkResponse({ type: SyllabusDto, description: 'The syllabus after the replacement' })
  @ApiBadRequestResponse({ description: 'Validation failed (title without `ar`, minutes out of 1–1440 or not a number, more than 200 items, …) or `syllabus_invalid { unknown, duplicates }`' })
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ReplaceSyllabusDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<SyllabusDto> {
    return this.syllabus.replace(id, body, caller, requestContext(req));
  }
}
