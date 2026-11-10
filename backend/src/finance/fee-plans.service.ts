import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import type { CreateFeePlanDto, FeePlanDto, FeePlanListDto, ListFeePlansQueryDto, UpdateFeePlanDto } from './fee-plans.dto.js';
import { checkPlan, linesTotal, moneyText, planFeePlanUpdate } from './fee-plans.rules.js';
import type { CurrentPlan, FeePlanPatch, PlanLine, PlanShare } from './fee-plans.rules.js';
import { financeError } from './finance.errors.js';
import { FEE_PLANS_MANAGE_PERMISSION } from './finance.policy.js';

export const FEE_PLANS_AUDIT_ACTIONS = {
  created: 'fee_plans.created',
  updated: 'fee_plans.updated',
  deleted: 'fee_plans.deleted',
} as const;

export const FEE_PLANS_ENTITY_TYPE = 'fee_plans';

const PLAN_SELECT = {
  id: true,
  name: true,
  courseId: true,
  classId: true,
  lines: true,
  installments: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, name: true } },
  class: { select: { id: true, code: true, name: true } },
} satisfies Prisma.FeePlanSelect;

type PlanRow = Prisma.FeePlanGetPayload<{ select: typeof PLAN_SELECT }>;
type Tx = Prisma.TransactionClient;

function canManage(caller: Pick<AuthPrincipal, 'permissions'>): boolean {
  return caller.permissions.includes(FEE_PLANS_MANAGE_PERMISSION);
}

/** The stored lines as the API returns them (lenient: an unreadable item is dropped). */
export function readPlanLines(value: Prisma.JsonValue): PlanLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as { description?: unknown; amount?: unknown } | null;
    const description = readLocalizedText(row?.description);
    return description && typeof row?.amount === 'number' ? [{ description, amount: row.amount }] : [];
  });
}

/** The stored installment shares as the API returns them. */
export function readPlanShares(value: Prisma.JsonValue): PlanShare[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as { percent?: unknown; dueOffsetDays?: unknown } | null;
    return typeof row?.percent === 'number' && typeof row?.dueOffsetDays === 'number' ? [{ percent: row.percent, dueOffsetDays: row.dueOffsetDays }] : [];
  });
}

function ref(row: { id: string; code: string; name: Prisma.JsonValue } | null) {
  return row ? { id: row.id, code: row.code, name: readLocalizedText(row.name) ?? { ar: row.code } } : null;
}

