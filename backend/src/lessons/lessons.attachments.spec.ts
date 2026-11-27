// TEST-340 (unit) — the rules of a lesson's attachments (J-F77).
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS_MAX, parseLessonAttachments, readLessonAttachments, sameAttachments } from './lessons.attachments.js';

const book = { kind: 'book', title: { ar: 'كتاب الوحدة' }, url: 'https://cdn.example.org/unit.pdf' };

describe('parseLessonAttachments', () => {
  it('normalises a valid list: trimmed text, blank locales dropped, keys in one order', () => {
    const check = parseLessonAttachments([{ url: ' https://example.org/page ', title: { ar: ' صفحة ', en: '', tr: '  ' }, kind: 'link' }, book]);
    expect(check).toEqual({
      ok: true,
      attachments: [
        { kind: 'link', title: { ar: 'صفحة' }, url: 'https://example.org/page' },
        { kind: 'book', title: { ar: 'كتاب الوحدة' }, url: 'https://cdn.example.org/unit.pdf' },
      ],
    });
    expect(JSON.stringify(check.ok && check.attachments[0])).toBe('{"kind":"link","title":{"ar":"صفحة"},"url":"https://example.org/page"}');
  });

  it('accepts null, undefined and [] as none', () => {
    expect(parseLessonAttachments(null)).toEqual({ ok: true, attachments: [] });
    expect(parseLessonAttachments(undefined)).toEqual({ ok: true, attachments: [] });
    expect(parseLessonAttachments([])).toEqual({ ok: true, attachments: [] });
  });

  it('refuses an http link, an unknown kind, a missing Arabic title, an extra key and more than the maximum, naming where', () => {
    const refused = (input: unknown) => {
      const check = parseLessonAttachments(input);
      expect(check.ok).toBe(false);
      return check.ok ? [] : check.problems;
    };
    expect(refused([{ ...book, url: 'http://cdn.example.org/unit.pdf' }])[0]).toMatch(/^0\.url: /);
    expect(refused([{ ...book, kind: 'video' }])[0]).toMatch(/^0\.kind: /);
    expect(refused([{ ...book, title: { en: 'Unit' } }])[0]).toMatch(/^0\.title\.ar: /);
    expect(refused([{ ...book, size: 3 }])[0]).toMatch(/size/);
    expect(refused('book')).toHaveLength(1);
    expect(refused(Array.from({ length: ATTACHMENTS_MAX + 1 }, () => book))).toHaveLength(1);
  });
});

describe('readLessonAttachments / sameAttachments', () => {
  it('reads a stored value leniently and compares normalised lists in order', () => {
    expect(readLessonAttachments([book])).toEqual([book]);
    expect(readLessonAttachments({ not: 'a list' })).toEqual([]);
    expect(readLessonAttachments([{ kind: 'book' }])).toEqual([]);
    const link = { kind: 'link' as const, title: { ar: 'رابط' }, url: 'https://example.org' };
    const typedBook = { kind: 'book' as const, title: { ar: 'كتاب الوحدة' }, url: 'https://cdn.example.org/unit.pdf' };
    expect(sameAttachments([typedBook, link], [typedBook, link])).toBe(true);
    expect(sameAttachments([typedBook, link], [link, typedBook])).toBe(false);
    expect(sameAttachments([], [])).toBe(true);
  });
});
