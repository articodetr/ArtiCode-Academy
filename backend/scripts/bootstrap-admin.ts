// Creates the FIRST academy admin (MOD-01). Run from backend/:
//
//   npm run auth:bootstrap-admin
//
// Input (no defaults, nothing stored in the repository):
//   BOOTSTRAP_ADMIN_EMAIL       required
//   BOOTSTRAP_ADMIN_FULL_NAME   required
//   BOOTSTRAP_ADMIN_PASSWORD    optional — when absent and stdin is a terminal,
//                               the password is prompted without echo
// Read from the environment and from backend/.env.local, backend/.env, ../.env
// (first definition wins). The password is never printed or logged.
//
// Exit codes: 0 created or already bootstrapped, 2 refused (an admin already
// exists — create further admins from the application), 1 error.
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { bootstrapFirstAdmin, bootstrapInputProblems } from '../src/auth/bootstrap-admin.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { promptHidden } from './hidden-prompt.js';

async function main(): Promise<number> {
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

  const email = process.env['BOOTSTRAP_ADMIN_EMAIL']?.trim() ?? '';
  const fullName = process.env['BOOTSTRAP_ADMIN_FULL_NAME']?.trim() ?? '';
  let password = process.env['BOOTSTRAP_ADMIN_PASSWORD'] ?? '';

  if (!password && process.stdin.isTTY) {
    password = await promptHidden('Password for the first admin (not echoed): ');
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('Passwords do not match.');
      return 1;
    }
  }

  const problems = bootstrapInputProblems({ email, fullName, password });
  if (problems.length > 0) {
    console.error(`Cannot bootstrap: ${problems.join('; ')}`);
    console.error('Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_FULL_NAME and BOOTSTRAP_ADMIN_PASSWORD (or run in a terminal to be prompted).');
    return 1;
  }

  const url = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
  if (!url) {
    console.error('No database URL: set DATABASE_URL or DB_APP_PASSWORD (repository root .env).');
    return 1;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await bootstrapFirstAdmin(db, { email, fullName, password }, new PasswordService());
    switch (result.outcome) {
      case 'created':
        console.log(`First academy admin created (user ${result.userId}). Sign in with the e-mail and the password you provided.`);
        return 0;
      case 'already_bootstrapped':
        console.log(`Already bootstrapped: ${email} is the academy admin (user ${result.userId}). Nothing changed.`);
        return 0;
      case 'refused':
        console.error(
          result.reason === 'admin_exists'
            ? 'Refused: an academy admin already exists. Create further admins from the application (users.roles.assign).'
            : 'Refused: this e-mail belongs to an existing non-admin account.',
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
