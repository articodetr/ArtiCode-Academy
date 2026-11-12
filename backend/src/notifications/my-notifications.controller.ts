import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import {
  ListMyNotificationsQueryDto,
  MyNotificationDto,
  MyNotificationListDto,
  NotificationPreferencesDto,
  ReadAllNotificationsDto,
  ReadAllResultDto,
  UnreadCountDto,
  UpdateNotificationPreferencesDto,
} from './my-notifications.dto.js';
import { MyNotificationsService } from './my-notifications.service.js';

/**
 * MOD-12-T02 — the caller's notifications and e-mail preferences (roadmap
 * §4j.4 API-167..172). No `@RequirePermissions`: every signed-in user may
 * call these routes and reaches their own notifications and switches only
 * (ownership — D-R86). None of them records an audit event.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyNotificationsController {
  constructor(private readonly myNotifications: MyNotificationsService) {}

  @Get('notifications')
  @ApiOperation({
    summary: 'List my notifications',
    description:
      'The caller’s own notifications, newest first, keyset-paginated (`limit` 1–100, `cursor` = `nextCursor` of the previous page), with the filters `unread` and `category`. ' +
      'Each item carries the event key, the category, the title and body worded in the recipient’s language when it was created, `data` (the frontend path `link` and ids), ' +
      'the student it is about (the caller or their child), the announcement id and `readAt` — never the state of its e-mail copy or an address. No permission key is needed (ownership).',
  })
  @ApiOkResponse({ type: MyNotificationListDto })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown parameter, `limit` out of range, malformed `cursor`, unknown `category`, `unread` not a boolean)' })
  list(@Query() query: ListMyNotificationsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyNotificationListDto> {
    return this.myNotifications.list(query, caller);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Count my unread notifications', description: 'The number the header bell shows; the frontend asks for it every 60 seconds while the page is visible.' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() caller: AuthPrincipal): Promise<UnreadCountDto> {
    return this.myNotifications.unreadCount(caller);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all my notifications as read',
    description: 'Marks every unread notification of the caller as read — or only those of one `category`. Answers how many were marked; no audit event.',
  })
  @ApiOkResponse({ type: ReadAllResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed (unknown field or category)' })
  markAllRead(@Body() body: ReadAllNotificationsDto, @CurrentUser() caller: AuthPrincipal): Promise<ReadAllResultDto> {
    return this.myNotifications.markAllRead(body, caller);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark one of my notifications as read',
    description: 'Sets `readAt` once; repeating the call changes nothing and answers the same notification. A notification of another user answers `404` like an unknown one. No audit event.',
  })
  @ApiOkResponse({ type: MyNotificationDto })
  @ApiBadRequestResponse({ description: '`id` is not a UUID' })
  @ApiNotFoundResponse({ description: 'notification_not_found' })
  markRead(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal): Promise<MyNotificationDto> {
    return this.myNotifications.markRead(id, caller);
  }

  @Get('notification-preferences')
  @ApiOperation({
    summary: 'Read my e-mail preferences for notifications',
    description:
      'The six categories with `emailEnabled` (true until switched off), plus `emailVerified` (the caller confirmed an address — nothing is e-mailed without it) and `emailAvailable` (the academy has a mail transport). ' +
      'Notifications inside the app are always on.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  preferences(@CurrentUser() caller: AuthPrincipal): Promise<NotificationPreferencesDto> {
    return this.myNotifications.preferences(caller);
  }

  @Put('notification-preferences')
  @ApiOperation({
    summary: 'Change my e-mail preferences for notifications',
    description: 'Replaces the switch of each category named in `categories` and leaves the others as they are; answers the six categories. A personal preference: no audit event.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  @ApiBadRequestResponse({ description: 'nothing_to_update (no category named) | validation failed (unknown category, a category twice, `emailEnabled` not a JSON boolean, unknown field)' })
  updatePreferences(@Body() body: UpdateNotificationPreferencesDto, @CurrentUser() caller: AuthPrincipal): Promise<NotificationPreferencesDto> {
    return this.myNotifications.updatePreferences(body, caller);
  }
}
