import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import { AuthService } from '../auth/auth.service.js';
import type { IssuedSession } from '../auth/auth.service.js';
import { PasswordService, passwordProblems } from '../auth/password.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import type { Env } from '../config/env.schema.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import type { MailDeliveryResult } from '../mail/mail.transport.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { usersError } from '../users/users.errors.js';
import { activePermissionKeys, exceedingPermissions } from '../users/users.policy.js';
import { normalizeIdentifier } from '../users/users.validation.js';
import type {
  ConfirmEmailVerificationResponseDto,
  InvitationPreviewDto,
  IssueInvitationResponseDto,
  IssuePasswordResetResponseDto,
  RequestEmailVerificationResponseDto,
} from './account.dto.js';
import { maskEmail, maskUsername } from './account.masking.js';
import { VerificationTokenService } from './verification-token.service.js';

export const ACCOUNT_AUDIT_ACTIONS = {
  invitationIssued: 'users.invitation.issued',
  invitationAccepted: 'users.invitation.accepted',
  passwordResetIssued: 'users.password_reset.issued',
  passwordReset: 'auth.password.reset',
  emailVerificationIssued: 'users.email_verification.issued',
  emailVerified: 'users.email.verified',
} as const;

/** LR-01-T02 (D-R78): at most 3 confirmation e-mails per account per 15 minutes, counted from the stored tokens. */
export const EMAIL_VERIFICATION_REQUEST_LIMIT = 3;
export const EMAIL_VERIFICATION_WINDOW_MS = 15 * 60 * 1000;

/** Why a confirmation e-mail was sent: the user asked (API-165), or right after accepting an invitation. */
export type EmailVerificationOrigin = 'self' | 'invitation';

/** Only accounts created by POST /api/users and never activated can be invited. */
export const INVITABLE_STATUS = 'invited';
/** Only an account that is in use (and so has a password) can have it reset; `invited` ones are (re)invited instead. */
export const RESETTABLE_STATUS = 'active';

/** Who asked for a password-reset token — recorded in the token row and the audit event, never the token. */
export type PasswordResetOrigin = 'admin' | 'self_service';

// Explicit projections: never the password hash or the login counters.
const TARGET_SELECT = {
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

type TargetRow = Prisma.UserGetPayload<{ select: typeof TARGET_SELECT }>;

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

// The current hash is read only to refuse re-using the current password; it never leaves the service.
const RESET_SELECT = {
  id: true,
  purpose: true,
  expiresAt: true,
  consumedAt: true,
  user: { select: { id: true, status: true, deletedAt: true, passwordHash: true } },
} satisfies Prisma.VerificationTokenSelect;

type ResetRow = Prisma.VerificationTokenGetPayload<{ select: typeof RESET_SELECT }>;

/** What a confirmation e-mail needs to know about its recipient. */
interface VerificationRecipient {
  id: string;
  email: string;
  fullName: string;
  displayName: string | null;
  locale: TargetRow['locale'];
}

const VERIFICATION_SELECT = {
  id: true,
  purpose: true,
  expiresAt: true,
  consumedAt: true,
  metadata: true,
  user: { select: { id: true, email: true, status: true, deletedAt: true } },
} satisfies Prisma.VerificationTokenSelect;

/** The address a confirmation token was issued for (stored in its metadata), or null. */
function issuedForEmail(metadata: Prisma.JsonValue): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata['email'] === 'string') {
    return metadata['email'];
  }
  return null;
}

interface IssuedPasswordReset {
  token: string;
  expiresAt: Date;
}