function toPlanDto(row: PlanRow, invoiceCount: number | null): FeePlanDto {
  const lines = readPlanLines(row.lines);
  return {
    id: row.id,
    name: readLocalizedText(row.name) ?? { ar: '' },
    course: ref(row.course),
    class: ref(row.class),
    lines,
    installments: readPlanShares(row.installments),
    total: Number(linesTotal(lines)),
    isActive: row.isActive,
    invoiceCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentOf(row: PlanRow): CurrentPlan {
  return {
    name: readLocalizedText(row.name) ?? { ar: '' },
    courseId: row.courseId,
    classId: row.classId,
    lines: readPlanLines(row.lines),
    installments: readPlanShares(row.installments),
    isActive: row.isActive,
  };
}

/** Two-decimal numbers as stored (the DTO already limits the decimals). */
function normaliseLines(lines: readonly { description: Parameters<typeof toLocalizedText>[0]; amount: number }[]): PlanLine[] {
  return lines.map((line) => ({ description: toLocalizedText(line.description), amount: Number(moneyText(line.amount)) }));
}

function normaliseShares(shares: readonly { percent: number; dueOffsetDays: number }[]): PlanShare[] {
  return shares.map((share) => ({ percent: Number(moneyText(share.percent)), dueOffsetDays: share.dueOffsetDays }));
}

/**
 * MOD-11-T02 — fee plans (roadmap §4i.4 API-140..API-143; owner decision
 * D-R60): templates of lines and installment shares that an invoice copies.
 * Reading needs `fee_plans.manage` or `invoices.manage` (checked in the
 * controller) — inactive plans and the invoice counts for `fee_plans.manage`
 * only; writing needs `fee_plans.manage`. A plan prices a course, a class or
 * nothing in particular; its shares sum to 100 with non-decreasing day
 * offsets. A plan an invoice was created from is deactivated, not deleted
 * (`409 fee_plan_in_use`). One `fee_plans.*` event per effective write.
 */
@Injectable()
export class FeePlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** API-140 */
  async list(query: ListFeePlansQueryDto, caller: AuthPrincipal): Promise<FeePlanListDto> {
    const manage = canManage(caller);
    const where: Prisma.FeePlanWhereInput = {};
    if (!manage) where.isActive = true;
    if (query.courseId) where.courseId = query.courseId;
    if (query.classId) where.classId = query.classId;
    const rows = await this.prisma.db.feePlan.findMany({ where, orderBy: { id: 'asc' }, select: PLAN_SELECT });
    const counts = manage ? await this.invoiceCounts(this.prisma.db, rows.map((row) => row.id)) : null;
    return { items: rows.map((row) => toPlanDto(row, counts ? (counts.get(row.id) ?? 0) : null)) };
  }

  /** API-141 */
  async create(input: CreateFeePlanDto, caller: AuthPrincipal, ctx: RequestContext): Promise<FeePlanDto> {
    const plan = { courseId: input.courseId ?? null, classId: input.classId ?? null, installments: normaliseShares(input.installments) };
    const problems = checkPlan(plan);
    if (problems.length > 0) throw financeError.feePlanInvalid(problems);
    const lines = normaliseLines(input.lines);
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertScope(tx, plan.courseId, plan.classId);
      const row = await tx.feePlan.create({
        data: {
          name: toLocalizedText(input.name) as unknown as Prisma.InputJsonValue,
          courseId: plan.courseId,
          classId: plan.classId,
          lines: lines as unknown as Prisma.InputJsonValue,
          installments: plan.installments as unknown as Prisma.InputJsonValue,
          createdById: caller.id,
        },
        select: PLAN_SELECT,
      });
      await this.audit.record(
        {
          action: FEE_PLANS_AUDIT_ACTIONS.created,
          actorUserId: caller.id,
          entityType: FEE_PLANS_ENTITY_TYPE,
          entityId: row.id,
          metadata: { courseId: plan.courseId, classId: plan.classId, total: Number(linesTotal(lines)), installments: plan.installments.length },
          ...ctx,
        },
        tx,
      );
      return toPlanDto(row, 0);
    });
  }

  /** API-142 */
  async update(id: string, input: UpdateFeePlanDto, caller: AuthPrincipal, ctx: RequestContext): Promise<FeePlanDto> {
    const patch: FeePlanPatch = {};
    if (input.name !== undefined) patch.name = toLocalizedText(input.name);
    if (input.courseId !== undefined) patch.courseId = input.courseId;
    if (input.classId !== undefined) patch.classId = input.classId;
    if (input.lines !== undefined) patch.lines = normaliseLines(input.lines);
    if (input.installments !== undefined) patch.installments = normaliseShares(input.installments);
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (Object.keys(patch).length === 0) throw financeError.nothingToUpdate();
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_plans WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      if (!locked[0]) throw financeError.feePlanNotFound(id);
      const row = await tx.feePlan.findUniqueOrThrow({ where: { id }, select: PLAN_SELECT });
      const plan = planFeePlanUpdate(currentOf(row), patch);
      const problems = checkPlan(plan.next);
      if (problems.length > 0) throw financeError.feePlanInvalid(problems);
      if (plan.fields.length === 0) return toPlanDto(row, (await this.invoiceCounts(tx, [id])).get(id) ?? 0);
      if (plan.fields.includes('courseId') || plan.fields.includes('classId')) await this.assertScope(tx, plan.next.courseId, plan.next.classId);
      const data: Prisma.FeePlanUncheckedUpdateInput = {};
      if (plan.fields.includes('name')) data.name = plan.next.name as unknown as Prisma.InputJsonValue;
      if (plan.fields.includes('courseId')) data.courseId = plan.next.courseId;
      if (plan.fields.includes('classId')) data.classId = plan.next.classId;
      if (plan.fields.includes('lines')) data.lines = plan.next.lines as unknown as Prisma.InputJsonValue;
      if (plan.fields.includes('installments')) data.installments = plan.next.installments as unknown as Prisma.InputJsonValue;
      if (plan.fields.includes('isActive')) data.isActive = plan.next.isActive;
      const updated = await tx.feePlan.update({ where: { id }, data, select: PLAN_SELECT });
      await this.audit.record(
        { action: FEE_PLANS_AUDIT_ACTIONS.updated, actorUserId: caller.id, entityType: FEE_PLANS_ENTITY_TYPE, entityId: id, metadata: { fields: plan.fields }, ...ctx },
        tx,
      );
      return toPlanDto(updated, (await this.invoiceCounts(tx, [id])).get(id) ?? 0);
    });
  }

  /** API-143 */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_plans WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked[0]) throw financeError.feePlanNotFound(id);
      const invoiceCount = await tx.invoice.count({ where: { feePlanId: id } });
      if (invoiceCount > 0) throw financeError.feePlanInUse(invoiceCount);
      await tx.feePlan.delete({ where: { id } });
      await this.audit.record({ action: FEE_PLANS_AUDIT_ACTIONS.deleted, actorUserId: caller.id, entityType: FEE_PLANS_ENTITY_TYPE, entityId: id, metadata: {}, ...ctx }, tx);
    });
  }

  // ---------------------------------------------------------------------------

  private async assertScope(tx: Tx, courseId: string | null, classId: string | null): Promise<void> {
    if (courseId && !(await tx.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw financeError.courseNotFound(courseId);
    if (classId && !(await tx.class.findUnique({ where: { id: classId }, select: { id: true } }))) throw financeError.classNotFound(classId);
  }

  private async invoiceCounts(db: Tx | PrismaService['db'], ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const groups = await db.invoice.groupBy({ by: ['feePlanId'], where: { feePlanId: { in: [...ids] } }, _count: { _all: true } });
    return new Map(groups.map((group) => [group.feePlanId!, group._count._all]));
  }
}
