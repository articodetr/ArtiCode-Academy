// TEST-016 — MOD-01-H02 origin decision (pure function behind OriginGuard).
import { evaluateOrigin, isLoopbackOrigin, normalizeOrigin } from './origin.guard.js';
import type { OriginCheckInput } from './origin.guard.js';

const ALLOWED = new Set(['https://app.academy.test', 'http://localhost:5173']);

function input(overrides: Partial<OriginCheckInput>): OriginCheckInput {
  return {
    method: 'POST',
    origin: undefined,
    secFetchSite: undefined,
    host: 'api.academy.test',
    protocol: 'https',
    allowedOrigins: ALLOWED,
    allowLoopback: false,
    ...overrides,
  };
}

describe('normalizeOrigin', () => {
  it('lower-cases the host, drops default ports and rejects non-origins', () => {
    expect(normalizeOrigin('https://App.Academy.TEST:443')).toBe('https://app.academy.test');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeOrigin(' https://app.academy.test ')).toBe('https://app.academy.test');
    for (const bad of [undefined, '', 'null', 'not a url', 'ftp://app.academy.test', 'https://app.academy.test/path',
      'https://app.academy.test/?q=1', 'https://user:pw@app.academy.test', 'javascript:alert(1)']) {
      expect(normalizeOrigin(bad), String(bad)).toBeNull();
    }
  });

  it('recognises loopback origins only', () => {
    expect(isLoopbackOrigin('http://localhost:5174')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:3000')).toBe(true);
    expect(isLoopbackOrigin('http://localhost.evil.test')).toBe(false);
    expect(isLoopbackOrigin('http://evil.localhost')).toBe(false);
    expect(isLoopbackOrigin('https://app.academy.test')).toBe(false);
  });
});

describe('evaluateOrigin', () => {
  it('never blocks safe methods, whatever the headers say', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(evaluateOrigin(input({ method, origin: 'https://evil.test', secFetchSite: 'cross-site' }))).toEqual({
        allowed: true,
        reason: 'safe_method',
      });
    }
  });

  it('accepts allowlisted origins (normalised) for every unsafe method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(evaluateOrigin(input({ method, origin: 'https://app.academy.test' })).allowed).toBe(true);
    }
    expect(evaluateOrigin(input({ origin: 'HTTPS://APP.ACADEMY.TEST:443' }))).toEqual({ allowed: true, reason: 'allowlisted' });
    // A legitimate same-site deployment (app.* calling api.*) sends Sec-Fetch-Site: same-site; the allowlist decides.
    expect(evaluateOrigin(input({ origin: 'https://app.academy.test', secFetchSite: 'same-site' })).allowed).toBe(true);
  });

  it('rejects foreign, parent and sibling-subdomain origins, `null` and malformed values', () => {
    const rejected: Array<[string, string]> = [
      ['https://evil.test', 'origin_not_allowed'],
      ['https://academy.test', 'origin_not_allowed'],
      ['https://evil.academy.test', 'origin_not_allowed'],
      ['https://app.academy.test.evil.test', 'origin_not_allowed'],
      ['http://app.academy.test', 'origin_not_allowed'], // scheme downgrade
      ['https://app.academy.test:8443', 'origin_not_allowed'],
      ['null', 'origin_invalid'],
      ['', 'origin_invalid'],
      ['garbage', 'origin_invalid'],
    ];
    for (const [origin, reason] of rejected) {
      expect(evaluateOrigin(input({ origin, secFetchSite: 'same-site' })), origin).toEqual({ allowed: false, reason });
    }
  });

  it('accepts the request’s own origin (same-origin clients such as the Swagger UI)', () => {
    expect(evaluateOrigin(input({ origin: 'https://api.academy.test', host: 'api.academy.test', protocol: 'https' }))).toEqual({
      allowed: true,
      reason: 'same_origin',
    });
    expect(evaluateOrigin(input({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000', protocol: 'http' })).allowed).toBe(true);
    // Scheme must match: behind a TLS-terminating proxy without `trust proxy` the server sees http (MOD-01-H01).
    expect(evaluateOrigin(input({ origin: 'https://api.academy.test', host: 'api.academy.test', protocol: 'http' }))).toEqual({
      allowed: false,
      reason: 'origin_not_allowed',
    });
    expect(evaluateOrigin(input({ origin: 'https://api.academy.test', host: undefined })).allowed).toBe(false);
  });

  it('accepts loopback origins outside production only', () => {
    const dev = input({ origin: 'http://localhost:5174', allowLoopback: true });
    expect(evaluateOrigin(dev)).toEqual({ allowed: true, reason: 'loopback' });
    expect(evaluateOrigin({ ...dev, origin: 'http://127.0.0.1:5174' }).allowed).toBe(true);
    expect(evaluateOrigin({ ...dev, allowLoopback: false })).toEqual({ allowed: false, reason: 'origin_not_allowed' });
    expect(evaluateOrigin({ ...dev, origin: 'http://evil.localhost:5174' }).allowed).toBe(false);
  });

  it('without Origin, trusts non-browser clients but rejects cross-site and same-site Fetch Metadata', () => {
    expect(evaluateOrigin(input({}))).toEqual({ allowed: true, reason: 'no_origin' });
    expect(evaluateOrigin(input({ secFetchSite: 'same-origin' })).allowed).toBe(true);
    expect(evaluateOrigin(input({ secFetchSite: 'none' })).allowed).toBe(true);
    expect(evaluateOrigin(input({ secFetchSite: 'cross-site' }))).toEqual({ allowed: false, reason: 'fetch_site_rejected' });
    expect(evaluateOrigin(input({ secFetchSite: 'Same-Site ' }))).toEqual({ allowed: false, reason: 'fetch_site_rejected' });
  });
});
