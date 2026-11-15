import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NODE_ENVS } from '../config/env.schema.js';
import { DATABASE_ERROR_CODES, SCHEMA_ERROR_CODES } from './readiness-errors.js';
import type { DatabaseErrorCode, SchemaErrorCode } from './readiness-errors.js';
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
    enum: DATABASE_ERROR_CODES,
    example: 'database_unreachable',
    description:
      'Why the database is down (when down): database_timeout = no answer within 5 s; database_unreachable = the connection or `SELECT 1` failed. A fixed code — the driver message goes to the server log only (KI-084)',
  })
  error?: DatabaseErrorCode;
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
    enum: SCHEMA_ERROR_CODES,
    example: 'migrations_unreadable',
    description:
      'Why `_prisma_migrations` could not be read (when error): migrations_timeout = no answer within 5 s; migrations_unreadable = the query failed. A fixed code — the driver message goes to the server log only (KI-084)',
  })
  error?: SchemaErrorCode;
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
