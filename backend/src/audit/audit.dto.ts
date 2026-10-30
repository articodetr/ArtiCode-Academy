import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import {
  AUDIT_ACTION_PATTERN,
  AUDIT_PAGE_DEFAULT,
  AUDIT_PAGE_MAX,
  ENTITY_ID_MAX_LENGTH,
  ENTITY_TYPE_PATTERN,
  UUID_PATTERN,
} from './audit.query.js';

/** Trims a text parameter; an empty result counts as absent. */
function trimmedParam({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ default: AUDIT_PAGE_DEFAULT, minimum: 1, maximum: AUDIT_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AUDIT_PAGE_MAX)
  limit?: number = AUDIT_PAGE_DEFAULT;

  @ApiPropertyOptional({
    description:
      'Event-name prefix, matched literally and case-sensitively (`users.` = every users event, `users.status.changed` = one event).',
    example: 'users.',
    maxLength: 64,
  })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Matches(AUDIT_ACTION_PATTERN, { message: 'action must be a dotted lower-case event-name prefix such as "users." (1–64 characters)' })
  action?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Events recorded with this user as actor.' })
  @IsOptional()
  @Transform(trimmedParam)
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({
    description: 'Entity table the event is about (`users`, `roles`); required when `entityId` is given.',
    example: 'users',
    maxLength: 64,
  })
  @ValidateIf((query: AuditLogQueryDto) => query.entityType !== undefined || query.entityId !== undefined)
  @Transform(trimmedParam)
  @IsDefined({ message: 'entityType is required when entityId is given' })
  @IsString()
  @Matches(ENTITY_TYPE_PATTERN, { message: 'entityType must be a lower-case table name such as "users" (1–64 characters)' })
  entityType?: string;

  @ApiPropertyOptional({ description: 'Identifier of the entity (together with `entityType`).', maxLength: ENTITY_ID_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Length(1, ENTITY_ID_MAX_LENGTH)
  entityId?: string;

  @ApiPropertyOptional({
    description: 'Return events created strictly before this ISO 8601 timestamp.',
    example: '2026-10-29T15:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({
    description: 'Opaque page cursor: pass the `nextCursor` of the previous page (same filters) to fetch the next, older page.',
  })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Matches(UUID_PATTERN, { message: 'cursor must be a nextCursor value of a previous page' })
  cursor?: string;
}

export class AuditLogItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'auth.login.succeeded' })
  action: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, example: 'users' })
  entityType: string | null;

  @ApiProperty({ nullable: true })
  entityId: string | null;

  @ApiProperty({ nullable: true, description: 'Identifiers and non-sensitive values only' })
  metadata: unknown;

  @ApiProperty({ nullable: true, example: '127.0.0.1' })
  ipAddress: string | null;

  @ApiProperty({ nullable: true })
  userAgent: string | null;

  @ApiProperty({ example: '2026-10-29T15:00:00.000Z' })
  createdAt: string;
}

export class AuditLogListDto {
  @ApiProperty({ type: [AuditLogItemDto], description: 'Newest first (insertion order — the UUIDv7 primary key).' })
  items: AuditLogItemDto[];

  @ApiProperty({
    nullable: true,
    description: 'Pass as `cursor` with the same filters to fetch the next (older) page; null when exhausted.',
  })
  nextCursor: string | null;
}
