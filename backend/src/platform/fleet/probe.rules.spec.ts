// TEST-210 (unit part) — MOD-18-T05: the pure rules of the fleet probe — every
// outcome of snapshotOf(), the academy-supplied text guards, `behind`, `stale`
// and the fleet counts.
import { describe, expect, it } from 'vitest';
import type { EndpointResult, ProbeExchange } from './probe.client.js';
import {
  ACADEMY_SERVICE_NAME,
  PROBE_ERROR_MAX_LENGTH,
  fleetCounts,
  isBehind,
  isStale,
  readReadiness,
  sanitizeProbeError,
  shortText,
  snapshotOf,
} from './probe.rules.js';

const NEWEST = '20261112083749_mod12_notifications';
const OLDER = '20261110212431_mod11_finance';

function response(status: number, body: unknown, latencyMs = 12): EndpointResult {
  return { kind: 'response', status, latencyMs, json: true, body };
}

function text(status: number, latencyMs = 5): EndpointResult {
  return { kind: 'response', status, latencyMs, json: false, body: undefined };
}

const LIVE = response(200, {
  status: 'ok',
  service: ACADEMY_SERVICE_NAME,
  version: '0.0.1',
  environment: 'production',
  timestamp: '2026-11-13T10:00:00.000Z',
  uptimeSeconds: 42,
});

function readiness(status: 'ready' | 'not_ready', extra: Record<string, unknown> = {}, applied = NEWEST): unknown {
  return {
    status,
    checks: {
      database: { status: 'up', latencyMs: 2 },
      schema: { status: status === 'ready' ? 'current' : 'outdated', expected: NEWEST, applied },
    },
    timestamp: '2026-11-13T10:00:00.000Z',
    ...extra,
  };
}

function probed(liveness: EndpointResult, ready: EndpointResult | null): ProbeExchange {
  return { kind: 'probed', liveness, readiness: ready };
}

