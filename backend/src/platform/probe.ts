// MOD-18-T05 (D-R103) — the periodic fleet probe of the platform:
//
//   node dist/platform/probe.js            (the `probe` service of the platform compose project — T06)
//   node dist/platform/probe.js --once     (one round, then exit)
//   npm run start:platform:probe           (= the first line, after `npm run build`)
//
// Each round probes every academy of the registry that is not archived and has
// an origin (GET <origin>/api/health and /api/health/ready, one after the
// other), records one `academy_health_checks` row per academy and prints ONE
// JSON line on stdout:
//   {"event":"platform.probe.round","probed":n,"ready":…,"notReady":…,"unreachable":…,"invalid":…,"behind":…,"failed":…,"durationMs":…}
// then sleeps PLATFORM_PROBE_INTERVAL_SECONDS. Any error is one line on stderr:
// with --once the exit code is 1, otherwise the loop goes on. SIGTERM / SIGINT
// end the loop after the running round (exit 0).
//
// A Nest application CONTEXT of PlatformProbeModule — no HTTP server, no
// PlatformAppModule. Connects as the platform APPLICATION role:
// PLATFORM_DATABASE_URL, else derived from PLATFORM_DB_APP_* like the platform
// API. Outside production the env files of src/config/env-files.ts are read too;
// PLATFORM_JWT_SECRET is never needed. No audit event (the snapshots are the record).
import { NestFactory } from '@nestjs/core';
import { ENV_FILE_PATHS } from '../config/env-files.js';
import { environmentWithFiles } from '../maintenance/maintenance.cli.js';
import { FleetService } from './fleet/fleet.service.js';
import { FLEET_SETTINGS } from './fleet/fleet.settings.js';
import type { FleetSettings } from './fleet/fleet.settings.js';
import { PlatformProbeModule } from './fleet/platform-probe.module.js';
import { PROBE_USAGE, parseProbeArgs, probeErrorLine, readProbeEnv, runProbeLoop, secretsOf } from './fleet/probe.cli.js';

const secrets: string[] = [];

async function run(): Promise<number> {
  const args = parseProbeArgs(process.argv.slice(2));
  if (args.help) {
    console.log(PROBE_USAGE);
    return 0;
  }

  const raw =
    process.env['NODE_ENV'] === 'production'
      ? { ...process.env }
      : environmentWithFiles(process.env, ENV_FILE_PATHS);
  if (raw['PLATFORM_DB_APP_PASSWORD']) secrets.push(raw['PLATFORM_DB_APP_PASSWORD']);
  const env = readProbeEnv(raw);
  secrets.push(...secretsOf(env));

  // logger: false — the command's only output is its own lines; abortOnError:
  // false — a failed start is thrown to the catch below instead of aborting.
  const app = await NestFactory.createApplicationContext(PlatformProbeModule.withEnv(env), {
    logger: false,
    abortOnError: false,
  });
  const stop = new AbortController();
  const onSignal = () => stop.abort();
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  try {
    const fleet = app.get(FleetService);
    const settings = app.get<FleetSettings>(FLEET_SETTINGS);
    return await runProbeLoop({
      once: args.once,
      intervalMs: settings.probeIntervalSeconds * 1000,
      round: () => fleet.probeAll(),
      write: (line) => process.stdout.write(`${line}\n`),
      writeError: (line) => process.stderr.write(`${line}\n`),
      secrets,
      signal: stop.signal,
    });
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    // A failed disconnect after the last round changes nothing in the database.
    await app.close().catch(() => undefined);
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(probeErrorLine(error, secrets));
    process.exitCode = 1;
  });
