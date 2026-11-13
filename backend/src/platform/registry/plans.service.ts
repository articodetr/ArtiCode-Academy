// MOD-18-T04 — the platform's plans (API-191..193, D-R101): a key, a localized
// name, flat `limits` and an active flag; no price, no currency. Reading is
// open to every signed-in platform user, writing to `super_admin` (the
// controller). A deactivated plan keeps its subscriptions and refuses new ones.
import { Injectable } from '@nestjs/common';
import { readLocalizedText } from '../../authorization/localized-text.js';
import type { RequestContext } from '../../auth/principal.js';
import type { Prisma } from '../../generated/platform/client.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import { REGISTRY_AUDIT_ACTIONS, REGISTRY_ENTITY_TYPES, isUniqueViolation } from './academies.read.js';
import type { CreatePlanDto, ListPlansQueryDto, PlanDto, PlanListDto, UpdatePlanDto } from './plans.dto.js';
import { PLAN_PATCH_FIELDS, isEmptyPatch, planPlanUpdate } from './registry.changes.js';
import type { PlanPatch } from './registry.changes.js';
import { toPlatformLocalizedText } from './registry.dto.js';
import { registryError } from './registry.errors.js';
import { canonicalLimits, checkPlanLimits, readPlanLimits } from './registry.validation.js';
import type { PlanLimits } from './registry.validation.js';

const PLAN_SELECT = {
  id: true,
  key: true,
  name: true,
  limits: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanSelect;

type PlanRow = Prisma.PlanGetPayload<{ select: typeof PLAN_SELECT }>;

function toPlanDto(row: PlanRow): PlanDto {
  return {
    id: row.id,
    key: row.key,
    name: readLocalizedText(row.name) ?? { ar: row.key },
    limits: readPlanLimits(row.limits),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The request's `limits` checked (`400 plan_limits_invalid`) and in stored (sorted) form; undefined when absent. */
function limitsOf(value: unknown): PlanLimits | undefined {
  if (value === undefined) return undefined;
  const verdict = checkPlanLimits(value);
  if (verdict.problems.length > 0) throw registryError.planLimitsInvalid(verdict.problems, verdict.keys);
  return canonicalLimits(value as PlanLimits);
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** API-191 — by key; inactive plans only with `includeInactive=true`. */
  async list(query: ListPlansQueryDto): Promise<PlanListDto> {
    const rows = await this.prisma.db.plan.findMany({
      where: query.includeInactive === true ? {} : { isActive: true },
      orderBy: [{ key: 'asc' }],
      select: PLAN_SELECT,
    });
    return { items: rows.map(toPlanDto) };
  }

  /** API-192 — `409 plan_key_taken` on a duplicate key. */
  async create(input: CreatePlanDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<PlanDto> {
    const limits = limitsOf(input.limits) ?? {};
    const db = this.prisma.db;
    const clash = await db.plan.findUnique({ where: { key: input.key }, select: { id: true } });
    if (clash) throw registryError.planKeyTaken(input.key);
    try {
      const id = await db.$transaction(async (tx) => {
        const plan = await tx.plan.create({
          data: {
            key: input.key,
            name: toPlatformLocalizedText(input.name) as Prisma.InputJsonValue,
            limits: limits as Prisma.InputJsonValue,
            isActive: input.isActive ?? true,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId: caller.id,
          action: REGISTRY_AUDIT_ACTIONS.planCreated,
          entityType: REGISTRY_ENTITY_TYPES.plans,
          entityId: plan.id,
          metadata: { key: input.key },
          ctx,
        });
        return plan.id;
      });
      return toPlanDto(await db.plan.findUniqueOrThrow({ where: { id }, select: PLAN_SELECT }));
    } catch (error) {
      if (isUniqueViolation(error)) throw registryError.planKeyTaken(input.key);
      throw error;
    }
  }

  /** API-193 — smallest diff under the plan-row lock; the key is immutable. */
  async update(id: string, input: UpdatePlanDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<PlanDto> {
    if (isEmptyPatch(input, PLAN_PATCH_FIELDS)) throw registryError.nothingToUpdate();
    const patch: PlanPatch = {};
    if (input.name !== undefined) patch.name = toPlatformLocalizedText(input.name);
    const limits = limitsOf(input.limits);
    if (limits !== undefined) patch.limits = limits;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const db = this.prisma.db;
    await db.$transaction(async (tx) => {
      // Serialises with another PATCH and with a subscription being created on the plan (it reads the plan FOR SHARE).
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM plans WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw registryError.planNotFound(id);
      const row = await tx.plan.findUniqueOrThrow({ where: { id }, select: PLAN_SELECT });
      const plan = planPlanUpdate(
        { name: readLocalizedText(row.name) ?? { ar: row.key }, limits: readPlanLimits(row.limits), isActive: row.isActive },
        patch,
      );
      if (plan.fields.length === 0) return;
      const data: Prisma.PlanUpdateInput = {};
      if (plan.data.name !== undefined) data.name = plan.data.name as Prisma.InputJsonValue;
      if (plan.data.limits !== undefined) data.limits = plan.data.limits as Prisma.InputJsonValue;
      if (plan.data.isActive !== undefined) data.isActive = plan.data.isActive;
      await tx.plan.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(tx, {
        actorId: caller.id,
        action: REGISTRY_AUDIT_ACTIONS.planUpdated,
        entityType: REGISTRY_ENTITY_TYPES.plans,
        entityId: id,
        metadata: { key: row.key, fields: plan.fields },
        ctx,
      });
    });
    return toPlanDto(await db.plan.findUniqueOrThrow({ where: { id }, select: PLAN_SELECT }));
  }
}
