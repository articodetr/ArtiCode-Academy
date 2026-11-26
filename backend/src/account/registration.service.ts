import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { isSelfRegistrationOpen, readSettings } from '../academy/academy.settings.js';
import { AuditService } from '../audit/audit.service.js';
import { authError } from '../auth/auth.errors.js';
import { AuthService } from '../auth/auth.service.js';
import type { IssuedSession } from '../auth/auth.service.js';
import { PasswordService, passwordProblems } from '../auth/password.service.js';
import type { RequestContext } from '../auth/principal.js';
import { STUDENT_ROLE_KEY } from '../classes/classes.policy.js';
import { Prisma } from '../generated/prisma/client.js';
import type { UserStatus } from '../generated/prisma/client.js';
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
import { SELF_REGISTRATION_TOKEN_WHERE, VerificationTokenService, isSelfRegistrationToken } from './verification-token.service.js';

export const REGISTRATION_AUDIT_ACTIONS = {
  /**
   * A visitor created their own ACTIVE student account (`{ via: 'email' }`; Google sign-up records
   * `{ via: 'google' }`). The actor is the new account itself, as for Google.
   */
  selfRegistered: 'users.self_registered',
  /**
   * LEGACY (contract v3, before the direct registration): the visitor opened an e-mailed link and typed the password
   * chosen at registration — the pending account became `active`.
   */
  completed: 'users.self_registration.completed',
} as const;

/**
 * LEGACY contract v3: the wrong passwords one confirmation link takes. The count
 * lives in the link's metadata (`attempts`), written under the account's row
 * lock; the wrong password that reaches it retires the link (`attemptsLeft: 0`),
 * and the next try is `404 registration_link_invalid`.
 */
export const REGISTRATION_PASSWORD_ATTEMPTS = 5;

/**
 * The completion holds the account's row lock while it checks the password
 * (argon2id): many completions at once queue for the hashing threads, so the
 * transaction gets more than Prisma's default 2 s / 5 s.
 */
const COMPLETION_TX = { maxWait: 10_000, timeout: 15_000 } as const;

type Tx = Prisma.TransactionClient;

// The account a legacy completion activates. The password hash is read to check the typed password against it; it
// never leaves the service.
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

/** A live (not soft-deleted) self-registered account still waiting for its holder (legacy flow). */
function awaiting(user: { status: UserStatus; deletedAt: Date | null; selfRegisteredAt: Date | null }): boolean {
  return user.deletedAt === null && isPendingSelfRegistration(user);
}

