// PORTAL-04 — the keys of Google sign-in's rate limits (review #2): per IP for
// the start route and the callback's ceiling, per (IP, digest of the state
// cookie) for the callback — never the cookie itself — and the ceiling scoped
// to the route marked @GoogleCallbackThrottle(). The limits themselves are
// counted through the API in test/google-auth.e2e-spec.ts.
import type { ExecutionContext } from '@nestjs/common';
import {
  GOOGLE_CALLBACK_CLIENT_LIMIT,
  GOOGLE_CALLBACK_IP_LIMIT,
  GOOGLE_CALLBACK_IP_THROTTLER,
  GOOGLE_CALLBACK_IP_THROTTLER_OPTIONS,
  GOOGLE_START_LIMIT,
  GoogleCallbackThrottle,
  googleCallbackClientTracker,
  googleIpTracker,
  isGoogleCallbackRoute,
} from './google-throttle.js';

const COOKIE = 'eyJhbGciOiJIUzI1NiJ9.eyJzdCI6InN0YXRlIn0.c2lnbmF0dXJlLW9mLXRoZS1zdGF0ZS10b2tlbg';
const request = (ip: string, cookie?: string) => ({ ip, headers: cookie === undefined ? {} : { cookie: `aca_refresh=other; aca_google=${cookie}` } });

class Probe {
  callback(): void {}
  start(): void {}
}
const callbackDescriptor = Object.getOwnPropertyDescriptor(Probe.prototype, 'callback')!;
GoogleCallbackThrottle()(Probe.prototype, 'callback', callbackDescriptor);

const contextOf = (handler: () => void): ExecutionContext => ({ getHandler: () => handler, getClass: () => Probe }) as unknown as ExecutionContext;

describe('Google sign-in rate limits', () => {
  it('has the agreed limits', () => {
    expect(GOOGLE_START_LIMIT).toBe(200);
    expect(GOOGLE_CALLBACK_CLIENT_LIMIT).toBe(30);
    expect(GOOGLE_CALLBACK_IP_LIMIT).toBe(300);
    expect(GOOGLE_CALLBACK_IP_THROTTLER_OPTIONS).toMatchObject({ name: GOOGLE_CALLBACK_IP_THROTTLER, limit: 300, ttl: 15 * 60 * 1000 });
  });

  it('keys the start and the ceiling by the IP alone (an IPv6 address by its /64)', () => {
    expect(googleIpTracker(request('198.51.100.7', COOKIE))).toBe('198.51.100.7');
    expect(googleIpTracker(request('2001:db8:1:2:aaaa::1'))).toBe(googleIpTracker(request('2001:db8:1:2:bbbb::2')));
    expect(googleIpTracker({})).toBe('');
  });

  it('keys the callback by the IP and a digest of the state cookie, never the cookie', () => {
    const key = googleCallbackClientTracker(request('198.51.100.7', COOKIE));
    expect(key).toMatch(/^198\.51\.100\.7\|google:[0-9a-f]{32}$/);
    expect(key).not.toContain(COOKIE);
    expect(key).not.toContain(COOKIE.slice(0, 20));
    // Another attempt (cookie) or another address is another budget; the same pair is the same one.
    expect(googleCallbackClientTracker(request('198.51.100.7', `${COOKIE}x`))).not.toBe(key);
    expect(googleCallbackClientTracker(request('198.51.100.8', COOKIE))).not.toBe(key);
    expect(googleCallbackClientTracker(request('198.51.100.7', COOKIE))).toBe(key);
    // Without the cookie every return from one address shares one key.
    expect(googleCallbackClientTracker(request('198.51.100.7'))).toBe('198.51.100.7|google:none');
  });

  it('applies the ceiling to the marked callback only', () => {
    expect(isGoogleCallbackRoute(contextOf(Probe.prototype.callback))).toBe(true);
    expect(isGoogleCallbackRoute(contextOf(Probe.prototype.start))).toBe(false);
    const skipIf = GOOGLE_CALLBACK_IP_THROTTLER_OPTIONS.skipIf!;
    expect(skipIf(contextOf(Probe.prototype.callback))).toBe(false);
    expect(skipIf(contextOf(Probe.prototype.start))).toBe(true);
  });
});
