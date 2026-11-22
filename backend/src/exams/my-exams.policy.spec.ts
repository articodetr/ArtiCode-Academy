// TEST-283 (unit part) — when a learner sees their own result in «my exams» (D-R47, D-R156).
import { describe, expect, it } from 'vitest';
import { visibleResult } from './my-exams.policy.js';
import type { MyExamResultView } from './my-exams.policy.js';

describe('visibleResult()', () => {
  const scored: MyExamResultView = { status: 'scored', score: 8, feedback: null };
  const absent: MyExamResultView = { status: 'absent', score: null, feedback: 'لم يحضر' };
  const onSubmit = { delivery: 'online', resultsRelease: 'on_submit' } as const;
  const onPublish = { delivery: 'online', resultsRelease: 'on_publish' } as const;

  it('keeps the first phase’s rule for a manual exam: the publication alone', () => {
    expect(visibleResult('scheduled', scored)).toBeNull();
    expect(visibleResult('published', scored)).toEqual(scored);
    expect(visibleResult('published', null)).toBeNull();
    // Whatever the columns say, a manual exam never releases on submit.
    expect(visibleResult('scheduled', scored, { delivery: 'manual', resultsRelease: 'on_submit' }, 'online')).toBeNull();
  });

  it('shows an attempt’s result at once when the online exam releases on submit', () => {
    expect(visibleResult('scheduled', scored, onSubmit, 'online')).toEqual(scored);
    expect(visibleResult('scheduled', scored, onPublish, 'online')).toBeNull();
    expect(visibleResult('published', scored, onPublish, 'online')).toEqual(scored);
  });

  it('holds a result the teacher typed until the publication, even for an exam that releases on submit', () => {
    expect(visibleResult('scheduled', absent, onSubmit, 'manual')).toBeNull();
    // The source defaults to manual: a caller that does not know it never releases early.
    expect(visibleResult('scheduled', absent, onSubmit)).toBeNull();
    expect(visibleResult('published', absent, onSubmit, 'manual')).toEqual(absent);
  });
});
