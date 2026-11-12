import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { NotificationCategory } from '../generated/prisma/client.js';
import { NOTIFICATION_CATEGORIES } from './notifications.events.js';

export const MY_NOTIFICATIONS_PAGE_DEFAULT = 20;
export const MY_NOTIFICATIONS_PAGE_MAX = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = [...NOTIFICATION_CATEGORIES];

/** Query booleans: `"true"`/`"1"` and `"false"`/`"0"`; anything else is left for @IsBoolean to reject (no implicit `Boolean("false")`). */
function booleanParam({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

/** Body booleans are the raw JSON value: the global implicit conversion must not turn `"no"` into `true` (KI-039). */
function rawBoolean({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

function trimmedParam({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// ---------------------------------------------------------------------------
// «My notifications» — API-167..API-170
// ---------------------------------------------------------------------------

/** Filters of the caller's inbox; keyset pagination on the id, newest first. */
export class ListMyNotificationsQueryDto {
  @ApiPropertyOptional({ default: MY_NOTIFICATIONS_PAGE_DEFAULT, minimum: 1, maximum: MY_NOTIFICATIONS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MY_NOTIFICATIONS_PAGE_MAX)
  limit?: number = MY_NOTIFICATIONS_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque page cursor: pass the `nextCursor` of the previous page (same filters) to fetch the next, older page.' })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Matches(UUID_PATTERN, { message: 'cursor must be a nextCursor value of a previous page' })
  cursor?: string;

  @ApiPropertyOptional({ description: 'true: only the notifications not read yet; false or absent: all of them' })
  @IsOptional()
  @Transform(booleanParam)
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ enum: CATEGORIES, description: 'Notifications of this category only' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: NotificationCategory;
}

export class NotificationStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
}

export class MyNotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'assignment.published', description: 'The event: a lower-case dotted key (`lesson.cancelled`, `submission.graded`, `invoice.issued`, `announcement` …)' })
  eventKey: string;

  @ApiProperty({ enum: CATEGORIES })
  category: NotificationCategory;

  @ApiProperty({ description: 'Worded once, in the recipient’s language at the time the notification was created' })
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    example: { link: '/my-assignments', assignmentId: '019a0000-0000-7000-8000-000000000001', classId: '019a0000-0000-7000-8000-000000000002' },
    description: 'The frontend path to open (`link`) and the ids of the event — never a name, a score or an amount',
  })
  data: Record<string, unknown>;

  @ApiProperty({
    type: NotificationStudentDto,
    nullable: true,
    description: 'The student the notification is about — the caller themself or their child; null for an announcement and for a class event about several children (the body names them)',
  })
  student: NotificationStudentDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Set for a manual announcement' })
  announcementId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — when the caller marked it as read; null while unread' })
  readAt: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;
}

export class MyNotificationListDto {
  @ApiProperty({ type: [MyNotificationDto] })
  items: MyNotificationDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next, older page; null on the last page' })
  nextCursor: string | null;
}

export class UnreadCountDto {
  @ApiProperty({ minimum: 0, description: 'The caller’s notifications not read yet' })
  unread: number;
}

/** Optional body of `POST /api/me/notifications/read-all` (a client may send none). */
export class ReadAllNotificationsDto {
  @ApiPropertyOptional({ enum: CATEGORIES, description: 'Mark only this category as read; absent = every category' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: NotificationCategory;
}

export class ReadAllResultDto {
  @ApiProperty({ minimum: 0, description: 'Notifications this call marked as read (0 when nothing was unread)' })
  updated: number;
}

// ---------------------------------------------------------------------------
// E-mail preferences — API-171/API-172
// ---------------------------------------------------------------------------

export class NotificationPreferenceDto {
  @ApiProperty({ enum: CATEGORIES })
  category: NotificationCategory;

  @ApiProperty({ description: 'Whether notifications of this category are also e-mailed; true until the user switches it off' })
  emailEnabled: boolean;
}

export class NotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceDto], description: 'The six categories, always all of them, in a fixed order' })
  categories: NotificationPreferenceDto[];

  @ApiProperty({ description: 'The caller has an e-mail address they confirmed; without it nothing is e-mailed whatever the switches say' })
  emailVerified: boolean;

  @ApiProperty({ description: 'The academy sends e-mail at all (a mail transport is configured)' })
  emailAvailable: boolean;
}

export class NotificationPreferenceInputDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category: NotificationCategory;

  @ApiProperty({ description: 'A JSON boolean' })
  @Transform(rawBoolean)
  @IsBoolean()
  emailEnabled: boolean;
}

/** `PUT /api/me/notification-preferences` (API-172): replaces the switch of each named category and leaves the others alone. */
export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: [NotificationPreferenceInputDto],
    minItems: 1,
    maxItems: CATEGORIES.length,
    description: 'One entry per category to change, no category twice; a missing or empty list is refused (`nothing_to_update`)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CATEGORIES.length)
  @ArrayUnique((entry: NotificationPreferenceInputDto) => entry?.category, { message: 'categories must not repeat a category' })
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceInputDto)
  categories?: NotificationPreferenceInputDto[];
}
