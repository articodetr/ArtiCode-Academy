import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
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
import { MANAGE_COURSES_PERMISSION, READ_COURSES_PERMISSION } from '../courses/courses.policy.js';
import { CurriculumDto, CurriculumItemDto, ReplaceCurriculumDto, ReplaceLessonContentDto } from './curriculum.dto.js';
import { CurriculumService } from './curriculum.service.js';

/**
 * MOD-20 «My School» — the course curriculum for authors (roadmap §4q,
 * D-R130..D-R135): API-226 reads the levels and lessons with their content
 * (`courses.read` + `courses.manage` or a teacher of a class of the course),
 * API-227 replaces the whole structure and API-228 one lesson's content (both
 * `courses.manage`).
 */
@ApiTags('courses')
@ApiBearerAuth()
@Controller('courses/:id/curriculum')
@RequirePermissions(READ_COURSES_PERMISSION)
@ApiParam({ name: 'id', format: 'uuid', description: 'Course id' })
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `courses.read` to read, `courses.manage` to write; origin_forbidden' })
export class CurriculumController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get()
  @ApiOperation({
    summary: 'Read a course curriculum (API-226)',
    description:
      'Every level of the course in order (empty ones too) with its lessons, then the lessons outside every level (`looseItems`). Each lesson carries its kind, ' +
      'content, resources, flags, how it completes, its length and `progressCount` (learners with progress — such a lesson can only be unpublished). ' +
      'Open to the holders of `courses.manage` (`canManage: true`) and to the teachers of a class of the course (read only); anyone else gets `404 course_not_found`.',
  })
  @ApiOkResponse({ type: CurriculumDto })
  @ApiNotFoundResponse({ description: 'course_not_found — unknown course, or the caller neither manages courses nor teaches a class of it' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<CurriculumDto> {
    return this.curriculum.get(id, caller);
  }

  @Put()
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiOperation({
    summary: 'Replace a course curriculum (API-227)',
    description:
      'The COMPLETE structure: `sections` (the levels in order, each with its lessons in order) then `looseItems` (lessons outside every level). ' +
      'A level or lesson with an `id` of this course is kept and updated, one without is created (a new lesson is a `text` lesson without content), unlisted ones are deleted; ' +
      'levels take positions 0..n-1 and lessons their position in the flattened learning order. A lesson’s kind, content and resources are kept (API-228 writes them). ' +
      'At most 50 levels and 200 lessons. One transaction (the course row is locked) with exactly one event ' +
      '`courses.curriculum.changed { code, sections { added, updated, removed }, items { added, updated, removed, moved }, reordered, totalSections, totalItems }`; ' +
      'the stored structure again writes nothing and records nothing. A level may carry `releaseAfterDays` (0..365 or null): it opens that many days after each class starts (D-R145). ' +
      'Lessons this write newly publishes notify the active students (and their guardians) of every open or running class of the course — one `curriculum.lessons_published` per class, category `lessons` (D-R146). Requires `courses.manage`.',
  })
  @ApiOkResponse({ type: CurriculumDto, description: 'The curriculum after the replacement' })
  @ApiBadRequestResponse({
    description: 'Validation failed (title without `ar`, minutes out of 1–1440, a flag that is not a JSON boolean, more than 50 levels or 200 lessons, …) or `curriculum_invalid { unknownSections, duplicateSections, unknownItems, duplicateItems }`',
  })
  @ApiNotFoundResponse({ description: 'course_not_found' })
  @ApiConflictResponse({ description: 'lesson_has_progress { itemIds } — a lesson that would be deleted has learners’ progress; unpublish it instead (D-R135)' })
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ReplaceCurriculumDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<CurriculumDto> {
    return this.curriculum.replace(id, body, caller, requestContext(req));
  }

  @Put('items/:itemId/content')
  @RequirePermissions(MANAGE_COURSES_PERMISSION)
  @ApiParam({ name: 'itemId', format: 'uuid', description: 'Lesson (syllabus item) id of this course' })
  @ApiOperation({
    summary: 'Replace a lesson’s content (API-228)',
    description:
      'The lesson’s `kind`, its `content` (an object of that kind, or null for no content yet) and its `resources` (`[{ title, url }]`, at most 20) — all three present. ' +
      'https URLs only; YouTube/Vimeo links are stored as their video id; a file video and audio need their length in seconds (D-R131/D-R134). ' +
      'Writes only when something differs, with exactly one event `courses.curriculum.content.changed { code, itemId, kind, previousKind, resources }` ' +
      '(`resources` = their count — never a URL or a text). Requires `courses.manage`.',
  })
  @ApiOkResponse({ type: CurriculumItemDto, description: 'The lesson after the write' })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown kind, content not an object or null, resources not an array) or `content_invalid { problems }`' })
  @ApiNotFoundResponse({ description: 'course_not_found | lesson_not_found { itemId } — the lesson is not one of this course' })
  replaceContent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() body: ReplaceLessonContentDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<CurriculumItemDto> {
    return this.curriculum.replaceContent(id, itemId, body, caller, requestContext(req));
  }
}
