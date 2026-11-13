// Planning of the registry's PATCH requests (MOD-18-T04: API-186 academies,
// API-193 plans, API-195 subscriptions) and the subscription rules (API-194/195)
// as pure functions, unit-tested in registry.changes.spec.ts: only fields whose
// value changes are written, an idempotent PATCH writes nothing and records
// nothing, and the audit metadata carries the names of the changed fields —
// never their values.
import { sameLocalizedText } from '../../authorization/localized-text.js';
import type { LocalizedText } from '../../authorization/localized-text.js';
import type { AcademyStatus, SubscriptionStatus } from '../../generated/platform/client.js';
import type { SubscriptionProblem } from './registry.errors.js';
import { SUBSCRIPTION_PROBLEMS } from './registry.errors.js';
import { sameLimits } from './registry.validation.js';
import type { PlanLimits } from './registry.validation.js';

/** True when the body carries none of `fields` (`{}`). */
export function isEmptyPatch<F extends string>(patch: Partial<Record<F, unknown>>, fields: readonly F[]): boolean {
  return fields.every((field) => patch[field] === undefined);
}

// ---------------------------------------------------------------------------
// Academies (API-186)
// ---------------------------------------------------------------------------

/** Fields a PATCH may set, in the fixed order of the audit `fields`. The slug is immutable (400 by the whitelist). */
export const ACADEMY_PATCH_FIELDS = ['name', 'origin', 'contactEmail', 'notes'] as const;
export type AcademyPatchField = (typeof ACADEMY_PATCH_FIELDS)[number];

export interface AcademyPatch {
  name?: LocalizedText;
  origin?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}

export interface CurrentAcademy {
  status: AcademyStatus;
  name: LocalizedText;
  origin: string | null;
  contactEmail: string | null;
  notes: string | null;
}

export interface AcademyUpdatePlan {
  data: AcademyPatch;
  /** Changed fields in ACADEMY_PATCH_FIELDS order; empty = nothing to write. */
  fields: AcademyPatchField[];
  /** The PATCH clears the origin of an active academy — refused with `422 origin_required` (active ⇒ origin). */
  clearsActiveOrigin: boolean;
}

export function planAcademyUpdate(current: CurrentAcademy, patch: AcademyPatch): AcademyUpdatePlan {
  const data: AcademyPatch = {};
  const fields: AcademyPatchField[] = [];
  for (const field of ACADEMY_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const unchanged =
      field === 'name' ? sameLocalizedText(current.name, requested as LocalizedText) : current[field] === requested;
    if (unchanged) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  return { data, fields, clearsActiveOrigin: current.status === 'active' && data.origin === null };
}

// ---------------------------------------------------------------------------
// Plans (API-193)
// ---------------------------------------------------------------------------

/** The key is immutable (400 by the whitelist); `limits` is replaced as a whole. */
export const PLAN_PATCH_FIELDS = ['name', 'limits', 'isActive'] as const;
export type PlanPatchField = (typeof PLAN_PATCH_FIELDS)[number];

export interface PlanPatch {
  name?: LocalizedText;
  limits?: PlanLimits;
  isActive?: boolean;
}

export interface CurrentPlan {
  name: LocalizedText;
  limits: PlanLimits;
  isActive: boolean;
}

export interface PlanUpdatePlan {
  data: PlanPatch;
  fields: PlanPatchField[];
}

export function planPlanUpdate(current: CurrentPlan, patch: PlanPatch): PlanUpdatePlan {
  const data: PlanPatch = {};
  const fields: PlanPatchField[] = [];
  if (patch.name !== undefined && !sameLocalizedText(current.name, patch.name)) {
    data.name = patch.name;
    fields.push('name');
  }
  if (patch.limits !== undefined && !sameLimits(current.limits, patch.limits)) {
    data.limits = patch.limits;
    fields.push('limits');
  }
  if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
    data.isActive = patch.isActive;
    fields.push('isActive');
  }
  return { data, fields };
}

// ---------------------------------------------------------------------------
// Subscriptions (API-194/195)
// ---------------------------------------------------------------------------

/** A current subscription; at most one per academy (partial unique `uq_subscriptions_academy_current`). */
export const CURRENT_SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due'] as const satisfies readonly SubscriptionStatus[];
export type CurrentSubscriptionStatus = (typeof CURRENT_SUBSCRIPTION_STATUSES)[number];

const SUBSCRIPTION_STATUS_ORDER: readonly SubscriptionStatus[] = ['trial', 'active', 'past_due', 'canceled', 'expired'];

/** Status moves of a subscription; `canceled` and `expired` are terminal. */
const SUBSCRIPTION_MOVES: Readonly<Record<SubscriptionStatus, readonly SubscriptionStatus[]>> = {
  trial: ['active', 'canceled', 'expired'],
  active: ['past_due', 'canceled', 'expired'],
  past_due: ['active', 'canceled', 'expired'],
  canceled: [],
  expired: [],
};

