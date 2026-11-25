// PORTAL-04 — the pure half of Google sign-in: the signed state of the
// `aca_google` cookie, PKCE S256, the safe returnTo rule, the authorization URL
// and the callback's redirects.
import { SignJWT } from 'jose';
import {
  DEFAULT_RETURN_TO,
  GOOGLE_STATE_TTL_SECONDS,
  buildAuthorizationUrl,
  codeChallengeS256,
  deriveStateKey,
  doneRedirect,
  failureRedirect,
  mfaRedirect,
  newGoogleAttempt,
  randomToken,
  safeReturnTo,
  signGoogleState,
  statesMatch,
  verifyGoogleState,
} from './google-state.js';

/** A test value only, as long as a real JWT_SECRET. */
const SECRET = 'google-state-test-secret-'.repeat(2);

describe('PKCE (RFC 7636)', () => {
  it('derives the S256 challenge of the RFC 7636 Appendix B verifier', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes verifiers, states and nonces of 43 unreserved characters, a new one each time', () => {
    const attempt = newGoogleAttempt('/catalog');
    for (const value of [attempt.state, attempt.nonce, attempt.codeVerifier]) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([attempt.state, attempt.nonce, attempt.codeVerifier, randomToken()]).size).toBe(4);
    expect(attempt.returnTo).toBe('/catalog');
    expect(newGoogleAttempt('https://evil.example/').returnTo).toBe('/');
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/', '/'],
    ['/catalog', '/catalog'],
    ['/catalog/0194f6d2?intent=enroll#top', '/catalog/0194f6d2?intent=enroll#top'],
    ['/my-school/%D8%A7', '/my-school/%D8%A7'],
    ['/apiary', '/apiary'],
    ['/api', '/api'],
    ['/' + 'a'.repeat(511), '/' + 'a'.repeat(511)],
  ])('keeps the safe path %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    ['a full URL', 'https://evil.example/x'],
    ['a protocol-relative URL', '//evil.example/x'],
    ['a slash-backslash', '/\\evil.example'],
    ['a backslash anywhere', '/a\\b'],
    ['no leading slash', 'catalog'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['the API', '/api/auth/me'],
    ['a space', '/a b'],
    ['a tab', '/a\tb'],
    ['a new line', '/a\nb'],
    ['a NUL', '/a\u0000b'],
    ['DEL', '/a\u007fb'],
    ['a C1 control', '/a\u0085b'],
    ['a no-break space', '/a b'],
    ['a line separator', '/a b'],
    ['513 characters', '/' + 'a'.repeat(512)],
    ['an empty string', ''],
  ])('refuses %s', (_label, input) => {
    expect(safeReturnTo(input)).toBe(DEFAULT_RETURN_TO);
  });

  it('refuses every value that is not a string', () => {
    for (const value of [undefined, null, 42, true, ['/catalog'], { path: '/catalog' }]) expect(safeReturnTo(value)).toBe('/');
  });
});

