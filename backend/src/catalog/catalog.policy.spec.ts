// TEST-241 (unit) — what the catalog tells a reader about a class (MOD-19,
// D-R122..D-R124): who may enroll themself, the blocker order (the refusal
// order of API-221) and the pricing rules of a course plan.
import { describe, expect, it } from 'vitest';
import type { ClassBlockerInput } from './catalog.policy.js';
import { classBlocker, isSelfServiceOpen, nextStartsOn, seatsLeft, selfServiceReason } from './catalog.policy.js';
import { coursePlanFits, coursePlanTotal, coursePlanUsable } from './course-pricing.js';

const open: ClassBlockerInput = {
  selfService: true,
  mine: null,
  selfEnrollment: true,
  status: 'open',
  capacity: 2,
  enrolledCount: 1,
  coursePaid: false,
  priceUsable: false,
};
const at = new Date('2026-11-19T09:00:00.000Z');

describe('self-service (D-R124)', () => {
  it('needs enrollments.self_enroll first, then the student role', () => {
    expect(selfServiceReason({ permissions: ['courses.read'], roles: ['student'] })).toBe('no_permission');
    expect(selfServiceReason({ permissions: ['enrollments.self_enroll'], roles: ['guardian'] })).toBe('not_a_student');
    expect(selfServiceReason({ permissions: ['enrollments.self_enroll'], roles: ['student'] })).toBeNull();
  });

  it('opens a class only when the office opened it and it takes students (D-R123)', () => {
    expect(isSelfServiceOpen({ selfEnrollment: true, status: 'open' })).toBe(true);
    expect(isSelfServiceOpen({ selfEnrollment: true, status: 'running' })).toBe(true);
    expect(isSelfServiceOpen({ selfEnrollment: false, status: 'open' })).toBe(false);
    for (const status of ['planned', 'completed', 'cancelled'] as const) expect(isSelfServiceOpen({ selfEnrollment: true, status })).toBe(false);
  });
});

describe('class blocker — the refusal order of API-221', () => {
  it('lets a reader in when nothing blocks', () => {
    expect(classBlocker(open)).toBeNull();
    expect(classBlocker({ ...open, coursePaid: true, priceUsable: true })).toBeNull();
  });

  it('refuses in order: not allowed, own row, not open, full, price', () => {
    expect(classBlocker({ ...open, selfService: false, mine: { status: 'pending', activatedAt: null } })).toBe('not_allowed');
    expect(classBlocker({ ...open, mine: { status: 'pending', activatedAt: null }, enrolledCount: 2 })).toBe('request_pending');
    expect(classBlocker({ ...open, mine: { status: 'active', activatedAt: at }, selfEnrollment: false })).toBe('already_enrolled');
    expect(classBlocker({ ...open, selfEnrollment: false, enrolledCount: 2 })).toBe('not_open');
    expect(classBlocker({ ...open, enrolledCount: 2, coursePaid: true })).toBe('class_full');
    expect(classBlocker({ ...open, coursePaid: true, priceUsable: false })).toBe('price_unavailable');
  });

  it('treats a closed request as no row: it can be asked again', () => {
    expect(classBlocker({ ...open, mine: { status: 'cancelled', activatedAt: null } })).toBeNull();
  });

  it('never shows negative seats', () => {
    expect(seatsLeft(5, 3)).toBe(2);
    expect(seatsLeft(2, 3)).toBe(0);
  });
});

describe('course pricing (D-R122)', () => {
  const course = '019a0000-0000-7000-8000-0000000000c1';
  it('takes a general plan or a plan of this course, never a class plan or another course’s', () => {
    expect(coursePlanFits({ courseId: null, classId: null }, null)).toBe(true);
    expect(coursePlanFits({ courseId: course, classId: null }, course)).toBe(true);
    expect(coursePlanFits({ courseId: course, classId: null }, null)).toBe(false);
    expect(coursePlanFits({ courseId: 'other', classId: null }, course)).toBe(false);
    expect(coursePlanFits({ courseId: null, classId: 'a-class' }, course)).toBe(false);
  });

  it('prices a request only with an active plan that still fits', () => {
    expect(coursePlanUsable({ courseId: null, classId: null, isActive: true }, course)).toBe(true);
    expect(coursePlanUsable({ courseId: null, classId: null, isActive: false }, course)).toBe(false);
    expect(coursePlanUsable({ courseId: null, classId: 'a-class', isActive: true }, course)).toBe(false);
  });

  it('totals the plan lines with two decimals', () => {
    expect(coursePlanTotal({ lines: [{ description: { ar: 'رسوم' }, amount: 1000 }, { description: { ar: 'كتب' }, amount: 199.5 }] })).toBe('1199.50');
    expect(coursePlanTotal({ lines: [] })).toBe('0.00');
  });

  it('nextStartsOn — the earliest start day today or later, ignoring classes without one or already started (PORTAL-01)', () => {
    const today = '2026-11-22';
    expect(nextStartsOn(['2026-12-10', '2026-12-01', null, '2027-01-05'], today)).toBe('2026-12-01');
    expect(nextStartsOn(['2026-11-22', '2026-12-01'], today)).toBe('2026-11-22');
    expect(nextStartsOn(['2026-11-01', '2026-11-21'], today)).toBeNull();
    expect(nextStartsOn([null, null], today)).toBeNull();
    expect(nextStartsOn([], today)).toBeNull();
  });
});
