import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSelfRegistrationOpen, readSettings } from '../academy/academy.settings.js';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import { AuthService } from '../auth/auth.service.js';
import type { IssuedSession } from '../auth/auth.service.js';
import { PasswordService, passwordProblems } from '../auth/password.service.js';
import type { RequestContext } from '../auth/principal.js';
import { STUDENT_ROLE_KEY } from '../classes/classes.policy.js';
import type { Env } from '../config/env.schema.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Locale, UserStatus } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { maskEmail } from './account.masking.js';
import type { RegistrationPreviewDto } from './registration.dto.js';
import { registrationError } from './registration.errors.js';
import {
  PENDING_SELF_REGISTRATION_WHERE,
  checkCompleteBody,
  checkRegisterBody,
  isPendingSelfRegistration,
} from './registration.rules.js';
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
  /** The visitor opened the e-mailed link and typed the password chosen at registration: the account is `active`. */
  completed: 'users.self_registration.completed',
  /**
   * The notice «لديك حساب بالفعل» was sent to an existing account (actor NULL, no metadata) — the stored row the
   * notice limit counts (REGISTRATION_NOTICE_LIMIT) and part of the academy's daily budget (REGISTRATION_MAIL_DAILY_LIMIT).
   */
  noticeSent: 'users.self_registration.notice_sent',
} as const;

/**
 * At most 3 registration links per pending account per 15 minutes, counted from
 * the stored tokens (as API-165 counts its confirmations — D-R78). A request past
 * it still answers 202 and sends — and changes — nothing: the throttles bound the
 * requests, this bounds the mails one address can receive however many IPs ask.
 */
export const REGISTRATION_RESEND_LIMIT = 3;
export const REGISTRATION_RESEND_WINDOW_MS = 15 * 60 * 1000;

/**
 * At most one «لديك حساب بالفعل» per account per 24 hours, counted from its
 * `users.self_registration.notice_sent` events: anybody can type somebody
 * else's address, and the notice must not become a way to flood its holder.
 */
export const REGISTRATION_NOTICE_LIMIT = 1;
export const REGISTRATION_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The academy's ceiling of registration e-mails — links (the self-registration
 * tokens) and notices (their events) together — per 24 hours, counted from the
 * stored rows under one advisory lock (REGISTRATION_MAIL_BUDGET_LOCK), so many
 * addresses from many IPs cannot turn the academy's sending domain into a
 * spam source or spend its provider quota. Past it a request still answers 202
 * and nothing is created or sent.
 */
export const REGISTRATION_MAIL_DAILY_LIMIT = 300;
export const REGISTRATION_MAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The transaction-level advisory lock that serialises the daily budget (count, then reserve). */
export const REGISTRATION_MAIL_BUDGET_LOCK = 'articode.registration.mail_budget';

/**
 * Contract v3: the wrong passwords one confirmation link takes. The count lives
 * in the link's metadata (`attempts`), written under the account's row lock; the
 * wrong password that reaches it retires the link (`attemptsLeft: 0`), and the
 * next try is `404 registration_link_invalid` — the visitor registers again.
 */
export const REGISTRATION_PASSWORD_ATTEMPTS = 5;

/**
 * The completion holds the account's row lock while it checks the password
 * (argon2id): many completions at once queue for the hashing threads, so the
 * transaction gets more than Prisma's default 2 s / 5 s.
 */
const COMPLETION_TX = { maxWait: 10_000, timeout: 15_000 } as const;

/** The models the budget is counted from (a transaction or a client). */
type BudgetReader = Pick<Prisma.TransactionClient, 'verificationToken' | 'auditLog'>;

/**
 * The registration e-mails reserved since `since`: every self-registration
 * token issued (one link e-mail each — retired or used ones included) plus
 * every notice event. The rows of an account removed since then are gone with
 * it (its tokens cascade), which only ever gives back budget.
 */
export async function countRegistrationMails(db: BudgetReader, since: Date): Promise<number> {
  // One after the other: inside an interactive transaction the two would share one connection (KI-074).
  const links = await db.verificationToken.count({ where: { ...SELF_REGISTRATION_TOKEN_WHERE, createdAt: { gte: since } } });
  const notices = await db.auditLog.count({ where: { action: REGISTRATION_AUDIT_ACTIONS.noticeSent, createdAt: { gte: since } } });
  return links + notices;
}