/**
 * MOD-03-T03 — invitations and account activation; MOD-03-T05 — password
 * reset. Tokens are random, stored as SHA-256 only and used once; the raw
 * token is returned a single time to the authorized issuer (D-R01). Accepting
 * through such a manually delivered link never sets `email_verified_at`
 * (D-R08, ADR-031). Every write records exactly one audit event inside its
 * transaction. LR-01-T02: `email_verified_at` is set only through a
 * confirmation token that travels in an e-mail (D-R78).
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly selfServiceResetEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.selfServiceResetEnabled = config.get('AUTH_SELF_SERVICE_RESET_ENABLED', { infer: true });
  }

  // -------------------------------------------------------------- issue

  /**
   * Issues a fresh invitation for an `invited` account, retiring any pending
   * one. SEC-R-13: the issuer could accept the token themself, so the roles of
   * the invitee may not confer any permission the issuer lacks (same rule as
   * user creation — users.policy.ts).
   */
  async issueInvitation(userId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<IssueInvitationResponseDto> {
    const user = await this.loadTarget(userId, caller);
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
    // (any transport, `resend` included — LR-01) and never decides the outcome.
    const delivery = await this.mail.sendInvitation({
      userId: user.id,
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

    const session = await this.auth.openSession(invitation.user.id, 'invitation', ctx);

    // D-R78: accepting a manually delivered link proves nothing about the
    // address, so a confirmation e-mail goes to it right away — after the
    // response, so the provider's latency never delays the sign-in.
    const { user } = invitation;
    if (user.email && this.mail.transportName !== 'none') {
      const recipient: VerificationRecipient = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        displayName: user.displayName,
        locale: user.locale,
      };
      setImmediate(() => {
        void this.verifyAfterAcceptance(recipient, ctx);
      });
    }
    return session;
  }

  // ----------------------------------------------- password reset (T05)

  /**
   * Issues a one-time password-reset token for an `active` account on behalf
   * of an administrator (D-R01: the link is handed over manually). SEC-R-15:
   * the issuer could use the token themself, so the target's roles may not
   * confer any permission the issuer lacks — checked before the status, like
   * invitations. The account is flagged `must_change_password` until the
   * reset is confirmed or the password changed otherwise.
   */
  async issuePasswordReset(userId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<IssuePasswordResetResponseDto> {
    const user = await this.loadTarget(userId, caller);
    if (user.status !== RESETTABLE_STATUS) throw usersError.userNotResettable(user.status);

    const issued = await this.createPasswordReset(user, { via: 'admin', actorUserId: caller.id, mustChangePassword: true }, ctx);
    const delivery = await this.mail.sendPasswordReset({
      userId: user.id,
      to: user.email,
      recipientName: user.displayName ?? user.fullName,
      locale: user.locale,
      token: issued.token,
      expiresAt: issued.expiresAt,
    });

    return {
      userId: user.id,
      token: issued.token,
      link: this.mail.passwordResetLink(issued.token),
      expiresAt: issued.expiresAt.toISOString(),
      delivery: { transport: delivery.transport, status: delivery.status },
    };
  }

  /**
   * Public "forgot my password": refused as a whole while
   * `AUTH_SELF_SERVICE_RESET_ENABLED` is false (no mail transport reaches the
   * user before LR-01 — D-R08). When enabled it answers the same way whether
   * the identifier matches an account or not; the token is created and mailed
   * after the response, so the timing reveals nothing either. The raw token
   * only ever travels in the e-mail.
   */
  async requestPasswordReset(identifierRaw: string, ctx: RequestContext): Promise<void> {
    if (!this.selfServiceResetEnabled) throw usersError.resetDisabled();
    const identifier = normalizeIdentifier(identifierRaw);
    if (!identifier) return;

    const user = await this.prisma.db.user.findFirst({
      where: {
        deletedAt: null,
        status: RESETTABLE_STATUS,
        // A username-only account has nowhere to receive the link.
        ...(identifier.includes('@') ? { email: identifier } : { username: identifier, email: { not: null } }),
      },
      select: { id: true, email: true, fullName: true, displayName: true, locale: true },
    });
    if (!user?.email) return;

    // Deliberately not awaited: the response is identical for known and
    // unknown identifiers and so is its timing (202 = accepted for processing).
    setImmediate(() => {
      void this.deliverSelfServiceReset(user, ctx);
    });
  }

  private async deliverSelfServiceReset(
    user: { id: string; email: string | null; fullName: string; displayName: string | null; locale: TargetRow['locale'] },
    ctx: RequestContext,
  ): Promise<void> {
    try {
      const issued = await this.createPasswordReset(user, { via: 'self_service', actorUserId: null, mustChangePassword: false }, ctx);
      await this.mail.sendPasswordReset({
        userId: user.id,
        to: user.email,
        recipientName: user.displayName ?? user.fullName,
        locale: user.locale,
        token: issued.token,
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      // Nothing about the account, the address or the token: only that the background step failed.
      this.logger.error('self-service password reset failed after the response', error instanceof Error ? error.stack : String(error));
    }
  }

  /**
   * Consumes the reset token, stores the new password, unlocks the account,
   * revokes every session and opens a new one as `login` would. Access tokens
   * issued before the change die through `password_changed_at` (AuthService).
   */
  async confirmPasswordReset(token: string, newPassword: string, ctx: RequestContext): Promise<IssuedSession> {
    const problems = passwordProblems(newPassword);
    if (problems.length > 0) throw authError.passwordWeak(problems);

    const reset = await this.loadUsableReset(token, new Date());
    if (reset.user.passwordHash && (await this.passwords.verify(reset.user.passwordHash, newPassword))) {
      throw authError.passwordWeak(['different from the current password']);
    }
    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();

    await this.prisma.db.$transaction(async (tx) => {
      // Exactly one request may flip consumed_at; the loser of a race sees the generic 404.
      const consumed = await tx.verificationToken.updateMany({
        where: { id: reset.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw usersError.resetInvalid();
      await tx.user.update({
        where: { id: reset.user.id },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // Every device is signed out: whoever held the old password or a cookie is gone (AC 2).
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: reset.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          action: ACCOUNT_AUDIT_ACTIONS.passwordReset,
          actorUserId: reset.user.id,
          entityType: 'users',
          entityId: reset.user.id,
          metadata: { resetId: reset.id, revokedSessions: revoked.count },
          ...ctx,
        },
        tx,
      );
    });

    return this.auth.openSession(reset.user.id, 'password_reset', ctx);
  }

  /**
   * One transaction: retires the pending reset tokens of the account, stores
   * the hash of a fresh one, optionally flags the account, and records
   * `users.password_reset.issued` (the token itself appears nowhere).
   */
  private async createPasswordReset(
    user: { id: string },
    options: { via: PasswordResetOrigin; actorUserId: string | null; mustChangePassword: boolean },
    ctx: RequestContext,
  ): Promise<IssuedPasswordReset> {
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.passwordResetExpiry(now);

    await this.prisma.db.$transaction(async (tx) => {
      const retired = await tx.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'password_reset', consumedAt: null },
        data: { consumedAt: now },
      });
      const created = await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'password_reset',
          tokenHash: generated.hash,
          expiresAt,
          metadata: { via: options.via, issuedBy: options.actorUserId },
        },
        select: { id: true },
      });
      if (options.mustChangePassword) {
        await tx.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      }
      await this.audit.record(
        {
          action: ACCOUNT_AUDIT_ACTIONS.passwordResetIssued,
          actorUserId: options.actorUserId,
          entityType: 'users',
          entityId: user.id,
          metadata: { resetId: created.id, via: options.via, superseded: retired.count, expiresAt: expiresAt.toISOString() },
          ...ctx,
        },
        tx,
      );
    });

    return { token: generated.token, expiresAt };
  }

  // ------------------------------------------ e-mail verification (LR-01-T02)

  /**
   * API-165: the signed-in user asks for a confirmation e-mail to their own
   * address. Refused when there is no address (422), it is already confirmed
   * (409), no transport reaches the user (503 — `MAIL_TRANSPORT=none`), or
   * three were issued in the last 15 minutes (429). The token travels in the
   * e-mail only — never in this response (D-R78).
   */
  async requestEmailVerification(caller: AuthPrincipal, ctx: RequestContext): Promise<RequestEmailVerificationResponseDto> {
    const user = await this.prisma.db.user.findFirst({
      where: { id: caller.id, deletedAt: null },
      select: { id: true, email: true, emailVerifiedAt: true, fullName: true, displayName: true, locale: true },
    });
    if (!user) throw usersError.userNotFound();
    if (!user.email) throw usersError.emailMissing();
    if (user.emailVerifiedAt) throw usersError.emailAlreadyVerified(user.emailVerifiedAt);
    if (this.mail.transportName === 'none') throw usersError.mailUnavailable();
    const recent = await this.prisma.db.verificationToken.count({
      where: {
        userId: user.id,
        purpose: 'email_verification',
        createdAt: { gte: new Date(Date.now() - EMAIL_VERIFICATION_WINDOW_MS) },
      },
    });
    if (recent >= EMAIL_VERIFICATION_REQUEST_LIMIT) throw authError.rateLimited();

    const { expiresAt, delivery } = await this.issueEmailVerification({ ...user, email: user.email }, 'self', ctx);
    return { expiresAt: expiresAt.toISOString(), delivery: { transport: delivery.transport, status: delivery.status } };
  }

  /**
   * API-166 (public): the link from the e-mail. Sets `email_verified_at` —
   * the only path that does (D-R78) — when the token is unused and unexpired
   * and the account is active and still has the address the token was issued
   * for. Opens no session: the link may be opened on any device.
   */
  async confirmEmailVerification(token: string, ctx: RequestContext): Promise<ConfirmEmailVerificationResponseDto> {
    if (!this.tokens.isWellFormed(token)) throw usersError.verificationInvalid();
    const row = await this.prisma.db.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
      select: VERIFICATION_SELECT,
    });
    if (!row || row.purpose !== 'email_verification' || row.consumedAt !== null) throw usersError.verificationInvalid();
    const now = new Date();
    if (row.expiresAt <= now) throw usersError.verificationExpired(row.expiresAt);
    const email = issuedForEmail(row.metadata);
    if (!email || row.user.deletedAt !== null || row.user.status !== RESETTABLE_STATUS || row.user.email !== email) {
      throw usersError.verificationInvalid();
    }

    await this.prisma.db.$transaction(async (tx) => {
      const consumed = await tx.verificationToken.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw usersError.verificationInvalid();
      // Conditional: an address changed after the checks above confirms nothing.
      const verified = await tx.user.updateMany({
        where: { id: row.user.id, email, deletedAt: null },
        data: { emailVerifiedAt: now },
      });
      if (verified.count !== 1) throw usersError.verificationInvalid();
      await this.audit.record(
        {
          action: ACCOUNT_AUDIT_ACTIONS.emailVerified,
          actorUserId: row.user.id,
          entityType: 'users',
          entityId: row.user.id,
          metadata: { verificationId: row.id },
          ...ctx,
        },
        tx,
      );
    });
    return { emailVerifiedAt: now.toISOString() };
  }

  /**
   * One transaction: retires the pending confirmation tokens of the account,
   * stores the hash of a fresh one with the address it confirms, and records
   * `users.email_verification.issued`; then mails the link (never logged,
   * never returned).
   */
  private async issueEmailVerification(
    user: VerificationRecipient,
    via: EmailVerificationOrigin,
    ctx: RequestContext,
  ): Promise<{ expiresAt: Date; delivery: MailDeliveryResult }> {
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.emailVerificationExpiry(now);

    await this.prisma.db.$transaction(async (tx) => {
      const retired = await tx.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'email_verification', consumedAt: null },
        data: { consumedAt: now },
      });
      const created = await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'email_verification',
          tokenHash: generated.hash,
          expiresAt,
          metadata: { email: user.email, via },
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: ACCOUNT_AUDIT_ACTIONS.emailVerificationIssued,
          actorUserId: user.id,
          entityType: 'users',
          entityId: user.id,
          metadata: { verificationId: created.id, via, superseded: retired.count, expiresAt: expiresAt.toISOString() },
          ...ctx,
        },
        tx,
      );
    });

    const delivery = await this.mail.sendEmailVerification({
      userId: user.id,
      to: user.email,
      recipientName: user.displayName ?? user.fullName,
      locale: user.locale,
      token: generated.token,
      expiresAt,
    });
    return { expiresAt, delivery };
  }

  private async verifyAfterAcceptance(user: VerificationRecipient, ctx: RequestContext): Promise<void> {
    try {
      await this.issueEmailVerification(user, 'invitation', ctx);
    } catch (error) {
      // Nothing about the account, the address or the token.
      this.logger.error('e-mail verification after an accepted invitation failed', error instanceof Error ? error.stack : String(error));
    }
  }

  // ------------------------------------------------------------- lookup

  /**
   * The account an administrative token is issued for. Authorisation before
   * state: a caller who may not act on this account learns nothing about its
   * status (SEC-R-13 for invitations, SEC-R-15 for password resets).
   */
  private async loadTarget(userId: string, caller: AuthPrincipal): Promise<TargetRow> {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, deletedAt: null }, select: TARGET_SELECT });
    if (!user) throw usersError.userNotFound();
    const exceeding = exceedingPermissions(
      activePermissionKeys(user.roles.map((grant) => grant.role)),
      caller.permissions,
    );
    if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
    return user;
  }

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

  /**
   * Same for a password-reset token: malformed/unknown/other purpose/already
   * used or replaced → 404 `reset_invalid` (one code — a used reset link has
   * nothing to tell its holder); past expiry → 410 `reset_expired`; account
   * deleted or no longer `active` → 404.
   */
  private async loadUsableReset(token: string, now: Date): Promise<ResetRow> {
    if (!this.tokens.isWellFormed(token)) throw usersError.resetInvalid();
    const row = await this.prisma.db.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
      select: RESET_SELECT,
    });
    if (!row || row.purpose !== 'password_reset' || row.consumedAt !== null) throw usersError.resetInvalid();
    if (row.expiresAt <= now) throw usersError.resetExpired(row.expiresAt);
    if (row.user.deletedAt !== null || row.user.status !== RESETTABLE_STATUS) throw usersError.resetInvalid();
    return row;
  }
}
