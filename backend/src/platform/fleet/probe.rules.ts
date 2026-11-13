// MOD-18-T05 (D-R103) — the pure rules of the fleet probe: from the two raw
// answers of an academy (probe.client.ts) to the snapshot stored in
// `academy_health_checks`, and the fleet view's derived values (`behind`,
// `stale`, the counts). No I/O, no Nest.
//
// Outcomes (the `probe_outcome` enum):
//   ready        readiness answered 200 `{ status: 'ready' }`
//   not_ready    readiness answered 503 `{ status: 'not_ready', reason? }` — `reason` is the academy's
//   unreachable  no HTTP answer (timeout, refused, DNS, TLS) or a gateway error in front of the API
//                (502 / 504, or a 503 that is not the academy's readiness answer)
//   invalid      an answer that is not an ArtiCode academy's: a redirect (never followed), a body
//                over 64 KB, not JSON, an unexpected status or shape, another service — or an
//                origin the SSRF guard refuses
// For every outcome but `ready` and `not_ready`, `reason` is one of PROBE_REASONS and `error` a
// short human detail (≤ 500 characters, URL credentials masked).
import { SERVICE_NAME } from '../../common/package-info.js';
import { MIGRATION_NAME_PATTERN } from '../../health/schema-version.js';
import type { EndpointResult, ProbeExchange } from './probe.client.js';

export const PROBE_OUTCOMES = ['ready', 'not_ready', 'unreachable', 'invalid'] as const;
export type ProbeOutcomeValue = (typeof PROBE_OUTCOMES)[number];

/** The probe's own reasons (an academy's `not_ready` keeps the academy's reason). */
export const PROBE_REASONS = [
  // unreachable
  'timeout',
  'connection_failed',
  'gateway_error',
  // invalid
  'origin_refused',
  'redirect',
  'body_too_large',
  'not_json',
  'unexpected_status',
  'unexpected_body',
  'not_an_academy',
] as const;
export type ProbeReason = (typeof PROBE_REASONS)[number];

/** The service name an academy's liveness answer carries (API-003). */
export const ACADEMY_SERVICE_NAME = SERVICE_NAME;

/** Longest `error` stored (the CHECK of academy_health_checks). */
export const PROBE_ERROR_MAX_LENGTH = 500;

/** The columns of one `academy_health_checks` row the probe decides. */
export interface ProbeSnapshot {
  outcome: ProbeOutcomeValue;
  httpStatus: number | null;
  latencyMs: number | null;
  apiVersion: string | null;
  environment: string | null;
  schemaStatus: string | null;
  schemaExpected: string | null;
  schemaApplied: string | null;
  reason: string | null;
  error: string | null;
}

type Verdict = Pick<ProbeSnapshot, 'outcome' | 'httpStatus' | 'latencyMs' | 'reason' | 'error'>;

const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 504]);
const READINESS_STATUSES = ['ready', 'not_ready'] as const;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const CONTROL_CHARACTERS = /\p{Cc}/u;

/** A short single-line string from an untrusted answer, else null. */
export function shortText(value: unknown, max = 100): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > max || CONTROL_CHARACTERS.test(text)) return null;
  return text;
}

function codeText(value: unknown): string | null {
  return typeof value === 'string' && CODE_PATTERN.test(value) ? value : null;
}

