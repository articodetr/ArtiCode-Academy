import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import {
  LearningCompleteResultDto,
  LearningItemDto,
  LearningPlaybackResultDto,
  LearningVisitResultDto,
  LearningWorkspaceDto,
  MyLearningListDto,
  SavePlaybackDto,
} from './my-learning.dto.js';
import { MyLearningService } from './my-learning.service.js';

/** 120 learner writes per minute per (IP, user): a visit per lesson, a playback save every ~15 s, the «complete» button. */
const LEARNER_WRITE_LIMIT = { login: { limit: 120, ttl: 60 * 1000 } };

const NOT_ENROLLED = 'not_enrolled — no active or completed enrollment of the caller’s own in a class of the course (`reason: pending` while a request awaits approval; a guardian is refused too)';

/**
 * MOD-20 «My School» — the learner's side (roadmap §4q, API-229..234). No
 * `@RequirePermissions`: every signed-in user may call these routes and only
 * ever reaches their own enrollments (ownership — D-R132) and, on «My School»,
 * the progress of their linked children while they hold the `guardian` role.
 * No route takes a student id. The three writes record no audit event
 * (D-R139) and are rate limited per (IP, user).
 */
@ApiTags('learning')
@ApiBearerAuth()
@Controller('me/learning')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyLearningController {
  constructor(private readonly learning: MyLearningService) {}

  @Get()
  @ApiOperation({
    summary: 'My School — my courses and my children’s',
    description:
      'One item per owned enrollment: the caller’s own `active`/`completed` enrollments (`relation: self`) and, while the caller holds the `guardian` role, those of their linked, not soft-deleted children (`relation: child`, read-only — `action` null, `canLearn` false). ' +
      'Each item carries the class and course, the lead teacher by name, the student’s progress on the course’s published lessons (computed on read; it follows the student across classes of the course), the last opened lesson while still published, the latest activity and the next step (`start`/`continue`/`review`). ' +
      '`self` first, then the latest activity, then the newest enrollment; at most 200; no pagination. No permission key; no audit event.',
  })
  @ApiOkResponse({ type: MyLearningListDto })
  list(@CurrentUser() caller: AuthPrincipal): Promise<MyLearningListDto> {
    return this.learning.list(caller);
  }

  @Get('courses/:courseId')
  @ApiParam({ name: 'courseId', format: 'uuid' })
  @ApiOperation({
    summary: 'The learning workspace of a course',
    description:
      'The course’s levels with their published lessons in learning order (a level without a published lesson is not shown; lessons outside every level come last), the caller’s state on each, the progress per level and for the course, and where «continue learning» opens (`last`, `replaced` when that lesson was unpublished, `first`). ' +
      'Every level is open (no prerequisite). Needs an own `active` or `completed` enrollment in a class of the course (the active one first, then the newest). Read-only.',
  })
  @ApiOkResponse({ type: LearningWorkspaceDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`courseId` is not a uuid)' })
  @ApiForbiddenResponse({ description: NOT_ENROLLED })
  @ApiNotFoundResponse({ description: 'learning_course_not_found' })
  workspace(@Param('courseId', new ParseUUIDPipe()) courseId: string, @CurrentUser() caller: AuthPrincipal): Promise<LearningWorkspaceDto> {
    return this.learning.workspace(courseId, caller);
  }

  @Get('items/:itemId')
  @ApiParam({ name: 'itemId', format: 'uuid', description: 'A curriculum lesson (a syllabus item)' })
  @ApiOperation({
    summary: 'One lesson of a course I learn',
    description:
      'The lesson’s content and resources, how it completes (`manual`, `playback` at the academy threshold, `attendance` for a live lesson), the caller’s own progress, the previous and next lessons across level boundaries, ' +
      'the sessions (MOD-06 lessons) of the caller’s own classes that cover it — with the caller’s own attendance and no meeting link for a cancelled one — and the non-draft assignments and scheduled/published exams linked to those sessions. ' +
      'An unknown or unpublished lesson is 404; then the access rule of the workspace. Read-only: opening is recorded by the visit route.',
  })
  @ApiOkResponse({ type: LearningItemDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`itemId` is not a uuid)' })
  @ApiForbiddenResponse({ description: NOT_ENROLLED })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  item(@Param('itemId', new ParseUUIDPipe()) itemId: string, @CurrentUser() caller: AuthPrincipal): Promise<LearningItemDto> {
    return this.learning.item(itemId, caller);
  }

  @Post('items/:itemId/visit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle(LEARNER_WRITE_LIMIT)
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOperation({
    summary: 'Record that I opened a lesson',
    description:
      'A first opening starts the lesson (`in_progress`); a later one only moves its last opening — the resume point of «continue learning». Opening never completes a lesson and a completed lesson stays completed. Idempotent. No audit event (D-R139).',
  })
  @ApiOkResponse({ type: LearningVisitResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`itemId` is not a uuid)' })
  @ApiForbiddenResponse({ description: `${NOT_ENROLLED}; origin_forbidden` })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  visit(@Param('itemId', new ParseUUIDPipe()) itemId: string, @CurrentUser() caller: AuthPrincipal): Promise<LearningVisitResultDto> {
    return this.learning.visit(itemId, caller);
  }

  @Put('items/:itemId/playback')
  @UseGuards(AuthThrottlerGuard)
  @Throttle(LEARNER_WRITE_LIMIT)
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOperation({
    summary: 'Save the playback of a lesson’s medium',
    description:
      'For a lesson that completes by playback (a `file` video, audio): the intervals actually played since the previous save and the current position. Coverage is the union of every played interval, never the furthest point, so seeking ahead credits nothing; ' +
      'the new seconds one save may add are capped by the server clock (twice the time since the later of the previous save and the last opening, plus 10 s — `capped: true` when the claim was trimmed). ' +
      'Once the coverage reaches the academy threshold of the authored length the lesson is completed (`completedNow: true`, once). No audit event (D-R139).',
  })
  @ApiOkResponse({ type: LearningPlaybackResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`positionSeconds` 0..86400, `ranges` at most 50 pairs of numbers 0..86400 — raw JSON numbers)' })
  @ApiForbiddenResponse({ description: `${NOT_ENROLLED}; origin_forbidden` })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  @ApiConflictResponse({ description: 'playback_not_tracked — the lesson has no measurable medium' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  playback(@Param('itemId', new ParseUUIDPipe()) itemId: string, @Body() body: SavePlaybackDto, @CurrentUser() caller: AuthPrincipal): Promise<LearningPlaybackResultDto> {
    return this.learning.playback(itemId, body, caller);
  }

  @Post('items/:itemId/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle(LEARNER_WRITE_LIMIT)
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOperation({
    summary: 'Mark a lesson as complete',
    description:
      'For a lesson that completes by the explicit action (text, PDF, image, file, an embedded YouTube/Vimeo video, a lesson without content). Completing twice writes nothing the second time (`completedNow: false`); a completion never reverts. ' +
      'Answers the lesson’s progress, its level’s and the course’s. No audit event (D-R139).',
  })
  @ApiOkResponse({ type: LearningCompleteResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`itemId` is not a uuid)' })
  @ApiForbiddenResponse({ description: `${NOT_ENROLLED}; origin_forbidden` })
  @ApiNotFoundResponse({ description: 'lesson_not_found' })
  @ApiConflictResponse({ description: 'completion_by_playback { thresholdPercent } — the medium completes it | completion_by_attendance — a live lesson completes by attending a session' })
  @ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited' })
  complete(@Param('itemId', new ParseUUIDPipe()) itemId: string, @CurrentUser() caller: AuthPrincipal): Promise<LearningCompleteResultDto> {
    return this.learning.complete(itemId, caller);
  }
}
