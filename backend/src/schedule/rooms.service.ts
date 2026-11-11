import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { isEmptyRoomPatch, planRoomUpdate } from './rooms.changes.js';
import type { CurrentRoom, RoomPatch, RoomUpdatePlan } from './rooms.changes.js';
import { NO_BRANCH_FILTER } from './rooms.dto.js';
import type { CreateRoomDto, ListRoomsQueryDto, RoomDto, RoomListDto, UpdateRoomDto } from './rooms.dto.js';
import { scheduleError } from './schedule.errors.js';
import { canManageSchedule } from './schedule.policy.js';
import { displayTimeZone } from './timetable.policy.js';

export const ROOMS_AUDIT_ACTIONS = {
  created: 'rooms.created',
  updated: 'rooms.updated',
  deleted: 'rooms.deleted',
} as const;

/** Audit `entity_type` of room events. */
export const ROOMS_ENTITY_TYPE = 'rooms';

const ROOM_SELECT = {
  id: true,
  branchId: true,
  code: true,
  name: true,
  capacity: true,
  kind: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, code: true, name: true, timezone: true } },
} satisfies Prisma.RoomSelect;

type RoomRow = Prisma.RoomGetPayload<{ select: typeof ROOM_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, 'branch' | 'room' | 'classSchedule'>;

/** `timeZone` = the zone the room's times are shown in (D-R41): its branch's, else the academy's — as for lessons and slots. */
function toRoomDto(row: RoomRow, academyTimeZone: string): RoomDto {
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name),
    capacity: row.capacity,
    kind: row.kind,
    branchId: row.branchId,
    branch: row.branch ? { id: row.branch.id, code: row.branch.code, name: readLocalizedText(row.branch.name) ?? { ar: row.branch.code } } : null,
    timeZone: displayTimeZone(row.branch?.timezone, academyTimeZone),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentOf(row: RoomRow): CurrentRoom {
  return {
    code: row.code,
    name: readLocalizedText(row.name),
    capacity: row.capacity,
    kind: row.kind,
    branchId: row.branchId,
    isActive: row.isActive,
  };
}

/** DTO → plain patch (localized text reduced to strings only). */
function patchOf(input: UpdateRoomDto): RoomPatch {
  const patch: RoomPatch = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.name !== undefined) patch.name = input.name === null ? null : toLocalizedText(input.name);
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.branchId !== undefined) patch.branchId = input.branchId;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  return patch;
}