type Tx = Prisma.TransactionClient;

/** A registration whose password is already hashed: the plain password never goes further than the hashing. */
type HashedRegistration = Omit<RegisterInput, 'password'> & { passwordHash: string };

// The account behind an address, as the background registration decides on it.
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  status: true,
  deletedAt: true,
  selfRegisteredAt: true,
  locale: true,
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

// The account a completion activates. The password hash is read to check the typed password against it; it never
// leaves the service.
const COMPLETION_SELECT = {
  id: true,
  email: true,
  status: true,
  deletedAt: true,
  selfRegisteredAt: true,
  passwordHash: true,
} satisfies Prisma.UserSelect;

const LINK_SELECT = {
  id: true,
  purpose: true,
  metadata: true,
  expiresAt: true,
  consumedAt: true,
  user: { select: { ...COMPLETION_SELECT, fullName: true } },
} satisfies Prisma.VerificationTokenSelect;

type LinkRow = Prisma.VerificationTokenGetPayload<{ select: typeof LINK_SELECT }>;

/** What the completion transaction decided: done (the session opens after the commit), or a refusal to throw after it. */
type CompletionOutcome = { kind: 'completed' } | { kind: 'refused'; error: Error };

/** A live (not soft-deleted) self-registered account still waiting for its holder. */
function awaiting(user: { status: UserStatus; deletedAt: Date | null; selfRegisteredAt: Date | null }): boolean {
  return user.deletedAt === null && isPendingSelfRegistration(user);
}

/**
 * An account a confirmation link can activate: awaiting its holder AND holding
 * the password chosen at registration. A v2 self-registration never finished
 * has none — its link can never be completed (the visitor registers again).
 */
function completable(user: { status: UserStatus; deletedAt: Date | null; selfRegisteredAt: Date | null; passwordHash: string | null }): boolean {
  return awaiting(user) && user.passwordHash !== null;
}

