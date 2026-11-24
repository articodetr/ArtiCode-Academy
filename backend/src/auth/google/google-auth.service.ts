// PORTAL-04 — Google sign-in (OpenID Connect, authorization code + PKCE).
//
// `start()` makes one attempt: a fresh state, nonce and PKCE verifier, signed
// into the `aca_google` cookie, and the authorization URL for the browser.
// `callback()` checks what Google sent back against that cookie, exchanges the
// code, verifies the ID token, finds or creates the account, and opens the
// session through AuthService.beginSession() — which answers the MFA challenge
// instead for an account with two-step verification. It never throws: every
// outcome is a redirect the controller answers.
//
// Account resolution (common contract B), in one transaction where it writes:
//   1. a `user_identities` row (google, sub) → that user;
//   2. else the user with the same e-mail: linked automatically only when the
//      account is `active` with a confirmed address of its own, or `pending`
//      from self-registration without a password (it then becomes `active`
//      with a confirmed address and its open confirmation links are retired);
//      anything else → `link_required`;
//   3. else a new student account — only while the academy accepts
//      self-registration (`settings.selfRegistration.enabled === true`).
// A suspended, archived, soft-deleted or locked account → `account_unavailable`
// (no failed login is counted). Audit: `auth.google.linked { via }` when an
// identity row is created, `users.self_registered { via: 'google' }` for a new
// account; `auth.login.succeeded { via: 'google' }` comes from the session
// code. Never the e-mail, the subject, a code or a token in metadata.
import { isPendingSelfRegistration } from '../../account/registration.rules.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readSettings } from '../../academy/academy.settings.js';
import { AuditService } from '../../audit/audit.service.js';
import type { Env } from '../../config/env.schema.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthHttpException } from '../auth.errors.js';
import { AuthService } from '../auth.service.js';
import type { IssuedSession } from '../auth.service.js';
import { isPendingMfa } from '../mfa-login.rules.js';
import type { RequestContext } from '../principal.js';
import { GoogleOidcClient, GoogleOidcError } from './google-oidc.client.js';
import type { GoogleIdentityClaims } from './google-oidc.client.js';
import {
  DEFAULT_RETURN_TO,
  buildAuthorizationUrl,
  deriveStateKey,
  isControlCode,
  newGoogleAttempt,
  signGoogleState,
  statesMatch,
  verifyGoogleState,
} from './google-state.js';
import type { GoogleFailureCode } from './google-state.js';
import { GOOGLE_OAUTH_CONFIG } from './google.config.js';
import type { GoogleOAuthConfig } from './google.config.js';
import { googleError } from './google.errors.js';

export const GOOGLE_AUDIT_ACTIONS = {
  linked: 'auth.google.linked',
  selfRegistered: 'users.self_registered',
} as const;

/** How an identity row came to exist (`auth.google.linked { via }`). */
export type GoogleLinkVia = 'existing_identity' | 'verified_email' | 'pending_registration' | 'new_account';

/** The seeded role every self-registered account gets — and nothing else. */
export const SELF_REGISTERED_ROLE_KEY = 'student';

const FULL_NAME_MIN = 2;
const FULL_NAME_MAX = 200;
const MAX_CODE_LENGTH = 2048;

/** What the callback answers (the controller turns it into a 302). */
export type GoogleCallbackOutcome =
  | { kind: 'session'; session: IssuedSession; returnTo: string }
  | { kind: 'mfa'; challenge: string; expiresAt: Date; returnTo: string }
  | { kind: 'failure'; code: GoogleFailureCode; returnTo: string };

/** The query Google sends to the callback (any other parameter is ignored). */
export interface GoogleCallbackQuery {
  code?: unknown;
  state?: unknown;
  error?: unknown;
}

type Tx = Prisma.TransactionClient;
type Resolution = { kind: 'user'; userId: string } | { kind: 'refused'; code: GoogleFailureCode };

const ACCOUNT_SELECT = {
  id: true,
  status: true,
  deletedAt: true,
  lockedUntil: true,
  emailVerifiedAt: true,
  passwordHash: true,
} satisfies Prisma.UserSelect;
type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

/** A single string from an Express query value (`?x=a&x=b` is an array: refused). */
function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Suspended, archived, soft-deleted or locked right now: Google opens nothing for it. */
export function isUnavailable(user: Pick<AccountRow, 'status' | 'deletedAt' | 'lockedUntil'>, now: Date): boolean {
  if (user.deletedAt !== null) return true;
  if (user.status === 'suspended' || user.status === 'archived') return true;
  return user.lockedUntil !== null && user.lockedUntil > now;
}

/**
 * The name of a new account: Google's `name` without control characters and
 * with collapsed white space, 2..200 characters; else the e-mail's local part;
 * else the address itself.
 */
