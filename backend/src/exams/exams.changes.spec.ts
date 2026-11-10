// TEST-129 (unit) — the smallest exam PATCH, the pass-score rule and the exam-date keyset (MOD-09-T03).
import { describe, expect, it } from 'vitest';
import { isEmptyExamPatch, passScoreProblem, planExamUpdate } from './exams.changes.js';
import type { ExamValues } from './exams.changes.js';
import { NO_EXAM_DATE_KEY, afterExamCursor, examCursorKey, examOrderBy } from './exams.keyset.js';

const ID = '01a1c029-93e8-7402-a176-8fa8224c0217';
const current: ExamValues = {
  title: { ar: 'اختبار' },
  description: null,
  type: 'quiz',
  lessonId: null,
  scheduledAt: '2026-11-20T07:00:00.000Z',
  durationMinutes: 45,
  maxScore: '20.00',
  passScore: '10.00',
  weight: null,
};

describe('planExamUpdate', () => {
  it('writes only the changed fields, in a stable order; the same values write nothing', () => {
    expect(planExamUpdate(current, { title: { ar: 'اختبار' }, maxScore: '20.00', scheduledAt: '2026-11-20T07:00:00.000Z', description: null })).toEqual({ data: {}, fields: [] });
    const plan = planExamUpdate(current, { weight: '30.00', type: 'final', description: { ar: 'الوصف' }, durationMinutes: null });
    expect(plan.fields).toEqual(['description', 'type', 'durationMinutes', 'weight']);
    expect(plan.data).toEqual({ description: { ar: 'الوصف' }, type: 'final', durationMinutes: null, weight: '30.00' });
    expect(isEmptyExamPatch({})).toBe(true);
    expect(isEmptyExamPatch({ weight: null })).toBe(false);
  });

  it('keeps the pass score within the maximum after the merge', () => {
    expect(passScoreProblem(current, { maxScore: '8.00' })).toEqual({ passScore: 10, maxScore: 8 });
    expect(passScoreProblem(current, { passScore: '20.50' })).toEqual({ passScore: 20.5, maxScore: 20 });
    expect(passScoreProblem(current, { maxScore: '8.00', passScore: null })).toBeNull();
    expect(passScoreProblem(current, { passScore: '20.00' })).toBeNull();
  });
});

describe('exam-date keyset', () => {
  it('keys a dated row by its instant and an undated one by the empty marker, ordered NULLS LAST', () => {
    expect(examCursorKey(new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01T10:00:00.000Z');
    expect(examCursorKey(null)).toBe(NO_EXAM_DATE_KEY);
    expect(examOrderBy('desc')).toEqual([{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]);
  });

  it('continues after a dated cursor with later dates, the same date and a later id, then the undated rows', () => {
    const at = new Date('2026-12-01T10:00:00.000Z');
    expect(afterExamCursor('2026-12-01T10:00:00.000Z', ID, 'asc')).toEqual({ OR: [{ scheduledAt: { gt: at } }, { scheduledAt: at, id: { gt: ID } }, { scheduledAt: null }] });
    expect(afterExamCursor(NO_EXAM_DATE_KEY, ID, 'desc')).toEqual({ scheduledAt: null, id: { lt: ID } });
    expect(afterExamCursor('not-a-date', ID, 'asc')).toBeNull();
  });
});
