// PORTAL-04 — an administrator removes the Google identity linked to an
// account: `DELETE /api/users/:id/google-identity` (users.update). The account
// keeps everything else (its password, if any, its sessions, its roles); it
// signs in with Google again only after a new link (common contract B: a
// confirmed address of a student or guardian account, or nothing). Used by the
// UsersModule, which registers GoogleIdentityController — AuthModule cannot
// import UsersModule (UsersModule imports AuthModule).
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { usersError } from '../../users/users.errors.js';
import { activePermissionKeys, exceedingPermissions } from '../../users/users.policy.js';
import { authError } from '../auth.errors.js';
import type { AuthPrincipal, RequestContext } from '../principal.js';

export const GOOGLE_IDENTITY_AUDIT_ACTIONS = {
  /** An administrator removed the account's Google identity, metadata `{ provider: 'google' }` — never the subject or the e-mail. */
  unlinked: 'users.identity.unlinked',
} as const;

// Existence and the roles for SEC-R-15 — the same grants users.service.ts reads.
const TARGET_SELECT = {
  id: true,
  deletedAt: true,
  roles: {
    select: {
      role: {
        select: { permissions: { select: { permissionKey: true, permission: { select: { deprecatedAt: true } } } } },
      },
    },
  },
} satisfies Prisma.UserSelect;

type Db = Prisma.TransactionClient | PrismaService['db'];

@Injectable()
export class GoogleIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Order of the checks: 404 `user_not_found` (unknown or soft-deleted) → 403
   * `permission_denied` when the target's roles confer a permission the caller
   * lacks (SEC-R-15, before anything about the link, so a caller who may not
   * act on this account learns nothing about it) → inside one transaction on
   * the target's row locked `FOR NO KEY UPDATE` (KI-079): 404 and SEC-R-15
   * again, then the link. Nothing linked → `false`, no write, no event; else
   * the identity row is deleted with exactly one `users.identity.unlinked`.
   * Allowed on one's own account too (the holder of `users.update`).
   */
  async unlink(userId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<boolean> {
    await this.loadTarget(this.prisma.db, userId, caller);
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
      await this.loadTarget(tx, userId, caller);
      const removed = await tx.userIdentity.deleteMany({ where: { userId, provider: 'google' } });
      if (removed.count === 0) return false;
      await this.audit.record(
        {
          action: GOOGLE_IDENTITY_AUDIT_ACTIONS.unlinked,
          actorUserId: caller.id,
          entityType: 'users',
          entityId: userId,
          metadata: { provider: 'google' },
          ...ctx,
        },
        tx,
      );
      return true;
    });
  }

  /** Unknown or soft-deleted → 404; the target's roles within the caller's reach (SEC-R-15, `assertWithinReach()` of users.service.ts). */
  private async loadTarget(db: Db, userId: string, caller: AuthPrincipal): Promise<void> {
    const user = await db.user.findUnique({ where: { id: userId }, select: TARGET_SELECT });
    if (!user || user.deletedAt !== null) throw usersError.userNotFound();
    const exceeding = exceedingPermissions(activePermissionKeys(user.roles.map((grant) => grant.role)), caller.permissions);
    if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
  }
}
