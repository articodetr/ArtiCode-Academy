// MOD-17-T05 (D-R93) — the daily maintenance command. One run, then it exits:
//
//   node dist/maintenance/main.js [--dry-run]      (the production `runtime` image)
//   npx tsx src/maintenance/main.ts --dry-run      (from backend/, local tries)
//
// Deletes the verification tokens consumed or expired more than 30 days ago and
// the refresh tokens of families older than AUTH_REFRESH_FAMILY_MAX_DAYS + 7
// days (maintenance.rules.ts), prints exactly one JSON line with the counts on
// stdout and exits 0; on any error one line on stderr and exit 1. No audit
// event, no other table, no HTTP server, no AppModule. The schedule lives
// outside the API (compose runs it daily). Connects as the APPLICATION role:
// DATABASE_URL, else derived from DB_APP_* like the API. Outside production the
// env files of src/config/env-files.ts are read too; JWT_SECRET is never needed.
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV_FILE_PATHS } from '../config/env-files.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { pruneExpiredTokens } from './maintenance.js';
import {
  MAINTENANCE_USAGE,
  environmentWithFiles,
  errorLine,
  parseMaintenanceArgs,
  readMaintenanceEnv,
  resultLine,
} from './maintenance.cli.js';

/** Upper bound for a connection attempt, as the API's PrismaService. */
const DB_TIMEOUT_MS = 5000;

const secrets: string[] = [];

function rememberSecrets(databaseUrl: string): void {
  secrets.push(databaseUrl);
  try {
    const password = new URL(databaseUrl).password;
    if (password) secrets.push(password, decodeURIComponent(password));
  } catch {
    // Not a URL the WHATWG parser accepts; the whole string is masked anyway.
  }
}

async function run(): Promise<number> {
  const args = parseMaintenanceArgs(process.argv.slice(2));
  if (args.help) {
    console.log(MAINTENANCE_USAGE);
    return 0;
  }

  const raw =
    process.env['NODE_ENV'] === 'production'
      ? { ...process.env }
      : environmentWithFiles(process.env, ENV_FILE_PATHS);
  if (raw['DB_APP_PASSWORD']) secrets.push(raw['DB_APP_PASSWORD']);
  const env = readMaintenanceEnv(raw);
  rememberSecrets(env.databaseUrl);

  const started = performance.now();
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.databaseUrl,
      connectionTimeoutMillis: DB_TIMEOUT_MS,
    }),
  });
  try {
    const result = await pruneExpiredTokens(db, new Date(), {
      familyMaxDays: env.familyMaxDays,
      dryRun: args.dryRun,
    });
    console.log(resultLine(result, performance.now() - started));
    return 0;
  } finally {
    // A failed disconnect after a successful run changes nothing in the database.
    await db.$disconnect().catch(() => undefined);
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(errorLine(error, secrets));
    process.exitCode = 1;
  });
