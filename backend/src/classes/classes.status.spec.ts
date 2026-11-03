// TEST-048 (unit) — the class state machine of MOD-05-T02 (D-R17).
import { describe, expect, it } from 'vitest';
import type { ClassStatus } from '../generated/prisma/client.js';
import { allowedClassActions, CLASS_STATUS_ACTIONS, enrollmentStatusAfter, isClassDeletable, nextClassStatus } from './classes.status.js';

const STATUSES: ClassStatus[] = ['planned', 'open', 'running', 'completed', 'cancelled'];

describe('class state machine', () => {
  it('allows exactly the five documented transitions', () => {
    const allowed: string[] = [];
    for (const action of CLASS_STATUS_ACTIONS) {
      for (const from of STATUSES) {
        const to = nextClassStatus(action, from);
        if (to !== null) allowed.push(`${action}:${from}->${to}`);
      }
    }
    expect(allowed).toEqual([
      'open:planned->open',
      'start:open->running',
      'complete:running->completed',
      'cancel:planned->cancelled',
      'cancel:open->cancelled',
      'cancel:running->cancelled',
      'restore:cancelled->planned',
    ]);
  });

  it('lists the allowed actions per status in catalogue order; completed is terminal', () => {
    expect(allowedClassActions('planned')).toEqual(['open', 'cancel']);
    expect(allowedClassActions('open')).toEqual(['start', 'cancel']);
    expect(allowedClassActions('running')).toEqual(['complete', 'cancel']);
    expect(allowedClassActions('completed')).toEqual([]);
    expect(allowedClassActions('cancelled')).toEqual(['restore']);
  });

  it('complete and cancel move the active enrollments; the other actions leave them alone (restore does not reactivate)', () => {
    expect(enrollmentStatusAfter('complete')).toBe('completed');
    expect(enrollmentStatusAfter('cancel')).toBe('cancelled');
    for (const action of ['open', 'start', 'restore'] as const) expect(enrollmentStatusAfter(action)).toBeNull();
  });

  it('deletes only a planned class without any enrollment', () => {
    expect(isClassDeletable('planned', 0)).toBe(true);
    expect(isClassDeletable('planned', 1)).toBe(false);
    for (const status of ['open', 'running', 'completed', 'cancelled'] as const) expect(isClassDeletable(status, 0)).toBe(false);
  });
});
