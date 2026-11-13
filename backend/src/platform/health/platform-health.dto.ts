import { ApiProperty } from '@nestjs/swagger';
import { HealthResponseDto, ReadinessResponseDto } from '../../health/health.dto.js';

/** Identifier reported by the platform's liveness endpoint (API-176). */
export const PLATFORM_SERVICE_NAME = 'articode-platform-api';

/** API-176 — the academy API-003 shape, with the platform's service name. */
export class PlatformHealthResponseDto extends HealthResponseDto {
  // The initializer only satisfies TS2612 (a redeclared base field); the DTO is never instantiated.
  @ApiProperty({ example: PLATFORM_SERVICE_NAME })
  override service: string = PLATFORM_SERVICE_NAME;
}

/**
 * API-177 — the academy API-004 shape: `checks.database` is the platform
 * database, `checks.schema` compares the newest migration shipped under
 * `prisma/platform/migrations` with the platform's `_prisma_migrations`.
 */
export class PlatformReadinessResponseDto extends ReadinessResponseDto {}
