// TEST-051 (unit) — the "my classes" rules of MOD-05-T05.
import { describe, expect, it } from 'vitest';
import { MY_CLASSES_DEFAULT_STATUSES, myClassStatuses, relationOf, seesChildren } from './my-classes.policy.js';

describe('my classes', () => {
  it('reads active and completed enrollments by default, or exactly the status asked for', () => {
    expect(myClassStatuses(undefined)).toEqual(['active', 'completed']);
    expect(myClassStatuses('withdrawn')).toEqual(['withdrawn']);
    // The defaults are a fresh array every time (never the shared constant).
    const statuses = myClassStatuses(undefined);
    statuses.push('cancelled');
    expect(MY_CLASSES_DEFAULT_STATUSES).toEqual(['active', 'completed']);
  });

  it('names the caller’s own enrollment self and a linked student’s child', () => {
    expect(relationOf('u-1', 'u-1')).toBe('self');
    expect(relationOf('u-2', 'u-1')).toBe('child');
  });

  it('shows the children’s classes only while the caller holds the guardian role (owner decision, #19)', () => {
    expect(seesChildren(['guardian'])).toBe(true);
    expect(seesChildren(['student', 'guardian'])).toBe(true);
    expect(seesChildren(['student'])).toBe(false);
    expect(seesChildren([])).toBe(false);
  });
});
