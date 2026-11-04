import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { isEmptyBranchPatch, planBranchUpdate } from './branches.changes.js';
import type { BranchPatch, BranchUpdatePlan, CurrentBranch } from './branches.changes.js';
import type { BranchDto, BranchListDto, CreateBranchDto, UpdateBranchDto } from './branches.dto.js';
import { branchesError } from './branches.errors.js';
import { canManageBranches } from './branches.policy.js';

export const BRANCHES_AUDIT_ACTIONS = {
  created: 'branches.created',
  updated: 'branches.updated',
  deleted: 'branches.deleted',
} as const;

/** Audit `entity_type` of branch events. */
export const BRANCHES_ENTITY_TYPE = 'branches';

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  timezone: true,
  isMain: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BranchSelect;

type BranchRow = Prisma.BranchGetPayload<{ select: typeof BRANCH_SELECT }>;
type Tx = Prisma.TransactionClient;

function toBranchDto(row: BranchRow): BranchDto {
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    address: readLocalizedText(row.address),
    phone: row.phone,
    timezone: row.timezone,
    isMain: row.isMain,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentOf(row: BranchRow): CurrentBranch {
  return {
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    address: readLocalizedText(row.address),
    phone: row.phone,
    timezone: row.timezone,
    isMain: row.isMain,
    isActive: row.isActive,
  };
}

/** DTO → plain patch (localized texts reduced to strings only). */
function patchOf(input: UpdateBranchDto): BranchPatch {
  const patch: BranchPatch = {};
  if (input.code !== undefined) patch.code = input.code;
  if (input.name !== undefined) patch.name = toLocalizedText(input.name);
  if (input.address !== undefined) patch.address = input.address === null ? null : toLocalizedText(input.address);
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.isMain !== undefined) patch.isMain = input.isMain;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  return patch;
}

/**
 * Optional localized jsonb: `null` must be the database NULL (`Prisma.DbNull`),
 * not a JSON `null` — the CHECK only accepts NULL or an object with `ar`.
 */
