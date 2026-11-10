// TEST-129 (unit) — the exam state machine of MOD-09-T03 (D-R47).
import { describe, expect, it } from 'vitest';
import { actionNeedsLiveClass, allowedExamActions, isExamDeletable, lockedExamFields, nextExamStatus } from './exams.status.js';

describe('exam state machine', () => {
  it('moves draft → scheduled → published and back, one step at a time', () => {
    expect(nextExamStatus('schedule', 'draft')).toBe('scheduled');
    expect(nextExamStatus('unschedule', 'scheduled')).toBe('draft');
    expect(nextExamStatus('publish', 'scheduled')).toBe('published');
    expect(nextExamStatus('unpublish', 'published')).toBe('scheduled');
    expect(nextExamStatus('publish', 'draft')).toBeNull();
    expect(nextExamStatus('schedule', 'published')).toBeNull();
    expect(nextExamStatus('unschedule', 'published')).toBeNull();
    expect(allowedExamActions('draft')).toEqual(['schedule']);
    expect(allowedExamActions('scheduled')).toEqual(['unschedule', 'publish']);
    expect(allowedExamActions('published')).toEqual(['unpublish']);
  });

  it('refuses forward moves for a cancelled class only, deletes drafts and scheduled exams without results, locks maxScore once a result exists', () => {
    expect([actionNeedsLiveClass('schedule'), actionNeedsLiveClass('publish'), actionNeedsLiveClass('unschedule'), actionNeedsLiveClass('unpublish')]).toEqual([true, true, false, false]);
    expect(isExamDeletable('draft', 0)).toBe(true);
    expect(isExamDeletable('scheduled', 0)).toBe(true);
    expect(isExamDeletable('scheduled', 1)).toBe(false);
    expect(isExamDeletable('published', 0)).toBe(false);
    expect(lockedExamFields(0, ['maxScore', 'title'])).toEqual([]);
    expect(lockedExamFields(3, ['maxScore', 'title', 'weight'])).toEqual(['maxScore']);
  });
});