/** The token's metadata as an object (empty for anything else). */
function metadataObject(metadata: Prisma.JsonValue | null): Prisma.JsonObject {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

/** The address a registration token was issued for (its metadata), or null. */
function issuedForEmail(metadata: Prisma.JsonValue | null): string | null {
  const email = metadataObject(metadata)['email'];
  return typeof email === 'string' ? email : null;
}

/** The wrong passwords already typed for a link (its metadata `attempts`; 0 when absent or malformed). */
export function wrongPasswordAttempts(metadata: Prisma.JsonValue | null): number {
  const attempts = metadataObject(metadata)['attempts'];
  return typeof attempts === 'number' && Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * PORTAL-03/04 (#207, contract v3 — the password is chosen on /register) — a
 * visitor creates their own student account. Three public routes, all closed
 * (`403 registration_disabled`) unless `settings.selfRegistration.enabled` is
 * true AND a mail transport exists (`isSelfRegistrationOpen()`, the rule of
 * API-205):
 *
 *  - `register` checks the body and the password policy and answers 202 with no
 *    body; only then, in the background, is the password hashed and the address
 *    looked up — a new one gets a `pending` account with that password, marked
 *    `self_registered_at` (the `student` role and a student profile), and an
 *    e-mailed link; a pending self-registered one gets the new password (the
 *    latest registration wins) and a fresh link; any other account the notice
 *    «لديك حساب بالفعل»; a soft-deleted one nothing. The answer and its timing
 *    reveal nothing about the address;
 *  - `preview` tells the link holder the name and the masked address;
 *  - `complete` activates the account and confirms the address together — the
 *    only way such an account becomes `active` — but ONLY when the visitor types
 *    the password chosen at registration: whoever holds the mailbox but did not
 *    register cannot complete somebody else's registration of their address
 *    (no pre-hijacking), and whoever registered proves both the mailbox (the
 *    link) and the password. A wrong password counts on the link (5, then the
 *    link is retired). The completion then opens the session, like an
 *    accepted invitation.
 *
 * Self-registration tokens are `email_verification` tokens with the metadata
 * `{ via: 'self_registration', email, attempts? }` (the kind guard of
 * verification-token.service.ts). Lock order of every write on an existing
 * account: its `users` row (`FOR NO KEY UPDATE`, never `FOR UPDATE` — KI-079),
 * then the daily e-mail budget (REGISTRATION_MAIL_BUDGET_LOCK), then its tokens.
 * Every e-mail is bounded three ways (review #3): the throttles bound the
 * requests, the per-account limits bound what one address receives (3 links
 * per 15 minutes, 1 notice per 24 hours) and the daily budget bounds what the
 * academy sends (300 per 24 hours); past any of them the request still answers
 * 202 and nothing is sent or changed.
 */
@Injectable()
export class RegistrationService implements OnModuleDestroy {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly mailTransport: string;
  /** The background steps that have not finished yet (`whenIdle()`). */
  private readonly inFlight = new Set<Promise<void>>();
  /**
   * The two e-mail limits, from the constants above. Mutable for the e2e suite
   * only: the 24-hour window counts the stored rows of earlier runs against the
   * same database too, so the suite lifts the daily ceiling and lowers it to
   * prove it.
   */
  readonly limits = { noticesPerAccount: REGISTRATION_NOTICE_LIMIT, mailsPerDay: REGISTRATION_MAIL_DAILY_LIMIT };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.mailTransport = config.get('MAIL_TRANSPORT', { infer: true });
  }

  /**
   * A graceful stop lets the registrations already answered with 202 finish
   * (review #9). `onModuleDestroy`, not `onApplicationShutdown`: Nest runs the
   * destroy hooks of this module before those of the global PrismaModule, whose
   * `onModuleDestroy` closes the database client — the shutdown hooks come only
   * after it, when the steps could no longer write.
   */
  async onModuleDestroy(): Promise<void> {
    await this.whenIdle();
  }

  // ------------------------------------------------------------ register

  /**
   * `POST /api/account/register`. Checks, in order: open (403), the body (400
   * `registration_invalid`), the password policy of an invitation (400
   * `password_weak` — about the typed password alone, so it reveals nothing
   * about any account); then schedules the work and returns — the 202 leaves
   * before the password is hashed or any account is looked up.
   */
  async register(body: unknown, ctx: RequestContext): Promise<void> {
    await this.assertOpen();
    const checked = checkRegisterBody(body);
    if (!checked.ok) throw registrationError.invalid(checked.violations);
    const problems = passwordProblems(checked.value.password);
    if (problems.length > 0) throw authError.passwordWeak(problems);
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
            // Nothing about the address, the name, the password or a token: only that the background step failed.
            this.logger.error('self-registration failed after the response', error instanceof Error ? error.stack : String(error));
          })
          .finally(resolve);
      });
    });
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  private async processRegistration(input: RegisterInput, ctx: RequestContext): Promise<void> {
    // Hashed for every request alike, after the response: what follows never sees the plain password.
    const { password, ...rest } = input;
    const registration: HashedRegistration = { ...rest, passwordHash: await this.passwords.hash(password) };
    const existing = await this.prisma.db.user.findUnique({ where: { email: registration.email }, select: { id: true } });
    if (existing) return this.handleExisting(existing.id, registration, ctx);
    try {
      await this.createPending(registration, ctx);
    } catch (error) {
      // Two registrations of one new address at once: the unique index on the e-mail lets one account through;
      // the other request is handled as for an address that already has it.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.db.user.findUnique({ where: { email: registration.email }, select: { id: true } });
      if (winner) await this.handleExisting(winner.id, registration, ctx);
    }
  }

  /**
   * A new address: the pending account with the chosen password and the
   * self-registration marker, its role and profile, the first link and
   * `users.self_registered` — one transaction, after the daily budget (nothing
   * is created past it: the address stays free for a later request).
   */
  private async createPending(input: HashedRegistration, ctx: RequestContext): Promise<void> {
    const role = await this.prisma.db.role.findUnique({ where: { key: STUDENT_ROLE_KEY }, select: { id: true } });
    if (!role) {
      this.logger.error(`self-registration skipped: the system role "${STUDENT_ROLE_KEY}" is missing (run the seed)`);
      return;
    }
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.emailVerificationExpiry(now);
    const userId = await this.prisma.db.$transaction(async (tx) => {
      if (!(await this.reserveMail(tx, now))) return null;
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          locale: input.locale,
          status: 'pending',
          passwordHash: input.passwordHash,
          passwordChangedAt: now,
          selfRegisteredAt: now,
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
    if (userId === null) return;
    await this.mail.sendRegistration({ userId, to: input.email, locale: input.locale, token: generated.token, expiresAt });
  }

  /**
   * An address that already has an account, decided on its locked row: a
   * pending self-registered account gets the new password (the latest
   * registration wins — its older links retired, so only the new one, with this
   * password, completes it; the stored name and locale unchanged) and a fresh
   * link — none of it past REGISTRATION_RESEND_LIMIT; a soft-deleted one
   * nothing; any other the notice «لديك حساب بالفعل» (at most
   * REGISTRATION_NOTICE_LIMIT per 24 hours, recorded as
   * `users.self_registration.notice_sent`) — and nothing about it changes.
   * Neither e-mail leaves, nor anything changes, past the academy's daily budget.
   */
  private async handleExisting(userId: string, input: HashedRegistration, ctx: RequestContext): Promise<void> {
    const generated = this.tokens.generate();
    const now = new Date();
    const expiresAt = this.tokens.emailVerificationExpiry(now);
    const outcome = await this.prisma.db.$transaction(async (tx) => {
      await this.lockUserRow(tx, userId);
      const account: AccountRow | null = await tx.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
      if (!account || account.deletedAt !== null || !account.email) return { kind: 'nothing' as const };
      if (!awaiting(account)) {
        // Counted on the locked row: two requests for one address at once never send two notices.
        const notices = await tx.auditLog.count({
          where: {
            action: REGISTRATION_AUDIT_ACTIONS.noticeSent,
            entityType: 'users',
            entityId: userId,
            createdAt: { gte: new Date(now.getTime() - REGISTRATION_NOTICE_WINDOW_MS) },
          },
        });
        if (notices >= this.limits.noticesPerAccount) return { kind: 'notice_capped' as const, notices };
        if (!(await this.reserveMail(tx, now))) return { kind: 'budget' as const };
        await this.audit.record(
          { action: REGISTRATION_AUDIT_ACTIONS.noticeSent, actorUserId: null, entityType: 'users', entityId: userId, ...ctx },
          tx,
        );
        return { kind: 'notice' as const, account };
      }
      const recent = await tx.verificationToken.count({
        where: { userId, ...SELF_REGISTRATION_TOKEN_WHERE, createdAt: { gte: new Date(now.getTime() - REGISTRATION_RESEND_WINDOW_MS) } },
      });
      if (recent >= REGISTRATION_RESEND_LIMIT) return { kind: 'capped' as const };
      if (!(await this.reserveMail(tx, now))) return { kind: 'budget' as const };
      await tx.user.update({ where: { id: userId }, data: { passwordHash: input.passwordHash, passwordChangedAt: now } });
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
    } else if (outcome.kind === 'notice_capped') {
      this.logger.warn(`existing-account notice not sent: ${outcome.notices} in the last 24 hours (limit ${this.limits.noticesPerAccount})`);
    }
  }

  /**
   * The academy's daily budget of registration e-mails: under the advisory
   * lock (held to the end of the transaction, so the count and the row that
   * reserves the next e-mail — a token or a notice event — are one step for
   * every concurrent request), true while fewer than `limits.mailsPerDay` were
   * reserved in the last 24 hours. Past it, a warning with the counts only.
   * Lock order: an account's row (handleExisting) before this lock, never the
   * other way round.
   */
  private async reserveMail(tx: Tx, now: Date): Promise<boolean> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${REGISTRATION_MAIL_BUDGET_LOCK}))`;
    const sent = await countRegistrationMails(tx, new Date(now.getTime() - REGISTRATION_MAIL_WINDOW_MS));
    if (sent < this.limits.mailsPerDay) return true;
    this.logger.warn(`self-registration e-mail not sent: ${sent} registration e-mails in the last 24 hours (limit ${this.limits.mailsPerDay})`);
    return false;
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
   * — a dead link is answered before the form) → the body (400
   * `registration_invalid`) → then, under the account's row lock, the link and
   * the account again and the typed password against the one chosen at
   * registration: a wrong one is `400 registration_password_incorrect
   * { attemptsLeft }`, counted on the link and committed before the answer (the
   * 5th retires the link). The right one consumes the link (exactly one request
   * can), sets the account `active` with `email_verified_at` (opening the link
   * proved the address), retires its other links and records
   * `users.self_registration.completed` — one transaction; then the session
   * opens (`auth.login.succeeded { via: 'self_registration' }`), like an
   * accepted invitation.
   */
  async complete(token: string, body: unknown, ctx: RequestContext): Promise<IssuedSession> {
    await this.assertOpen();
    const link = await this.loadUsableLink(token, new Date());
    const checked = checkCompleteBody(body);
    if (!checked.ok) throw registrationError.invalid(checked.violations);
    const { password } = checked.value;
    const email = issuedForEmail(link.metadata)!;
    const userId = link.user.id;
    const now = new Date();

    const outcome = await this.prisma.db.$transaction(async (tx): Promise<CompletionOutcome> => {
      // Every completion of this account runs one at a time from here on: the lock serialises the attempts count,
      // the consumption of the link and a new registration replacing the password (handleExisting locks it too).
      await this.lockUserRow(tx, userId);
      const account = await tx.user.findUnique({ where: { id: userId }, select: COMPLETION_SELECT });
      const current = await tx.verificationToken.findUnique({ where: { id: link.id }, select: { consumedAt: true, expiresAt: true, metadata: true } });
      if (!current || current.consumedAt !== null) return { kind: 'refused', error: registrationError.linkInvalid() };
      if (current.expiresAt <= now) return { kind: 'refused', error: registrationError.linkExpired(current.expiresAt) };
      if (!account || !completable(account) || account.email !== email) return { kind: 'refused', error: registrationError.linkInvalid() };

      if (!(await this.passwords.verify(account.passwordHash!, password))) {
        const attempts = wrongPasswordAttempts(current.metadata) + 1;
        const exhausted = attempts >= REGISTRATION_PASSWORD_ATTEMPTS;
        await tx.verificationToken.update({
          where: { id: link.id },
          data: {
            metadata: { ...metadataObject(current.metadata), attempts } as Prisma.InputJsonObject,
            ...(exhausted ? { consumedAt: now } : {}),
          },
        });
        return { kind: 'refused', error: registrationError.passwordIncorrect(Math.max(0, REGISTRATION_PASSWORD_ATTEMPTS - attempts)) };
      }

      const consumed = await tx.verificationToken.updateMany({ where: { id: link.id, consumedAt: null }, data: { consumedAt: now } });
      if (consumed.count !== 1) return { kind: 'refused', error: registrationError.linkInvalid() };
      // Conditional on what was checked: the same pending account, address and password.
      const activated = await tx.user.updateMany({
        where: { id: userId, ...PENDING_SELF_REGISTRATION_WHERE, deletedAt: null, email, passwordHash: account.passwordHash },
        data: { status: 'active', emailVerifiedAt: now, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      });
      if (activated.count !== 1) throw registrationError.linkInvalid();
      await tx.verificationToken.updateMany({
        where: { userId, ...SELF_REGISTRATION_TOKEN_WHERE, consumedAt: null },
        data: { consumedAt: now },
      });
      await this.audit.record(
        {
          action: REGISTRATION_AUDIT_ACTIONS.completed,
          actorUserId: userId,
          entityType: 'users',
          entityId: userId,
          metadata: { verificationId: link.id },
          ...ctx,
        },
        tx,
      );
      return { kind: 'completed' };
    }, COMPLETION_TX);

    if (outcome.kind === 'refused') throw outcome.error;
    return this.auth.openSession(userId, 'self_registration', ctx);
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
   * reset), used, replaced or retired → 404; past its expiry → 410; the account
   * no longer waiting (completed, deleted), without the password chosen at
   * registration (a v2 registration never finished — it can never be
   * completed: the visitor registers again), or no longer holding the address
   * the link was sent to → 404.
   */
  private async loadUsableLink(token: string, now: Date): Promise<LinkRow> {
    if (!this.tokens.isWellFormed(token)) throw registrationError.linkInvalid();
    const row = await this.prisma.db.verificationToken.findUnique({ where: { tokenHash: this.tokens.hash(token) }, select: LINK_SELECT });
    if (!row || !isSelfRegistrationToken(row) || row.consumedAt !== null) throw registrationError.linkInvalid();
    if (row.expiresAt <= now) throw registrationError.linkExpired(row.expiresAt);
    const email = issuedForEmail(row.metadata);
    if (!email || !completable(row.user) || row.user.email !== email) throw registrationError.linkInvalid();
    return row;
  }

  /** The account row locked `FOR NO KEY UPDATE` for the rest of the transaction (read it again after this). */
  private async lockUserRow(tx: Tx, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
  }
}
