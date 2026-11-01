// TEST-041 (unit part) — MOD-04-T03 pure rules: the course status machine,
// PATCH planning, the age-range merge, decimal hours and the shared keyset
// cursor — no database.
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { CourseValues } from './courses.changes.js';
import { hoursToDecimalString, invalidAgeRange, isEmptyCoursePatch, planCourseUpdate } from './courses.changes.js';
import { allowedCourseActions, isDeletable, nextCourseStatus } from './courses.status.js';

const course = (overrides: Partial<CourseValues> = {}): CourseValues => ({
  code: 'PY-101',
  name: { ar: 'بايثون', en: 'Python' },
  summary: null,
  description: null,
  levelId: null,
  durationHours: '24.0',
  sessionsCount: 12,
  minAge: 10,
  maxAge: 14,
  ...overrides,
});

describe('course status machine', () => {
  it('follows draft → published → archived → draft', () => {
    expect(nextCourseStatus('publish', 'draft')).toBe('published');
    expect(nextCourseStatus('unpublish', 'published')).toBe('draft');
    expect(nextCourseStatus('archive', 'draft')).toBe('archived');
    expect(nextCourseStatus('archive', 'published')).toBe('archived');
    expect(nextCourseStatus('restore', 'archived')).toBe('draft');
  });

  it('refuses everything else and lists the allowed actions', () => {
    expect(nextCourseStatus('publish', 'published')).toBeNull();
    expect(nextCourseStatus('publish', 'archived')).toBeNull();
    expect(nextCourseStatus('restore', 'draft')).toBeNull();
    expect(nextCourseStatus('unpublish', 'archived')).toBeNull();
    expect(allowedCourseActions('draft')).toEqual(['publish', 'archive']);
    expect(allowedCourseActions('published')).toEqual(['unpublish', 'archive']);
    expect(allowedCourseActions('archived')).toEqual(['restore']);
  });

  it('deletes drafts only', () => {
    expect(isDeletable('draft')).toBe(true);
    expect(isDeletable('published')).toBe(false);
    expect(isDeletable('archived')).toBe(false);
  });
});

describe('course update planning', () => {
  it('detects an empty body', () => {
    expect(isEmptyCoursePatch({})).toBe(true);
    expect(isEmptyCoursePatch({ minAge: null })).toBe(false);
  });

  it('writes only what changes, in the fixed field order, and compares localized text as a whole', () => {
    const plan = planCourseUpdate(course(), {
      maxAge: 15,
      name: { ar: 'بايثون' },
      summary: { ar: 'ملخص' },
      code: 'PY-101',
      durationHours: '24.0',
      levelId: null,
    });
    expect(plan.fields).toEqual(['name', 'summary', 'maxAge']);
    expect(plan.data).toEqual({ name: { ar: 'بايثون' }, summary: { ar: 'ملخص' }, maxAge: 15 });
  });

  it('clears optional fields with null and is idempotent', () => {
    expect(planCourseUpdate(course(), { durationHours: null, minAge: null }).fields).toEqual(['durationHours', 'minAge']);
    expect(planCourseUpdate(course(), { summary: null, levelId: null, sessionsCount: 12 }).fields).toEqual([]);
  });

  it('checks the age range after merging the patch', () => {
    expect(invalidAgeRange(course(), { minAge: 15 })).toEqual({ minAge: 15, maxAge: 14 });
    expect(invalidAgeRange(course(), { maxAge: 9 })).toEqual({ minAge: 10, maxAge: 9 });
    expect(invalidAgeRange(course(), { minAge: 15, maxAge: 16 })).toBeNull();
    expect(invalidAgeRange(course(), { maxAge: null, minAge: 99 })).toBeNull();
  });

  it('keeps hours as the canonical numeric(6,1) string', () => {
    expect(hoursToDecimalString(12)).toBe('12.0');
    expect(hoursToDecimalString(12.5)).toBe('12.5');
    expect(hoursToDecimalString('12.50')).toBe('12.5');
    expect(hoursToDecimalString(null)).toBeNull();
  });
});

describe('keyset cursor (common)', () => {
  const invalid = () => new Error('cursor_invalid');
  const id = '01a19870-0000-7000-8000-000000000001';

  it('round-trips a keyed and an id-only cursor', () => {
    const keyed = encodeKeysetCursor({ sort: 'code', order: 'asc', key: 'PY-101', id });
    expect(decodeKeysetCursor(keyed, 'code', 'asc', true, invalid)).toEqual({ sort: 'code', order: 'asc', key: 'PY-101', id });
    const byId = encodeKeysetCursor({ sort: 'createdAt', order: 'desc', key: null, id });
    expect(decodeKeysetCursor(byId, 'createdAt', 'desc', false, invalid).id).toBe(id);
  });

  it('refuses a cursor of another sort or order, garbage and a bad id', () => {
    const keyed = encodeKeysetCursor({ sort: 'code', order: 'asc', key: 'PY-101', id });
    expect(() => decodeKeysetCursor(keyed, 'code', 'desc', true, invalid)).toThrow('cursor_invalid');
    expect(() => decodeKeysetCursor(keyed, 'createdAt', 'asc', false, invalid)).toThrow('cursor_invalid');
    expect(() => decodeKeysetCursor('not-base64-json', 'code', 'asc', true, invalid)).toThrow('cursor_invalid');
    const badId = Buffer.from(JSON.stringify([1, 'code', 'asc', 'X', 'nope'])).toString('base64url');
    expect(() => decodeKeysetCursor(badId, 'code', 'asc', true, invalid)).toThrow('cursor_invalid');
  });
});
