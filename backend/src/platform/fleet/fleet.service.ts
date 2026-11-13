// MOD-18-T05 (D-R103) — fleet health: probe an academy's public endpoints,
// keep the snapshots, and read them back. No audit event for a probe or a read
// (§4m.4): the `academy_health_checks` row is its own record, with
// `triggered_by` for a probe a platform user asked for.
//
// Retention: after each insert, the academy's rows beyond its newest
// HEALTH_CHECKS_KEPT_PER_ACADEMY (500 — about 41 hours at the default 5-minute
// interval) are deleted in the same transaction.
//
// The HTTP requests run OUTSIDE any database transaction; only the insert and
// the pruning share one (scalar queries only — no relation read inside it, KI-074).
import { Inject, Injectable } from '@nestjs/common';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../common/keyset-cursor.js';
import { readLocalizedText } from '../../authorization/localized-text.js';
import { readNewestMigration } from '../../health/schema-version.js';
import { Prisma } from '../../generated/platform/client.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import { fleetError } from './fleet.errors.js';
import type { FleetDto, HealthCheckDto, HealthCheckListDto, HealthCheckUserDto, ListHealthChecksQueryDto } from './fleet.dto.js';
import { HEALTH_CHECKS_PAGE_DEFAULT } from './fleet.dto.js';
import {
  ACADEMY_MIGRATIONS_DIR,
  FLEET_SETTINGS,
  HEALTH_CHECKS_KEPT_PER_ACADEMY,
  STALE_AFTER_INTERVALS,
} from './fleet.settings.js';
import type { FleetSettings } from './fleet.settings.js';
import { ProbeClient } from './probe.client.js';
import { fleetCounts, isBehind, isStale, snapshotOf } from './probe.rules.js';
import type { ProbeOutcomeValue } from './probe.rules.js';

/** The scalar columns of a health check (no relation — safe inside a transaction). */
const CHECK_SELECT = {
  id: true,
  academyId: true,
  checkedAt: true,
  outcome: true,
  httpStatus: true,
  latencyMs: true,
  apiVersion: true,
  environment: true,
  schemaStatus: true,
  schemaExpected: true,
  schemaApplied: true,
  reason: true,
  error: true,
  triggeredById: true,
} as const satisfies Prisma.AcademyHealthCheckSelect;

/** CHECK_SELECT with the triggering user's name (outside transactions only). */
const CHECK_WITH_USER_SELECT = {
  ...CHECK_SELECT,
  triggeredBy: { select: { id: true, fullName: true } },
} as const satisfies Prisma.AcademyHealthCheckSelect;

type CheckRow = Prisma.AcademyHealthCheckGetPayload<{ select: typeof CHECK_SELECT }>;

const HISTORY_CURSOR_SORT = 'id';

/** One probing round of the periodic service (probe.ts). */
export interface ProbeRoundSummary {
  /** Academies the round tried (not archived, with an origin). */
  probed: number;
  ready: number;
  notReady: number;
  unreachable: number;
  invalid: number;
  /** Recorded snapshots whose `behind` is true. */
  behind: number;
  /** Probes whose snapshot could not be recorded (a database error). */
  failed: number;
  /** The message of the first such error (the CLI masks secrets before printing it). */
  firstError?: string;
}

