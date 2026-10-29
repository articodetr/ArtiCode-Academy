import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NODE_ENVS } from '../config/env.schema.js';

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

export class ReadinessChecksDto {
  @ApiProperty({ type: DatabaseCheckDto })
  database: DatabaseCheckDto;
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ready', 'not_ready'], example: 'ready' })
  status: 'ready' | 'not_ready';

  @ApiProperty({ type: ReadinessChecksDto })
  checks: ReadinessChecksDto;

  @ApiProperty({ example: '2026-10-29T12:00:00.000Z' })
  timestamp: string;
}
