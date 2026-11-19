// TEST-050 (unit) — the enrollment rules of MOD-05-T04; TEST-242 (unit) — the
// approve / reject actions of a request (MOD-19, D-R125/D-R126).
import { describe, expect, it } from 'vitest';
import type { EnrollmentStatus } from '../generated/prisma/client.js';
import {
  ENROLLMENT_STATUS_ACTIONS,
  allowedEnrollmentActions,
  canReadRoster,
  enrollmentWrite,
  hasFreeSeat,
  isEnrollableClass,
  nextEnrollmentStatus,
  takesSeat,
} from './enrollments.status.js';

const STATUSES: EnrollmentStatus[] = ['pending', 'active', 'completed', 'withdrawn', 'cancelled'];

describe('enrollment state machine', () => {
  it('allows exactly the planned transitions (AC5)', () => {
    const allowed: string[] = [];
    for (const action of ENROLLMENT_STATUS_ACTIONS) {
      for (const from of STATUSES) {
        const to = nextEnrollmentStatus(action, from);
        if (to !== null) allowed.push(`${action}:${from}->${to}`);
      }
    }
    expect(allowed.sort()).toEqual(
      [
        'withdraw:active->withdrawn',
        'complete:active->completed',
        'cancel:active->cancelled',
        'reactivate:withdrawn->active',
        'reactivate:cancelled->active',
        // MOD-19: a pending enrollment is a request.
        'approve:pending->active',
        'reject:pending->cancelled',
      ].sort(),
    );
  });

  it('lists the allowed actions per status in catalogue order; completed allows nothing, pending approve and reject only', () => {
    expect(allowedEnrollmentActions('active')).toEqual(['withdraw', 'complete', 'cancel']);
    expect(allowedEnrollmentActions('withdrawn')).toEqual(['reactivate']);
    expect(allowedEnrollmentActions('cancelled')).toEqual(['reactivate']);
    expect(allowedEnrollmentActions('completed')).toEqual([]);
    expect(allowedEnrollmentActions('pending')).toEqual(['approve', 'reject']);
  });

  it('reactivate and approve take a seat (again)', () => {
    expect(ENROLLMENT_STATUS_ACTIONS.filter(takesSeat)).toEqual(['reactivate', 'approve']);
  });
});

describe('class and capacity rules', () => {
  it('enrolls into open and running classes only (AC2)', () => {
    expect(isEnrollableClass('open')).toBe(true);
    expect(isEnrollableClass('running')).toBe(true);
    for (const status of ['planned', 'completed', 'cancelled'] as const) expect(isEnrollableClass(status)).toBe(false);
  });

  it('keeps the capacity hard (AC3)', () => {
    expect(hasFreeSeat(2, 1)).toBe(true);
    expect(hasFreeSeat(2, 2)).toBe(false);
    // A capacity lowered below the active count by an old row still has no seat.
    expect(hasFreeSeat(2, 3)).toBe(false);
  });

  it('lets enrollment managers and assigned teachers read the roster, nobody else (AC1)', () => {
    expect(canReadRoster(true, false)).toBe(true);
    expect(canReadRoster(false, true)).toBe(true);
    expect(canReadRoster(false, false)).toBe(false);
  });
});

describe('enrollmentWrite', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');

  it('stamps the withdrawal with its reason, the completion, and nothing extra for cancel', () => {
    expect(enrollmentWrite('withdraw', 'withdrawn', now, 'moved away')).toEqual({ status: 'withdrawn', withdrawnAt: now, withdrawalReason: 'moved away' });
    expect(enrollmentWrite('withdraw', 'withdrawn', now, null)).toEqual({ status: 'withdrawn', withdrawnAt: now, withdrawalReason: null });
    expect(enrollmentWrite('complete', 'completed', now, 'done')).toEqual({ status: 'completed', completedAt: now });
    expect(enrollmentWrite('cancel', 'cancelled', now, 'error')).toEqual({ status: 'cancelled' });
  });

  it('reactivation and approval stamp activated_at and clear the withdrawal, completion and rejection columns', () => {
    const active = {
      status: 'active',
      activatedAt: now,
      withdrawnAt: null,
      withdrawalReason: null,
      completedAt: null,
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
    };
    expect(enrollmentWrite('reactivate', 'active', now, 'back')).toEqual(active);
    expect(enrollmentWrite('approve', 'active', now, null, 'admin-1')).toEqual(active);
  });

  it('a rejection keeps who rejected it and the required reason (D-R126)', () => {
    expect(enrollmentWrite('reject', 'cancelled', now, 'no seat for this level', 'admin-1')).toEqual({
      status: 'cancelled',
      rejectedAt: now,
      rejectedById: 'admin-1',
      rejectionReason: 'no seat for this level',
    });
  });
});
