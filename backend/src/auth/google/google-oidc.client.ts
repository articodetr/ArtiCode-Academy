// PORTAL-04 — the two calls Google sign-in makes to Google, and the ID-token
// check. The token exchange is a server-side form POST to Google's token
// endpoint with the PKCE verifier (never logged: not the code, not a token,
// not the secret); the ID token is verified with jose against Google's
// published keys (one remote key set per process, cached by jose) and then its
// nonce, subject and verified e-mail are checked, and the optional `hd` (the
// Workspace domain) is read. `verifyGoogleIdToken()` is pure with an injected
// key set, so the tests verify REAL signed tokens against a local key set; e2e
// suites replace the key set and the exchange.
import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { GOOGLE_OAUTH_CONFIG } from './google.config.js';
import type { GoogleOAuthConfig } from './google.config.js';

/** Google's token endpoint. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Google's published signing keys (JWKS). */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Both spellings Google uses for `iss` (OpenID Connect, "Validating an ID token"). */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** The token exchange gives up after 10 seconds. */
export const GOOGLE_TOKEN_TIMEOUT_MS = 10_000;
/** DI token of the key set the ID tokens are verified against (Google's remote JWKS in production). */
export const GOOGLE_JWKS = Symbol('GOOGLE_JWKS');

const MAX_ID_TOKEN_LENGTH = 16 * 1024;
const MAX_EMAIL_LENGTH = 320;
const MAX_SUBJECT_LENGTH = 255;

/** What a verified Google ID token says about the person. */
export interface GoogleIdentityClaims {
  /** Google's stable subject — the key of the link, never the e-mail. */
  sub: string;
  /** Trimmed and lower-cased; Google says it is verified (`email_verified === true`). */
  email: string;
  /** `name`, when Google sent one. */
  name: string | null;
  /**
   * `hd`, the Google Workspace domain of the account, trimmed and lower-cased,
   * when Google sent one (never for a consumer Gmail account). With the
   * address it decides whether Google is authoritative for that address
   * (`isGoogleAuthoritative()` in google-auth.service.ts).
   */
  hd: string | null;
}

/** Why a step at Google failed — a code only, never a value from the exchange (logged, never answered). */
export type GoogleOidcFailure =
  | 'exchange_failed'
  | 'exchange_timeout'
  | 'id_token_missing'
  | 'id_token_invalid'
  | 'id_token_expired'
  | 'nonce_mismatch'
  | 'subject_missing'
  | 'email_missing'
  | 'email_unverified';

export class GoogleOidcError extends Error {
  constructor(readonly reason: GoogleOidcFailure) {
    super(`Google sign-in failed: ${reason}`);
    this.name = 'GoogleOidcError';
  }
}

/**
 * Verifies a Google ID token: signature against `keys` (RS256 only), issuer,
 * audience = our client id, expiry with 60 s of clock tolerance; then the
 * `nonce` of this attempt, a non-empty `sub`, an `email` and
 * `email_verified === true`; `hd` is read when it is a non-empty string (no
 * check — it only narrows what the account resolution allows). Throws
 * GoogleOidcError, never anything else.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  keys: JWTVerifyGetKey,
  expected: { clientId: string; nonce: string; now?: Date },
): Promise<GoogleIdentityClaims> {
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) {
    throw new GoogleOidcError('id_token_invalid');
  }
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: expected.clientId,
      algorithms: ['RS256'],
      clockTolerance: '60s',
      requiredClaims: ['sub', 'iat', 'exp'],
      ...(expected.now ? { currentDate: expected.now } : {}),
    }));
  } catch (error) {
    throw new GoogleOidcError(error instanceof joseErrors.JWTExpired ? 'id_token_expired' : 'id_token_invalid');
  }
  if (typeof payload['nonce'] !== 'string' || payload['nonce'] !== expected.nonce) throw new GoogleOidcError('nonce_mismatch');
  const sub = typeof payload['sub'] === 'string' ? payload['sub'].trim() : '';
  if (sub.length === 0 || sub.length > MAX_SUBJECT_LENGTH || sub !== payload['sub']) throw new GoogleOidcError('subject_missing');
  const email = typeof payload['email'] === 'string' ? payload['email'].trim().toLowerCase() : '';
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !email.includes('@')) throw new GoogleOidcError('email_missing');
  if (payload['email_verified'] !== true) throw new GoogleOidcError('email_unverified');
  const name = typeof payload['name'] === 'string' ? payload['name'] : null;
  const hostedDomain = typeof payload['hd'] === 'string' ? payload['hd'].trim().toLowerCase() : '';
  const hd = hostedDomain.length > 0 && hostedDomain.length <= MAX_EMAIL_LENGTH ? hostedDomain : null;
  return { sub, email, name, hd };
}

/** The key set of Google's published keys, one per process (jose caches the keys and refetches on rotation). */
export function googleRemoteKeySet(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
}

/**
 * The calls to Google. Replaced in the e2e suites (a subclass with a local
 * key set and a fake `exchangeCode()`), so no test ever reaches Google.
 */
@Injectable()
export class GoogleOidcClient {
  constructor(
    @Inject(GOOGLE_OAUTH_CONFIG) protected readonly config: GoogleOAuthConfig | null,
    @Inject(GOOGLE_JWKS) protected readonly keys: JWTVerifyGetKey,
  ) {}

  /** Exchanges the authorization code (and the PKCE verifier) for an ID token, then verifies it. */
  async authenticate(input: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentityClaims> {
    const config = this.requireConfig();
    const idToken = await this.exchangeCode(input.code, input.codeVerifier, config);
    return verifyGoogleIdToken(idToken, this.keys, { clientId: config.clientId, nonce: input.nonce });
  }

  /**
   * The token request (RFC 6749 §4.1.3 + RFC 7636 §4.5): a form POST with the
   * client credentials in the body, 10 s at most, no redirect followed. Only
   * the `id_token` of the answer is kept; the access token is not used.
   */
  protected async exchangeCode(code: string, codeVerifier: string, config: GoogleOAuthConfig): Promise<string> {
    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(GOOGLE_TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new GoogleOidcError(timedOut ? 'exchange_timeout' : 'exchange_failed');
    }
    if (!response.ok) {
      // The body may echo request details: it is drained, never read into a message.
      await response.body?.cancel().catch(() => undefined);
      throw new GoogleOidcError('exchange_failed');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GoogleOidcError('exchange_failed');
    }
    const idToken = body && typeof body === 'object' ? (body as Record<string, unknown>)['id_token'] : undefined;
    if (typeof idToken !== 'string' || idToken.length === 0) throw new GoogleOidcError('id_token_missing');
    return idToken;
  }

  private requireConfig(): GoogleOAuthConfig {
    if (!this.config) throw new GoogleOidcError('exchange_failed');
    return this.config;
  }
}