@Injectable()
export class FleetService {
  /** The build's newest academy migration, read once: the shipped folder never changes. */
  private newestMigration?: Promise<string | null>;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly client: ProbeClient,
    @Inject(FLEET_SETTINGS) private readonly settings: FleetSettings,
    @Inject(ACADEMY_MIGRATIONS_DIR) private readonly academyMigrationsDir: string,
  ) {}

  /** Newest migration of the academy schema shipped with this platform build; null when none. */
  newestAcademyMigration(): Promise<string | null> {
    this.newestMigration ??= readNewestMigration(this.academyMigrationsDir);
    return this.newestMigration;
  }

  /**
   * API-196 — probes one academy now and records the snapshot. `409
   * academy_not_probeable` for an archived academy or one without an origin.
   */
  async probeAcademy(academyId: string, triggeredBy: HealthCheckUserDto | null): Promise<HealthCheckDto> {
    const academy = await this.prisma.db.academy.findUnique({
      where: { id: academyId },
      select: { id: true, status: true, origin: true },
    });
    if (!academy) throw fleetError.academyNotFound(academyId);
    if (academy.status === 'archived') throw fleetError.academyNotProbeable(academyId, 'archived');
    if (academy.origin === null) throw fleetError.academyNotProbeable(academyId, 'no_origin');
    return this.probeAndRecord(academy.id, academy.origin, triggeredBy);
  }

  /**
   * One round of the periodic probe: every academy that is not archived and
   * has an origin, one after the other, by slug. A failure to record one
   * snapshot is counted and the round goes on. `ids` restricts the round
   * (tests).
   */
  async probeAll(filter: { ids?: readonly string[] } = {}): Promise<ProbeRoundSummary> {
    const academies = await this.prisma.db.academy.findMany({
      where: {
        status: { not: 'archived' },
        origin: { not: null },
        ...(filter.ids ? { id: { in: [...filter.ids] } } : {}),
      },
      orderBy: { slug: 'asc' },
      select: { id: true, origin: true },
    });
    const summary: ProbeRoundSummary = {
      probed: academies.length,
      ready: 0,
      notReady: 0,
      unreachable: 0,
      invalid: 0,
      behind: 0,
      failed: 0,
    };
    for (const academy of academies) {
      if (academy.origin === null) continue;
      try {
        const check = await this.probeAndRecord(academy.id, academy.origin, null);
        if (check.outcome === 'not_ready') summary.notReady += 1;
        else summary[check.outcome] += 1;
        if (check.behind === true) summary.behind += 1;
      } catch (error) {
        summary.failed += 1;
        summary.firstError ??= error instanceof Error ? error.message : String(error);
      }
    }
    return summary;
  }

  /** API-197 — the academy's checks, newest first, keyset on the id. Archived academies keep their history. */
  async history(academyId: string, query: ListHealthChecksQueryDto): Promise<HealthCheckListDto> {
    const limit = query.limit ?? HEALTH_CHECKS_PAGE_DEFAULT;
    const after = query.cursor
      ? decodeKeysetCursor(query.cursor, HISTORY_CURSOR_SORT, 'desc', false, fleetError.cursorInvalid)
      : null;

    const academy = await this.prisma.db.academy.findUnique({ where: { id: academyId }, select: { id: true } });
    if (!academy) throw fleetError.academyNotFound(academyId);

    const rows = await this.prisma.db.academyHealthCheck.findMany({
      where: { academyId, ...(after ? { id: { lt: after.id } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: CHECK_WITH_USER_SELECT,
    });
    const page = rows.slice(0, limit);
    const newest = await this.newestAcademyMigration();
    const last = page.at(-1);
    return {
      items: page.map((row) => toHealthCheckDto(row, row.triggeredBy, newest)),
      nextCursor:
        rows.length > limit && last
          ? encodeKeysetCursor({ sort: HISTORY_CURSOR_SORT, order: 'desc', key: null, id: last.id })
          : null,
    };
  }

  /** API-198 — every academy that is not archived, by slug, with its newest check. */
  async fleet(): Promise<FleetDto> {
    const now = new Date();
    const staleAfterSeconds = STALE_AFTER_INTERVALS * this.settings.probeIntervalSeconds;
    const academies = await this.prisma.db.academy.findMany({
      where: { status: { not: 'archived' } },
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true, name: true, status: true, origin: true },
    });

    // The newest check of each academy: one index-ordered row per academy.
    const latestIds = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT latest.id
        FROM academies a
       CROSS JOIN LATERAL (
             SELECT c.id FROM academy_health_checks c
              WHERE c.academy_id = a.id
              ORDER BY c.id DESC
              LIMIT 1) latest
       WHERE a.status <> 'archived'`;
    const latestRows =
      latestIds.length === 0
        ? []
        : await this.prisma.db.academyHealthCheck.findMany({
            where: { id: { in: latestIds.map((row) => row.id) } },
            select: CHECK_WITH_USER_SELECT,
          });
    const latestByAcademy = new Map(latestRows.map((row) => [row.academyId, row]));

    const newest = await this.newestAcademyMigration();
    const items = academies.map((academy) => {
      const row = latestByAcademy.get(academy.id);
      const latest = row ? toHealthCheckDto(row, row.triggeredBy, newest) : null;
      return {
        academy: {
          id: academy.id,
          slug: academy.slug,
          name: readLocalizedText(academy.name) ?? { ar: academy.slug },
          status: academy.status,
          origin: academy.origin,
        },
        latest,
        behind: latest?.behind ?? null,
        stale: isStale(row?.checkedAt ?? null, now, staleAfterSeconds),
      };
    });

    return {
      newestAcademyMigration: newest,
      staleAfterSeconds,
      generatedAt: now.toISOString(),
      counts: fleetCounts(
        items.map((item) => ({ outcome: (item.latest?.outcome ?? null) as ProbeOutcomeValue | null, behind: item.behind })),
      ),
      items,
    };
  }

  private async probeAndRecord(
    academyId: string,
    origin: string,
    triggeredBy: HealthCheckUserDto | null,
  ): Promise<HealthCheckDto> {
    const snapshot = snapshotOf(await this.client.probe(origin));
    let row: CheckRow;
    try {
      row = await this.prisma.db.$transaction(async (tx) => {
        const created = await tx.academyHealthCheck.create({
          data: { academyId, triggeredById: triggeredBy?.id ?? null, ...snapshot },
          select: CHECK_SELECT,
        });
        await pruneHistory(tx, academyId);
        return created;
      });
    } catch (error) {
      // The academy was deleted while it was being probed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw fleetError.academyNotFound(academyId);
      }
      throw error;
    }
    return toHealthCheckDto(row, triggeredBy, await this.newestAcademyMigration());
  }
}

/** Deletes the academy's checks older than its newest HEALTH_CHECKS_KEPT_PER_ACADEMY. */
async function pruneHistory(tx: PlatformTransaction, academyId: string): Promise<void> {
  const oldestDropped = await tx.academyHealthCheck.findFirst({
    where: { academyId },
    orderBy: { id: 'desc' },
    skip: HEALTH_CHECKS_KEPT_PER_ACADEMY,
    select: { id: true },
  });
  if (oldestDropped) {
    await tx.academyHealthCheck.deleteMany({ where: { academyId, id: { lte: oldestDropped.id } } });
  }
}

function toHealthCheckDto(
  row: CheckRow,
  triggeredBy: { id: string; fullName: string } | null,
  newestAcademyMigration: string | null,
): HealthCheckDto {
  return {
    id: row.id,
    academyId: row.academyId,
    checkedAt: row.checkedAt.toISOString(),
    outcome: row.outcome,
    httpStatus: row.httpStatus,
    latencyMs: row.latencyMs,
    apiVersion: row.apiVersion,
    environment: row.environment,
    schemaStatus: row.schemaStatus,
    schemaExpected: row.schemaExpected,
    schemaApplied: row.schemaApplied,
    reason: row.reason,
    error: row.error,
    triggeredBy: row.triggeredById === null || triggeredBy === null ? null : { id: triggeredBy.id, fullName: triggeredBy.fullName },
    behind: isBehind(row.schemaApplied, newestAcademyMigration),
  };
}
