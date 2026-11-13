// MOD-18-T04 — the subscriptions of an academy (API-194/195, D-R101): a plan, a
// status and dates; at most one current (trial | active | past_due)
// subscription per academy (partial unique `uq_subscriptions_academy_current`).
// Every write locks the academy row first (lockAcademy), so the
// one-current check and the archived check run one at a time per academy.
import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../auth/principal.js';
import type { Prisma } from '../../generated/platform/client.js';
import { toInstant } from '../../lessons/lessons.time.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';
import { REGISTRY_AUDIT_ACTIONS, REGISTRY_ENTITY_TYPES, SUBSCRIPTION_SELECT, isUniqueViolation, lockAcademy, toSubscriptionDto } from './academies.read.js';
import { isReadOnly } from './academy-status.js';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_PATCH_FIELDS,
  endsSubscription,
  isEmptyPatch,
  planSubscriptionUpdate,
  subscriptionProblems,
} from './registry.changes.js';
import type { SubscriptionPatch } from './registry.changes.js';
import { registryError } from './registry.errors.js';
import type { CreateSubscriptionDto, SubscriptionDto, UpdateSubscriptionDto } from './subscriptions.dto.js';

const nullableInstant = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : toInstant(value);

/** The academy's current subscription, if any. */
function currentSubscriptionOf(db: PlatformTransaction, academyId: string) {
  return db.subscription.findFirst({
    where: { academyId, status: { in: [...CURRENT_SUBSCRIPTION_STATUSES] } },
    select: { id: true },
  });
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * API-194 — refusals in order: the dates (`400 subscription_invalid`), the
   * academy (`404`, `409 academy_archived`), the plan (`404 plan_not_found`,
   * `422 plan_inactive`), an existing current subscription
   * (`409 subscription_current_exists { subscriptionId }`).
   */
  async create(academyId: string, input: CreateSubscriptionDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<SubscriptionDto> {
    const startsAt = toInstant(input.startsAt);
    const endsAt = nullableInstant(input.endsAt) ?? null;
    const trialEndsAt = nullableInstant(input.trialEndsAt) ?? null;
    const problems = subscriptionProblems({ status: input.status, startsAt, endsAt, trialEndsAt }, true);
    if (problems.length > 0) throw registryError.subscriptionInvalid(problems);

    const db = this.prisma.db;
    let subscriptionId: string;
    try {
      subscriptionId = await db.$transaction(async (tx) => {
        const locked = await lockAcademy(tx, academyId);
        if (!locked) throw registryError.academyNotFound(academyId);
        if (isReadOnly(locked.status)) throw registryError.academyArchived(academyId);
        // FOR SHARE: a concurrent deactivation of the plan (PATCH, FOR NO KEY UPDATE) waits or is waited for.
        const plans = await tx.$queryRaw<{ id: string; key: string; isActive: boolean }[]>`
          SELECT id, key, is_active AS "isActive" FROM plans WHERE id = ${input.planId}::uuid FOR SHARE`;
        const plan = plans[0];
        if (!plan) throw registryError.planNotFound(input.planId);
        if (!plan.isActive) throw registryError.planInactive(plan.id, plan.key);
        const current = await currentSubscriptionOf(tx, academyId);
        if (current) throw registryError.subscriptionCurrentExists(current.id);
        const created = await tx.subscription.create({
          data: { academyId, planId: plan.id, status: input.status, startsAt, endsAt, trialEndsAt, notes: input.notes ?? null },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId: caller.id,
          action: REGISTRY_AUDIT_ACTIONS.subscriptionCreated,
          entityType: REGISTRY_ENTITY_TYPES.subscriptions,
          entityId: created.id,
          metadata: { academyId, planKey: plan.key, status: input.status },
          ctx,
        });
        return created.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const current = await currentSubscriptionOf(db, academyId);
        if (current) throw registryError.subscriptionCurrentExists(current.id);
      }
      throw error;
    }
    return toSubscriptionDto(await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: SUBSCRIPTION_SELECT }));
  }

  /**
   * API-195 — smallest diff; refusals in order: `{}` (`400 nothing_to_update`),
   * the subscription (`404`), an archived academy (`409 academy_archived`,
   * unless the PATCH ends the subscription — `canceled` or `expired`), the
   * status move (`409 invalid_transition`), the merged dates
   * (`400 subscription_invalid`).
   */
  async update(id: string, input: UpdateSubscriptionDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<SubscriptionDto> {
    if (isEmptyPatch(input, SUBSCRIPTION_PATCH_FIELDS)) throw registryError.nothingToUpdate();
    const patch: SubscriptionPatch = {};
    if (input.status !== undefined) patch.status = input.status;
    const endsAt = nullableInstant(input.endsAt);
    if (endsAt !== undefined) patch.endsAt = endsAt;
    const trialEndsAt = nullableInstant(input.trialEndsAt);
    if (trialEndsAt !== undefined) patch.trialEndsAt = trialEndsAt;
    if (input.notes !== undefined) patch.notes = input.notes;

    const db = this.prisma.db;
    const owner = await db.subscription.findUnique({ where: { id }, select: { academyId: true } });
    if (!owner) throw registryError.subscriptionNotFound(id);
    await db.$transaction(async (tx) => {
      const locked = await lockAcademy(tx, owner.academyId);
      const row = await tx.subscription.findUnique({ where: { id }, select: SUBSCRIPTION_SELECT });
      if (!locked || !row) throw registryError.subscriptionNotFound(id);
      if (isReadOnly(locked.status) && !(patch.status !== undefined && endsSubscription(patch.status))) {
        throw registryError.academyArchived(owner.academyId);
      }
      const plan = planSubscriptionUpdate(row, patch);
      if (plan.fields.length === 0) return;
      if (plan.refusedMove) throw registryError.subscriptionTransition(plan.refusedMove.from, plan.refusedMove.to, plan.refusedMove.allowed);
      if (plan.problems.length > 0) throw registryError.subscriptionInvalid(plan.problems);
      const data: Prisma.SubscriptionUpdateInput = {};
      if (plan.data.status !== undefined) data.status = plan.data.status;
      if (plan.data.endsAt !== undefined) data.endsAt = plan.data.endsAt;
      if (plan.data.trialEndsAt !== undefined) data.trialEndsAt = plan.data.trialEndsAt;
      if (plan.data.notes !== undefined) data.notes = plan.data.notes;
      await tx.subscription.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(tx, {
        actorId: caller.id,
        action: REGISTRY_AUDIT_ACTIONS.subscriptionUpdated,
        entityType: REGISTRY_ENTITY_TYPES.subscriptions,
        entityId: id,
        metadata: {
          academyId: row.academyId,
          planKey: row.plan.key,
          status: plan.data.status ?? row.status,
          fields: plan.fields,
          ...(plan.data.status !== undefined ? { from: row.status } : {}),
        },
        ctx,
      });
    });
    return toSubscriptionDto(await db.subscription.findUniqueOrThrow({ where: { id }, select: SUBSCRIPTION_SELECT }));
  }
}
