import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NODE_ENVS } from '../config/env.schema.js';
import { READINESS_REASONS, SCHEMA_STATUSES } from './schema-version.js';
import type { ReadinessReason, SchemaStatus } from './schema-version.js';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok'] })
  status: 'ok';

  @ApiProperty({ example: 'articode-academy-api' })
  service: string;

  @ApiProperty({
    example: '0.0.1',
    description: 'Version field of backend/package.json',
  })
  version: string;

  @ApiProperty({ example: 'development', enum: NODE_ENVS })
  environment: string;

  @ApiProperty({
    example: '2026-10-29T12:00:00.000Z',
    description: 'Server time in ISO 8601 (UTC)',
  })
  timestamp: string;

  @ApiProperty({
    example: 42,
    description: 'Seconds since the process started',
  })
  uptimeSeconds: number;
}

export const DATABASE_STATUSES = ['up', 'down', 'not_configured'] as const;
export type DatabaseStatus = (typeof DATABASE_STATUSES)[number];

export class DatabaseCheckDto {
  @ApiProperty({ enum: DATABASE_STATUSES, example: 'up' })
  status: DatabaseStatus;

  @ApiPropertyOptional({
    example: 3,
    description: 'Round-trip time of `SELECT 1` in milliseconds (when up)',
  })
  latencyMs?: number;

  @ApiPropertyOptional({
    example: 'connect ECONNREFUSED 127.0.0.1:5432',
    description: 'Driver error message (when down)',
  })
  error?: string;
}

export class SchemaCheckDto {
  @ApiProperty({
    enum: SCHEMA_STATUSES,
    example: 'current',
    description:
      'current = the newest shipped migration is the newest applied one; ahead = it is applied and a newer one too (an older build during an upgrade — still ready); outdated = it is not applied (or `_prisma_migrations` does not exist yet) — not ready; unchecked = no shipped migration found or the database is not up (nothing is read); error = `_prisma_migrations` could not be read — not ready',
  })
  status: SchemaStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '20261112083749_mod12_notifications',
    description:
      'Newest migration folder shipped with this build (`prisma/migrations`, a `YYYYMMDDhhmmss_name` folder holding `migration.sql`); null when none is found',
  })
  expected: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '20261112083749_mod12_notifications',
    description:
      'Newest finished, not rolled-back migration of `_prisma_migrations`; null when there is none, the table does not exist, or the database was not read',
  })
  applied: string | null;

  @ApiPropertyOptional({
    example: 'permission denied for table _prisma_migrations',
    description: 'Driver error message (when error)',
  })
  error?: string;
}

export class ReadinessChecksDto {
  @ApiProperty({ type: DatabaseCheckDto })
  database: DatabaseCheckDto;

  @ApiProperty({ type: SchemaCheckDto })
  schema: SchemaCheckDto;
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ready', 'not_ready'], example: 'ready' })
  status: 'ready' | 'not_ready';

  @ApiPropertyOptional({
    enum: READINESS_REASONS,
    example: 'schema_outdated',
    description:
      'Only when not ready: database_unavailable (the database is down or not configured), schema_outdated (the newest shipped migration is not applied), schema_unverified (`_prisma_migrations` could not be read)',
  })
  reason?: ReadinessReason;

  @ApiProperty({ type: ReadinessChecksDto })
  checks: ReadinessChecksDto;

  @ApiProperty({ example: '2026-10-29T12:00:00.000Z' })
  timestamp: string;
}