export function isCurrentSubscriptionStatus(status: SubscriptionStatus): status is CurrentSubscriptionStatus {
  return (CURRENT_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

/** Statuses reachable from `from` in one move (the `allowed` detail of `invalid_transition`). */
export function allowedSubscriptionMoves(from: SubscriptionStatus): SubscriptionStatus[] {
  return SUBSCRIPTION_STATUS_ORDER.filter((status) => SUBSCRIPTION_MOVES[from].includes(status));
}

export function canMoveSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_MOVES[from].includes(to);
}

/** A status that ends a subscription (accepted even on an archived academy). */
export function endsSubscription(status: SubscriptionStatus): boolean {
  return status === 'canceled' || status === 'expired';
}

export interface SubscriptionDates {
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
  trialEndsAt: Date | null;
}

/**
 * Problems of `subscription_invalid`, in SUBSCRIPTION_PROBLEMS order:
 * `ends_before_start` (endsAt not after startsAt — CHECK
 * `ck_subscriptions_ends_after_start`), `trial_ends_before_start` (likewise
 * for trialEndsAt), `trial_end_without_trial` (a trial end on a subscription
 * that is not a trial — checked when `trialEndSet`, i.e. on creation and when
 * a PATCH writes a new non-null trialEndsAt: a trial's end date survives its
 * move to `active` as history).
 */
export function subscriptionProblems(dates: SubscriptionDates, trialEndSet: boolean): SubscriptionProblem[] {
  const found = new Set<SubscriptionProblem>();
  const start = dates.startsAt.getTime();
  if (dates.endsAt !== null && dates.endsAt.getTime() <= start) found.add('ends_before_start');
  if (dates.trialEndsAt !== null && dates.trialEndsAt.getTime() <= start) found.add('trial_ends_before_start');
  if (trialEndSet && dates.trialEndsAt !== null && dates.status !== 'trial') found.add('trial_end_without_trial');
  return SUBSCRIPTION_PROBLEMS.filter((problem) => found.has(problem));
}

export const SUBSCRIPTION_PATCH_FIELDS = ['status', 'endsAt', 'trialEndsAt', 'notes'] as const;
export type SubscriptionPatchField = (typeof SUBSCRIPTION_PATCH_FIELDS)[number];

export interface SubscriptionPatch {
  status?: SubscriptionStatus;
  endsAt?: Date | null;
  trialEndsAt?: Date | null;
  notes?: string | null;
}

export interface CurrentSubscription extends SubscriptionDates {
  notes: string | null;
}

export interface SubscriptionUpdatePlan {
  data: SubscriptionPatch;
  fields: SubscriptionPatchField[];
  /** The status move is not allowed (`409 invalid_transition`); null = allowed or no move. */
  refusedMove: { from: SubscriptionStatus; to: SubscriptionStatus; allowed: SubscriptionStatus[] } | null;
  /** Date problems of the merged subscription (`400 subscription_invalid`); empty = fine. */
  problems: SubscriptionProblem[];
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

export function planSubscriptionUpdate(current: CurrentSubscription, patch: SubscriptionPatch): SubscriptionUpdatePlan {
  const data: SubscriptionPatch = {};
  const fields: SubscriptionPatchField[] = [];
  if (patch.status !== undefined && patch.status !== current.status) {
    data.status = patch.status;
    fields.push('status');
  }
  if (patch.endsAt !== undefined && !sameInstant(current.endsAt, patch.endsAt)) {
    data.endsAt = patch.endsAt;
    fields.push('endsAt');
  }
  if (patch.trialEndsAt !== undefined && !sameInstant(current.trialEndsAt, patch.trialEndsAt)) {
    data.trialEndsAt = patch.trialEndsAt;
    fields.push('trialEndsAt');
  }
  if (patch.notes !== undefined && patch.notes !== current.notes) {
    data.notes = patch.notes;
    fields.push('notes');
  }

  const refusedMove =
    data.status !== undefined && !canMoveSubscription(current.status, data.status)
      ? { from: current.status, to: data.status, allowed: allowedSubscriptionMoves(current.status) }
      : null;
  const merged: SubscriptionDates = {
    status: data.status ?? current.status,
    startsAt: current.startsAt,
    endsAt: data.endsAt !== undefined ? data.endsAt : current.endsAt,
    trialEndsAt: data.trialEndsAt !== undefined ? data.trialEndsAt : current.trialEndsAt,
  };
  const problems = fields.length === 0 ? [] : subscriptionProblems(merged, fields.includes('trialEndsAt'));
  return { data, fields, refusedMove, problems };
}
