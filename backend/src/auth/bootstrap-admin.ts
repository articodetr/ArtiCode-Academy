// First academy admin bootstrap (MOD-01). Pure function shared by the CLI
// (scripts/bootstrap-admin.ts) and the tests. Rules:
//   - works only while NO active academy_admin exists (a second admin must be
//     created by an existing admin through the application);
//   - re-running with the same e-mail is a no-op ("already_bootstrapped");
//   - no default credentials: e-mail, name and password come from the caller;
//   - never logs or returns the password; never touches the platform (Super Admin).
import { ACADEMY_ADMIN_ROLE_KEY } from '../authorization/system-roles.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AUDIT_ACTIONS } from './auth.service.js';
import { BOOTSTRAP_PASSWORD_MIN_LENGTH, passwordProblems } from './password.service.js';

export interface BootstrapAdminInput {
  email: string;
  fullName: string;
  password: string;
}

export type BootstrapAdminResult =
  | { outcome: 'created'; userId: string }
  | { outcome: 'already_bootstrapped'; userId: string }
  | { outcome: 'refused'; reason: 'admin_exists' | 'email_in_use' };

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validation problems of the input (empty when acceptable). The password is never echoed. */
export function bootstrapInputProblems(input: BootstrapAdminInput): string[] {
  const problems: string[] = [];
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320) problems.push('email must be a valid address');
  if (input.fullName.trim().length < 2) problems.push('full name must have at least 2 characters');
  for (const problem of passwordProblems(input.password, BOOTSTRAP_PASSWORD_MIN_LENGTH)) {
    problems.push(`password must be ${problem}`);
  }
  return problems;
}

export async function bootstrapFirstAdmin(
  db: PrismaClient,
  input: BootstrapAdminInput,
  hasher: PasswordHasher,
): Promise<BootstrapAdminResult> {
  const problems = bootstrapInputProblems(input);
  if (problems.length > 0) {
    throw new Error(`Bootstrap input is invalid: ${problems.join('; ')}`);
  }
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  // Hash outside the transaction (CPU-bound) so the row lock below stays short.
  const passwordHash = await hasher.hash(input.password);

  return db.$transaction(async (tx) => {
    // Serialises concurrent bootstrap attempts on the role row.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM roles WHERE key = ${ACADEMY_ADMIN_ROLE_KEY} FOR UPDATE`;
    const role = locked[0];
    if (!role) {
      throw new Error(`Role "${ACADEMY_ADMIN_ROLE_KEY}" is missing — run "npm run prisma:seed" first`);
    }

    const admins = await tx.user.findMany({
      where: { deletedAt: null, status: { not: 'archived' }, roles: { some: { roleId: role.id } } },
      select: { id: true, email: true },
    });
    if (admins.length > 0) {
      const same = admins.find((admin) => admin.email === email);
      return same
        ? { outcome: 'already_bootstrapped', userId: same.id }
        : { outcome: 'refused', reason: 'admin_exists' };
    }

    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return { outcome: 'refused', reason: 'email_in_use' };

    const now = new Date();
    const user = await tx.user.create({
      data: {
        email,
        fullName,
        passwordHash,
        status: 'active',
        emailVerifiedAt: now,
        passwordChangedAt: now,
        mustChangePassword: false,
        roles: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        action: AUDIT_ACTIONS.bootstrapAdmin,
        actorUserId: null,
        entityType: 'users',
        entityId: user.id,
        metadata: { source: 'bootstrap-admin' },
      },
    });
    return { outcome: 'created', userId: user.id };
  });
}
