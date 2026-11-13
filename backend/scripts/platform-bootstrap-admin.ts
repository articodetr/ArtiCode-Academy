// Creates the FIRST platform super admin (MOD-18-T03, D-R100). Run from backend/:
//
//   npm run platform:bootstrap-admin
//
// Input (no defaults, nothing stored in the repository):
//   PLATFORM_BOOTSTRAP_EMAIL       required
//   PLATFORM_BOOTSTRAP_FULL_NAME   required
//   PLATFORM_BOOTSTRAP_PASSWORD    optional — when absent and stdin is a terminal,
//                                  the password is prompted twice without echo
// Read from the environment and from backend/.env.local, backend/.env, ../.env
// (first definition wins). The platform database is reached through
// PLATFORM_DATABASE_URL or the PLATFORM_DB_APP_* variables — never an academy
// database. The password is never printed or logged.
//
// Exit codes: 0 created or already bootstrapped, 2 refused (a super admin
// already exists — add accounts with `npm run platform:create-user`), 1 error.
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordService } from '../src/auth/password.service.js';
import { platformPostgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/platform/client.js';
import { bootstrapFirstPlatformAdmin, platformUserInputProblems } from '../src/platform/auth/platform-bootstrap.js';
import { promptHidden } from './hidden-prompt.js';

async function main(): Promise<number> {
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

  const email = process.env['PLATFORM_BOOTSTRAP_EMAIL']?.trim() ?? '';
  const fullName = process.env['PLATFORM_BOOTSTRAP_FULL_NAME']?.trim() ?? '';
  let password = process.env['PLATFORM_BOOTSTRAP_PASSWORD'] ?? '';

  if (!password && process.stdin.isTTY) {
    password = await promptHidden('Password for the first platform super admin (not echoed): ');
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('Passwords do not match.');
      return 1;
    }
  }

  const problems = platformUserInputProblems({ email, fullName, password });
  if (problems.length > 0) {
    console.error(`Cannot bootstrap: ${problems.join('; ')}`);
    console.error(
      'Set PLATFORM_BOOTSTRAP_EMAIL, PLATFORM_BOOTSTRAP_FULL_NAME and PLATFORM_BOOTSTRAP_PASSWORD (or run in a terminal to be prompted).',
    );
    return 1;
  }

  const url = process.env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(process.env, 'app');
  if (!url) {
    console.error('No platform database URL: set PLATFORM_DATABASE_URL or PLATFORM_DB_APP_PASSWORD (repository root .env).');
    return 1;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await bootstrapFirstPlatformAdmin(db, { email, fullName, password }, new PasswordService());
    switch (result.outcome) {
      case 'created':
        console.log(`First platform super admin created (user ${result.userId}). Sign in with the e-mail and the password you provided.`);
        return 0;
      case 'already_bootstrapped':
        console.log(`Already bootstrapped: ${email.toLowerCase()} is a platform super admin (user ${result.userId}). Nothing changed.`);
        return 0;
      case 'refused':
        console.error(
          result.reason === 'super_admin_exists'
            ? 'Refused: a platform super admin already exists. Add accounts with "npm run platform:create-user".'
            : 'Refused: this e-mail belongs to an existing platform account.',
        );
        return 2;
    }
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
