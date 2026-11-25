import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
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
import { EnrollmentRequestsService } from '../enrollments/enrollment-requests.service.js';
import { MyEnrollmentRequestDto, MyEnrollmentRequestListDto } from '../enrollments/enrollment-requests.dto.js';
import { CatalogCourseDetailDto, CatalogEnrollResultDto, CatalogListDto, ListCatalogQueryDto } from './catalog.dto.js';
import { SELF_ENROLL_PERMISSION } from './catalog.policy.js';
import { CatalogService } from './catalog.service.js';

const READ_COURSES = 'courses.read';

/**
 * MOD-19 (roadmap §4p) — «explore courses»: API-219 (list) and API-220
 * (details) with `courses.read`, API-221 (enroll oneself) with
 * `enrollments.self_enroll`. The global guards (Origin → Auth → Permissions)
 * run first; ownership and the `student` role are checked in the service.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('courses')
  @RequirePermissions(READ_COURSES)
  @ApiOperation({
    summary: 'Explore the published courses (API-219)',
    description:
      'Published courses only, whatever the caller’s other keys (D-R129), by code, keyset-paginated (`limit` 1–100, default 24). Filters `q` (code or Arabic/English name, ' +
      'literal), `levelId`, `subjectId` (PORTAL-04), `pricing` free|paid, `available` true|false (a class takes a self-service enrollment now). Each card: cover, level, ' +
      'the school subject (id and name), duration, sessions, syllabus ' +
      'count, the price (the course plan total in the academy currency — D-R122), the classes open to self-service and how many have a free seat, the lead teachers by name, ' +
      'and whether the caller is enrolled or has a pending request.',
  })
  @ApiOkResponse({ type: CatalogListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `courses.read`' })
  list(@Query() query: ListCatalogQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<CatalogListDto> {
    return this.catalog.list(query, caller);
  }

  @Get('courses/:id')
  @RequirePermissions(READ_COURSES)
  @ApiOperation({
    summary: 'Read one published course of the catalog (API-220)',
    description:
      'The card plus the description, the age range and the syllabus (titles and estimates only — lessons, assignments, exams and materials stay behind an active enrollment). ' +
      '`classes` = the classes open to self-service now and every class holding the caller’s own enrollment or pending request: dates, capacity, seats left, the lead teacher ' +
      'by name, the weekly slots effective today or later (each in its room’s branch zone, else the academy’s), and whether API-221 would accept the caller (`enrollable`, ' +
      '`blocker`). `selfService` says whether the caller may enroll themself at all (`enrollments.self_enroll` and the `student` role — D-R124).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The course' })
  @ApiOkResponse({ type: CatalogCourseDetailDto })
  @ApiNotFoundResponse({ description: 'course_not_found — no published course with this id' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `courses.read`' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<CatalogCourseDetailDto> {
    return this.catalog.get(id, caller);
  }

  @Post('classes/:id/enroll')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SELF_ENROLL_PERMISSION)
  @ApiOperation({
    summary: 'Enroll oneself in a class (API-221)',
    description:
      'No body. A free course: the enrollment is `active` at once (`source: self`, one `enrollments.created`, the notification `enrollment.activated`). A paid course: a `pending` ' +
      'request with an invoice issued from the course plan (one `enrollments.requested`; the student and guardians get `enrollment.requested`, the holders of ' +
      '`enrollments.manage` get `enrollment.request_received`); the office records the payment (API-151) and approves it (API-059) — neither alone activates it (D-R125). ' +
      'Refused in this order: a class not opened to self-service or of an unpublished course 404; no `student` role 422 not_a_student; a pending request 409 request_pending; ' +
      'an enrollment 409 already_enrolled (a rejected or withdrawn request is reopened); 409 class_not_enrollable; 409 class_full; 409 course_price_unavailable.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The class' })
  @ApiCreatedResponse({ type: CatalogEnrollResultDto })
  @ApiNotFoundResponse({ description: 'class_not_found — no class open to self-service with this id' })
  @ApiUnprocessableEntityResponse({ description: 'not_a_student — the caller does not hold the `student` role' })
  @ApiConflictResponse({ description: 'request_pending | already_enrolled | class_not_enrollable | class_full | course_price_unavailable' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `enrollments.self_enroll`; origin_forbidden' })
  enroll(@Param('id', new ParseUUIDPipe()) classId: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<CatalogEnrollResultDto> {
    return this.catalog.enroll(classId, caller, requestContext(req));
  }
}

/**
 * MOD-19 — the student's own requests (API-222/223): ownership, no key — a
 * request is the caller's own enrollment with a `requested_at`; someone
 * else's is 404.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('me/enrollment-requests')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyEnrollmentRequestsController {
  constructor(private readonly requests: EnrollmentRequestsService) {}

  @Get()
  @ApiOperation({
    summary: 'My enrollment requests (API-222)',
    description:
      'The caller’s own requested enrollments, newest first (at most 200, no pagination): the state (pending_payment, pending_approval, enrolled, completed, withdrawn, ' +
      'rejected, cancelled), the class and course, the invoices with what is paid and due, and the rejection reason. Never the reviewer.',
  })
  @ApiOkResponse({ type: MyEnrollmentRequestListDto })
  mine(@CurrentUser() caller: AuthPrincipal): Promise<MyEnrollmentRequestListDto> {
    return this.requests.mine(caller);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel my pending request (API-223)',
    description:
      'pending → cancelled; the unpaid issued invoices of the request are cancelled with it; one `enrollments.status.changed { action: cancel_request }`. ' +
      'A request with a completed payment is 409 request_has_payments (the office refunds first); one no longer pending is 409 invalid_transition.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The enrollment' })
  @ApiOkResponse({ type: MyEnrollmentRequestDto })
  @ApiNotFoundResponse({ description: 'request_not_found — not the caller’s own request' })
  @ApiConflictResponse({ description: 'invalid_transition | request_has_payments' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'origin_forbidden' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<MyEnrollmentRequestDto> {
    return this.requests.cancelOwn(id, caller, requestContext(req));
  }
}
