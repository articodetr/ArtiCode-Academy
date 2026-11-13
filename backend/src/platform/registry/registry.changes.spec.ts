// TEST-209 (unit) — MOD-18-T04 the PATCH planners of the registry and the
// subscription rules: smallest diff in a fixed field order, whole-object
// texts and limits, the status moves and the date problems.
import { describe, expect, it } from 'vitest';
import type { CurrentAcademy, CurrentSubscription } from './registry.changes.js';
import {
  ACADEMY_PATCH_FIELDS,
  allowedSubscriptionMoves,
  canMoveSubscription,
  endsSubscription,
  isCurrentSubscriptionStatus,
  isEmptyPatch,
  planAcademyUpdate,
  planPlanUpdate,
  planSubscriptionUpdate,
  subscriptionProblems,
} from './registry.changes.js';

const T0 = new Date('2026-12-01T00:00:00Z');
const T1 = new Date('2027-01-01T00:00:00Z');
const T_BEFORE = new Date('2026-11-01T00:00:00Z');

function academy(overrides: Partial<CurrentAcademy> = {}): CurrentAcademy {
  return { status: 'provisioning', name: { ar: 'أكاديمية', en: 'Academy' }, origin: null, contactEmail: null, notes: null, ...overrides };
}

function subscription(overrides: Partial<CurrentSubscription> = {}): CurrentSubscription {
  return { status: 'trial', startsAt: T0, endsAt: null, trialEndsAt: null, notes: null, ...overrides };
}

describe('registry update planning (TEST-209)', () => {
  it('detects an empty body', () => {
    expect(isEmptyPatch({}, ACADEMY_PATCH_FIELDS)).toBe(true);
    expect(isEmptyPatch({ notes: undefined }, ACADEMY_PATCH_FIELDS)).toBe(true);
    expect(isEmptyPatch({ notes: null }, ACADEMY_PATCH_FIELDS)).toBe(false);
  });

  it('academy: writes only the changed fields in the fixed order and compares names as wholes', () => {
    const plan = planAcademyUpdate(academy({ origin: 'https://a.example' }), {
      notes: 'n',
      origin: 'https://a.example',
      name: { ar: 'أكاديمية', en: 'Academy' },
      contactEmail: 'x@a.example',
    });
    expect(plan.fields).toEqual(['contactEmail', 'notes']);
    expect(plan.data).toEqual({ contactEmail: 'x@a.example', notes: 'n' });
    expect(planAcademyUpdate(academy(), { name: { ar: 'أكاديمية' } }).fields).toEqual(['name']);
    expect(planAcademyUpdate(academy(), { origin: null, notes: null }).fields).toEqual([]);
  });

  it('academy: clearing the origin of an active academy is flagged (origin_required)', () => {
    expect(planAcademyUpdate(academy({ status: 'active', origin: 'https://a.example' }), { origin: null }).clearsActiveOrigin).toBe(true);
    expect(planAcademyUpdate(academy({ status: 'suspended', origin: 'https://a.example' }), { origin: null }).clearsActiveOrigin).toBe(false);
    expect(planAcademyUpdate(academy({ status: 'active', origin: 'https://a.example' }), { origin: 'https://b.example' }).clearsActiveOrigin).toBe(false);
  });

  it('plan: name, limits (key order ignored) and isActive', () => {
    const current = { name: { ar: 'قياسية' }, limits: { students: 100, storageGb: null }, isActive: true };
    expect(planPlanUpdate(current, { limits: { storageGb: null, students: 100 }, isActive: true, name: { ar: 'قياسية' } }).fields).toEqual([]);
    const plan = planPlanUpdate(current, { isActive: false, limits: { students: 200 }, name: { ar: 'قياسية', en: 'Standard' } });
    expect(plan.fields).toEqual(['name', 'limits', 'isActive']);
    expect(plan.data).toEqual({ name: { ar: 'قياسية', en: 'Standard' }, limits: { students: 200 }, isActive: false });
  });
});

describe('subscription rules (TEST-209)', () => {
  it('moves: trial→active|canceled|expired, active→past_due|…, past_due→active|…; canceled and expired are terminal', () => {
    expect(allowedSubscriptionMoves('trial')).toEqual(['active', 'canceled', 'expired']);
    expect(allowedSubscriptionMoves('active')).toEqual(['past_due', 'canceled', 'expired']);
    expect(allowedSubscriptionMoves('past_due')).toEqual(['active', 'canceled', 'expired']);
    expect(allowedSubscriptionMoves('canceled')).toEqual([]);
    expect(allowedSubscriptionMoves('expired')).toEqual([]);
    expect(canMoveSubscription('active', 'trial')).toBe(false);
    expect(canMoveSubscription('past_due', 'active')).toBe(true);
    expect(['trial', 'active', 'past_due', 'canceled', 'expired'].filter((s) => isCurrentSubscriptionStatus(s as never))).toEqual(['trial', 'active', 'past_due']);
    expect(endsSubscription('canceled') && endsSubscription('expired') && !endsSubscription('past_due')).toBe(true);
  });

  it('date problems in a fixed order', () => {
    expect(subscriptionProblems({ status: 'trial', startsAt: T0, endsAt: T1, trialEndsAt: T1 }, true)).toEqual([]);
    expect(subscriptionProblems({ status: 'active', startsAt: T0, endsAt: T0, trialEndsAt: T_BEFORE }, true)).toEqual([
      'ends_before_start',
      'trial_ends_before_start',
      'trial_end_without_trial',
    ]);
    expect(subscriptionProblems({ status: 'active', startsAt: T0, endsAt: null, trialEndsAt: T1 }, false)).toEqual([]);
  });

  it('PATCH: smallest diff, instants compared by value, null clears', () => {
    const current = subscription({ endsAt: T1, notes: 'x' });
    expect(planSubscriptionUpdate(current, { status: 'trial', endsAt: new Date(T1.getTime()), notes: 'x' }).fields).toEqual([]);
    const plan = planSubscriptionUpdate(current, { notes: null, endsAt: null, status: 'active' });
    expect(plan.fields).toEqual(['status', 'endsAt', 'notes']);
    expect(plan).toMatchObject({ data: { status: 'active', endsAt: null, notes: null }, refusedMove: null, problems: [] });
  });

  it('PATCH: a refused move and the merged date problems', () => {
    expect(planSubscriptionUpdate(subscription({ status: 'canceled' }), { status: 'active' }).refusedMove).toEqual({
      from: 'canceled',
      to: 'active',
      allowed: [],
    });
    expect(planSubscriptionUpdate(subscription({ status: 'active' }), { status: 'trial' }).refusedMove).toEqual({
      from: 'active',
      to: 'trial',
      allowed: ['past_due', 'canceled', 'expired'],
    });
    expect(planSubscriptionUpdate(subscription(), { endsAt: T_BEFORE }).problems).toEqual(['ends_before_start']);
    // A trial's end date survives its activation; a NEW trial end on a non-trial is refused.
    const trial = subscription({ trialEndsAt: T1 });
    expect(planSubscriptionUpdate(trial, { status: 'active' }).problems).toEqual([]);
    expect(planSubscriptionUpdate(subscription({ status: 'active' }), { trialEndsAt: T1 }).problems).toEqual(['trial_end_without_trial']);
    expect(planSubscriptionUpdate(trial, { status: 'active', trialEndsAt: null }).problems).toEqual([]);
  });
});