export function fullNameFrom(claims: Pick<GoogleIdentityClaims, 'name' | 'email'>): string {
  const clean = (value: string) => {
    const visible = [...value].map((char) => (isControlCode(char.codePointAt(0)!) ? ' ' : char)).join('');
    return [...visible.replace(/\s+/gu, ' ').trim()].slice(0, FULL_NAME_MAX).join('').trim();
  };
  for (const candidate of [claims.name ?? '', claims.email.split('@')[0] ?? '', claims.email]) {
    const name = clean(candidate);
    if ([...name].length >= FULL_NAME_MIN) return name;
  }
  return claims.email.slice(0, FULL_NAME_MAX);
}

/** The one rule for a self-registered pending account, shared with the e-mail registration (account/registration.rules.ts). */
export { isPendingSelfRegistration };

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly stateKey: Uint8Array;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly oidc: GoogleOidcClient,
    @Inject(GOOGLE_OAUTH_CONFIG) private readonly config: GoogleOAuthConfig | null,
    env: ConfigService<Env, true>,
  ) {
    this.stateKey = deriveStateKey(env.get('JWT_SECRET', { infer: true }));
  }

  /** True when Google sign-in is configured on this server. */
  get configured(): boolean {
    return this.config !== null;
  }

  /**
   * One sign-in attempt: the authorization URL and the signed state for the
   * cookie. `503 google_unavailable` when Google is not configured.
   */
  async start(returnTo: unknown): Promise<{ url: string; stateToken: string }> {
    if (!this.config) throw googleError.unavailable();
    const attempt = newGoogleAttempt(returnTo);
    const url = buildAuthorizationUrl({ clientId: this.config.clientId, redirectUri: this.config.redirectUri, ...attempt });
    return { url, stateToken: await signGoogleState(this.stateKey, attempt) };
  }

  /** Google's answer → a session, an MFA challenge or a failure code. Never throws. */
  async callback(query: GoogleCallbackQuery, stateCookie: string | undefined, ctx: RequestContext): Promise<GoogleCallbackOutcome> {
    const attempt = await verifyGoogleState(this.stateKey, stateCookie);
    const returnTo = attempt?.returnTo ?? DEFAULT_RETURN_TO;
    const failure = (code: GoogleFailureCode, reason?: string): GoogleCallbackOutcome => {
      if (reason) this.logger.warn(`Google sign-in refused (${code}): ${reason}`);
      return { kind: 'failure', code, returnTo };
    };

    if (!this.config) return failure('unavailable');
    const error = queryString(query.error);
    if (error !== undefined) return failure(error === 'access_denied' ? 'cancelled' : 'failed', error === 'access_denied' ? undefined : 'provider_error');
    if (!attempt) return failure('failed', stateCookie ? 'state_cookie_invalid' : 'state_cookie_missing');
    if (!statesMatch(attempt.state, query.state)) return failure('failed', 'state_mismatch');
    const code = queryString(query.code);
    if (!code || code.length > MAX_CODE_LENGTH) return failure('failed', 'code_missing');

    let claims: GoogleIdentityClaims;
    try {
      claims = await this.oidc.authenticate({ code, codeVerifier: attempt.codeVerifier, nonce: attempt.nonce });
    } catch (caught) {
      return failure('failed', caught instanceof GoogleOidcError ? caught.reason : 'exchange_error');
    }

    let resolution: Resolution;
    try {
      resolution = await this.resolve(claims, ctx);
    } catch (caught) {
      this.logger.error('Google sign-in: the account could not be resolved', caught instanceof Error ? caught.stack : undefined);
      return failure('failed');
    }
    if (resolution.kind === 'refused') return failure(resolution.code);

    try {
      const outcome = await this.auth.beginSession(resolution.userId, 'google', ctx);
      if (isPendingMfa(outcome)) return { kind: 'mfa', challenge: outcome.challenge, expiresAt: outcome.expiresAt, returnTo };
      return { kind: 'session', session: outcome, returnTo };
    } catch (caught) {
      // The status gate refused (the account changed between the resolution and now), or the account has
      // MFA and the server has no usable key (`503 mfa_unavailable` — the second factor is never skipped).
      if (caught instanceof AuthHttpException && caught.code !== 'mfa_unavailable') return failure('account_unavailable', caught.code);
      return failure('failed', caught instanceof AuthHttpException ? caught.code : 'session_error');
    }
  }

  /** Steps 1..3 of the resolution; a race on a new account (two callbacks at once) is retried once. */
  private async resolve(claims: GoogleIdentityClaims, ctx: RequestContext): Promise<Resolution> {
    const signUpOpen = await this.signUpOpen();
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.db.$transaction((tx) => this.resolveIn(tx, claims, signUpOpen, new Date(), ctx));
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  private async resolveIn(tx: Tx, claims: GoogleIdentityClaims, signUpOpen: boolean, now: Date, ctx: RequestContext): Promise<Resolution> {
    const identity = await tx.userIdentity.findUnique({
      where: { provider_providerSubject: { provider: 'google', providerSubject: claims.sub } },
      select: { id: true, userId: true },
    });
    if (identity) {
      const user = await tx.user.findUnique({ where: { id: identity.userId }, select: ACCOUNT_SELECT });
      if (!user || isUnavailable(user, now) || user.status !== 'active') return { kind: 'refused', code: 'account_unavailable' };
      await tx.userIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: now } });
      return { kind: 'user', userId: user.id };
    }

    const sameEmail = await tx.user.findUnique({ where: { email: claims.email }, select: { id: true } });
    if (sameEmail) return this.linkExisting(tx, sameEmail.id, claims, now, ctx);
    if (!signUpOpen) return { kind: 'refused', code: 'registration_closed' };
    return this.createAccount(tx, claims, now, ctx);
  }

  /** Step 2 under the user-row lock (`FOR NO KEY UPDATE` — never `FOR UPDATE`, KI-079). */
  private async linkExisting(tx: Tx, userId: string, claims: GoogleIdentityClaims, now: Date, ctx: RequestContext): Promise<Resolution> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
    if (!user || isUnavailable(user, now)) return { kind: 'refused', code: 'account_unavailable' };
    // One Google identity per account: another Google account is never swapped in automatically. The same
    // one means a parallel sign-in linked it while this one waited for the lock: it is simply used.
    const linked = await tx.userIdentity.findFirst({ where: { userId, provider: 'google' }, select: { id: true, providerSubject: true } });
    if (linked) {
      if (linked.providerSubject !== claims.sub) return { kind: 'refused', code: 'link_required' };
      if (user.status !== 'active') return { kind: 'refused', code: 'account_unavailable' };
      await tx.userIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: now } });
      return { kind: 'user', userId };
    }

    let via: GoogleLinkVia;
    if (user.status === 'active' && user.emailVerifiedAt !== null) {
      via = 'verified_email';
    } else if (isPendingSelfRegistration(user)) {
      via = 'pending_registration';
      await tx.user.update({ where: { id: userId }, data: { status: 'active', emailVerifiedAt: now } });
      // The address is proven now: every open confirmation link of the account is retired.
      await tx.verificationToken.updateMany({
        where: { userId, purpose: 'email_verification', consumedAt: null },
        data: { consumedAt: now },
      });
    } else {
      return { kind: 'refused', code: 'link_required' };
    }
    await tx.userIdentity.create({
      data: { userId, provider: 'google', providerSubject: claims.sub, email: claims.email, lastUsedAt: now },
    });
    await this.recordLinked(tx, userId, via, ctx);
    return { kind: 'user', userId };
  }

  /** Step 3: a new student account — the seeded `student` role and a student profile, nothing the client chose. */
  private async createAccount(tx: Tx, claims: GoogleIdentityClaims, now: Date, ctx: RequestContext): Promise<Resolution> {
    const role = await tx.role.findUnique({ where: { key: SELF_REGISTERED_ROLE_KEY }, select: { id: true } });
    if (!role) throw new Error(`the system role "${SELF_REGISTERED_ROLE_KEY}" is missing (run the seed)`);
    const user = await tx.user.create({
      data: {
        email: claims.email,
        fullName: fullNameFrom(claims),
        status: 'active',
        emailVerifiedAt: now,
        roles: { create: { roleId: role.id } },
        studentProfile: { create: {} },
        identities: { create: { provider: 'google', providerSubject: claims.sub, email: claims.email, lastUsedAt: now } },
      },
      select: { id: true },
    });
    await this.audit.record(
      {
        action: GOOGLE_AUDIT_ACTIONS.selfRegistered,
        actorUserId: user.id,
        entityType: 'users',
        entityId: user.id,
        metadata: { via: 'google' },
        ...ctx,
      },
      tx,
    );
    await this.recordLinked(tx, user.id, 'new_account', ctx);
    return { kind: 'user', userId: user.id };
  }

  private recordLinked(tx: Tx, userId: string, via: GoogleLinkVia, ctx: RequestContext): Promise<void> {
    return this.audit.record(
      { action: GOOGLE_AUDIT_ACTIONS.linked, actorUserId: userId, entityType: 'users', entityId: userId, metadata: { via }, ...ctx },
      tx,
    );
  }

  /** New accounts only while the academy accepts self-registration (Google proves the address: no mail transport needed). */
  private async signUpOpen(): Promise<boolean> {
    const row = await this.prisma.db.academy.findFirst({ select: { settings: true } });
    return row !== null && readSettings(row.settings).selfRegistration.enabled === true;
  }
}
