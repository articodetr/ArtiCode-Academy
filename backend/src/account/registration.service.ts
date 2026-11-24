import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSelfRegistrationOpen, readSettings } from '../academy/academy.settings.js';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import { PasswordService, passwordProblems } from '../auth/password.service.js';
import type { RequestContext } from '../auth/principal.js';
import { STUDENT_ROLE_KEY } from '../classes/classes.policy.js';
import type { Env } from '../config/env.schema.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Locale, UserStatus } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { maskEmail } from './account.masking.js';
import type { RegistrationCompletedDto, RegistrationPreviewDto } from './registration.dto.js';
import { registrationError } from './registration.errors.js';
import { checkCompleteBody, checkRegisterBody, isPendingSelfRegistration } from './registration.rules.js';
import type { RegisterInput } from './registration.rules.js';
import {
  SELF_REGISTRATION_TOKEN_WHERE,
  SELF_REGISTRATION_VIA,
  VerificationTokenService,
  isSelfRegistrationToken,
} from './verification-token.service.js';

export const REGISTRATION_AUDIT_ACTIONS = {
  /** A pending account was created by a visitor (`{ via: 'email' }`; Google sign-up records `{ via: 'google' }`). */
  selfRegistered: 'users.self_registered',
  /** The visitor opened the e-mailed link and chose the password: the account is `active`. */
  completed: 'users.self_registration.completed',
} as const;

/**
 * At most 3 registration links per pending account per 15 minutes, counted from
 * the stored tokens (as API-165 counts its confirmations — D-R78). A request past
 * it still answers 202 and sends nothing: the throttles bound the requests, this
 * bounds the mails one address can receive however many IPs ask.
 */
export const REGISTRATION_RESEND_LIMIT = 3;
export const REGISTRATION_RESEND_WINDOW_MS = 15 * 60 * 1000;

type Tx = Prisma.TransactionClient;

// The account behind an address. The password hash is read only to know whether
// the account has one (`isPendingSelfRegistration()`); it never leaves the service.
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  status: true,
  deletedAt: true,
  passwordHash: true,
  locale: true,
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

const LINK_SELECT = {
  id: true,
  purpose: true,
  metadata: true,
  expiresAt: true,
  consumedAt: true,
  user: { select: { id: true, email: true, fullName: true, status: true, deletedAt: true, passwordHash: true } },
} satisfies Prisma.VerificationTokenSelect;

type LinkRow = Prisma.VerificationTokenGetPayload<{ select: typeof LINK_SELECT }>;

/** A live (not soft-deleted) self-registered account still waiting for its holder. */
function awaiting(user: { status: UserStatus; deletedAt: Date | null; passwordHash: string | null }): boolean {
  return user.deletedAt === null && isPendingSelfRegistration(user);
}

