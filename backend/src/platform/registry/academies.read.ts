// Reading side of the academies registry (MOD-18-T04): explicit selects, the
// row → DTO mappers and the page-wide loaders shared by the academies,
// domains and subscriptions services. Nothing here writes.
import { readLocalizedText } from '../../authorization/localized-text.js';
import { Prisma } from '../../generated/platform/client.js';
import type { ProbeOutcome, SubscriptionStatus } from '../../generated/platform/client.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';
import type { AcademyCurrentSubscriptionDto, AcademyDetailDto, AcademyItemDto, AcademyLatestHealthCheckDto, DomainDto } from './academies.dto.js';
import { CURRENT_SUBSCRIPTION_STATUSES } from './registry.changes.js';
import { registryError } from './registry.errors.js';
import type { SubscriptionDto } from './subscriptions.dto.js';

/** Audit `entity_type` values of the registry events. */
export const REGISTRY_ENTITY_TYPES = {
  academies: 'academies',
  plans: 'plans',
  subscriptions: 'subscriptions',
} as const;

/** Event names of the registry (roadmap §4m.4). */
export const REGISTRY_AUDIT_ACTIONS = {
  academyCreated: 'platform.academies.created',
  academyUpdated: 'platform.academies.updated',
  academyStatusChanged: 'platform.academies.status.changed',
  domainAdded: 'platform.domains.added',
  domainUpdated: 'platform.domains.updated',
  domainRemoved: 'platform.domains.removed',
  planCreated: 'platform.plans.created',
  planUpdated: 'platform.plans.updated',
  subscriptionCreated: 'platform.subscriptions.created',
  subscriptionUpdated: 'platform.subscriptions.updated',
} as const;

export const ACADEMY_ITEM_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  origin: true,
  contactEmail: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AcademySelect;

