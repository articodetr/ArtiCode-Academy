import { describe, expect, it } from 'vitest';
import { absenceRate, attendanceRate, capRows, percentOf } from './reports.calc.js';
import { ReportsHttpException } from './reports.errors.js';
import { periodWindow, resolvePeriod } from './reports.period.js';

describe('resolvePeriod (D-R69, TEST-167)', () => {
  it('defaults to the 30 days ending today, or ending at `to`', () => {
    expect(resolvePeriod({}, '2026-11-11')).toEqual({ from: '2026-10-13', to: '2026-11-11' });
    expect(resolvePeriod({ to: '2026-03-01' }, '2026-11-11')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    expect(resolvePeriod({ from: '2026-11-01' }, '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-11' });
    expect(resolvePeriod({ from: '2026-11-11', to: '2026-11-11' }, '2026-11-11')).toEqual({ from: '2026-11-11', to: '2026-11-11' });
  });

  it('accepts 366 inclusive days and refuses 367 or a start after the end with report_range_invalid', () => {
    expect(resolvePeriod({ from: '2024-03-01', to: '2025-03-01' }, '2026-11-11')).toEqual({ from: '2024-03-01', to: '2025-03-01' });
    for (const query of [{ from: '2024-02-29', to: '2025-03-01' }, { from: '2026-11-12', to: '2026-11-11' }, { from: '2026-12-01' }]) {
      try {
        resolvePeriod(query, '2026-11-11');
        expect.unreachable(JSON.stringify(query));
      } catch (error) {
        expect(error).toBeInstanceOf(ReportsHttpException);
        expect((error as ReportsHttpException).getResponse()).toMatchObject({ code: 'report_range_invalid', maxDays: 366 });
      }
    }
  });
});

describe('periodWindow', () => {
  it('spans whole local days, also across a daylight-saving change', () => {
    expect(periodWindow({ from: '2026-11-01', to: '2026-11-30' }, 'UTC')).toMatchObject({
      start: new Date('2026-11-01T00:00:00.000Z'),
      end: new Date('2026-12-01T00:00:00.000Z'),
    });
    // Riyadh is UTC+3 all year.
    expect(periodWindow({ from: '2026-11-11', to: '2026-11-11' }, 'Asia/Riyadh')).toMatchObject({
      start: new Date('2026-11-10T21:00:00.000Z'),
      end: new Date('2026-11-11T21:00:00.000Z'),
    });
    // Berlin springs forward on 2026-03-29: that day has 23 hours.
    const spring = periodWindow({ from: '2026-03-29', to: '2026-03-29' }, 'Europe/Berlin');
    expect(spring.start).toEqual(new Date('2026-03-28T23:00:00.000Z'));
    expect(spring.end).toEqual(new Date('2026-03-29T22:00:00.000Z'));
  });
});

describe('percentages and the row cap (D-R70/D-R72)', () => {
  it('rounds half-up to two places and answers null over nothing', () => {
    expect(percentOf(2, 3)).toBe(66.67);
    expect(percentOf(1, 8)).toBe(12.5);
    expect(percentOf(1, 200)).toBe(0.5);
    expect(percentOf(0, 4)).toBe(0);
    expect(percentOf(3, 0)).toBeNull();
  });

  it('leaves excused out of both rates', () => {
    const counts = { present: 2, late: 1, absent: 1, excused: 5 };
    expect(attendanceRate(counts)).toBe(75);
    expect(absenceRate(counts)).toBe(25);
    expect(attendanceRate({ present: 0, late: 0, absent: 0, excused: 3 })).toBeNull();
  });

  it('cuts a read of cap + 1 rows and says so', () => {
    expect(capRows([1, 2, 3], 3)).toEqual({ rows: [1, 2, 3], truncated: false });
    expect(capRows([1, 2, 3, 4], 3)).toEqual({ rows: [1, 2, 3], truncated: true });
  });
});