/** The address a registration token was issued for (its metadata), or null. */
function issuedForEmail(metadata: Prisma.JsonValue | null): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata['email'] === 'string') {
    return metadata['email'];
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * PORTAL-03 (#207, the agreed contract v2) — a visitor creates their own student
 * account. Three public routes, all closed (`403 registration_disabled`) unless
 * `settings.selfRegistration.enabled` is true AND a mail transport exists
 * (`isSelfRegistrationOpen()`, the rule of API-205):
 *
 *  - `register` validates the body and answers 202 with no body; only then, in
 *    the background, is the address looked up — a new one gets a `pending`
 *    account without a password (the `student` role and a student profile) and
 *    an e-mailed link, a pending self-registered one a fresh link, any other
 *    account the notice «لديك حساب بالفعل», a soft-deleted one nothing. The
 *    answer and its timing reveal nothing about the address;
 *  - `preview` tells the link holder the name and the masked address;
 *  - `complete` stores the chosen password, activates the account and confirms
 *    the address together — the only way such an account becomes `active` — and
 *    opens no session.
 *
 * Self-registration tokens are `email_verification` tokens with the metadata
 * `{ via: 'self_registration', email }` (the kind guard of
 * verification-token.service.ts). Lock order of every write on an existing
 * account: its `users` row (`FOR NO KEY UPDATE`, never `FOR UPDATE` — KI-079),
 * then its tokens.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly mailTransport: string;
  /** The background steps that have not finished yet (`whenIdle()`). */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.mailTransport = config.get('MAIL_TRANSPORT', { infer: true });
  }

  // ------------------------------------------------------------ register

  /**
   * `POST /api/account/register`. Checks, in order: open (403), the body (400
   * `registration_invalid`); then schedules the work and returns — the 202
   * leaves before any account is looked up.
   */
  async register(body: unknown, ctx: RequestContext): Promise<void> {
    await this.assertOpen();
    const checked = checkRegisterBody(body);
    if (!checked.ok) throw registrationError.invalid(checked.violations);
    const input = checked.value;
    this.inBackground(() => this.processRegistration(input, ctx));
  }

  /** Resolves when every background step scheduled so far has finished (tests; a graceful stop). */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all(this.inFlight);
  }

  private inBackground(work: () => Promise<void>): void {
    const job = new Promise<void>((resolve) => {
      setImmediate(() => {
        work()
          .catch((error: unknown) => {
            // Nothing about the address, the name or a token: only that the background step failed.
            this.logger.error('self-registration failed after the response', error instanceof Error ? error.stack : String(error));
          })
          .finally(resolve);
      });
    });
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  private async processRegistration(input: RegisterInput, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.db.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) return this.handleExisting(existing.id, input);
    try {
      await this.createPending(input, ctx);
    } catch (error) {
      // Two registrations of one new address at once: the unique index on the e-mail lets one account through;
      // the other request is handled as for an address that already has it.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.db.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (winner) await this.handleExisting(winner.id, input);
    }
  }

  /** A new address: the pending account, its role and profile, the first link and `users.self_registered` — one transaction. */
  private async createPending(input: RegisterInput, ctx: RequestContext): Promise<void> {
    const role = await this.prisma.db.role.findUnique({ where: { key: STUDENT_ROLE_KEY }, select: { id: true } });
    if (!role) {
      this.logger.error(`self-registration skipped: the system role "${STUDENT_ROLE_KEY}" is missing (run the seed)`);
      return;
    }
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.emailVerificationExpiry(now);
    const userId = await this.prisma.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          locale: input.locale,
          status: 'pending',
          passwordHash: null,
          // Only the seeded `student` role: nothing the visitor sends chooses a role, a permission or an academy.
          roles: { create: [{ roleId: role.id }] },
          studentProfile: { create: {} },
        },
        select: { id: true },
      });
      await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'email_verification',
          tokenHash: generated.hash,
          expiresAt,
          metadata: { via: SELF_REGISTRATION_VIA, email: input.email },
        },
      });
      await this.audit.record(
        {
          action: REGISTRATION_AUDIT_ACTIONS.selfRegistered,
          actorUserId: null,
          entityType: 'users',
          entityId: user.id,
          metadata: { via: 'email' },
          ...ctx,
        },
        tx,
      );
      return user.id;
    });
    await this.mail.sendRegistration({ userId, to: input.email, locale: input.locale, token: generated.token, expiresAt });
  }

  /**
   * An address that already has an account, decided on its locked row: a
   * pending self-registered account gets a fresh link (the older ones retired,
   * the stored name and locale unchanged; nothing past REGISTRATION_RESEND_LIMIT),
   * a soft-deleted one nothing, any other the notice «لديك حساب بالفعل» — and
   * nothing about it changes.
   */
  private async handleExisting(userId: string, input: RegisterInput): Promise<void> {
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.emailVerificationExpiry(now);
    const outcome = await this.prisma.db.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, userId);
      if (!account || account.deletedAt !== null || !account.email) return { kind: 'nothing' as const };
      if (!awaiting(account)) return { kind: 'notice' as const, account };
      const recent = await tx.verificationToken.count({
        where: { userId, ...SELF_REGISTRATION_TOKEN_WHERE, createdAt: { gte: new Date(now.getTime() - REGISTRATION_RESEND_WINDOW_MS) } },
      });
      if (recent >= REGISTRATION_RESEND_LIMIT) return { kind: 'capped' as const };
      await tx.verificationToken.updateMany({
        where: { userId, ...SELF_REGISTRATION_TOKEN_WHERE, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.verificationToken.create({
        data: {
          userId,
          purpose: 'email_verification',
          tokenHash: generated.hash,
          expiresAt,
          metadata: { via: SELF_REGISTRATION_VIA, email: account.email },
        },
      });
      return { kind: 'resend' as const, account };
    });

    // The language the visitor reads now, else the account's own.
    const accountLocale: Locale | null = outcome.kind === 'resend' || outcome.kind === 'notice' ? outcome.account.locale : null;
    const locale = input.locale ?? accountLocale;
    if (outcome.kind === 'resend') {
      await this.mail.sendRegistration({ userId, to: outcome.account.email!, locale, token: generated.token, expiresAt });
    } else if (outcome.kind === 'notice') {
      await this.mail.sendExistingAccountNotice({ userId, to: outcome.account.email!, locale });
    } else if (outcome.kind === 'capped') {
      this.logger.warn(`self-registration link not re-sent: ${REGISTRATION_RESEND_LIMIT} in the last 15 minutes`);
    }
  }

  // ------------------------------------------------------------- preview

  /** `GET /api/account/register/:token`: open (403) → the link (404/410). */
  async preview(token: string): Promise<RegistrationPreviewDto> {
    await this.assertOpen();
    const link = await this.loadUsableLink(token, new Date());
    return {
      fullName: link.user.fullName,
      maskedEmail: maskEmail(link.user.email!),
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------ complete

  /**
   * `POST /api/account/register/:token/complete`. Checks, in order: open (403)
   * → the link (404 `registration_link_invalid` / 410 `registration_link_expired`
   * — a dead link is answered before the form, so nobody fixes a password for
   * it) → the body (400 `registration_invalid`) → the password policy of an
   * invitation (400 `password_weak`). Then, under the account's row lock, the
   * token is consumed (exactly one request can) and the account becomes
   * `active` with the password, `password_changed_at` and `email_verified_at`
   * together, its other open registration links retired; one
   * `users.self_registration.completed`. No session opens.
   */
  async complete(token: string, body: unknown, ctx: RequestContext): Promise<RegistrationCompletedDto> {
    await this.assertOpen();
    const link = await this.loadUsableLink(token, new Date());
    const checked = checkCompleteBody(body);
    if (!checked.ok) throw registrationError.invalid(checked.violations);
    const { password, fullName } = checked.value;
    const problems = passwordProblems(password);
    if (problems.length > 0) throw authError.passwordWeak(problems);

    const passwordHash = await this.passwords.hash(password);
    const email = issuedForEmail(link.metadata)!;
    const nameChanged = fullName !== null && fullName !== link.user.fullName;
    const now = new Date();

    await this.prisma.db.$transaction(async (tx) => {
      await this.lockAccount(tx, link.user.id);
      const consumed = await tx.verificationToken.updateMany({
        where: { id: link.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw registrationError.linkInvalid();
      // Conditional: an account completed, given a password, deleted or re-addressed meanwhile is not completed again.
      const activated = await tx.user.updateMany({
        where: { id: link.user.id, status: 'pending', passwordHash: null, deletedAt: null, email },
        data: {
          status: 'active',
          passwordHash,
          passwordChangedAt: now,
          emailVerifiedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          ...(nameChanged ? { fullName: fullName! } : {}),
        },
      });
      if (activated.count !== 1) throw registrationError.linkInvalid();
      await tx.verificationToken.updateMany({
        where: { userId: link.user.id, ...SELF_REGISTRATION_TOKEN_WHERE, consumedAt: null },
        data: { consumedAt: now },
      });
      await this.audit.record(
        {
          action: REGISTRATION_AUDIT_ACTIONS.completed,
          actorUserId: link.user.id,
          entityType: 'users',
          entityId: link.user.id,
          metadata: { verificationId: link.id, nameChanged },
          ...ctx,
        },
        tx,
      );
    });
    return { completed: true };
  }

  // -------------------------------------------------------------- shared

  /** 403 `registration_disabled` unless the academy takes registrations and an e-mail can leave the server. */
  private async assertOpen(): Promise<void> {
    const row = await this.prisma.db.academy.findFirst({ select: { settings: true } });
    if (!row || !isSelfRegistrationOpen(readSettings(row.settings), this.mailTransport)) throw registrationError.disabled();
  }

  /**
   * A raw token → a usable registration link, or: malformed, unknown, not a
   * self-registration token (an API-165/166 confirmation, an invitation, a
   * reset), used or replaced → 404; past its expiry → 410; the account no
   * longer waiting (completed, given a password, deleted) or no longer holding
   * the address the link was sent to → 404.
   */
  private async loadUsableLink(token: string, now: Date): Promise<LinkRow> {
    if (!this.tokens.isWellFormed(token)) throw registrationError.linkInvalid();
    const row = await this.prisma.db.verificationToken.findUnique({ where: { tokenHash: this.tokens.hash(token) }, select: LINK_SELECT });
    if (!row || !isSelfRegistrationToken(row) || row.consumedAt !== null) throw registrationError.linkInvalid();
    if (row.expiresAt <= now) throw registrationError.linkExpired(row.expiresAt);
    const email = issuedForEmail(row.metadata);
    if (!email || !awaiting(row.user) || row.user.email !== email) throw registrationError.linkInvalid();
    return row;
  }

  /** The account row locked `FOR NO KEY UPDATE` for the rest of the transaction, re-read under the lock. */
  private async lockAccount(tx: Tx, userId: string): Promise<AccountRow | null> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    return tx.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
  }
}
