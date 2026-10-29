// Demo accounts for LOCAL DEVELOPMENT only — not a product feature. Run from backend/:
//
//   npm run dev:demo-users
//
// Creates — or, when they already exist, resets the password of and re-activates —
// three accounts that share one password, so the owner can sign in to the web app
// with every role while the real account flows (POST /api/users + invitation,
// MOD-03) are still being built:
//
//   admin@<domain>     academy_admin
//   teacher@<domain>   teacher   (+ employee_profiles, kind = teacher)
//   student@<domain>   student   (+ student_profiles)
//
// Input (nothing stored in the repository):
//   DEMO_USERS_PASSWORD       optional — when absent and stdin is a terminal, the
//                             password is prompted without echo; >= 12 characters
//                             (the first-admin minimum of scripts/bootstrap-admin.ts)
//   DEMO_USERS_EMAIL_DOMAIN   optional — default "articode.com"
// Read from the environment and from backend/.env.local, backend/.env, ../.env
// (first definition wins).
//
// Safety rules:
//   - refused when NODE_ENV=production (exit 2): the production path for new
//     accounts is POST /api/users followed by an invitation (MOD-03-T03);
//   - touches only the three addresses above and never a soft-deleted user;
//   - the password is never printed or logged; audit rows carry identifiers only.
// Exit codes: 0 done, 1 error (invalid input, no database), 2 refused.
import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { AUDIT_ACTIONS } from '../src/auth/auth.service.js';
import type { PasswordHasher } from '../src/auth/bootstrap-admin.js';
import { BOOTSTRAP_PASSWORD_MIN_LENGTH, PasswordService, passwordProblems } from '../src/auth/password.service.js';
import { ACADEMY_ADMIN_ROLE_KEY } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { EmployeeKind } from '../src/generated/prisma/client.js';
import { USERS_AUDIT_ACTIONS } from '../src/users/users.service.js';
import { promptHidden } from './hidden-prompt.js';

export type DemoLocalPart = 'admin' | 'teacher' | 'student';

export interface DemoAccount {
  readonly localPart: DemoLocalPart;
  readonly roleKey: string;
  readonly fullName: string;
  readonly fullNameLatin: string;
  /** Profile row created with the user, mirroring POST /api/users (users.policy.ts, profileKindFor). */
  readonly profile: { kind: 'student' } | { kind: 'employee'; employeeKind: EmployeeKind } | null;
}

export const DEMO_EMAIL_DOMAIN_DEFAULT = 'articode.com';
/** The set contains an academy admin, so the first-admin minimum applies to the shared password. */
export const DEMO_PASSWORD_MIN_LENGTH = BOOTSTRAP_PASSWORD_MIN_LENGTH;
/** `metadata.source` of the audit rows written by this script. */
export const DEMO_SOURCE = 'dev-demo-users';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { localPart: 'admin', roleKey: ACADEMY_ADMIN_ROLE_KEY, fullName: 'مدير تجريبي', fullNameLatin: 'Demo Admin', profile: null },
  {
    localPart: 'teacher',
    roleKey: 'teacher',
    fullName: 'معلّم تجريبي',
    fullNameLatin: 'Demo Teacher',
    profile: { kind: 'employee', employeeKind: 'teacher' },
  },
  { localPart: 'student', roleKey: 'student', fullName: 'طالب تجريبي', fullNameLatin: 'Demo Student', profile: { kind: 'student' } },
];

// A bare host name with at least one dot: the application validates e-mail
// addresses with a top-level domain (IsEmail in users.dto.ts).
const DOMAIN_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface DemoUsersInput {
  domain: string;
  password: string;
}

export type DemoOutcome = 'created' | 'reset' | 'skipped_deleted';

export interface DemoAccountResult {
  email: string;
  roleKey: string;
  outcome: DemoOutcome;
  userId: string;
}

/** `production` (any case, surrounding spaces ignored) is the only refused environment. */
export function isRefusedEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv?.trim().toLowerCase() === 'production';
}

/** Trimmed, lower-cased; empty or missing → the default domain. */
export function normalizeDomain(raw: string | undefined): string {
  const value = raw?.trim().toLowerCase() ?? '';
  return value === '' ? DEMO_EMAIL_DOMAIN_DEFAULT : value;
}

export function demoEmail(account: DemoAccount, domain: string): string {
  return `${account.localPart}@${domain}`;
}

/** Validation problems of the input (empty when acceptable). The password is never echoed. */
export function demoUsersInputProblems(input: DemoUsersInput): string[] {
  const problems: string[] = [];
  if (!DOMAIN_PATTERN.test(input.domain)) {
    problems.push('DEMO_USERS_EMAIL_DOMAIN must be a bare host name with a dot, such as "articode.com"');
  }
  for (const problem of passwordProblems(input.password, DEMO_PASSWORD_MIN_LENGTH)) {
    problems.push(`password must be ${problem}`);
  }
  return problems;
}

/**
 * Creates the missing demo accounts and resets the existing ones, all in one
 * transaction (a failure leaves the database as it was). Re-running yields the
 * same rows. Never touches a soft-deleted user.
 */
