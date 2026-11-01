import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { coursesError } from '../courses/courses.errors.js';
import { canManageCourses } from '../courses/courses.policy.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { checkLevelOrder, isEmptyLevelPatch, planLevelUpdate } from './levels.changes.js';
import type { CurrentLevel, LevelPatch } from './levels.changes.js';
import type { CreateLevelDto, LevelDto, LevelListDto, ReorderLevelsDto, UpdateLevelDto } from './levels.dto.js';

export const LEVELS_AUDIT_ACTIONS = {
  created: 'levels.created',
  updated: 'levels.updated',
  deleted: 'levels.deleted',
  reordered: 'levels.reordered',
} as const;

/** Audit `entity_type` of level events. */
export const LEVELS_ENTITY_TYPE = 'levels';

const LEVEL_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { courses: true } },
} satisfies Prisma.LevelSelect;

type LevelRow = Prisma.LevelGetPayload<{ select: typeof LEVEL_SELECT }>;
type Tx = Prisma.TransactionClient;

function toLevelDto(row: LevelRow, manager: boolean): LevelDto {
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    description: readLocalizedText(row.description),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    courseCount: manager ? row._count.courses : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentOf(row: LevelRow): CurrentLevel {
  return {
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    description: readLocalizedText(row.description),
    isActive: row.isActive,
  };
}

/**
 * Optional localized jsonb: `null` must be the database NULL (`Prisma.DbNull`),
 * not a JSON `null` — the CHECK only accepts NULL or an object with `ar`.
 */
function optionalJson(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/**
 * Every write that assigns or moves sort orders runs under one transaction-
 * scoped advisory lock, so two creations cannot pick the same `max + 1` and a
 * reorder never interleaves with a creation (the deferred unique would only
 * fail at COMMIT).
 */
async function lockLevelOrder(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('articode.levels.order'))`;
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate code (P2002),
 * a deletion that lost the race with a course assignment (P2003) or a row
 * deleted meanwhile (P2025).
 */
function translateKnownError(error: unknown, levelId: string | null, code: string | null): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002' && code !== null) return coursesError.levelCodeTaken(code);
  if (error.code === 'P2003') return coursesError.levelInUse(1);
  if (error.code === 'P2025' && levelId !== null) return coursesError.levelNotFound(levelId);
  return error;
}

/**
 * MOD-04-T02 — course levels. `courses.read` lists the active levels;
 * `courses.manage` sees inactive ones with their course counts and writes.
 * Every write is one transaction with exactly one audit event (`levels.*`);
 * metadata holds codes, ids and field names only. A PATCH or reorder without
 * a difference writes nothing and records nothing.
 */
@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(caller: AuthPrincipal): Promise<LevelListDto> {
    const manager = canManageCourses(caller.permissions);
    const rows = await this.prisma.db.level.findMany({
      where: manager ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: LEVEL_SELECT,
    });
    return { items: rows.map((row) => toLevelDto(row, manager)) };
  }

  async create(input: CreateLevelDto, caller: AuthPrincipal, ctx: RequestContext): Promise<LevelDto> {
    const clash = await this.prisma.db.level.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw coursesError.levelCodeTaken(input.code);

    const name = toLocalizedText(input.name);
    const description = input.description ? toLocalizedText(input.description) : null;
    let levelId: string;
    try {
      levelId = await this.prisma.db.$transaction(async (tx) => {
        await lockLevelOrder(tx);
        const max = await tx.level.aggregate({ _max: { sortOrder: true } });
        const sortOrder = (max._max.sortOrder ?? -1) + 1;
        const level = await tx.level.create({
          data: {
            code: input.code,
            name: name as Prisma.InputJsonValue,
            description: optionalJson(description),
            isActive: input.isActive ?? true,
            sortOrder,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: LEVELS_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: LEVELS_ENTITY_TYPE,
            entityId: level.id,
            metadata: { code: input.code, sortOrder },
            ...ctx,
          },
          tx,
        );
        return level.id;
      });
    } catch (error) {
      throw translateKnownError(error, null, input.code);
    }
    return this.getById(levelId);
  }

  async update(id: string, input: UpdateLevelDto, caller: AuthPrincipal, ctx: RequestContext): Promise<LevelDto> {
    if (isEmptyLevelPatch(input)) throw coursesError.nothingToUpdate();
    const row = await this.prisma.db.level.findUnique({ where: { id }, select: LEVEL_SELECT });
    if (!row) throw coursesError.levelNotFound(id);

    const patch: LevelPatch = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.name !== undefined) patch.name = toLocalizedText(input.name);
    if (input.description !== undefined) patch.description = input.description === null ? null : toLocalizedText(input.description);
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    const plan = planLevelUpdate(currentOf(row), patch);
    if (plan.fields.length === 0) return toLevelDto(row, true);

    if (plan.data.code !== undefined) {
      const clash = await this.prisma.db.level.findUnique({ where: { code: plan.data.code }, select: { id: true } });
      if (clash && clash.id !== id) throw coursesError.levelCodeTaken(plan.data.code);
    }

    const data: Prisma.LevelUpdateInput = {};
    if (plan.data.code !== undefined) data.code = plan.data.code;
    if (plan.data.name !== undefined) data.name = plan.data.name as Prisma.InputJsonValue;
    if (plan.data.description !== undefined) data.description = optionalJson(plan.data.description);
    if (plan.data.isActive !== undefined) data.isActive = plan.data.isActive;
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.level.update({ where: { id }, data, select: { id: true } });
        await this.audit.record(
          {
            action: LEVELS_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: LEVELS_ENTITY_TYPE,
            entityId: id,
            metadata: { code: plan.data.code ?? row.code, fields: plan.fields },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, plan.data.code ?? null);
    }
    return this.getById(id);
  }

  /** Deletes a level no course uses (`409 level_in_use` otherwise); the remaining orders keep their gaps. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.db.level.findUnique({ where: { id }, select: LEVEL_SELECT });
    if (!row) throw coursesError.levelNotFound(id);
    if (row._count.courses > 0) throw coursesError.levelInUse(row._count.courses);
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockLevelOrder(tx);
        // The FK on courses.level_id (Restrict) rejects the delete if a course
        // took the level meanwhile (P2003 → 409) and rolls the event back too.
        await tx.level.delete({ where: { id }, select: { id: true } });
        await this.audit.record(
          {
            action: LEVELS_AUDIT_ACTIONS.deleted,
            actorUserId: caller.id,
            entityType: LEVELS_ENTITY_TYPE,
            entityId: id,
            metadata: { code: row.code },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, null);
    }
  }

  /**
   * Full reorder: `levelIds` must list every level exactly once (`400
   * level_order_invalid` otherwise); positions become 0..n-1. The swap is legal
   * inside the transaction because `uq_levels_sort_order` is deferred (ADR-046).
   */
  async reorder(input: ReorderLevelsDto, caller: AuthPrincipal, ctx: RequestContext): Promise<LevelListDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await lockLevelOrder(tx);
      const rows = await tx.level.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, sortOrder: true },
      });
      const check = checkLevelOrder(
        rows.map((row) => row.id),
        input.levelIds,
      );
      if (!check.ok) throw coursesError.levelOrderInvalid(check.problems);
      if (!check.changed) return;
      const position = new Map(rows.map((row) => [row.id, row.sortOrder]));
      for (const [index, levelId] of input.levelIds.entries()) {
        if (position.get(levelId) === index) continue;
        await tx.level.update({ where: { id: levelId }, data: { sortOrder: index }, select: { id: true } });
      }
      await this.audit.record(
        {
          action: LEVELS_AUDIT_ACTIONS.reordered,
          actorUserId: caller.id,
          entityType: LEVELS_ENTITY_TYPE,
          entityId: null,
          metadata: { levelIds: input.levelIds },
          ...ctx,
        },
        tx,
      );
    });
    return this.list(caller);
  }

  /** Manager view of one level (create/update responses). */
  private async getById(id: string): Promise<LevelDto> {
    const row = await this.prisma.db.level.findUnique({ where: { id }, select: LEVEL_SELECT });
    if (!row) throw coursesError.levelNotFound(id);
    return toLevelDto(row, true);
  }
}
