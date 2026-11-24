// PORTAL-04 — Google sign-in, the pure half: the short-lived signed state token
// that rides in the `aca_google` cookie between `POST /api/auth/google/start`
// and Google's redirect back to the callback, PKCE (RFC 7636, S256), the nonce,
// the authorization URL, the safe `returnTo` rule shared with the frontend, and
// the root-relative redirects of the callback. No framework or database import.
import { createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/** Name of the httpOnly cookie that carries the signed state between start and callback. */
export const GOOGLE_STATE_COOKIE = 'aca_google';
/** Lifetime of the state token and of its cookie: 10 minutes to finish at Google. */
export const GOOGLE_STATE_TTL_SECONDS = 600;
/** Google's authorization endpoint (OpenID Connect discovery of accounts.google.com). */
export const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** The scopes asked for: an ID token with the subject, the verified e-mail and the name. */
export const GOOGLE_SCOPES = 'openid email profile';

const STATE_ALGORITHM = 'HS256';
/** A key of its own, derived from JWT_SECRET: a state token is never an access token and vice versa. */
const STATE_KEY_INFO = 'articode-academy/google-oauth-state/v1';
const STATE_ISSUER = 'articode-academy';
const STATE_AUDIENCE = 'articode-academy-google-state';
const STATE_TYPE = 'google-state+jwt';
/** 32 random bytes → 43 base64url characters (state, nonce, PKCE verifier). */
const RANDOM_BYTES = 32;
const RANDOM_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** At most this many characters in a `returnTo` path (server and client share the rule). */
export const RETURN_TO_MAX_LENGTH = 512;
/** The fallback of every unsafe `returnTo`. */
export const DEFAULT_RETURN_TO = '/';

/** What the signed state carries; never sent to Google except `state`, the nonce and the PKCE challenge. */
export interface GoogleStatePayload {
  /** The `state` parameter handed to Google, compared in constant time on the way back. */
  state: string;
  /** The OpenID Connect nonce the ID token must carry. */
  nonce: string;
  /** The PKCE code verifier sent with the token exchange (its S256 challenge went to Google). */
  codeVerifier: string;
  /** Where the frontend continues after sign-in (always a safe path). */
  returnTo: string;
}

/** 43 random base64url characters (256 bits). */
export function randomToken(): string {
  return randomBytes(RANDOM_BYTES).toString('base64url');
}

/** Fresh state, nonce and PKCE verifier for one sign-in attempt. */
export function newGoogleAttempt(returnTo: unknown): GoogleStatePayload {
  return { state: randomToken(), nonce: randomToken(), codeVerifier: randomToken(), returnTo: safeReturnTo(returnTo) };
}

/** RFC 7636 §4.2, method S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export function codeChallengeS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/**
 * The safe `returnTo` rule (common contract B, the same on the client): a
 * string of at most 512 characters that starts with exactly one `/` (not `//`,
 * not `/\`), holds no backslash, no control character and no whitespace, and
 * does not start with `/api/`; anything else — a full URL included — is `/`.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RETURN_TO;
  if (value.length === 0 || value.length > RETURN_TO_MAX_LENGTH) return DEFAULT_RETURN_TO;
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_RETURN_TO;
  if (value.includes('\\')) return DEFAULT_RETURN_TO;
  // Control characters (C0, DEL, C1) and every Unicode white space (\s covers NBSP, LS, PS, …).
  if (hasControlCharacter(value) || /\s/u.test(value)) return DEFAULT_RETURN_TO;
  if (value.startsWith('/api/')) return DEFAULT_RETURN_TO;
  return value;
}

/** A C0 control character, DEL or a C1 control character. */
export function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) if (isControlCode(value.charCodeAt(i))) return true;
  return false;
}

/**
 * The HS256 key of the state token: HKDF-SHA-256 of JWT_SECRET with an info
 * string of its own. Without JWT_SECRET (outside production only) a random key
 * per process: a restart then only ends the sign-ins in flight.
 */
