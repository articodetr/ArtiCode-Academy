// MOD-18-T05 (D-R103) — the outbound HTTP side of the fleet probe: it asks an
// academy's two PUBLIC endpoints, `GET <origin>/api/health` (API-003) and
// `GET <origin>/api/health/ready` (API-004), and hands the raw answers to the
// pure rules of probe.rules.ts. It never throws: every failure is an answer.
//
// SSRF guard — the probe is the platform's only outbound request, so it is
// deliberately narrow:
//   - the URL is built from the academy's STORED origin only (the registry's
//     CHECK already limits it), never from a request parameter;
//   - the origin must parse, carry no credentials and nothing after the host
//     and port; the scheme is `https:` — `http:` only for `localhost` /
//     `127.0.0.1` and only outside production;
//   - no credentials, no cookies, no headers but `Accept: application/json`
//     and `User-Agent: articode-platform-probe`;
//   - `redirect: 'manual'`: a 3xx is an answer (`invalid`), never followed;
//   - each request is bounded by PLATFORM_PROBE_TIMEOUT_MS (AbortSignal.timeout,
//     which also bounds reading the body);
//   - the body is read as a stream and abandoned beyond 64 KB.
import { Inject, Injectable } from '@nestjs/common';
import { FLEET_SETTINGS } from './fleet.settings.js';
import type { FleetSettings } from './fleet.settings.js';

export const PROBE_USER_AGENT = 'articode-platform-probe';
/** Largest answer body read from an academy endpoint. */
export const PROBE_BODY_LIMIT_BYTES = 64 * 1024;
export const LIVENESS_PATH = '/api/health';
export const READINESS_PATH = '/api/health/ready';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/** The subset of `fetch` the probe uses — injectable so the unit tests answer without a network. */
export type ProbeFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Injection token of the ProbeFetch (the global `fetch` by default). */
export const PROBE_FETCH = Symbol('PROBE_FETCH');

export const defaultProbeFetch: ProbeFetch = (input, init) => fetch(input, init);

export type OriginCheck = { ok: true; origin: string } | { ok: false; error: string };

/**
 * Whether the probe may ask `raw`. The error never echoes the URL (it could
 * carry credentials).
 */
export function checkProbeOrigin(raw: string, production: boolean): OriginCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'the origin is not a URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `the scheme "${url.protocol}" is not allowed (https only)` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'the origin must not carry credentials' };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return { ok: false, error: 'the origin must be scheme://host[:port] with nothing after it' };
  }
  if (url.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      return { ok: false, error: 'http is allowed for localhost and 127.0.0.1 only (https otherwise)' };
    }
    if (production) return { ok: false, error: 'http is not allowed in production (https only)' };
  }
  return { ok: true, origin: url.origin };
}

/** One request to one endpoint, as the rules see it. */
export type EndpointResult =
  /** An HTTP answer read in full; `body` is the parsed JSON when `json` is true. */
  | { kind: 'response'; status: number; latencyMs: number; json: boolean; body: unknown }
  /** A 3xx answer — not followed. */
  | { kind: 'redirect'; status: number; latencyMs: number }
  /** An answer whose body exceeds PROBE_BODY_LIMIT_BYTES — abandoned. */
  | { kind: 'too_large'; status: number; latencyMs: number }
  /** No HTTP answer: refused connection, DNS, TLS, reset, or the timeout. */
  | { kind: 'failed'; timedOut: boolean; error: string };

export type ProbeExchange =
  /** The origin failed checkProbeOrigin(): nothing was asked. */
  | { kind: 'refused'; error: string }
  /** `readiness` is null when the liveness request failed (the host is not reachable). */
  | { kind: 'probed'; liveness: EndpointResult; readiness: EndpointResult | null };

export interface ProbeOptions {
  fetch: ProbeFetch;
  timeoutMs: number;
  production: boolean;
  bodyLimitBytes?: number;
}

/** Asks liveness, then readiness (skipped when liveness got no HTTP answer). Never throws. */
export async function probeOrigin(origin: string, options: ProbeOptions): Promise<ProbeExchange> {
  const checked = checkProbeOrigin(origin, options.production);
  if (!checked.ok) return { kind: 'refused', error: checked.error };

  const liveness = await requestEndpoint(`${checked.origin}${LIVENESS_PATH}`, options);
  if (liveness.kind === 'failed') return { kind: 'probed', liveness, readiness: null };
  const readiness = await requestEndpoint(`${checked.origin}${READINESS_PATH}`, options);
  return { kind: 'probed', liveness, readiness };
}

async function requestEndpoint(url: string, options: ProbeOptions): Promise<EndpointResult> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const limit = options.bodyLimitBytes ?? PROBE_BODY_LIMIT_BYTES;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const response = await options.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': PROBE_USER_AGENT },
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal,
    });
    // Node answers a manual redirect with its real 3xx; a browser-like fetch
    // would give an opaque one (status 0).
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await discardBody(response);
      return { kind: 'redirect', status: response.status, latencyMs: elapsed() };
    }
    const bytes = await readCapped(response, limit);
    const latencyMs = elapsed();
    if (bytes === null) return { kind: 'too_large', status: response.status, latencyMs };
    const parsed = parseJson(bytes);
    return { kind: 'response', status: response.status, latencyMs, json: parsed.ok, body: parsed.value };
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof Error && error.name === 'TimeoutError');
    return {
      kind: 'failed',
      timedOut,
      error: timedOut ? `timed out after ${options.timeoutMs} ms` : describeFetchError(error),
    };
  }
}

/** The body as bytes, or null once it exceeds `limit` (the rest is never read). */
export async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    await discardBody(response);
    return null;
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false; value: undefined } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8').decode(bytes)) as unknown };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** `fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:443)` — the cause is where Node puts the reason. */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message || error.name];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code;
    const message = (cause as { message?: unknown }).message;
    const detail = [typeof code === 'string' ? code : '', typeof message === 'string' ? message : '']
      .filter((part, index, all) => part !== '' && all.indexOf(part) === index)
      .join(': ');
    if (detail) parts.push(`(${detail})`);
  }
  return parts.join(' ');
}

/** The probe as a Nest provider: the fetch, the timeout and the production flag come from DI. */
@Injectable()
export class ProbeClient {
  constructor(
    @Inject(PROBE_FETCH) private readonly fetchImpl: ProbeFetch,
    @Inject(FLEET_SETTINGS) private readonly settings: FleetSettings,
  ) {}

  probe(origin: string): Promise<ProbeExchange> {
    return probeOrigin(origin, {
      fetch: this.fetchImpl,
      timeoutMs: this.settings.probeTimeoutMs,
      production: this.settings.production,
    });
  }
}