function optionalJson(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toUpdateInput(data: BranchUpdatePlan['data']): Prisma.BranchUpdateInput {
  const { name, address, ...scalars } = data;
  const input: Prisma.BranchUpdateInput = { ...scalars };
  if (name !== undefined) input.name = name as Prisma.InputJsonValue;
  if (address !== undefined) input.address = optionalJson(address);
  return input;
}

/**
 * Every write runs under one transaction-scoped advisory lock: two promotions
 * cannot both demote the same main branch and leave two main ones (the
 * partial unique index `uq_branches_main` would only fail with a 500), and a
 * deactivation cannot interleave with a promotion of the same branch.
 * Branch writes are rare, so one lock for all of them is cheap.
 */
async function lockBranches(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('articode.branches.main'))`;
}

/** Makes every other main branch step down; returns the id of the branch that did (at most one). */
async function demoteMain(tx: Tx, exceptId: string | null): Promise<string | null> {
  const current = await tx.branch.findFirst({ where: { isMain: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (!current) return null;
  await tx.branch.update({ where: { id: current.id }, data: { isMain: false }, select: { id: true } });
  return current.id;
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate code (P2002),
 * a deletion that lost the race with a room (P2003 — once rooms exist, O9) or
 * a row deleted meanwhile (P2025).
 */
function translateKnownError(error: unknown, branchId: string | null, code: string | null): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002' && code !== null) return branchesError.codeTaken(code);
  if (error.code === 'P2003') return branchesError.inUse(1);
  if (error.code === 'P2025' && branchId !== null) return branchesError.notFound(branchId);
  return error;
}

/**
 * MOD-02-T06 (O8) — branches. Every signed-in user lists the active branches
 * (D-R21); `branches.manage` also sees inactive ones and writes. Every write is
 * one transaction with exactly one audit event (`branches.*`; metadata holds
 * codes, ids and field names only). A PATCH without a difference writes
 * nothing and records nothing. At most one branch is main: a promotion makes
 * the current main branch step down in the same transaction and event.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(caller: AuthPrincipal): Promise<BranchListDto> {
    const rows = await this.prisma.db.branch.findMany({
      where: canManageBranches(caller.permissions) ? {} : { isActive: true },
      orderBy: [{ isMain: 'desc' }, { code: 'asc' }],
      select: BRANCH_SELECT,
    });
    return { items: rows.map(toBranchDto) };
  }

  async create(input: CreateBranchDto, caller: AuthPrincipal, ctx: RequestContext): Promise<BranchDto> {
    const isMain = input.isMain ?? false;
    const isActive = input.isActive ?? true;
    if (isMain && !isActive) throw branchesError.isMain(null, 'promote_inactive');
    const clash = await this.prisma.db.branch.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw branchesError.codeTaken(input.code);

    const address = input.address ? toLocalizedText(input.address) : null;
    let branchId: string;
    try {
      branchId = await this.prisma.db.$transaction(async (tx) => {
        await lockBranches(tx);
        const demotedBranchId = isMain ? await demoteMain(tx, null) : null;
        const branch = await tx.branch.create({
          data: {
            code: input.code,
            name: toLocalizedText(input.name) as Prisma.InputJsonValue,
            address: optionalJson(address),
            phone: input.phone ?? null,
            timezone: input.timezone ?? null,
            isMain,
            isActive,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: BRANCHES_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: BRANCHES_ENTITY_TYPE,
            entityId: branch.id,
            metadata: { code: input.code, isMain, ...(demotedBranchId ? { demotedBranchId } : {}) },
            ...ctx,
          },
          tx,
        );
        return branch.id;
      });
    } catch (error) {
      throw translateKnownError(error, null, input.code);
    }
    return this.getById(branchId);
  }

  async update(id: string, input: UpdateBranchDto, caller: AuthPrincipal, ctx: RequestContext): Promise<BranchDto> {
    if (isEmptyBranchPatch(input)) throw branchesError.nothingToUpdate();
    const row = await this.prisma.db.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
    if (!row) throw branchesError.notFound(id);

    const patch = patchOf(input);
    // Fast path and friendly refusals on the current row; the transaction plans again after the lock.
    const first = planBranchUpdate(currentOf(row), patch);
    if (first.fields.length === 0) return toBranchDto(row);
    if (first.mainInactive) throw branchesError.isMain(id, first.mainInactive);
    if (first.data.code !== undefined) {
      const clash = await this.prisma.db.branch.findUnique({ where: { code: first.data.code }, select: { id: true } });
      if (clash && clash.id !== id) throw branchesError.codeTaken(first.data.code);
    }

    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockBranches(tx);
        const fresh = await tx.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
        if (!fresh) throw branchesError.notFound(id);
        const plan = planBranchUpdate(currentOf(fresh), patch);
        if (plan.fields.length === 0) return;
        if (plan.mainInactive) throw branchesError.isMain(id, plan.mainInactive);
        const demotedBranchId = plan.promotes ? await demoteMain(tx, id) : null;
        await tx.branch.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
        await this.audit.record(
          {
            action: BRANCHES_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: BRANCHES_ENTITY_TYPE,
            entityId: id,
            metadata: { code: plan.data.code ?? fresh.code, fields: plan.fields, ...(demotedBranchId ? { demotedBranchId } : {}) },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, first.data.code ?? null);
    }
    return this.getById(id);
  }

  /** Deletes a branch that is not main (`409 branch_is_main`) and that nothing uses (rooms — O9). */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.db.branch.findUnique({ where: { id }, select: { id: true, isMain: true } });
    if (!row) throw branchesError.notFound(id);
    if (row.isMain) throw branchesError.isMain(id, 'delete');
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockBranches(tx);
        const fresh = await tx.branch.findUnique({ where: { id }, select: { code: true, isMain: true } });
        if (!fresh) throw branchesError.notFound(id);
        if (fresh.isMain) throw branchesError.isMain(id, 'delete');
        await tx.branch.delete({ where: { id }, select: { id: true } });
        await this.audit.record(
          {
            action: BRANCHES_AUDIT_ACTIONS.deleted,
            actorUserId: caller.id,
            entityType: BRANCHES_ENTITY_TYPE,
            entityId: id,
            metadata: { code: fresh.code },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, null);
    }
  }

  private async getById(id: string): Promise<BranchDto> {
    const row = await this.prisma.db.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
    if (!row) throw branchesError.notFound(id);
    return toBranchDto(row);
  }
}
