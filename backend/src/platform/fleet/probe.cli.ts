// MOD-18-T05 (D-R103) — the command-line side of the periodic fleet probe:
// arguments, the few environment variables it needs, the output lines and the
// loop. src/platform/probe.ts wires them; nothing here runs on import.
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { buildPostgresUrl } from '../../config/database-url.js';
import { platformEnvSchema } from '../platform.env.schema.js';
import type { FleetEnv } from './fleet.settings.js';
import type { ProbeRoundSummary } from './fleet.service.js';

export const PROBE_USAGE =
  'usage: node dist/platform/probe.js [--once | --help]\n' +
  '  Probes every academy of the platform registry that is not archived and has an origin\n' +
  '  (GET <origin>/api/health and /api/health/ready), records one snapshot per academy and\n' +
  '  prints one JSON line per round. Without --once it repeats every\n' +
  '  PLATFORM_PROBE_INTERVAL_SECONDS until SIGTERM / SIGINT; --once runs one round and exits.';

export type ProbeArgs = { help: true } | { help: false; once: boolean };

export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  let once = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--once') once = true;
    else throw new Error(`unknown argument "${arg}" (${PROBE_USAGE.split('\n')[0]})`);
  }
  return { help: false, once };
}

/**
 * The variables the command reads, with the platform API's own definitions
 * (platform.env.schema.ts), so a value the API refuses is refused here too.
 * PLATFORM_JWT_SECRET, the CORS and cookie settings are not read: the command
 * runs with NODE_ENV=production without them.
 */
const shape = platformEnvSchema.in.shape;
const probeEnvSchema = z.object({
  NODE_ENV: shape.NODE_ENV,
  PLATFORM_DATABASE_URL: shape.PLATFORM_DATABASE_URL,
  DB_HOST: shape.DB_HOST,
  POSTGRES_PORT: shape.POSTGRES_PORT,
  PLATFORM_DB_NAME: shape.PLATFORM_DB_NAME,
  PLATFORM_DB_APP_USER: shape.PLATFORM_DB_APP_USER,
  PLATFORM_DB_APP_PASSWORD: shape.PLATFORM_DB_APP_PASSWORD,
  PLATFORM_PROBE_TIMEOUT_MS: shape.PLATFORM_PROBE_TIMEOUT_MS,
  PLATFORM_PROBE_INTERVAL_SECONDS: shape.PLATFORM_PROBE_INTERVAL_SECONDS,
});

/** What the probe command's ConfigService holds (FleetSettings + PlatformPrismaService read it). */
export type ProbeEnv = FleetEnv & {
  /** The platform APPLICATION role (DML only): PLATFORM_DATABASE_URL, else derived like the platform API does. */
  PLATFORM_DATABASE_URL: string;
};

export function readProbeEnv(raw: Record<string, string | undefined>): ProbeEnv {
  const result = probeEnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid environment: ${problems}`);
  }
  const env = result.data;
  const databaseUrl =
    env.PLATFORM_DATABASE_URL ??
    (env.PLATFORM_DB_APP_PASSWORD === undefined
      ? undefined
      : buildPostgresUrl({
          user: env.PLATFORM_DB_APP_USER,
          password: env.PLATFORM_DB_APP_PASSWORD,
          host: env.DB_HOST,
          port: env.POSTGRES_PORT,
          database: env.PLATFORM_DB_NAME,
        }));
  if (!databaseUrl) {
    throw new Error(
      'no platform database: set PLATFORM_DATABASE_URL, or PLATFORM_DB_APP_PASSWORD to derive it (application role)',
    );
  }
  return {
    NODE_ENV: env.NODE_ENV,
    PLATFORM_DATABASE_URL: databaseUrl,
    PLATFORM_PROBE_TIMEOUT_MS: env.PLATFORM_PROBE_TIMEOUT_MS,
    PLATFORM_PROBE_INTERVAL_SECONDS: env.PLATFORM_PROBE_INTERVAL_SECONDS,
  };
}

/** The connection string and its password, to mask in error lines. */
export function secretsOf(env: Pick<ProbeEnv, 'PLATFORM_DATABASE_URL'>): string[] {
  const secrets = [env.PLATFORM_DATABASE_URL];
  try {
    const password = new URL(env.PLATFORM_DATABASE_URL).password;
    if (password) secrets.push(password, decodeURIComponent(password));
  } catch {
    // Not a URL the WHATWG parser accepts; the whole string is masked anyway.
  }
  return secrets;
}

/** The one JSON line printed per round on stdout. */
export function roundLine(summary: ProbeRoundSummary, durationMs: number): string {
  return JSON.stringify({
    event: 'platform.probe.round',
    probed: summary.probed,
    ready: summary.ready,
    notReady: summary.notReady,
    unreachable: summary.unreachable,
    invalid: summary.invalid,
    behind: summary.behind,
    failed: summary.failed,
    durationMs: Math.round(durationMs),
  });
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S+/gi;

/**
 * The one line printed on stderr for a failure: the message on one line, any
 * connection string and every given secret masked, at most 500 characters.
 */
export function probeErrorLine(error: unknown, secrets: readonly (string | undefined)[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('***');
  }
  message = message.replace(CONNECTION_STRING, 'postgresql://***').replace(/\s+/g, ' ').trim();
  if (message.length > 500) message = `${message.slice(0, 497)}...`;
  return `platform probe failed: ${message || 'unknown error'}`;
}

export interface ProbeLoopOptions {
  once: boolean;
  intervalMs: number;
  round: () => Promise<ProbeRoundSummary>;
  /** One line on stdout. */
  write: (line: string) => void;
  /** One line on stderr. */
  writeError: (line: string) => void;
  secrets?: readonly string[];
  /** Aborted on SIGTERM / SIGINT: the loop ends after the running round. */
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal }).catch(() => undefined);
}

/**
 * `--once`: one round, exit code 0 — or 1 when the round failed or a snapshot
 * could not be recorded. Otherwise rounds every `intervalMs` until `signal`
 * aborts (exit code 0); a failed round prints its error line and the loop goes on.
 */
export async function runProbeLoop(options: ProbeLoopOptions): Promise<number> {
  const sleep = options.sleep ?? abortableSleep;
  for (;;) {
    let succeeded = true;
    const started = performance.now();
    try {
      const summary = await options.round();
      options.write(roundLine(summary, performance.now() - started));
      if (summary.failed > 0) {
        succeeded = false;
        options.writeError(
          probeErrorLine(
            `${summary.failed} of ${summary.probed} snapshots were not recorded: ${summary.firstError ?? 'unknown error'}`,
            options.secrets,
          ),
        );
      }
    } catch (error) {
      succeeded = false;
      options.writeError(probeErrorLine(error, options.secrets));
    }
    if (options.once) return succeeded ? 0 : 1;
    if (options.signal?.aborted) return 0;
    await sleep(options.intervalMs, options.signal);
    if (options.signal?.aborted) return 0;
  }
}
