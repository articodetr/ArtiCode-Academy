// MOD-18-T05 — what the fleet probe reads from the environment, behind one
// injection token so the e2e suites can shorten the timeout, and the folder of
// the ACADEMY migrations this platform build carries (`behind`, D-R103).
import { ConfigService } from '@nestjs/config';
import { defaultMigrationsDir } from '../../health/schema-version.js';
import type { PlatformEnv } from '../platform.env.schema.js';

/** The variables of platform.env.schema.ts the probe needs — the CLI validates only these (probe.cli.ts). */
export type FleetEnv = Pick<PlatformEnv, 'NODE_ENV' | 'PLATFORM_PROBE_TIMEOUT_MS' | 'PLATFORM_PROBE_INTERVAL_SECONDS'>;

export interface FleetSettings {
  /** Upper bound of ONE request to an academy (PLATFORM_PROBE_TIMEOUT_MS). */
  probeTimeoutMs: number;
  /** Pause between two rounds of the periodic probe (PLATFORM_PROBE_INTERVAL_SECONDS). */
  probeIntervalSeconds: number;
  /** NODE_ENV=production: `http://localhost` origins are refused too. */
  production: boolean;
}

/** Injection token of FleetSettings (tests override it). */
export const FLEET_SETTINGS = Symbol('FLEET_SETTINGS');

export function fleetSettingsFrom(config: ConfigService<FleetEnv, true>): FleetSettings {
  return {
    probeTimeoutMs: config.get('PLATFORM_PROBE_TIMEOUT_MS', { infer: true }),
    probeIntervalSeconds: config.get('PLATFORM_PROBE_INTERVAL_SECONDS', { infer: true }),
    production: config.get('NODE_ENV', { infer: true }) === 'production',
  };
}

/** An academy is `stale` without a check in the last three probe intervals (API-198). */
export const STALE_AFTER_INTERVALS = 3;

/** Health checks kept per academy: after each insert the older rows are deleted. */
export const HEALTH_CHECKS_KEPT_PER_ACADEMY = 500;

/**
 * Injection token of the ACADEMY migrations folder the platform build carries
 * (`<cwd>/prisma/migrations` — the same folder the academy API's readiness
 * reads). Its newest migration is what `behind` compares an academy's applied
 * schema with. Tests point it elsewhere.
 */
export const ACADEMY_MIGRATIONS_DIR = Symbol('ACADEMY_MIGRATIONS_DIR');

export { defaultMigrationsDir as defaultAcademyMigrationsDir };