/** Optional localized jsonb: `null` must be the database NULL, not a JSON `null` (the CHECK accepts NULL or an object with `ar`). */
function optionalJson(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toUpdateInput(data: RoomUpdatePlan['data']): Prisma.RoomUncheckedUpdateInput {
  const { name, ...scalars } = data;
  const input: Prisma.RoomUncheckedUpdateInput = { ...scalars };
  if (name !== undefined) input.name = optionalJson(name);
  return input;
}

/** The academy's own site (no branch) first, then by branch code, then by room code. */
function byPlace(a: RoomRow, b: RoomRow): number {
  const branchA = a.branch?.code ?? '';
  const branchB = b.branch?.code ?? '';
  if (branchA !== branchB) return branchA < branchB ? -1 : 1;
  if (a.code === b.code) return 0;
  return a.code < b.code ? -1 : 1;
}

/** Serialises the writers of one room (PATCH / DELETE) without blocking readers. */
async function lockRoom(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate code in the
 * same namespace (P2002 on uq_rooms_branch_code), a branch deleted meanwhile
 * (P2003 on insert/update), a slot that took the room before the delete
 * (P2003 on delete) or a row deleted meanwhile (P2025).
 */
function translateKnownError(error: unknown, scope: { roomId: string | null; code: string | null; branchId: string | null; deleting?: boolean }): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002' && scope.code !== null) return scheduleError.roomCodeTaken(scope.code, scope.branchId);
  if (error.code === 'P2003') return scope.deleting ? scheduleError.roomInUse(1) : scheduleError.branchNotFound(scope.branchId ?? '');
  if (error.code === 'P2025' && scope.roomId !== null) return scheduleError.roomNotFound(scope.roomId);
  return error;
}

/**
 * MOD-07-T02 (O9) — rooms. Every signed-in user lists the active rooms (the
 * place of a slot — D-R21/D-R27); `schedule.manage` also sees inactive ones
 * and writes. Every write is one transaction with exactly one audit event
 * (`rooms.*`; metadata holds codes, ids and field names only). A PATCH without
 * a difference writes nothing and records nothing. A room is deleted only
 * while no weekly slot points to it (`409 room_in_use`); deactivation keeps
 * existing slots and refuses new ones (T03).
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListRoomsQueryDto, caller: AuthPrincipal): Promise<RoomListDto> {
    const where: Prisma.RoomWhereInput = {};
    if (!canManageSchedule(caller.permissions)) where.isActive = true;
    if (query.branchId === NO_BRANCH_FILTER) where.branchId = null;
    else if (query.branchId !== undefined) where.branchId = query.branchId;
    if (query.kind !== undefined) where.kind = query.kind;
    const [rows, academyTimeZone] = await Promise.all([this.prisma.db.room.findMany({ where, select: ROOM_SELECT }), this.academyTimeZone()]);
    return { items: rows.sort(byPlace).map((row) => toRoomDto(row, academyTimeZone)) };
  }

  async create(input: CreateRoomDto, caller: AuthPrincipal, ctx: RequestContext): Promise<RoomDto> {
    const branchId = input.branchId ?? null;
    if (branchId !== null) await this.assertBranchUsable(this.prisma.db, branchId);
    await this.assertCodeFree(this.prisma.db, input.code, branchId, null);

    const kind = input.kind ?? 'classroom';
    const name = input.name ? toLocalizedText(input.name) : null;
    let roomId: string;
    try {
      roomId = await this.prisma.db.$transaction(async (tx) => {
        const room = await tx.room.create({
          data: {
            branchId,
            code: input.code,
            name: optionalJson(name),
            capacity: input.capacity ?? null,
            kind,
            isActive: input.isActive ?? true,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: ROOMS_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: ROOMS_ENTITY_TYPE,
            entityId: room.id,
            metadata: { code: input.code, branchId, kind },
            ...ctx,
          },
          tx,
        );
        return room.id;
      });
    } catch (error) {
      throw translateKnownError(error, { roomId: null, code: input.code, branchId });
    }
    return this.getById(roomId);
  }

  async update(id: string, input: UpdateRoomDto, caller: AuthPrincipal, ctx: RequestContext): Promise<RoomDto> {
    if (isEmptyRoomPatch(input)) throw scheduleError.nothingToUpdate();
    const row = await this.prisma.db.room.findUnique({ where: { id }, select: ROOM_SELECT });
    if (!row) throw scheduleError.roomNotFound(id);

    const patch = patchOf(input);
    // Fast path and friendly refusals on the current row; the transaction plans again under the row lock.
    const first = planRoomUpdate(currentOf(row), patch);
    if (first.fields.length === 0) return toRoomDto(row, await this.academyTimeZone());
    const targetBranchId = first.data.branchId !== undefined ? first.data.branchId : row.branchId;
    const targetCode = first.data.code ?? row.code;
    if (first.targetBranchId !== null) await this.assertBranchUsable(this.prisma.db, first.targetBranchId);
    if (first.codeNamespaceChanges) await this.assertCodeFree(this.prisma.db, targetCode, targetBranchId, id);

    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockRoom(tx, id);
        const fresh = await tx.room.findUnique({ where: { id }, select: ROOM_SELECT });
        if (!fresh) throw scheduleError.roomNotFound(id);
        const plan = planRoomUpdate(currentOf(fresh), patch);
        if (plan.fields.length === 0) return;
        await tx.room.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
        await this.audit.record(
          {
            action: ROOMS_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: ROOMS_ENTITY_TYPE,
            entityId: id,
            metadata: {
              code: plan.data.code ?? fresh.code,
              fields: plan.fields,
              ...(plan.data.branchId !== undefined ? { branchId: plan.data.branchId } : {}),
            },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, { roomId: id, code: first.codeNamespaceChanges ? targetCode : null, branchId: targetBranchId });
    }
    return this.getById(id);
  }

  /** Deletes a room that no weekly slot uses (`409 room_in_use { slotCount }`); deactivate a room in use instead. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.db.room.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw scheduleError.roomNotFound(id);
    await this.assertUnused(this.prisma.db, id);
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockRoom(tx, id);
        const fresh = await tx.room.findUnique({ where: { id }, select: { code: true, branchId: true } });
        if (!fresh) throw scheduleError.roomNotFound(id);
        await this.assertUnused(tx, id);
        await tx.room.delete({ where: { id }, select: { id: true } });
        await this.audit.record(
          {
            action: ROOMS_AUDIT_ACTIONS.deleted,
            actorUserId: caller.id,
            entityType: ROOMS_ENTITY_TYPE,
            entityId: id,
            metadata: { code: fresh.code, branchId: fresh.branchId },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, { roomId: id, code: null, branchId: null, deleting: true });
    }
  }

  /** The branch named for a room must exist (`404 branch_not_found`) and be active (`422 branch_inactive`). */
  private async assertBranchUsable(db: Db, branchId: string): Promise<void> {
    const branch = await db.branch.findUnique({ where: { id: branchId }, select: { isActive: true } });
    if (!branch) throw scheduleError.branchNotFound(branchId);
    if (!branch.isActive) throw scheduleError.branchInactive(branchId);
  }

  /** The code is unique inside its branch; rooms without a branch share one namespace (`uq_rooms_branch_code` NULLS NOT DISTINCT is the backstop). */
  private async assertCodeFree(db: Db, code: string, branchId: string | null, exceptId: string | null): Promise<void> {
    const clash = await db.room.findFirst({
      where: { branchId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw scheduleError.roomCodeTaken(code, branchId);
  }

  /** Weekly slots keep a room alive (`class_schedules.room_id` is Restrict); lessons will too once MOD-06 exists. */
  private async assertUnused(db: Db, roomId: string): Promise<void> {
    const slotCount = await db.classSchedule.count({ where: { roomId } });
    if (slotCount > 0) throw scheduleError.roomInUse(slotCount);
  }

  private async getById(id: string): Promise<RoomDto> {
    const row = await this.prisma.db.room.findUnique({ where: { id }, select: ROOM_SELECT });
    if (!row) throw scheduleError.roomNotFound(id);
    return toRoomDto(row, await this.academyTimeZone());
  }

  /** The academy's IANA zone, read once per request; UTC without the academy row (as API-090/091 and the lessons). */
  private async academyTimeZone(): Promise<string> {
    const academy = await this.prisma.db.academy.findFirst({ select: { timezone: true } });
    return academy?.timezone ?? 'UTC';
  }
}
