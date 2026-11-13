// MOD-18-T03 (D-R100) — the two ways a platform account is created in v1,
// both out of band (no HTTP route): the FIRST super admin
// (scripts/platform-bootstrap-admin.ts → npm run platform:bootstrap-admin) and
// any further support or super admin account
// (scripts/platform-create-user.ts → npm run platform:create-user). The logic
// lives here so the tests call it directly; the scripts only read their input.
// The academy model is src/auth/bootstrap-admin.ts. Rules:
//   - no default credentials: e-mail, name, role and password come from the caller;
//   - the password follows the platform policy (12+ characters —
//     platformPasswordProblems()) and is never logged, returned or recorded;
//   - the bootstrap works only while NO super admin exists (any status); the
//     same e-mail again is a no-op (`already_bootstrapped`);
//   - an e-mail already in use is refused (`email_in_use`);
//   - each creation records one `platform.users.created { role, via }` with
//     actor NULL (nobody is signed in), in the transaction of the insert.
import { assertNoSecrets } from '../../audit/audit-metadata.js';
import type { PlatformRole, PrismaClient } from '../../generated/platform/client.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';
import {
  PLATFORM_AUTH_EVENTS,
  PLATFORM_USERS_ENTITY,
  isPlatformEmail,
  normalizePlatformEmail,
  platformPasswordProblems,
} from './platform-session.rules.js';

export const PLATFORM_ROLES: readonly PlatformRole[] = ['super_admin', 'support'];

export interface PlatformUserInput {
  email: string;
  fullName: string;
  password: string;
}

export interface NewPlatformUserInput extends PlatformUserInput {
  role: PlatformRole;
}

export type PlatformBootstrapResult =
  | { outcome: 'created'; userId: string }
  | { outcome: 'already_bootstrapped'; userId: string }
  | { outcome: 'refused'; reason: 'super_admin_exists' | 'email_in_use' };

export type PlatformCreateUserResult =
  | { outcome: 'created'; userId: string }
  | { outcome: 'refused'; reason: 'email_in_use' };

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
}

/** How the account came to be (`platform.users.created { via }`). */
export type PlatformUserOrigin = 'bootstrap' | 'cli';

/** Validation problems of the input (empty when acceptable). The password is never echoed. */
export function platformUserInputProblems(input: PlatformUserInput & { role?: string }): string[] {
  const problems: string[] = [];
  if (!isPlatformEmail(normalizePlatformEmail(input.email))) problems.push('email must be a valid address');
  if (input.fullName.trim().length < 2) problems.push('full name must have at least 2 characters');
  if (input.fullName.trim().length > 200) problems.push('full name must have at most 200 characters');
  if (input.role !== undefined && !(PLATFORM_ROLES as readonly string[]).includes(input.role)) {
    problems.push(`role must be one of ${PLATFORM_ROLES.join(', ')}`);
  }
  for (const problem of platformPasswordProblems(input.password)) problems.push(`password must be ${problem}`);
  return problems;
}

/**
 * The bootstrap's decision from what the database holds (pure): another super
 * admin exists → refused; the same e-mail is already the super admin → no-op;
 * the e-mail belongs to a support account → refused; otherwise create.
 */
export function bootstrapDecision(
  superAdmins: readonly { id: string; email: string }[],
  email: string,
  emailOwnerId: string | null,
): PlatformBootstrapResult | { outcome: 'create' } {
  if (superAdmins.length > 0) {
    const same = superAdmins.find((admin) => admin.email === email);
    return same ? { outcome: 'already_bootstrapped', userId: same.id } : { outcome: 'refused', reason: 'super_admin_exists' };
  }
  if (emailOwnerId !== null) return { outcome: 'refused', reason: 'email_in_use' };
  return { outcome: 'create' };
}

function assertValid(input: PlatformUserInput & { role?: string }): void {
  const problems = platformUserInputProblems(input);
  if (problems.length > 0) throw new Error(`Platform user input is invalid: ${problems.join('; ')}`);
}

/** The unique-violation code of Prisma (P2002), whatever the driver adapter put around it. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Inserts the account and its one `platform.users.created` event (inside the caller's transaction). */
async function insertPlatformUser(
  tx: PlatformTransaction,
  input: { email: string; fullName: string; role: PlatformRole; passwordHash: string },
  via: PlatformUserOrigin,
): Promise<string> {
  const now = new Date();
  const user = await tx.platformUser.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      status: 'active',
      passwordHash: input.passwordHash,
      passwordChangedAt: now,
    },
    select: { id: true },
  });
  const metadata = { role: input.role, via };
  assertNoSecrets(metadata);
  await tx.platformAuditLog.create({
    data: {
      action: PLATFORM_AUTH_EVENTS.usersCreated,
      actorPlatformUserId: null,
      entityType: PLATFORM_USERS_ENTITY,
      entityId: user.id,
      metadata,
    },
  });
  return user.id;
}

export async function bootstrapFirstPlatformAdmin(
  db: PrismaClient,
  input: PlatformUserInput,
  hasher: PasswordHasher,
): Promise<PlatformBootstrapResult> {
  assertValid(input);
  const email = normalizePlatformEmail(input.email);
  const fullName = input.fullName.trim();
  // Hash outside the transaction (CPU-bound) so the lock below stays short.
  const passwordHash = await hasher.hash(input.password);

  return db.$transaction(async (tx) => {
    // Serialises concurrent bootstraps (a transaction-scoped advisory lock; any role may take one).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('articode.platform.bootstrap'))`;
    const superAdmins = await tx.platformUser.findMany({
      where: { role: 'super_admin' },
      select: { id: true, email: true },
    });
    const owner = await tx.platformUser.findUnique({ where: { email }, select: { id: true } });
    const decision = bootstrapDecision(superAdmins, email, owner?.id ?? null);
    if (decision.outcome !== 'create') return decision;
    const userId = await insertPlatformUser(tx, { email, fullName, role: 'super_admin', passwordHash }, 'bootstrap');
    return { outcome: 'created', userId };
  });
}

export async function createPlatformUser(
  db: PrismaClient,
  input: NewPlatformUserInput,
  hasher: PasswordHasher,
): Promise<PlatformCreateUserResult> {
  assertValid(input);
  const email = normalizePlatformEmail(input.email);
  const fullName = input.fullName.trim();
  const existing = await db.platformUser.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { outcome: 'refused', reason: 'email_in_use' };
  const passwordHash = await hasher.hash(input.password);
  try {
    const userId = await db.$transaction((tx) =>
      insertPlatformUser(tx, { email, fullName, role: input.role, passwordHash }, 'cli'),
    );
    return { outcome: 'created', userId };
  } catch (error) {
    // Two creations of one e-mail at the same instant: the unique index decides.
    if (isUniqueViolation(error)) return { outcome: 'refused', reason: 'email_in_use' };
    throw error;
  }
}