export const ACADEMY_DETAIL_SELECT = {
  ...ACADEMY_ITEM_SELECT,
  notes: true,
  archivedAt: true,
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AcademySelect;

export const DOMAIN_SELECT = {
  id: true,
  academyId: true,
  hostname: true,
  kind: true,
  isPrimary: true,
  verifiedAt: true,
  createdAt: true,
} satisfies Prisma.DomainSelect;

export const SUBSCRIPTION_SELECT = {
  id: true,
  academyId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  trialEndsAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  plan: { select: { id: true, key: true, name: true, isActive: true } },
} satisfies Prisma.SubscriptionSelect;

export type AcademyItemRow = Prisma.AcademyGetPayload<{ select: typeof ACADEMY_ITEM_SELECT }>;
export type AcademyDetailRow = Prisma.AcademyGetPayload<{ select: typeof ACADEMY_DETAIL_SELECT }>;
export type DomainRow = Prisma.DomainGetPayload<{ select: typeof DOMAIN_SELECT }>;
export type SubscriptionRow = Prisma.SubscriptionGetPayload<{ select: typeof SUBSCRIPTION_SELECT }>;

interface HealthRow {
  id: string;
  academyId: string;
  checkedAt: Date;
  outcome: ProbeOutcome;
  httpStatus: number | null;
  latencyMs: number | null;
  apiVersion: string | null;
  environment: string | null;
  schemaStatus: string | null;
  schemaExpected: string | null;
  schemaApplied: string | null;
  reason: string | null;
}

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toDomainDto(row: DomainRow): DomainDto {
  return {
    id: row.id,
    hostname: row.hostname,
    kind: row.kind,
    isPrimary: row.isPrimary,
    verifiedAt: isoOrNull(row.verifiedAt),
    createdAt: iso(row.createdAt),
  };
}

export function toSubscriptionDto(row: SubscriptionRow): SubscriptionDto {
  return {
    id: row.id,
    academyId: row.academyId,
    plan: {
      id: row.plan.id,
      key: row.plan.key,
      name: readLocalizedText(row.plan.name) ?? { ar: row.plan.key },
      isActive: row.plan.isActive,
    },
    status: row.status,
    startsAt: iso(row.startsAt),
    endsAt: isoOrNull(row.endsAt),
    trialEndsAt: isoOrNull(row.trialEndsAt),
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toCurrentSubscription(row: SubscriptionRow): AcademyCurrentSubscriptionDto {
  return {
    id: row.id,
    planId: row.plan.id,
    planKey: row.plan.key,
    status: row.status,
    startsAt: iso(row.startsAt),
    endsAt: isoOrNull(row.endsAt),
    trialEndsAt: isoOrNull(row.trialEndsAt),
  };
}

function toHealthDto(row: HealthRow): AcademyLatestHealthCheckDto {
  return {
    id: row.id,
    checkedAt: iso(row.checkedAt),
    outcome: row.outcome,
    httpStatus: row.httpStatus,
    latencyMs: row.latencyMs,
    apiVersion: row.apiVersion,
    environment: row.environment,
    schemaStatus: row.schemaStatus,
    schemaExpected: row.schemaExpected,
    schemaApplied: row.schemaApplied,
    reason: row.reason,
  };
}

interface ItemExtras {
  primary: Map<string, string>;
  current: Map<string, SubscriptionRow>;
  health: Map<string, HealthRow>;
}

/**
 * The page-wide parts of the list items, one query each whatever the page size: the primary domain,
 * the current subscription (at most one per academy — partial unique) and the
 * newest health check per academy (DISTINCT ON over the index
 * `(academy_id, checked_at DESC)` — never every probe of an academy).
 */
async function loadExtras(db: PlatformTransaction, academyIds: readonly string[]): Promise<ItemExtras> {
  if (academyIds.length === 0) return { primary: new Map(), current: new Map(), health: new Map() };
  const ids = [...new Set(academyIds)];
  const sqlIds = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
  // Sequential on purpose: `db` may be an interactive transaction, whose one
  // connection must not receive overlapping queries (KI-074).
  const primaries = await db.domain.findMany({ where: { academyId: { in: ids }, isPrimary: true }, select: { academyId: true, hostname: true } });
  const currents = await db.subscription.findMany({
    where: { academyId: { in: ids }, status: { in: [...CURRENT_SUBSCRIPTION_STATUSES] as SubscriptionStatus[] } },
    select: SUBSCRIPTION_SELECT,
  });
  const checks = await db.$queryRaw<HealthRow[]>`
      SELECT DISTINCT ON (academy_id)
             id, academy_id AS "academyId", checked_at AS "checkedAt", outcome::text AS outcome,
             http_status AS "httpStatus", latency_ms AS "latencyMs", api_version AS "apiVersion", environment,
             schema_status AS "schemaStatus", schema_expected AS "schemaExpected", schema_applied AS "schemaApplied", reason
        FROM academy_health_checks
       WHERE academy_id IN (${sqlIds})
       ORDER BY academy_id, checked_at DESC, id DESC`;
  return {
    primary: new Map(primaries.map((row) => [row.academyId, row.hostname])),
    current: new Map(currents.map((row) => [row.academyId, row])),
    health: new Map(checks.map((row) => [row.academyId, row])),
  };
}

function toItemDto(row: AcademyItemRow, extras: ItemExtras): AcademyItemDto {
  const current = extras.current.get(row.id);
  const health = extras.health.get(row.id);
  return {
    id: row.id,
    slug: row.slug,
    name: readLocalizedText(row.name) ?? { ar: row.slug },
    status: row.status,
    origin: row.origin,
    contactEmail: row.contactEmail,
    primaryDomain: extras.primary.get(row.id) ?? null,
    currentSubscription: current ? toCurrentSubscription(current) : null,
    latestHealthCheck: health ? toHealthDto(health) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function toAcademyItems(db: PlatformTransaction, rows: readonly AcademyItemRow[]): Promise<AcademyItemDto[]> {
  const extras = await loadExtras(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toItemDto(row, extras));
}

/** The academy with its domains (primary first, then by hostname) and subscriptions (newest first), or `404 academy_not_found`. */
export async function loadAcademyDetail(db: PlatformTransaction, academyId: string): Promise<AcademyDetailDto> {
  const row = await db.academy.findUnique({ where: { id: academyId }, select: ACADEMY_DETAIL_SELECT });
  if (!row) throw registryError.academyNotFound(academyId);
  const extras = await loadExtras(db, [row.id]);
  const domains = await db.domain.findMany({ where: { academyId }, orderBy: [{ isPrimary: 'desc' }, { hostname: 'asc' }], select: DOMAIN_SELECT });
  const subscriptions = await db.subscription.findMany({ where: { academyId }, orderBy: [{ id: 'desc' }], select: SUBSCRIPTION_SELECT });
  return {
    ...toItemDto(row, extras),
    notes: row.notes,
    archivedAt: isoOrNull(row.archivedAt),
    createdBy: row.createdBy ? { id: row.createdBy.id, fullName: row.createdBy.fullName } : null,
    domains: domains.map(toDomainDto),
    subscriptions: subscriptions.map(toSubscriptionDto),
  };
}

export interface LockedAcademy {
  id: string;
  slug: string;
  status: AcademyItemRow['status'];
}

/**
 * Locks the academy row for the rest of the transaction (`FOR NO KEY UPDATE`)
 * and returns its slug and status, or null when it does not exist. Every
 * registry write on an academy and on its domains and subscriptions takes this
 * lock first, so the archived check, the primary-domain swap and the
 * one-current-subscription check run one at a time per academy (the inserts'
 * own foreign-key `KEY SHARE` locks do not conflict with it).
 */
export async function lockAcademy(tx: PlatformTransaction, academyId: string): Promise<LockedAcademy | null> {
  const rows = await tx.$queryRaw<LockedAcademy[]>`
    SELECT id, slug, status::text AS status FROM academies WHERE id = ${academyId}::uuid FOR NO KEY UPDATE`;
  return rows[0] ?? null;
}

/** A unique violation (P2002) — a concurrent request beat the friendly check. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
