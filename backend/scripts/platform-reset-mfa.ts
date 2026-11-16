// Resets the two-step verification of a platform account (PMFA-T04, D-R117) —
// v1 has no user management in the platform API. Run from backend/:
//
//   npm run platform:reset-mfa -- --email ops@example.com --reason "Lost phone; identity confirmed"
//
// Arguments: --email <address> (required), --reason "<text>" (optional, 1..500
// characters after trimming; recorded in the event). The account's MFA columns
// are cleared, its recovery codes deleted, its open sign-in challenges consumed
// and every one of its sessions ended, with one `platform.users.mfa_reset`
// event; the holder then signs in with the password alone and may set MFA up
// again. Needs no PLATFORM_MFA_ENCRYPTION_KEY (no secret is opened) — this is
// the way out after a lost key. Read from the environment and from
// backend/.env.local, backend/.env, ../.env (first definition wins); the
// platform database through PLATFORM_DATABASE_URL or the PLATFORM_DB_APP_*
// variables. Nothing secret is ever printed.
//
// Exit codes: 0 reset, 0 with a "Nothing to reset" line (the account has no
// MFA and no setup in progress), 2 refused (no platform account has this
// e-mail), 1 error (bad arguments included).
import { parseArgs } from 'node:util';
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { platformPostgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/platform/client.js';
import {
  PlatformMfaResetError,
  platformMfaResetInputProblems,
  resetPlatformUserMfa,
} from '../src/platform/auth/mfa/platform-mfa-reset.js';

const USAGE = 'Usage: npm run platform:reset-mfa -- --email <address> [--reason "<text>"]';

async function main(): Promise<number> {
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

  let args: { email?: string; reason?: string };
  try {
    ({ values: args } = parseArgs({
      options: { email: { type: 'string' }, reason: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }
  const input = { email: args.email ?? '', ...(args.reason !== undefined ? { reason: args.reason } : {}) };

  const problems = platformMfaResetInputProblems(input);
  if (problems.length > 0) {
    console.error(`Cannot reset two-step verification: ${problems.join('; ')}`);
    console.error(USAGE);
    return 1;
  }

  const url = process.env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(process.env, 'app');
  if (!url) {
    console.error('No platform database URL: set PLATFORM_DATABASE_URL or PLATFORM_DB_APP_PASSWORD (repository root .env).');
    return 1;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await resetPlatformUserMfa(db, input);
    if (result.reset) {
      console.log(
        `Two-step verification of platform user ${result.userId} was reset; ${result.revokedSessions} session(s) ended. ` +
          'The holder signs in with the password alone and may set it up again.',
      );
    } else {
      console.log(`Nothing to reset: platform user ${result.userId} has no two-step verification and no setup in progress.`);
    }
    return 0;
  } catch (error) {
    if (error instanceof PlatformMfaResetError && error.code === 'user_not_found') {
      console.error('Refused: no platform account has this e-mail.');
      return 2;
    }
    throw error;
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