function migrationName(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 200 && MIGRATION_NAME_PATTERN.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A text fit for the `error` column: URL credentials masked (`scheme://***@`),
 * whitespace and control characters folded to one space, at most 500
 * characters (code points, as PostgreSQL's char_length counts them).
 */
export function sanitizeProbeError(text: string): string {
  const cleaned = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim();
  const points = Array.from(cleaned);
  if (points.length <= PROBE_ERROR_MAX_LENGTH) return cleaned;
  return `${points.slice(0, PROBE_ERROR_MAX_LENGTH - 1).join('')}…`;
}

interface LivenessAnswer {
  service: string;
  version: string | null;
  environment: string | null;
}

/** An academy liveness body `{ status: 'ok', service, version, environment }`, else null. */
export function readLiveness(body: unknown): LivenessAnswer | null {
  if (!isRecord(body) || body['status'] !== 'ok' || typeof body['service'] !== 'string') return null;
  return {
    service: body['service'],
    version: shortText(body['version'], 64),
    environment: shortText(body['environment'], 32),
  };
}

interface ReadinessAnswer {
  status: (typeof READINESS_STATUSES)[number];
  reason: string | null;
  databaseError: string | null;
  schemaStatus: string | null;
  schemaExpected: string | null;
  schemaApplied: string | null;
  schemaError: string | null;
}

/**
 * An academy readiness body `{ status, reason?, checks: { database, schema? } }`,
 * else null. `checks.schema` is optional (academies older than MOD-17-T03 do
 * not report it).
 */
export function readReadiness(body: unknown): ReadinessAnswer | null {
  if (!isRecord(body)) return null;
  const status = body['status'];
  if (status !== 'ready' && status !== 'not_ready') return null;
  const checks = body['checks'];
  if (!isRecord(checks)) return null;
  const database = checks['database'];
  if (!isRecord(database) || typeof database['status'] !== 'string') return null;
  const schema = isRecord(checks['schema']) ? checks['schema'] : null;
  return {
    status,
    reason: codeText(body['reason']),
    databaseError: database['status'] === 'up' ? null : shortText(database['error'], 400),
    schemaStatus: schema ? codeText(schema['status']) : null,
    schemaExpected: schema ? migrationName(schema['expected']) : null,
    schemaApplied: schema ? migrationName(schema['applied']) : null,
    schemaError: schema ? shortText(schema['error'], 400) : null,
  };
}

function verdict(
  outcome: ProbeOutcomeValue,
  reason: string | null,
  error: string | null,
  http: { status: number; latencyMs: number } | null = null,
): Verdict {
  return {
    outcome,
    httpStatus: http?.status ?? null,
    latencyMs: http?.latencyMs ?? null,
    reason,
    error: error === null ? null : sanitizeProbeError(error),
  };
}

/** A failure below the HTTP layer of one endpoint (or a gateway answer), else null. */
function transportVerdict(name: string, result: EndpointResult): Verdict | null {
  switch (result.kind) {
    case 'failed':
      return verdict('unreachable', result.timedOut ? 'timeout' : 'connection_failed', `${name}: ${result.error}`);
    case 'redirect':
      return verdict('invalid', 'redirect', `${name}: HTTP ${result.status} redirect, not followed`, result);
    case 'too_large':
      return verdict('invalid', 'body_too_large', `${name}: the answer is larger than 64 KB`, result);
    case 'response':
      return GATEWAY_STATUSES.has(result.status)
        ? verdict('unreachable', 'gateway_error', `${name}: HTTP ${result.status} from the gateway`, result)
        : null;
  }
}

function livenessVerdict(result: Extract<EndpointResult, { kind: 'response' }>, answer: LivenessAnswer | null): Verdict | null {
  // The academy's liveness never answers 503 itself: a proxy in front of a stopped API does.
  if (result.status === 503) {
    return verdict('unreachable', 'gateway_error', 'liveness: HTTP 503 from the gateway', result);
  }
  if (result.status !== 200) return verdict('invalid', 'unexpected_status', `liveness: HTTP ${result.status}`, result);
  if (!result.json) return verdict('invalid', 'not_json', 'liveness: the answer is not JSON', result);
  if (answer === null) {
    return verdict('invalid', 'unexpected_body', 'liveness: the answer is not an ArtiCode health answer', result);
  }
  if (answer.service !== ACADEMY_SERVICE_NAME) {
    const service = shortText(answer.service, 64) ?? '(unreadable)';
    return verdict('invalid', 'not_an_academy', `liveness: the service "${service}" is not an academy API`, result);
  }
  return null;
}

function readinessVerdict(result: Extract<EndpointResult, { kind: 'response' }>, answer: ReadinessAnswer | null): Verdict {
  if (result.status === 503 && (!result.json || answer === null)) {
    return verdict('unreachable', 'gateway_error', 'readiness: HTTP 503 from the gateway', result);
  }
  if (result.status !== 200 && result.status !== 503) {
    return verdict('invalid', 'unexpected_status', `readiness: HTTP ${result.status}`, result);
  }
  if (!result.json) return verdict('invalid', 'not_json', 'readiness: the answer is not JSON', result);
  if (answer === null) {
    return verdict('invalid', 'unexpected_body', 'readiness: the answer is not an ArtiCode readiness answer', result);
  }
  if (result.status === 200 && answer.status === 'ready') return verdict('ready', null, null, result);
  if (result.status === 503 && answer.status === 'not_ready') {
    return verdict('not_ready', answer.reason, answer.databaseError ?? answer.schemaError, result);
  }
  return verdict(
    'invalid',
    'unexpected_body',
    `readiness: HTTP ${result.status} with the status "${answer.status}"`,
    result,
  );
}

/** The snapshot of one probe. Total: every exchange gives exactly one outcome. */
export function snapshotOf(exchange: ProbeExchange): ProbeSnapshot {
  const empty = {
    apiVersion: null,
    environment: null,
    schemaStatus: null,
    schemaExpected: null,
    schemaApplied: null,
  };
  if (exchange.kind === 'refused') {
    return { ...empty, ...verdict('invalid', 'origin_refused', `origin refused: ${exchange.error}`) };
  }

  const { liveness, readiness } = exchange;
  const live = liveness.kind === 'response' && liveness.json ? readLiveness(liveness.body) : null;
  const ready = readiness?.kind === 'response' && readiness.json ? readReadiness(readiness.body) : null;
  const fields = {
    apiVersion: live?.version ?? null,
    environment: live?.environment ?? null,
    schemaStatus: ready?.schemaStatus ?? null,
    schemaExpected: ready?.schemaExpected ?? null,
    schemaApplied: ready?.schemaApplied ?? null,
  };

  // Liveness first (transport, then content), then readiness.
  const decided =
    transportVerdict('liveness', liveness) ??
    (liveness.kind === 'response' ? livenessVerdict(liveness, live) : null) ??
    (readiness === null
      ? verdict('unreachable', 'connection_failed', 'readiness: not asked')
      : transportVerdict('readiness', readiness)) ??
    (readiness?.kind === 'response'
      ? readinessVerdict(readiness, ready)
      : verdict('unreachable', 'connection_failed', 'readiness: no answer'));
  return { ...fields, ...decided };
}

/**
 * True when the academy's applied schema is older than the newest ACADEMY
 * migration the platform build carries — the academy runs an older release.
 * Null when either is unknown (no snapshot, no schema report, no migrations).
 */
export function isBehind(schemaApplied: string | null, newestAcademyMigration: string | null): boolean | null {
  if (schemaApplied === null || newestAcademyMigration === null) return null;
  if (!MIGRATION_NAME_PATTERN.test(schemaApplied) || !MIGRATION_NAME_PATTERN.test(newestAcademyMigration)) return null;
  return schemaApplied < newestAcademyMigration;
}

/** No check, or none in the last `staleAfterSeconds` (= 3 × PLATFORM_PROBE_INTERVAL_SECONDS). */
export function isStale(latestCheckedAt: Date | null, now: Date, staleAfterSeconds: number): boolean {
  if (latestCheckedAt === null) return true;
  return now.getTime() - latestCheckedAt.getTime() > staleAfterSeconds * 1000;
}

export interface FleetCounts {
  total: number;
  ready: number;
  notReady: number;
  unreachable: number;
  invalid: number;
  /** Never probed. */
  never: number;
  behind: number;
}

/** The fleet's counts: the five outcome counts (with `never`) partition `total`; `behind` counts `behind === true`. */
export function fleetCounts(items: readonly { outcome: ProbeOutcomeValue | null; behind: boolean | null }[]): FleetCounts {
  const counts: FleetCounts = { total: 0, ready: 0, notReady: 0, unreachable: 0, invalid: 0, never: 0, behind: 0 };
  for (const item of items) {
    counts.total += 1;
    if (item.outcome === null) counts.never += 1;
    else if (item.outcome === 'not_ready') counts.notReady += 1;
    else counts[item.outcome] += 1;
    if (item.behind === true) counts.behind += 1;
  }
  return counts;
}