describe('the signed state', () => {
  const key = deriveStateKey(SECRET);
  const attempt = newGoogleAttempt('/catalog/1?intent=enroll');

  it('round-trips state, nonce, verifier and returnTo', async () => {
    const token = await signGoogleState(key, attempt);
    expect(await verifyGoogleState(key, token)).toEqual(attempt);
  });

  it('derives the same key from the same JWT_SECRET, another from another, and a random one without', async () => {
    const token = await signGoogleState(key, attempt);
    expect(await verifyGoogleState(deriveStateKey(SECRET), token)).toEqual(attempt);
    expect(await verifyGoogleState(deriveStateKey(`${SECRET}x`), token)).toBeNull();
    expect(await verifyGoogleState(deriveStateKey(undefined), token)).toBeNull();
    // The derived key is not the secret itself: an HS256 token signed with JWT_SECRET is no state.
    const raw = await new SignJWT({ st: attempt.state, nn: attempt.nonce, cv: attempt.codeVerifier, rt: '/' })
      .setProtectedHeader({ alg: 'HS256', typ: 'google-state+jwt' })
      .setIssuer('articode-academy')
      .setAudience('articode-academy-google-state')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyGoogleState(key, raw)).toBeNull();
  });

  it('refuses a tampered signature or payload', async () => {
    const token = await signGoogleState(key, attempt);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const flipped = signature.slice(0, -2) + (signature.endsWith('AA') ? 'BB' : 'AA');
    expect(await verifyGoogleState(key, `${header}.${payload}.${flipped}`)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), rt: '/admin' })).toString('base64url');
    expect(await verifyGoogleState(key, `${header}.${forged}.${signature}`)).toBeNull();
  });

  it('expires after 10 minutes', async () => {
    const issued = new Date('2026-11-24T10:00:00.000Z');
    const token = await signGoogleState(key, attempt, issued);
    expect(await verifyGoogleState(key, token, new Date(issued.getTime() + (GOOGLE_STATE_TTL_SECONDS - 1) * 1000))).toEqual(attempt);
    expect(await verifyGoogleState(key, token, new Date(issued.getTime() + (GOOGLE_STATE_TTL_SECONDS + 10) * 1000))).toBeNull();
  });

  it('refuses another kind of token signed with the same key (audience, type) and anything malformed', async () => {
    const otherAudience = await new SignJWT({ st: attempt.state, nn: attempt.nonce, cv: attempt.codeVerifier, rt: '/' })
      .setProtectedHeader({ alg: 'HS256', typ: 'google-state+jwt' })
      .setIssuer('articode-academy')
      .setAudience('articode-academy-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect(await verifyGoogleState(key, otherAudience)).toBeNull();
    const otherType = await new SignJWT({ st: attempt.state, nn: attempt.nonce, cv: attempt.codeVerifier, rt: '/' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('articode-academy')
      .setAudience('articode-academy-google-state')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect(await verifyGoogleState(key, otherType)).toBeNull();
    const badClaims = await new SignJWT({ st: 'short', nn: attempt.nonce, cv: attempt.codeVerifier, rt: '/' })
      .setProtectedHeader({ alg: 'HS256', typ: 'google-state+jwt' })
      .setIssuer('articode-academy')
      .setAudience('articode-academy-google-state')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect(await verifyGoogleState(key, badClaims)).toBeNull();
    for (const value of [undefined, '', 'not-a-token', 42, 'a.b.c', 'x'.repeat(5000)]) expect(await verifyGoogleState(key, value)).toBeNull();
  });

  it('re-applies the safe rule to the returnTo it carries', async () => {
    const unsafe = await new SignJWT({ st: attempt.state, nn: attempt.nonce, cv: attempt.codeVerifier, rt: '//evil.example' })
      .setProtectedHeader({ alg: 'HS256', typ: 'google-state+jwt' })
      .setIssuer('articode-academy')
      .setAudience('articode-academy-google-state')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect((await verifyGoogleState(key, unsafe))?.returnTo).toBe('/');
  });

  it('compares states exactly', () => {
    expect(statesMatch(attempt.state, attempt.state)).toBe(true);
    expect(statesMatch(attempt.state, `${attempt.state}x`)).toBe(false);
    expect(statesMatch(attempt.state, attempt.state.slice(1))).toBe(false);
    for (const value of [undefined, '', ['a'], 42, 'x'.repeat(600)]) expect(statesMatch(attempt.state, value)).toBe(false);
  });
});

describe('the authorization URL and the callback redirects', () => {
  it('asks Google for an authorization code with PKCE S256, the three scopes, state, nonce and the account chooser', () => {
    const attempt = newGoogleAttempt('/');
    const url = new URL(
      buildAuthorizationUrl({ clientId: 'client.apps.googleusercontent.com', redirectUri: 'https://academy.example/api/auth/google/callback', ...attempt }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client.apps.googleusercontent.com',
      redirect_uri: 'https://academy.example/api/auth/google/callback',
      scope: 'openid email profile',
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge: codeChallengeS256(attempt.codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    // The verifier itself never leaves in the URL.
    expect(url.toString()).not.toContain(attempt.codeVerifier);
  });

  it('builds root-relative redirects with a sanitised returnTo', () => {
    expect(doneRedirect('/catalog/1?intent=enroll')).toBe('/auth/google/done?returnTo=%2Fcatalog%2F1%3Fintent%3Denroll');
    expect(doneRedirect('https://evil.example')).toBe('/auth/google/done?returnTo=%2F');
    expect(failureRedirect('link_required', '/catalog')).toBe('/login?google=link_required&returnTo=%2Fcatalog');
    expect(failureRedirect('failed', '//evil')).toBe('/login?google=failed&returnTo=%2F');
    const mfa = mfaRedirect('C'.repeat(43), new Date('2026-11-24T10:05:00.000Z'), '/my-school');
    expect(mfa.startsWith('/login#')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(mfa.slice('/login#'.length)))).toEqual({
      'google-mfa': 'C'.repeat(43),
      expiresAt: '2026-11-24T10:05:00.000Z',
      returnTo: '/my-school',
    });
  });
});