/**
 * An account a legacy confirmation link can activate: awaiting its holder AND
 * holding the password chosen at registration. A v2 self-registration never
 * finished has none — its link can never be completed.
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
 * PORTAL-03/04 (#207) — a visitor creates their own student account. Every
 * route is closed (`403 registration_disabled`) unless
 * `settings.selfRegistration.enabled` is true (`isSelfRegistrationOpen()`, the
 * rule of the `selfRegistration` flag of API-205 — no mail transport needed).
 *
 *  - `register` (the DIRECT registration): checks the body and the password
 *    policy, then the address — an address any account already has (whatever
 *    its state, soft-deleted included) is `409 email_in_use` and that account is
 *    left untouched; otherwise ONE transaction creates an `active` student (the
 *    seeded `student` role and an empty student profile, nothing the visitor
 *    chose), marked `self_registered_at`, with the chosen password and the
 *    address NOT confirmed (`email_verified_at` NULL — it was never proven), and
 *    records `users.self_registered { via: 'email' }`; then the session opens
 *    exactly like a sign-in (`auth.login.succeeded { via: 'self_registration' }`).
 *    No e-mail, no link, no approval.
 *  - LEGACY `preview` / `complete`: the accounts the e-mailed flow (contract v3)
 *    left `pending` with a link already mailed still complete through it — the
 *    link holder sees the name and the masked address, and typing the password
 *    chosen at registration activates the account, confirms the address and
 *    signs in. No new such account is created any more.
 *
 * Lock order of a legacy completion: the account's `users` row (`FOR NO KEY
 * UPDATE`, never `FOR UPDATE` — KI-079), then its tokens.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VerificationTokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  // ------------------------------------------------------------ register

  /**
   * `POST /api/account/register`. Checks, in order: open (403
   * `registration_disabled`), the body (400 `registration_invalid`), the
   * password policy of an invitation (400 `password_weak`), the address (409
   * `email_in_use` — nothing about that account changes). Then the active
   * student account and its `users.self_registered` event in one transaction (a
   * concurrent registration of the same address that wins the unique index makes
   * this one `409 email_in_use` too), and the session.
   */
  async register(body: unknown, ctx: RequestContext): Promise<IssuedSession> {
    await this.assertOpen();
    const checked = checkRegisterBody(body);
    if (!checked.ok) throw registrationError.invalid(checked.violations);
    const problems = passwordProblems(checked.value.password);
    if (problems.length > 0) throw authError.passwordWeak(problems);
    const { password, ...input } = checked.value;

    // Any row holding the address (the unique index): active, pending, invited, suspended, archived or soft-deleted.
    if (await this.addressTaken(input.email)) throw registrationError.emailInUse();

    const role = await this.prisma.db.role.findUnique({ where: { key: STUDENT_ROLE_KEY }, select: { id: true } });
    if (!role) {
      this.logger.error(`self-registration refused: the system role "${STUDENT_ROLE_KEY}" is missing (run the seed)`);
      throw new ServiceUnavailableException('Self-registration is not available');
    }

    // Hashed outside the transaction (argon2id is slow); the plain password goes no further.
    const passwordHash = await this.passwords.hash(password);
    const now = new Date();
    let userId: string;
    try {
      userId = await this.prisma.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            locale: input.locale,
            status: 'active',
            // Never confirmed here: the address was not proven. Google never links such an account by its e-mail.
            emailVerifiedAt: null,
            passwordHash,
            passwordChangedAt: now,
            mustChangePassword: false,
            selfRegisteredAt: now,
            // Only the seeded `student` role: nothing the visitor sends chooses a role, a permission or an academy.
            roles: { create: [{ roleId: role.id }] },
            studentProfile: { create: {} },
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: REGISTRATION_AUDIT_ACTIONS.selfRegistered,
            actorUserId: user.id,
            entityType: 'users',
            entityId: user.id,
            metadata: { via: 'email' },
            ...ctx,
          },
          tx,
        );
        return user.id;
      });
    } catch (error) {
      // Two registrations of one new address at once: the unique index on the e-mail lets one account through.
      if (isUniqueViolation(error) && (await this.addressTaken(input.email))) throw registrationError.emailInUse();
      throw error;
    }
    return this.auth.openSession(userId, 'self_registration', ctx);
  }

  private async addressTaken(email: string): Promise<boolean> {
    return (await this.prisma.db.user.findUnique({ where: { email }, select: { id: true } })) !== null;
  }

  // ------------------------------------------------------ preview (legacy)

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

  // ----------------------------------------------------- complete (legacy)

  /**
   * `POST /api/account/register/:token/complete` — LEGACY, for the accounts the
   * e-mailed flow left pending. Checks, in order: open (403) → the link (404
   * `registration_link_invalid` / 410 `registration_link_expired` — a dead link
   * is answered before the form) → the body (400 `registration_invalid`) →
   * then, under the account's row lock, the link and the account again and the
   * typed password against the one chosen at registration: a wrong one is `400
   * registration_password_incorrect { attemptsLeft }`, counted on the link and
   * committed before the answer (the 5th retires the link). The right one
   * consumes the link (exactly one request can), sets the account `active` with
   * `email_verified_at` (opening the link proved the address), retires its
   * other links and records `users.self_registration.completed` — one
   * transaction; then the session opens (`auth.login.succeeded { via:
   * 'self_registration' }`), like an accepted invitation.
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
      // Every completion of this account runs one at a time from here on: the lock serialises the attempts count
      // and the consumption of the link.
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

  /** 403 `registration_disabled` unless the academy takes registrations (`isSelfRegistrationOpen()`). */
  private async assertOpen(): Promise<void> {
    const row = await this.prisma.db.academy.findFirst({ select: { settings: true } });
    if (!row || !isSelfRegistrationOpen(readSettings(row.settings))) throw registrationError.disabled();
  }

  /**
   * A raw token → a usable legacy registration link, or: malformed, unknown,
   * not a self-registration token (an API-165/166 confirmation, an invitation,
   * a reset), used, replaced or retired → 404; past its expiry → 410; the
   * account no longer waiting (completed, deleted), without the password chosen
   * at registration (a v2 registration never finished — it can never be
   * completed), or no longer holding the address the link was sent to → 404.
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
