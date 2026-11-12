import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { SEND_NOTIFICATIONS_PERMISSION } from './announcements.audience.js';
import { AnnouncementDetailDto, AnnouncementDto, AnnouncementListDto, CreateAnnouncementDto, ListAnnouncementsQueryDto } from './announcements.dto.js';
import { AnnouncementsService } from './announcements.service.js';

/**
 * MOD-12-T05 — manual announcements (roadmap §4j.4 API-173..175; owner
 * decision D-R85). The three routes need `notifications.send` (the teacher
 * and the academy admin by seed). What a holder may do with it depends on
 * `classes.manage`, which the service checks: without it, announce to the
 * classes they teach and read their own announcements; with it, announce to
 * any class or to the academy by role and read every announcement. The
 * global guards (Origin → Auth → Permissions) run first.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('announcements')
@RequirePermissions(SEND_NOTIFICATIONS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `notifications.send` (and `classes.manage` for an academy audience); origin_forbidden' })
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send an announcement',
    description:
      'Writes a title and a body, as typed, to an audience: `{ kind: "class", classId, students?, guardians?, teachers? }` — the students with an active enrollment in the class, their guardians and/or its teachers, ' +
      'for a class the caller teaches or, with `classes.manage`, any class — or `{ kind: "academy", roleKeys }` — everyone who holds one of the roles `student`, `guardian`, `teacher`, `staff`, which needs `classes.manage` too. ' +
      'Recipients are active accounts, each once, never the sender; at most 5,000. One notification per recipient in the `announcements` category (it appears in «my notifications») and, with `sendEmail`, an e-mail copy ' +
      'for those with a confirmed address who left that category on. One transaction, one audit event `notifications.announcement.sent`. An announcement cannot be edited or withdrawn.',
  })
  @ApiCreatedResponse({ type: AnnouncementDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed (missing or blank title/body, more than 200 / 4,000 characters, `classId` not a UUID, a flag that is not a JSON boolean, an unknown field) | ' +
      'audience_invalid — `{ problems }`: kind_unknown, class_id_required, recipient_group_required, role_keys_not_allowed, class_fields_not_allowed, role_keys_required, role_keys_unknown, role_keys_duplicate',
  })
  @ApiNotFoundResponse({ description: 'class_not_found — `{ classId }`: unknown, or a class the caller neither teaches nor manages' })
  @ApiUnprocessableEntityResponse({ description: 'audience_empty | audience_too_large — `{ recipients, max }`' })
  send(@Body() body: CreateAnnouncementDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<AnnouncementDto> {
    return this.announcements.send(body, caller, requestContext(req));
  }

  @Get()
  @ApiOperation({
    summary: 'List announcements',
    description:
      'The announcements the caller sent — every announcement for a holder of `classes.manage` — newest first, keyset-paginated (`limit` 1–100, `cursor` = `nextCursor` of the previous page), optionally those sent to one class (`classId`). ' +
      'Each item carries the audience, the class, the title and body, the number of recipients and the sender.',
  })
  @ApiOkResponse({ type: AnnouncementListDto })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown parameter, `limit` out of range, malformed `cursor`, `classId` not a UUID)' })
  list(@Query() query: ListAnnouncementsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<AnnouncementListDto> {
    return this.announcements.list(query, caller);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read an announcement',
    description:
      'An announcement the caller sent — any announcement for a holder of `classes.manage` — with how many recipients marked it as read (`readCount`) and its e-mail copies counted by state (`email`). ' +
      'No list of recipients. Another sender’s announcement answers 404 like an unknown one.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AnnouncementDetailDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiNotFoundResponse({ description: 'announcement_not_found — `{ announcementId }`' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<AnnouncementDetailDto> {
    return this.announcements.get(id, caller);
  }
}
