// MOD-18-T05 — DTOs of the fleet routes (API-196..198).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { LocalizedText } from '../../authorization/localized-text.js';
import { PROBE_OUTCOMES, PROBE_REASONS } from './probe.rules.js';
import type { ProbeOutcomeValue } from './probe.rules.js';

export const HEALTH_CHECKS_PAGE_DEFAULT = 20;
export const HEALTH_CHECKS_PAGE_MAX = 100;

export class ListHealthChecksQueryDto {
  @ApiPropertyOptional({ default: HEALTH_CHECKS_PAGE_DEFAULT, minimum: 1, maximum: HEALTH_CHECKS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HEALTH_CHECKS_PAGE_MAX)
  limit?: number = HEALTH_CHECKS_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque page cursor: the `nextCursor` of the previous page, for the next, older page.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class HealthCheckUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Platform Support' })
  fullName: string;
}

/** One probe of an academy (a row of `academy_health_checks`). */
export class HealthCheckDto {
  @ApiProperty({ format: 'uuid', description: 'UUIDv7 — newer checks have greater ids' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  academyId: string;

  @ApiProperty({ description: 'ISO 8601 — when the row was written' })
  checkedAt: string;

  @ApiProperty({
    enum: PROBE_OUTCOMES,
    description:
      'ready = readiness answered 200 `ready`; not_ready = readiness answered 503 `not_ready` (`reason` is the academy’s); unreachable = no HTTP answer (timeout, refused, DNS, TLS) or a gateway error in front of the API (502/504, or a 503 that is not a readiness answer); invalid = an answer that is not an academy’s (a redirect — never followed —, over 64 KB, not JSON, an unexpected status or shape, another service) or an origin the SSRF guard refuses',
  })
  outcome: ProbeOutcomeValue;

  @ApiProperty({ type: Number, nullable: true, example: 200, description: 'Status of the deciding answer; null without an HTTP answer' })
  httpStatus: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 42, description: 'Round trip of the deciding request in ms; null without an HTTP answer' })
  latencyMs: number | null;

  @ApiProperty({ type: String, nullable: true, example: '0.0.1', description: '`version` of the academy’s liveness answer' })
  apiVersion: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'production', description: '`environment` of the academy’s liveness answer' })
  environment: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'current', description: '`checks.schema.status` of the academy’s readiness answer' })
  schemaStatus: string | null;

  @ApiProperty({ type: String, nullable: true, example: '20261112083749_mod12_notifications', description: '`checks.schema.expected` (the academy build’s newest migration)' })
  schemaExpected: string | null;

  @ApiProperty({ type: String, nullable: true, example: '20261112083749_mod12_notifications', description: '`checks.schema.applied` (the academy database’s newest applied migration)' })
  schemaApplied: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'schema_outdated',
    description: `null when ready; for not_ready the academy’s own reason (database_unavailable, schema_outdated, schema_unverified, …); otherwise the probe’s: ${PROBE_REASONS.join(', ')}`,
  })
  reason: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'A short human detail (≤ 500 characters, URL credentials masked); null when ready' })
  error: string | null;

  @ApiProperty({ type: HealthCheckUserDto, nullable: true, description: 'The platform user who asked for it; null for the periodic probe' })
  triggeredBy: HealthCheckUserDto | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'True when `schemaApplied` is older than the newest academy migration this platform build carries (the academy runs an older release); null when either is unknown',
  })
  behind: boolean | null;
}

export class HealthCheckListDto {
  @ApiProperty({ type: [HealthCheckDto], description: 'Newest first' })
  items: HealthCheckDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next, older page; null on the last page' })
  nextCursor: string | null;
}

export class FleetAcademyDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'demo' })
  slug: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ enum: ['provisioning', 'active', 'suspended'], description: 'Never `archived` here' })
  status: string;

  @ApiProperty({ type: String, nullable: true, example: 'https://demo.example.com' })
  origin: string | null;
}

export class FleetItemDto {
  @ApiProperty({ type: FleetAcademyDto })
  academy: FleetAcademyDto;

  @ApiProperty({ type: HealthCheckDto, nullable: true, description: 'The newest check; null when never probed' })
  latest: HealthCheckDto | null;

  @ApiProperty({ type: Boolean, nullable: true, description: '`behind` of the newest check; null when unknown' })
  behind: boolean | null;

  @ApiProperty({ description: 'True without a check in the last `staleAfterSeconds` (never probed included)' })
  stale: boolean;
}

export class FleetCountsDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  ready: number;

  @ApiProperty()
  notReady: number;

  @ApiProperty()
  unreachable: number;

  @ApiProperty()
  invalid: number;

  @ApiProperty({ description: 'Never probed — with the four outcome counts it partitions `total`' })
  never: number;

  @ApiProperty({ description: 'Items whose `behind` is true' })
  behind: number;
}

export class FleetDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '20261112083749_mod12_notifications',
    description: 'Newest academy migration this platform build carries (`prisma/migrations`); null when none is found',
  })
  newestAcademyMigration: string | null;

  @ApiProperty({ example: 900, description: '3 × PLATFORM_PROBE_INTERVAL_SECONDS — older checks make an item `stale`' })
  staleAfterSeconds: number;

  @ApiProperty({ description: 'ISO 8601 — when this view was computed' })
  generatedAt: string;

  @ApiProperty({ type: FleetCountsDto })
  counts: FleetCountsDto;

  @ApiProperty({ type: [FleetItemDto], description: 'Every academy that is not archived, by slug' })
  items: FleetItemDto[];
}
