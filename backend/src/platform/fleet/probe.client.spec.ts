// TEST-210 (unit part) — MOD-18-T05: the outbound side of the fleet probe with
// an injected fetch — the SSRF origin guard, the request it sends (headers,
// manual redirects, no credentials, a timeout signal), the 64 KB body cap,
// redirects never followed, defensive JSON, failures as answers.
import { describe, expect, it, vi } from 'vitest';
import { PROBE_BODY_LIMIT_BYTES, PROBE_USER_AGENT, checkProbeOrigin, probeOrigin, readCapped } from './probe.client.js';
import type { ProbeFetch } from './probe.client.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A body streamed in 16 KB chunks without a content-length (the cap must count the bytes). */
function streamed(totalBytes: number, status = 200): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(16 * 1024, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
  return new Response(stream, { status });
}

const LIVE = { status: 'ok', service: 'articode-academy-api', version: '0.0.1', environment: 'production' };

describe('fleet probe client (TEST-210)', () => {
  it('SSRF guard: https anywhere; http on localhost / 127.0.0.1 only and only outside production', () => {
    expect(checkProbeOrigin('https://demo.example.com', false)).toEqual({ ok: true, origin: 'https://demo.example.com' });
    expect(checkProbeOrigin('https://demo.example.com:8443/', true)).toEqual({ ok: true, origin: 'https://demo.example.com:8443' });
    expect(checkProbeOrigin('http://localhost:3000', false)).toEqual({ ok: true, origin: 'http://localhost:3000' });
    expect(checkProbeOrigin('http://127.0.0.1:3000', false)).toEqual({ ok: true, origin: 'http://127.0.0.1:3000' });

    expect(checkProbeOrigin('http://localhost:3000', true)).toMatchObject({ ok: false, error: expect.stringMatching(/production/) });
    expect(checkProbeOrigin('http://demo.example.com', false)).toMatchObject({ ok: false, error: expect.stringMatching(/localhost/) });
    expect(checkProbeOrigin('http://localhost.evil.example', false).ok).toBe(false);
    expect(checkProbeOrigin('http://10.0.0.5', false).ok).toBe(false);
    expect(checkProbeOrigin('file:///etc/passwd', false)).toMatchObject({ ok: false, error: expect.stringMatching(/scheme "file:"/) });
    expect(checkProbeOrigin('javascript:alert(1)', false)).toMatchObject({ ok: false, error: expect.stringMatching(/javascript:/) });
    expect(checkProbeOrigin('ftp://demo.example.com', false).ok).toBe(false);
    expect(checkProbeOrigin('not a url', false)).toEqual({ ok: false, error: 'the origin is not a URL' });
  });

  it('SSRF guard: no credentials, nothing after the host and port — and the error never echoes the URL', () => {
    const withUser = checkProbeOrigin('https://admin:s3cret@demo.example.com', false);
    expect(withUser).toEqual({ ok: false, error: 'the origin must not carry credentials' });
    expect(checkProbeOrigin('https://token@demo.example.com', false).ok).toBe(false);
    expect(checkProbeOrigin('https://demo.example.com/admin', false).ok).toBe(false);
    expect(checkProbeOrigin('https://demo.example.com?x=1', false).ok).toBe(false);
    expect(checkProbeOrigin('https://demo.example.com#x', false).ok).toBe(false);
    expect(JSON.stringify(withUser)).not.toContain('s3cret');
  });

  it('a refused origin is never fetched', async () => {
    const fetch = vi.fn<ProbeFetch>();
    const exchange = await probeOrigin('http://localhost:3000', { fetch, timeoutMs: 1000, production: true });
    expect(exchange).toEqual({ kind: 'refused', error: 'http is not allowed in production (https only)' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks liveness then readiness at the stored origin, with two headers, manual redirects and a timeout', async () => {
    const fetch = vi.fn<ProbeFetch>(async (url) =>
      url.endsWith('/ready') ? json({ status: 'ready', checks: { database: { status: 'up' } } }) : json(LIVE),
    );
    const exchange = await probeOrigin('https://demo.example.com', { fetch, timeoutMs: 1000, production: true });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://demo.example.com/api/health',
      'https://demo.example.com/api/health/ready',
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
      expect(init.headers).toEqual({ Accept: 'application/json', 'User-Agent': PROBE_USER_AGENT });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init).not.toHaveProperty('body');
    }
    expect(exchange).toMatchObject({
      kind: 'probed',
      liveness: { kind: 'response', status: 200, json: true, body: LIVE },
      readiness: { kind: 'response', status: 200, json: true },
    });
  });

  it('a redirect is an answer, never followed', async () => {
    const fetch = vi.fn<ProbeFetch>(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }));
    const exchange = await probeOrigin('https://demo.example.com', { fetch, timeoutMs: 1000, production: false });
    expect(exchange).toMatchObject({ liveness: { kind: 'redirect', status: 302 }, readiness: { kind: 'redirect', status: 302 } });
    // Two requests (liveness, readiness) — never one to the Location.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([url]) => url.startsWith('https://demo.example.com/'))).toBe(true);
  });

  it('caps the body at 64 KB, by the declared length or by the bytes read', async () => {
    expect(await readCapped(streamed(PROBE_BODY_LIMIT_BYTES), PROBE_BODY_LIMIT_BYTES)).toHaveLength(PROBE_BODY_LIMIT_BYTES);
    expect(await readCapped(streamed(PROBE_BODY_LIMIT_BYTES + 1), PROBE_BODY_LIMIT_BYTES)).toBeNull();
    const declared = new Response('{}', { headers: { 'content-length': String(PROBE_BODY_LIMIT_BYTES + 1) } });
    expect(await readCapped(declared, PROBE_BODY_LIMIT_BYTES)).toBeNull();

    const fetch = vi.fn<ProbeFetch>(async () => streamed(10 * PROBE_BODY_LIMIT_BYTES));
    const exchange = await probeOrigin('https://demo.example.com', { fetch, timeoutMs: 1000, production: false });
    expect(exchange).toMatchObject({ liveness: { kind: 'too_large', status: 200 } });
  });

  it('a body that is not JSON is an answer with json: false', async () => {
    const fetch = vi.fn<ProbeFetch>(async () => new Response('<html>hello</html>', { status: 200 }));
    const exchange = await probeOrigin('https://demo.example.com', { fetch, timeoutMs: 1000, production: false });
    expect(exchange).toMatchObject({ liveness: { kind: 'response', status: 200, json: false, body: undefined } });
  });

  it('a network failure or the timeout is a failed answer; readiness is then not asked', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
    });
    const failing = vi.fn<ProbeFetch>(async () => {
      throw refused;
    });
    expect(await probeOrigin('https://demo.example.com', { fetch: failing, timeoutMs: 1000, production: false })).toEqual({
      kind: 'probed',
      liveness: { kind: 'failed', timedOut: false, error: 'fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:443)' },
      readiness: null,
    });
    expect(failing).toHaveBeenCalledTimes(1);

    // A fetch that only ends when its signal aborts: the timeout ends it.
    const hanging = vi.fn<ProbeFetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    );
    expect(await probeOrigin('https://demo.example.com', { fetch: hanging, timeoutMs: 50, production: false })).toEqual({
      kind: 'probed',
      liveness: { kind: 'failed', timedOut: true, error: 'timed out after 50 ms' },
      readiness: null,
    });
  });
});