describe('fleet probe rules (TEST-210)', () => {
  it('ready: readiness 200 `ready` — version, environment and schema from the answers', () => {
    expect(snapshotOf(probed(LIVE, response(200, readiness('ready'), 30)))).toEqual({
      outcome: 'ready',
      httpStatus: 200,
      latencyMs: 30,
      apiVersion: '0.0.1',
      environment: 'production',
      schemaStatus: 'current',
      schemaExpected: NEWEST,
      schemaApplied: NEWEST,
      reason: null,
      error: null,
    });
  });

  it('not_ready: readiness 503 `not_ready` keeps the academy’s reason and its database error', () => {
    const outdated = snapshotOf(probed(LIVE, response(503, readiness('not_ready', { reason: 'schema_outdated' }, OLDER))));
    expect(outdated).toMatchObject({
      outcome: 'not_ready',
      httpStatus: 503,
      reason: 'schema_outdated',
      schemaStatus: 'outdated',
      schemaApplied: OLDER,
      error: null,
    });

    const down = snapshotOf(
      probed(
        LIVE,
        response(503, {
          status: 'not_ready',
          reason: 'database_unavailable',
          checks: { database: { status: 'down', error: 'connect ECONNREFUSED postgresql://app:s3cret@db:5432/x' } },
        }),
      ),
    );
    expect(down).toMatchObject({ outcome: 'not_ready', reason: 'database_unavailable', schemaStatus: null });
    expect(down.error).toContain('postgresql://***@db:5432');
    expect(down.error).not.toContain('s3cret');
  });

  it('not_ready without a schema report (an academy older than MOD-17-T03) and with an odd reason', () => {
    const snapshot = snapshotOf(
      probed(LIVE, response(503, { status: 'not_ready', reason: 'Bad Reason!', checks: { database: { status: 'up' } } })),
    );
    expect(snapshot).toMatchObject({ outcome: 'not_ready', reason: null, schemaStatus: null, schemaApplied: null });
  });

  it('unreachable: timeout, refused connection, gateway errors — liveness first', () => {
    expect(snapshotOf(probed({ kind: 'failed', timedOut: true, error: 'timed out after 5000 ms' }, null))).toMatchObject({
      outcome: 'unreachable',
      reason: 'timeout',
      httpStatus: null,
      latencyMs: null,
      error: 'liveness: timed out after 5000 ms',
    });
    expect(
      snapshotOf(probed({ kind: 'failed', timedOut: false, error: 'fetch failed (ECONNREFUSED)' }, null)),
    ).toMatchObject({ outcome: 'unreachable', reason: 'connection_failed' });
    expect(snapshotOf(probed(text(502), text(502)))).toMatchObject({
      outcome: 'unreachable',
      reason: 'gateway_error',
      httpStatus: 502,
    });
    // A proxy's 503 on liveness, or a 503 on readiness that is not a readiness answer.
    expect(snapshotOf(probed(text(503), text(503)))).toMatchObject({ outcome: 'unreachable', reason: 'gateway_error' });
    expect(snapshotOf(probed(LIVE, response(503, { message: 'Service Unavailable' })))).toMatchObject({
      outcome: 'unreachable',
      reason: 'gateway_error',
      apiVersion: '0.0.1',
    });
    expect(
      snapshotOf(probed(LIVE, { kind: 'failed', timedOut: true, error: 'timed out after 5000 ms' })),
    ).toMatchObject({ outcome: 'unreachable', reason: 'timeout', error: 'readiness: timed out after 5000 ms' });
  });

  it('invalid: a redirect is never followed, a body over 64 KB is abandoned', () => {
    expect(snapshotOf(probed({ kind: 'redirect', status: 302, latencyMs: 3 }, LIVE))).toMatchObject({
      outcome: 'invalid',
      reason: 'redirect',
      httpStatus: 302,
      error: 'liveness: HTTP 302 redirect, not followed',
    });
    expect(snapshotOf(probed(LIVE, { kind: 'redirect', status: 301, latencyMs: 3 }))).toMatchObject({
      outcome: 'invalid',
      reason: 'redirect',
      httpStatus: 301,
    });
    expect(snapshotOf(probed(LIVE, { kind: 'too_large', status: 200, latencyMs: 9 }))).toMatchObject({
      outcome: 'invalid',
      reason: 'body_too_large',
    });
  });

  it('invalid: not JSON, an unexpected status or shape, another service', () => {
    expect(snapshotOf(probed(text(200), text(200)))).toMatchObject({ outcome: 'invalid', reason: 'not_json', httpStatus: 200 });
    expect(snapshotOf(probed(response(404, { message: 'Not Found' }), text(404)))).toMatchObject({
      outcome: 'invalid',
      reason: 'unexpected_status',
      httpStatus: 404,
    });
    expect(snapshotOf(probed(response(200, { hello: 'world' }), LIVE))).toMatchObject({
      outcome: 'invalid',
      reason: 'unexpected_body',
    });
    expect(
      snapshotOf(probed(response(200, { status: 'ok', service: 'articode-platform-api', version: '0.0.1' }), LIVE)),
    ).toMatchObject({ outcome: 'invalid', reason: 'not_an_academy' });
    expect(snapshotOf(probed(LIVE, text(200)))).toMatchObject({ outcome: 'invalid', reason: 'not_json' });
    expect(snapshotOf(probed(LIVE, response(500, readiness('ready'))))).toMatchObject({
      outcome: 'invalid',
      reason: 'unexpected_status',
      httpStatus: 500,
    });
    expect(snapshotOf(probed(LIVE, response(200, { status: 'ready' })))).toMatchObject({
      outcome: 'invalid',
      reason: 'unexpected_body',
    });
    // 200 with `not_ready`, 503 with `ready`: the status and the body disagree.
    expect(snapshotOf(probed(LIVE, response(200, readiness('not_ready'))))).toMatchObject({
      outcome: 'invalid',
      reason: 'unexpected_body',
    });
    expect(snapshotOf(probed(LIVE, response(503, readiness('ready'))))).toMatchObject({
      outcome: 'invalid',
      reason: 'unexpected_body',
    });
  });

  it('invalid: an origin the SSRF guard refused was never asked', () => {
    expect(snapshotOf({ kind: 'refused', error: 'http is not allowed in production (https only)' })).toEqual({
      outcome: 'invalid',
      httpStatus: null,
      latencyMs: null,
      apiVersion: null,
      environment: null,
      schemaStatus: null,
      schemaExpected: null,
      schemaApplied: null,
      reason: 'origin_refused',
      error: 'origin refused: http is not allowed in production (https only)',
    });
  });

  it('keeps only short single-line texts and well-formed migration names from an academy', () => {
    expect(shortText('  1.2.3 ')).toBe('1.2.3');
    expect(shortText('')).toBeNull();
    expect(shortText('a\nb')).toBeNull();
    expect(shortText(42)).toBeNull();
    expect(shortText('x'.repeat(101))).toBeNull();
    const answer = readReadiness({
      status: 'ready',
      checks: { database: { status: 'up' }, schema: { status: 'current', expected: 'DROP TABLE x', applied: NEWEST } },
    });
    expect(answer).toMatchObject({ schemaExpected: null, schemaApplied: NEWEST });
    expect(readReadiness({ status: 'ready', checks: [] })).toBeNull();
  });

  it('caps and cleans the error text (≤ 500 characters, credentials masked)', () => {
    const long = sanitizeProbeError(`https://user:pa55@host.example/x ${'é'.repeat(800)}\n\tend`);
    expect(Array.from(long)).toHaveLength(PROBE_ERROR_MAX_LENGTH);
    expect(long.startsWith('https://***@host.example/x ')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
    expect(sanitizeProbeError('a\r\n\u0000b')).toBe('a b');
  });

  it('behind: the applied schema is older than the newest academy migration of this build', () => {
    expect(isBehind(OLDER, NEWEST)).toBe(true);
    expect(isBehind(NEWEST, NEWEST)).toBe(false);
    expect(isBehind('20270101000000_future', NEWEST)).toBe(false);
    expect(isBehind(null, NEWEST)).toBeNull();
    expect(isBehind(NEWEST, null)).toBeNull();
    expect(isBehind('not-a-migration', NEWEST)).toBeNull();
  });

  it('stale: never probed, or no check within 3 intervals', () => {
    const now = new Date('2026-11-13T12:00:00.000Z');
    expect(isStale(null, now, 900)).toBe(true);
    expect(isStale(new Date('2026-11-13T11:45:00.000Z'), now, 900)).toBe(false);
    expect(isStale(new Date('2026-11-13T11:44:59.000Z'), now, 900)).toBe(true);
  });

  it('counts: the outcomes and `never` partition the total; behind counts true only', () => {
    expect(
      fleetCounts([
        { outcome: 'ready', behind: false },
        { outcome: 'ready', behind: true },
        { outcome: 'not_ready', behind: true },
        { outcome: 'unreachable', behind: null },
        { outcome: 'invalid', behind: null },
        { outcome: null, behind: null },
      ]),
    ).toEqual({ total: 6, ready: 2, notReady: 1, unreachable: 1, invalid: 1, never: 1, behind: 2 });
  });
});
