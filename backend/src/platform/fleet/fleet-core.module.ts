import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FleetService } from './fleet.service.js';
import { ACADEMY_MIGRATIONS_DIR, FLEET_SETTINGS, defaultAcademyMigrationsDir, fleetSettingsFrom } from './fleet.settings.js';
import { PROBE_FETCH, ProbeClient, defaultProbeFetch } from './probe.client.js';

/**
 * MOD-18-T05 — the fleet probe without HTTP routes: FleetService and its
 * dependencies. Shared by FleetModule (the API-196..198 routes of the platform
 * API) and PlatformProbeModule (the periodic probe command, src/platform/probe.ts).
 * Needs a global ConfigService and the global PlatformPrismaService.
 */
@Module({
  providers: [
    FleetService,
    ProbeClient,
    { provide: FLEET_SETTINGS, inject: [ConfigService], useFactory: fleetSettingsFrom },
    { provide: PROBE_FETCH, useValue: defaultProbeFetch },
    // The academy migrations this platform build carries (`behind`); e2e suites override it.
    { provide: ACADEMY_MIGRATIONS_DIR, useFactory: defaultAcademyMigrationsDir },
  ],
  exports: [FleetService, FLEET_SETTINGS],
})
export class FleetCoreModule {}
