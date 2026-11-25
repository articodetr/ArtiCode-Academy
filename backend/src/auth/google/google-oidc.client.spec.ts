// PORTAL-04 — the ID-token check and the token exchange of Google sign-in.
// REAL signed ID tokens are made here with jose (an RS256 key pair generated
// by the test) and verified through the very function the server uses, with
// a local key set in place of Google's published keys. No request leaves the
// process: `fetch` is replaced for the exchange tests.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { GOOGLE_TOKEN_URL, GoogleOidcClient, GoogleOidcError, verifyGoogleIdToken } from './google-oidc.client.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NONCE = 'n'.repeat(43);
const KID = 'test-key-1';

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

interface TokenOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresIn?: number;
  issuedAt?: number;
  key?: CryptoKey;
  kid?: string;
}

async function idToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = options.issuedAt ?? now;
  // `sub` is a plain claim here so a test can replace it.
  return new SignJWT({ sub: '108234567890123456789', email: 'Learner@Example.Test ', email_verified: true, name: 'Learner One', nonce: NONCE, ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KID, typ: 'JWT' })
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (options.expiresIn ?? 3600))
    .sign(options.key ?? privateKey);
}

async function failureOf(token: string, nonce = NONCE): Promise<string> {
  try {
    await verifyGoogleIdToken(token, keys, { clientId: CLIENT_ID, nonce });
  } catch (error) {
    if (error instanceof GoogleOidcError) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token from either issuer spelling and returns the subject, the lower-cased e-mail and the name', async () => {
    for (const issuer of ['https://accounts.google.com', 'accounts.google.com']) {
      const claims = await verifyGoogleIdToken(await idToken({ issuer }), keys, { clientId: CLIENT_ID, nonce: NONCE });
      expect(claims).toEqual({ sub: '108234567890123456789', email: 'learner@example.test', name: 'Learner One', hd: null });
    }
    const nameless = await verifyGoogleIdToken(await idToken({ claims: { name: 42 } }), keys, { clientId: CLIENT_ID, nonce: NONCE });
    expect(nameless.name).toBeNull();
  });

  it('reads the Workspace domain `hd` trimmed and lower-cased, and ignores one that is not a non-empty string', async () => {
    const read = async (hd: unknown) => (await verifyGoogleIdToken(await idToken({ claims: { hd } }), keys, { clientId: CLIENT_ID, nonce: NONCE })).hd;
    expect(await read(' Example.Test ')).toBe('example.test');
    expect(await read('')).toBeNull();
    expect(await read('   ')).toBeNull();
    expect(await read(42)).toBeNull();
    expect(await read(['example.test'])).toBeNull();
  });

  it('refuses another audience, another issuer, another signing key and an unknown key id', async () => {
    expect(await failureOf(await idToken({ audience: 'other-client.apps.googleusercontent.com' }))).toBe('id_token_invalid');
    expect(await failureOf(await idToken({ issuer: 'https://evil.example' }))).toBe('id_token_invalid');
    expect(await failureOf(await idToken({ key: otherPrivateKey }))).toBe('id_token_invalid');
    expect(await failureOf(await idToken({ kid: 'unknown-key' }))).toBe('id_token_invalid');
  });

  it('refuses an expired token (past the 60 s tolerance) and accepts one inside it', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await failureOf(await idToken({ issuedAt: now - 3700, expiresIn: 3600 }))).toBe('id_token_expired');
    expect(await failureOf(await idToken({ issuedAt: now - 3630, expiresIn: 3600 }))).toBe('accepted');
  });

  it('refuses an HS256 token and anything that is not a JWT', async () => {
    const hs = await new SignJWT({ email: 'a@b.test', email_verified: true, nonce: NONCE })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setSubject('1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    expect(await failureOf(hs)).toBe('id_token_invalid');
    for (const bad of ['', 'not-a-jwt', 'a.b.c', 'x'.repeat(20_000)]) expect(await failureOf(bad)).toBe('id_token_invalid');
  });

  it('refuses a token of another attempt (nonce), and one without a nonce', async () => {
    expect(await failureOf(await idToken(), 'm'.repeat(43))).toBe('nonce_mismatch');
    expect(await failureOf(await idToken({ claims: { nonce: undefined } }))).toBe('nonce_mismatch');
  });

  it('refuses an unverified, missing or malformed e-mail and a blank subject', async () => {
    expect(await failureOf(await idToken({ claims: { email_verified: false } }))).toBe('email_unverified');
    expect(await failureOf(await idToken({ claims: { email_verified: 'true' } }))).toBe('email_unverified');
    expect(await failureOf(await idToken({ claims: { email_verified: undefined } }))).toBe('email_unverified');
    expect(await failureOf(await idToken({ claims: { email: undefined } }))).toBe('email_missing');
    expect(await failureOf(await idToken({ claims: { email: 'no-at-sign' } }))).toBe('email_missing');
    expect(await failureOf(await idToken({ claims: { sub: ' ' } }))).toBe('subject_missing');
  });
});

describe('GoogleOidcClient', () => {
  const config = { clientId: CLIENT_ID, clientSecret: 'test-only-secret', redirectUri: 'https://academy.example/api/auth/google/callback' };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exchanges the code with a form POST carrying the PKCE verifier, then verifies the ID token', async () => {
    const token = await idToken();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id_token: token, access_token: 'unused' }), { status: 200 }));
    const client = new GoogleOidcClient(config, keys);
    const claims = await client.authenticate({ code: 'the-code', codeVerifier: 'v'.repeat(43), nonce: NONCE });
    expect(claims.sub).toBe('108234567890123456789');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init = {}] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(GOOGLE_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'v'.repeat(43),
      redirect_uri: config.redirectUri,
      client_id: CLIENT_ID,
      client_secret: 'test-only-secret',
    });
  });

  it('turns a refused exchange, a network error, a timeout and an answer without an ID token into GoogleOidcError codes', async () => {
    const client = new GoogleOidcClient(config, keys);
    const input = { code: 'c', codeVerifier: 'v'.repeat(43), nonce: NONCE };
    const reasonOf = async () => {
      try {
        await client.authenticate(input);
      } catch (error) {
        return error instanceof GoogleOidcError ? error.reason : 'other';
      }
      return 'accepted';
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
    expect(await reasonOf()).toBe('exchange_failed');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await reasonOf()).toBe('exchange_failed');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await reasonOf()).toBe('exchange_timeout');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect(await reasonOf()).toBe('exchange_failed');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"access_token":"x"}', { status: 200 }));
    expect(await reasonOf()).toBe('id_token_missing');
  });

  it('refuses to run without a configuration', async () => {
    const client = new GoogleOidcClient(null, keys);
    await expect(client.authenticate({ code: 'c', codeVerifier: 'v'.repeat(43), nonce: NONCE })).rejects.toBeInstanceOf(GoogleOidcError);
  });
});