export async function seedDemoUsers(
  db: PrismaClient,
  input: DemoUsersInput,
  hasher: PasswordHasher,
): Promise<DemoAccountResult[]> {
  const problems = demoUsersInputProblems(input);
  if (problems.length > 0) {
    throw new Error(`Demo users input is invalid: ${problems.join('; ')}`);
  }
  // One hash per account (distinct salts), computed outside the transaction (CPU-bound).
  const hashes = await Promise.all(DEMO_ACCOUNTS.map(() => hasher.hash(input.password)));

  return db.$transaction(async (tx) => {
    const roleKeys = DEMO_ACCOUNTS.map((account) => account.roleKey);
    const roles = await tx.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missing = roleKeys.filter((key) => !roleIds.has(key));
    if (missing.length > 0) {
      throw new Error(`System roles missing (${missing.join(', ')}) — run "npm run prisma:seed" first`);
    }

    const now = new Date();
    const results: DemoAccountResult[] = [];
    for (const [index, account] of DEMO_ACCOUNTS.entries()) {
      const email = demoEmail(account, input.domain);
      const roleId = roleIds.get(account.roleKey) as string;
      const passwordHash = hashes[index] as string;
      const existing = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          deletedAt: true,
          roles: { select: { roleId: true } },
          studentProfile: { select: { userId: true } },
          employeeProfile: { select: { userId: true } },
        },
      });

      if (existing?.deletedAt) {
        results.push({ email, roleKey: account.roleKey, outcome: 'skipped_deleted', userId: existing.id });
        continue;
      }

      if (!existing) {
        const user = await tx.user.create({
          data: {
            email,
            fullName: account.fullName,
            fullNameLatin: account.fullNameLatin,
            status: 'active',
            passwordHash,
            emailVerifiedAt: now,
            passwordChangedAt: now,
            mustChangePassword: false,
            roles: { create: { roleId } },
            studentProfile: account.profile?.kind === 'student' ? { create: {} } : undefined,
            employeeProfile:
              account.profile?.kind === 'employee' ? { create: { kind: account.profile.employeeKind } } : undefined,
          },
          select: { id: true },
        });
        // Identifiers and non-sensitive values only (same shape as UsersService.create).
        await tx.auditLog.create({
          data: {
            action: USERS_AUDIT_ACTIONS.created,
            actorUserId: null,
            entityType: 'users',
            entityId: user.id,
            metadata: { kind: account.roleKey, roles: [account.roleKey], profile: account.profile?.kind ?? null, source: DEMO_SOURCE },
          },
        });
        results.push({ email, roleKey: account.roleKey, outcome: 'created', userId: user.id });
        continue;
      }

      await tx.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          status: 'active',
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          roles: existing.roles.some((link) => link.roleId === roleId) ? undefined : { create: { roleId } },
          studentProfile: account.profile?.kind === 'student' && !existing.studentProfile ? { create: {} } : undefined,
          employeeProfile:
            account.profile?.kind === 'employee' && !existing.employeeProfile
              ? { create: { kind: account.profile.employeeKind } }
              : undefined,
        },
      });
      // A reset password ends every open session, as POST /api/auth/password does.
      await tx.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({
        data: {
          action: AUDIT_ACTIONS.passwordChanged,
          actorUserId: null,
          entityType: 'users',
          entityId: existing.id,
          metadata: { source: DEMO_SOURCE, reason: 'demo_reset' },
        },
      });
      results.push({ email, roleKey: account.roleKey, outcome: 'reset', userId: existing.id });
    }
    return results;
  });
}

async function main(): Promise<number> {
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

  if (isRefusedEnvironment(process.env['NODE_ENV'])) {
    console.error(
      'Refused: demo accounts are a development tool and never run with NODE_ENV=production. Create accounts with POST /api/users and an invitation instead.',
    );
    return 2;
  }

  const domain = normalizeDomain(process.env['DEMO_USERS_EMAIL_DOMAIN']);
  let password = process.env['DEMO_USERS_PASSWORD'] ?? '';
  if (!password && process.stdin.isTTY) {
    password = await promptHidden(`Shared password for the demo accounts @${domain} (not echoed): `);
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('Passwords do not match.');
      return 1;
    }
  }

  const problems = demoUsersInputProblems({ domain, password });
  if (problems.length > 0) {
    console.error(`Cannot create demo accounts: ${problems.join('; ')}`);
    console.error(`Set DEMO_USERS_PASSWORD (>= ${DEMO_PASSWORD_MIN_LENGTH} characters) or run in a terminal to be prompted.`);
    return 1;
  }

  const url = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
  if (!url) {
    console.error('No database URL: set DATABASE_URL or DB_APP_PASSWORD (repository root .env).');
    return 1;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const results = await seedDemoUsers(db, { domain, password }, new PasswordService());
    for (const result of results) {
      console.log(`${result.outcome.padEnd(15)} ${result.email}  (${result.roleKey})`);
    }
    console.log('Sign in with any of these e-mails and the password you provided.');
    return 0;
  } finally {
    await db.$disconnect();
  }
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