export function deriveStateKey(jwtSecret: string | undefined): Uint8Array {
  const material = jwtSecret ? Buffer.from(jwtSecret, 'utf8') : randomBytes(48);
  return new Uint8Array(hkdfSync('sha256', material, Buffer.alloc(0), STATE_KEY_INFO, 32));
}

/** Signs the state for the cookie: 10 minutes, its own audience and type. */
export async function signGoogleState(key: Uint8Array, payload: GoogleStatePayload, now: Date = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ st: payload.state, nn: payload.nonce, cv: payload.codeVerifier, rt: payload.returnTo })
    .setProtectedHeader({ alg: STATE_ALGORITHM, typ: STATE_TYPE })
    .setIssuer(STATE_ISSUER)
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + GOOGLE_STATE_TTL_SECONDS)
    .sign(key);
}

/**
 * The payload of a state token this server signed and that has not expired, or
 * null for anything else (missing, malformed, forged, expired, another kind of
 * token). Never throws.
 */
export async function verifyGoogleState(key: Uint8Array, token: unknown, now: Date = new Date()): Promise<GoogleStatePayload | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: [STATE_ALGORITHM],
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
      typ: STATE_TYPE,
      currentDate: now,
      maxTokenAge: GOOGLE_STATE_TTL_SECONDS,
      clockTolerance: 5,
    });
    if (protectedHeader.alg !== STATE_ALGORITHM) return null;
    const { st, nn, cv, rt } = payload as Record<string, unknown>;
    if (!isRandomToken(st) || !isRandomToken(nn) || !isRandomToken(cv) || typeof rt !== 'string') return null;
    return { state: st, nonce: nn, codeVerifier: cv, returnTo: safeReturnTo(rt) };
  } catch {
    return null;
  }
}

function isRandomToken(value: unknown): value is string {
  return typeof value === 'string' && RANDOM_PATTERN.test(value);
}

/** Constant-time comparison of the `state` Google sent back with the cookie's (digests: equal lengths always). */
export function statesMatch(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length === 0 || received.length > 512) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(received).digest();
  return timingSafeEqual(a, b);
}

/** The URL the browser is sent to: authorization code + PKCE S256, `openid email profile`, account chooser. */
export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: GOOGLE_SCOPES,
    state: input.state,
    nonce: input.nonce,
    code_challenge: codeChallengeS256(input.codeVerifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** Codes of `/login?google=<code>` (common contract B). */
export const GOOGLE_FAILURE_CODES = [
  'cancelled',
  'failed',
  'unavailable',
  'registration_closed',
  'link_required',
  'account_unavailable',
] as const;
export type GoogleFailureCode = (typeof GOOGLE_FAILURE_CODES)[number];

/** Frontend route that finishes a Google sign-in with a session (it refreshes with the new cookie). */
export const GOOGLE_DONE_PATH = '/auth/google/done';
/** Frontend sign-in page: failures in the query, the MFA challenge in the fragment. */
export const LOGIN_PATH = '/login';

/** `302 /auth/google/done?returnTo=<path>` — a session cookie was set. */
export function doneRedirect(returnTo: unknown): string {
  return `${GOOGLE_DONE_PATH}?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) }).toString()}`;
}

/**
 * `302 /login#google-mfa=<challenge>&expiresAt=<ISO>&returnTo=<path>` — the
 * account has two-step verification. A fragment is never sent to a server and
 * never written to an access log; the frontend finishes with API-211.
 */
export function mfaRedirect(challenge: string, expiresAt: Date, returnTo: unknown): string {
  const fragment = new URLSearchParams({
    'google-mfa': challenge,
    expiresAt: expiresAt.toISOString(),
    returnTo: safeReturnTo(returnTo),
  });
  return `${LOGIN_PATH}#${fragment.toString()}`;
}

/** `302 /login?google=<code>&returnTo=<path>`. */
export function failureRedirect(code: GoogleFailureCode, returnTo: unknown): string {
  return `${LOGIN_PATH}?${new URLSearchParams({ google: code, returnTo: safeReturnTo(returnTo) }).toString()}`;
}
