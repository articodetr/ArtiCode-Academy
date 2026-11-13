// Creates a further platform account (MOD-18-T03, D-R100) — v1 has no user
// management in the platform API. Run from backend/:
//
//   npm run platform:create-user -- --role support --email ops@example.com --name "Ops Person"
//
// Arguments: --role support|super_admin, --email <address>, --name <full name>.
// Password: PLATFORM_NEW_USER_PASSWORD, else prompted twice without echo when
// stdin is a terminal. Read from the environment and from backend/.env.local,
// backend/.env, ../.env (first definition wins); the platform database through
// PLATFORM_DATABASE_URL or the PLATFORM_DB_APP_* variables. The password is
// never printed or logged.
//
// Exit codes: 0 created, 2 refused (the e-mail is already a platform account), 1 error.
import { parseArgs } from 'node:util';
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordService } from '../src/auth/password.service.js';
import { platformPostgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/platform/client.js';
import type { PlatformRole } from '../src/generated/platform/client.js';
import { createPlatformUser, platformUserInputProblems } from '../src/platform/auth/platform-bootstrap.js';
import { promptHidden } from './hidden-prompt.js';

const USAGE = 'Usage: npm run platform:create-user -- --role support|super_admin --email <address> --name "<full name>"';

async function main(): Promise<number> {
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

  let args: { role?: string; email?: string; name?: string };
  try {
    ({ values: args } = parseArgs({
      options: { role: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }
  const role = args.role?.trim() ?? '';
  const email = args.email?.trim() ?? '';
  const fullName = args.name?.trim() ?? '';
  let password = process.env['PLATFORM_NEW_USER_PASSWORD'] ?? '';

  if (!password && process.stdin.isTTY) {
    password = await promptHidden(`Password for ${email || 'the new account'} (not echoed): `);
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('Passwords do not match.');
      return 1;
    }
  }

  const problems = platformUserInputProblems({ email, fullName, password, role });
  if (problems.length > 0) {
    console.error(`Cannot create the platform account: ${problems.join('; ')}`);
    console.error(USAGE);
    console.error('The password comes from PLATFORM_NEW_USER_PASSWORD, or a hidden prompt in a terminal.');
    return 1;
  }

  const url = process.env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(process.env, 'app');
  if (!url) {
    console.error('No platform database URL: set PLATFORM_DATABASE_URL or PLATFORM_DB_APP_PASSWORD (repository root .env).');
    return 1;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await createPlatformUser(
      db,
      { email, fullName, password, role: role as PlatformRole },
      new PasswordService(),
    );
    if (result.outcome === 'created') {
      console.log(`Platform ${role} account created (user ${result.userId}). Hand the password over out of band.`);
      return 0;
    }
    console.error('Refused: this e-mail already belongs to a platform account.');
    return 2;
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
