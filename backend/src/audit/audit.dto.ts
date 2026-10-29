import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AuditLogQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Return events created strictly before this ISO 8601 timestamp (cursor).',
    example: '2026-10-29T15:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;
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
  @ApiProperty({ type: [AuditLogItemDto] })
  items: AuditLogItemDto[];

  @ApiProperty({
    nullable: true,
    description: 'Pass as `before` to fetch the next (older) page; null when exhausted.',
  })
  nextBefore: string | null;
}
