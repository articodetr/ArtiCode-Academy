import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import { AuthService } from '../auth/auth.service.js';
import type { IssuedSession } from '../auth/auth.service.js';
import { PasswordService, passwordProblems } from '../auth/password.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { usersError } from '../users/users.errors.js';
import { activePermissionKeys, exceedingPermissions } from '../users/users.policy.js';
import type { InvitationPreviewDto, IssueInvitationResponseDto } from './account.dto.js';
import { maskEmail, maskUsername } from './account.masking.js';
import { VerificationTokenService } from './verification-token.service.js';

export const ACCOUNT_AUDIT_ACTIONS = {
  invitationIssued: 'users.invitation.issued',
  invitationAccepted: 'users.invitation.accepted',
} as const;

/** Only accounts created by POST /api/users and never activated can be invited. */
export const INVITABLE_STATUS = 'invited';

// Explicit projections: never the password hash or the login counters.
const INVITEE_SELECT = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  displayName: true,
  locale: true,
  status: true,
  deletedAt: true,
  roles: {
    select: {
      role: {
        select: {
          key: true,
          permissions: { select: { permissionKey: true, permission: { select: { deprecatedAt: true } } } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

const INVITATION_SELECT = {
  id: true,
  purpose: true,
  expiresAt: true,
  consumedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      username: true,
      fullName: true,
      displayName: true,
      locale: true,
      status: true,
      deletedAt: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  },
} satisfies Prisma.VerificationTokenSelect;

type InvitationRow = Prisma.VerificationTokenGetPayload<{ select: typeof INVITATION_SELECT }>;

/**
 * MOD-03-T03 — invitations and account activation. Tokens are random, stored
 * as SHA-256 only and used once; the raw token is returned a single time to the
 * authorized issuer (D-R01). Accepting through such a manually delivered link
 * never sets `email_verified_at` (D-R08, ADR-031). Every write records exactly
 * one audit event inside its transaction.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // -------------------------------------------------------------- issue

  /**
   * Issues a fresh invitation for an `invited` account, retiring any pending
   * one. SEC-R-13: the issuer could accept the token themself, so the roles of
   * the invitee may not confer any permission the issuer lacks (same rule as
   * user creation — users.policy.ts).
   */
  async issueInvitation(userId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<IssueInvitationResponseDto> {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, deletedAt: null }, select: INVITEE_SELECT });
    if (!user) throw usersError.userNotFound();

    // Authorisation before state: a caller who may not invite this account
    // learns nothing about its status.
    const exceeding = exceedingPermissions(
      activePermissionKeys(user.roles.map((grant) => grant.role)),
      caller.permissions,
    );
    if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
    if (user.status !== INVITABLE_STATUS) throw usersError.userNotInvitable(user.status);

    const roleKeys = user.roles.map((grant) => grant.role.key).sort();
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.invitationExpiry(now);

    await this.prisma.db.$transaction(async (tx) => {
      // A new invitation replaces every pending one for this account (AC 4).
      const retired = await tx.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'invitation', consumedAt: null },
        data: { consumedAt: now },
      });
      const created = await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'invitation',
          tokenHash: generated.hash,
          expiresAt,
          // Non-secret context only (the roles the account holds, who issued it).
          metadata: { roles: roleKeys, issuedBy: caller.id },
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: ACCOUNT_AUDIT_ACTIONS.invitationIssued,
          actorUserId: caller.id,
          entityType: 'users',
          entityId: user.id,
          metadata: { invitationId: created.id, roles: roleKeys, superseded: retired.count, expiresAt: expiresAt.toISOString() },
          ...ctx,
        },
        tx,
      );
    });

    // After the commit, outside the transaction: the mail copy is best effort
    // (transport `none` until LR-01) and never decides the outcome.
    const delivery = await this.mail.sendInvitation({
      to: user.email,
      recipientName: user.displayName ?? user.fullName,
      locale: user.locale,
      token: generated.token,
      expiresAt,
    });

    return {
      userId: user.id,
      token: generated.token,
      link: this.mail.invitationLink(generated.token),
      expiresAt: expiresAt.toISOString(),
      delivery: { transport: delivery.transport, status: delivery.status },
    };
  }

  // ------------------------------------------------------------ preview

  async previewInvitation(token: string): Promise<InvitationPreviewDto> {
    const invitation = await this.loadUsableInvitation(token, new Date());
    const { user } = invitation;
    return {
      fullName: user.fullName,
      displayName: user.displayName,
      locale: user.locale,
      email: user.email ? maskEmail(user.email) : null,
      username: user.username ? maskUsername(user.username) : null,
      roles: user.roles.map((grant) => grant.role.key).sort(),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------- accept

  /**
   * Consumes the token, stores the chosen password, activates the account and
   * opens a session as `login` would. `email_verified_at` is left untouched:
   * a manually delivered link proves nothing about who owns the address (D-R08).
   */
  async acceptInvitation(token: string, password: string, ctx: RequestContext): Promise<IssuedSession> {
    const problems = passwordProblems(password);
    if (problems.length > 0) throw authError.passwordWeak(problems);

    const invitation = await this.loadUsableInvitation(token, new Date());
    const passwordHash = await this.passwords.hash(password);
    const roleKeys = invitation.user.roles.map((grant) => grant.role.key).sort();
    const now = new Date();

    await this.prisma.db.$transaction(async (tx) => {
      // Exactly one request may flip consumed_at: the loser of a race sees 409 (AC 2).
      const consumed = await tx.verificationToken.updateMany({
        where: { id: invitation.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw usersError.invitationConsumed();
      await tx.user.update({
        where: { id: invitation.user.id },
        data: {
          passwordHash,
          status: 'active',
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          // emailVerifiedAt deliberately not set (D-R08 / ADR-031).
        },
      });
      await this.audit.record(
        {
          action: ACCOUNT_AUDIT_ACTIONS.invitationAccepted,
          actorUserId: invitation.user.id,
          entityType: 'users',
          entityId: invitation.user.id,
          metadata: { invitationId: invitation.id, roles: roleKeys },
          ...ctx,
        },
        tx,
      );
    });

    return this.auth.openSession(invitation.user.id, 'invitation', ctx);
  }

  // ------------------------------------------------------------- lookup

  /**
   * Resolves a raw token to a usable invitation or throws, in this order:
   * malformed/unknown/other purpose → 404 `invitation_invalid`; already used
   * or replaced → 409 `invitation_consumed`; past expiry → 410
   * `invitation_expired`; account deleted or no longer `invited` → 404.
   */
  private async loadUsableInvitation(token: string, now: Date): Promise<InvitationRow> {
    if (!this.tokens.isWellFormed(token)) throw usersError.invitationInvalid();
    const row = await this.prisma.db.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
      select: INVITATION_SELECT,
    });
    if (!row || row.purpose !== 'invitation') throw usersError.invitationInvalid();
    if (row.consumedAt !== null) throw usersError.invitationConsumed();
    if (row.expiresAt <= now) throw usersError.invitationExpired(row.expiresAt);
    if (row.user.deletedAt !== null || row.user.status !== INVITABLE_STATUS) throw usersError.invitationInvalid();
    return row;
  }
}
