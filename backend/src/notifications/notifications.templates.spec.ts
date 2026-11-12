// TEST-175 — MOD-12-T02: the catalog of the fifteen automatic events and
// their wording in Arabic and English (D-R80, D-R83). Pure, no database.
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_EVENTS, NOTIFICATION_EVENT_KEYS, notificationData } from './notifications.events.js';
import type { NotificationEventKey, NotificationEventParams } from './notifications.events.js';
import { childrenSuffix, formatDay, formatNumber, formatTime, formatWhen, renderNotification } from './notifications.templates.js';

const LESSON_ID = '019a0000-0000-7000-8000-00000000000a';
const CLASS_ID = '019a0000-0000-7000-8000-00000000000b';
const OTHER_ID = '019a0000-0000-7000-8000-00000000000c';
/** 10:30 on Sunday 15 November 2026 in Riyadh. */
const AT = new Date('2026-11-15T07:30:00Z');
const ZONE = 'Asia/Riyadh';

// Values that must never reach a title: the title is the only event text an e-mail carries (D-R83).
const SCORE = '7.25';
const MAX_SCORE = '19.75';
const PERCENT = '86.4';
const TOTAL = '1234.56';
const AMOUNT = '654.32';
const SENSITIVE = [SCORE, MAX_SCORE, PERCENT, TOTAL, AMOUNT];

const lesson = { lessonId: LESSON_ID, classId: CLASS_ID, lessonTitle: { ar: 'الدرس الثالث', en: 'Lesson three' }, className: { ar: 'فصل الصباح', en: 'Morning class' }, startsAt: AT, timeZone: ZONE };

const SAMPLES: { [K in NotificationEventKey]: NotificationEventParams[K] } = {
  'lesson.cancelled': lesson,
  // The lesson now ends at 12:00 in Riyadh.
  'lesson.rescheduled': { ...lesson, endsAt: new Date('2026-11-15T09:00:00Z'), room: { code: 'A-101', name: null } },
  'attendance.absent': lesson,
  'assignment.published': { assignmentId: OTHER_ID, classId: CLASS_ID, title: { ar: 'مقال', en: 'Essay' }, className: lesson.className, dueAt: AT, timeZone: ZONE },
  'submission.graded': { submissionId: LESSON_ID, assignmentId: OTHER_ID, classId: CLASS_ID, title: { ar: 'مقال', en: 'Essay' }, score: SCORE, maxScore: MAX_SCORE },
  'submission.returned': { submissionId: LESSON_ID, assignmentId: OTHER_ID, classId: CLASS_ID, title: { ar: 'مقال', en: 'Essay' } },
  'exam.scheduled': { examId: OTHER_ID, classId: CLASS_ID, title: { ar: 'اختبار منتصف الفصل', en: 'Midterm' }, className: lesson.className, scheduledAt: AT, timeZone: ZONE },
  'exam.results_published': { examId: OTHER_ID, classId: CLASS_ID, title: { ar: 'اختبار منتصف الفصل', en: 'Midterm' }, result: 'scored', score: SCORE, maxScore: MAX_SCORE },
  'grades.finalized': { classId: CLASS_ID, className: lesson.className, percent: PERCENT, bandLabel: { ar: 'جيد جداً', en: 'Very good' }, bandLetter: 'B' },
  'certificate.issued': { certificateId: OTHER_ID, serial: 'CERT-2026-00024', courseName: { ar: 'اللغة العربية', en: 'Arabic' } },
  'certificate.revoked': { certificateId: OTHER_ID, serial: 'CERT-2026-00023', courseName: { ar: 'اللغة العربية', en: 'Arabic' } },
  'invoice.issued': { invoiceId: OTHER_ID, number: 'INV-2026-00082', total: TOTAL, currency: 'SAR', firstDueOn: '2026-12-01' },
  'invoice.cancelled': { invoiceId: OTHER_ID, number: 'INV-2026-00082' },
  'payment.recorded': { paymentId: LESSON_ID, invoiceId: OTHER_ID, receiptNumber: 'RCPT-2026-00052', invoiceNumber: 'INV-2026-00082', amount: AMOUNT, currency: 'SAR' },
  'payment.reversed': { paymentId: LESSON_ID, invoiceId: OTHER_ID, receiptNumber: 'RCPT-2026-00052', invoiceNumber: 'INV-2026-00082' },
};

const ARABIC_LETTER = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const render = <K extends NotificationEventKey>(key: K, locale: 'ar' | 'en') => renderNotification(key, SAMPLES[key], locale);

describe('notification events (D-R80, TEST-175)', () => {
  it('lists the fifteen automatic events in five categories, each with a scope and a link of this app', () => {
    expect(NOTIFICATION_EVENT_KEYS).toEqual([
      'lesson.cancelled',
      'lesson.rescheduled',
      'attendance.absent',
      'assignment.published',
      'submission.graded',
      'submission.returned',
      'exam.scheduled',
      'exam.results_published',
      'grades.finalized',
      'certificate.issued',
      'certificate.revoked',
      'invoice.issued',
      'invoice.cancelled',
      'payment.recorded',
      'payment.reversed',
    ]);
    const perCategory = (category: string) => NOTIFICATION_EVENT_KEYS.filter((key) => NOTIFICATION_EVENTS[key].category === category).length;
    expect(NOTIFICATION_CATEGORIES.map((category) => [category, perCategory(category)])).toEqual([
      ['lessons', 3],
      ['assignments', 3],
      ['exams', 2],
      ['grades', 3],
      ['finance', 4],
      // Announcements are manual (T05): no template.
      ['announcements', 0],
    ]);
    // A class event reaches the class once per recipient; every other event is about one student.
    expect(NOTIFICATION_EVENT_KEYS.filter((key) => NOTIFICATION_EVENTS[key].scope === 'class')).toEqual(['lesson.cancelled', 'lesson.rescheduled', 'assignment.published', 'exam.scheduled']);
    for (const key of NOTIFICATION_EVENT_KEYS) {
      // The shape the database checks (ck_notifications_event_key_format) and the column width.
      expect(key).toMatch(/^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)*$/);
      expect(key.length).toBeLessThanOrEqual(64);
      expect(NOTIFICATION_EVENTS[key].link).toMatch(/^\/[a-z-]+$/);
    }
  });

  it('keeps only the link and the ids in `data` — never a name, a score, an amount or a text', () => {
    expect(notificationData('submission.graded', SAMPLES['submission.graded'])).toEqual({ link: '/my-assignments', submissionId: LESSON_ID, assignmentId: OTHER_ID, classId: CLASS_ID });
    expect(notificationData('invoice.issued', SAMPLES['invoice.issued'])).toEqual({ link: '/my-invoices', invoiceId: OTHER_ID });
    expect(notificationData('certificate.issued', SAMPLES['certificate.issued'])).toEqual({ link: '/my-certificates', certificateId: OTHER_ID });
    // A single child is the row's own student; several are named in `data`.
    expect(notificationData('lesson.cancelled', lesson, [OTHER_ID])).toEqual({ link: '/my-lessons', lessonId: LESSON_ID, classId: CLASS_ID });
    expect(notificationData('lesson.cancelled', lesson, [OTHER_ID, LESSON_ID])).toEqual({ link: '/my-lessons', lessonId: LESSON_ID, classId: CLASS_ID, studentIds: [OTHER_ID, LESSON_ID] });
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const serialized = JSON.stringify(notificationData(key, SAMPLES[key]));
      for (const value of [...SENSITIVE, 'مقال', 'Essay', 'INV-2026-00082', 'CERT-2026-00024']) expect(serialized, key).not.toContain(value);
    }
  });
});

describe('notification wording (D-R83, TEST-175)', () => {
  it('words every event in Arabic and in English with a title and a body', () => {
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const arabic = render(key, 'ar');
      const english = render(key, 'en');
      for (const text of [arabic.title, arabic.body, english.title, english.body]) expect(text.trim(), key).not.toBe('');
      expect(arabic.title, key).toMatch(ARABIC_LETTER);
      expect(arabic.body, key).toMatch(ARABIC_LETTER);
      // Every sample text has an English form, so an English notification carries no Arabic at all.
      expect(english.title, key).not.toMatch(ARABIC_LETTER);
      expect(english.body, key).not.toMatch(ARABIC_LETTER);
      // Latin digits in both languages, as the frontend shows numbers and dates.
      expect(`${arabic.title} ${arabic.body}`, key).not.toMatch(ARABIC_INDIC_DIGIT);
      expect(arabic.title, key).not.toBe(english.title);
    }
  });

  it('never puts a score, an amount or a percentage into a title, while the body states what the reader already sees', () => {
    for (const key of NOTIFICATION_EVENT_KEYS) {
      for (const locale of ['ar', 'en'] as const) {
        const { title } = render(key, locale);
        for (const value of SENSITIVE) expect(title, `${key} (${locale})`).not.toContain(value);
      }
    }
    for (const locale of ['ar', 'en'] as const) {
      expect(render('submission.graded', locale).body).toContain(SCORE);
      expect(render('submission.graded', locale).body).toContain(MAX_SCORE);
      expect(render('exam.results_published', locale).body).toContain(SCORE);
      expect(render('grades.finalized', locale).body).toContain(`${PERCENT}%`);
      expect(render('grades.finalized', locale).body).toContain('(B)');
      expect(render('invoice.issued', locale).body).toContain(`${TOTAL} SAR`);
      expect(render('payment.recorded', locale).body).toContain(`${AMOUNT} SAR`);
      expect(render('payment.recorded', locale).body).toContain('RCPT-2026-00052');
      expect(render('certificate.issued', locale).body).toContain('CERT-2026-00024');
    }
    expect(render('submission.graded', 'en')).toEqual({ title: 'Assignment graded: Essay', body: 'The submission for “Essay” was graded: 7.25 out of 19.75.' });
    expect(render('submission.graded', 'ar')).toEqual({ title: 'صُحّح واجب: مقال', body: 'صُحّح تسليم واجب «مقال»: الدرجة 7.25 من 19.75.' });
    expect(render('invoice.cancelled', 'en')).toEqual({ title: 'Invoice cancelled: INV-2026-00082', body: 'Invoice INV-2026-00082 was cancelled.' });
    expect(render('payment.reversed', 'ar')).toEqual({ title: 'عُكست دفعة: RCPT-2026-00052', body: 'عُكست الدفعة ذات الإيصال RCPT-2026-00052 على الفاتورة INV-2026-00082.' });
  });

  it('picks stored texts in the reader language, else the academy default, else Arabic', () => {
    const arabicOnly = { ...SAMPLES['assignment.published'], title: { ar: 'مقال' }, className: { ar: 'فصل الصباح', tr: 'Sabah sınıfı' } };
    expect(renderNotification('assignment.published', arabicOnly, 'en').title).toBe('New assignment: مقال');
    expect(renderNotification('assignment.published', arabicOnly, 'en', 'tr').body).toContain('“Sabah sınıfı”');
    expect(renderNotification('assignment.published', arabicOnly, 'ar', 'tr').body).toContain('«فصل الصباح»');
  });

  it('words the variants: no due date, no room, an unscheduled exam, an absent or excused result, a band without a letter, an invoice without a due day', () => {
    const noDue = { ...SAMPLES['assignment.published'], dueAt: null };
    expect(renderNotification('assignment.published', noDue, 'en').body).toBe('The assignment “Essay” was published in class “Morning class”. It has no due date.');
    expect(renderNotification('assignment.published', noDue, 'ar').body).toBe('نُشر واجب «مقال» في فصل «فصل الصباح». بلا موعد تسليم محدد.');
    // The end of the lesson is worded too: a lesson that only ends earlier or later is news.
    expect(render('lesson.rescheduled', 'en').body).toContain(', until 12:00, in A-101.');
    expect(render('lesson.rescheduled', 'ar').body).toContain(' حتى 12:00، في A-101.');
    expect(formatTime(new Date('2026-11-15T09:00:00Z'), 'Europe/Berlin', 'en')).toBe('10:00');
    expect(formatTime(new Date('2026-11-15T09:00:00Z'), 'Not/AZone', 'ar')).toBe('09:00');
    // A named room is worded in the reader's language; a room without a name by its code; no room, no mention.
    const named = { ...SAMPLES['lesson.rescheduled'], room: { code: 'A-101', name: { ar: 'قاعة الحاسوب', en: 'Computer lab' } } };
    expect(renderNotification('lesson.rescheduled', named, 'en').body).toContain(', in Computer lab.');
    expect(renderNotification('lesson.rescheduled', named, 'ar').body).toContain('، في قاعة الحاسوب.');
    expect(renderNotification('lesson.rescheduled', { ...SAMPLES['lesson.rescheduled'], room: null }, 'en').body.endsWith(', until 12:00.')).toBe(true);
    const unscheduled = { ...SAMPLES['exam.scheduled'], scheduledAt: null };
    expect(renderNotification('exam.scheduled', unscheduled, 'en').body).toBe('The exam “Midterm” of class “Morning class” was scheduled; its time will follow.');
    expect(renderNotification('exam.scheduled', unscheduled, 'ar').body).toBe('اختبار «اختبار منتصف الفصل» في فصل «فصل الصباح» جُدول وسيُعلن موعده لاحقاً.');
    const result = (value: 'absent' | 'excused', locale: 'ar' | 'en') => renderNotification('exam.results_published', { ...SAMPLES['exam.results_published'], result: value, score: null }, locale).body;
    expect(result('absent', 'en')).toBe('Result of the exam “Midterm”: absent.');
    expect(result('excused', 'en')).toBe('Result of the exam “Midterm”: excused.');
    expect(result('absent', 'ar')).toBe('نتيجة اختبار «اختبار منتصف الفصل»: غائب.');
    expect(result('excused', 'ar')).toBe('نتيجة اختبار «اختبار منتصف الفصل»: معذور.');
    expect(renderNotification('grades.finalized', { ...SAMPLES['grades.finalized'], bandLetter: null }, 'en').body).toBe('The final grade of class “Morning class” is 86.4% — Very good.');
    expect(renderNotification('invoice.issued', { ...SAMPLES['invoice.issued'], firstDueOn: null }, 'en').body).toBe('Invoice INV-2026-00082 was issued for 1234.56 SAR.');
    expect(render('invoice.issued', 'en').body).toBe('Invoice INV-2026-00082 was issued for 1234.56 SAR; the first installment is due on 1 December 2026.');
  });

  it('states a time in the zone of the event with Latin digits, and falls back to UTC for an unknown zone', () => {
    const english = formatWhen(AT, ZONE, 'en');
    expect(english).toContain('Sunday');
    expect(english).toContain('15 November 2026');
    expect(english).toContain('10:30');
    const arabic = formatWhen(AT, ZONE, 'ar');
    expect(arabic).toContain('10:30');
    expect(arabic).toContain('2026');
    expect(arabic).toMatch(ARABIC_LETTER);
    expect(arabic).not.toMatch(ARABIC_INDIC_DIGIT);
    // The same instant in another zone is another wall-clock time: the zone is the event's, not the server's.
    expect(formatWhen(AT, 'Europe/Berlin', 'en')).toContain('08:30');
    expect(formatWhen(AT, 'Not/AZone', 'en')).toContain('07:30');
    expect(render('lesson.cancelled', 'en').body).toContain('10:30');
    expect(formatDay('2026-12-01', 'en')).toBe('1 December 2026');
    expect(formatDay('2026-12-01', 'ar')).toContain('2026');
    expect(formatDay('2026-12-01', 'ar')).not.toMatch(ARABIC_INDIC_DIGIT);
    expect(formatDay('soon', 'en')).toBe('soon');
    expect(formatDay('2026-13-45', 'en')).toBe('2026-13-45');
  });

  it('drops trailing zeros of a score or a percentage and leaves anything else alone', () => {
    expect(['8.50', '10.00', '86.40', '0.00', '7', '100', '0.05'].map(formatNumber)).toEqual(['8.5', '10', '86.4', '0', '7', '100', '0.05']);
    expect(formatNumber(7.5)).toBe('7.5');
    expect(formatNumber({ toString: () => '19.00' })).toBe('19');
    expect(formatNumber('n/a')).toBe('n/a');
  });

  it('ends a guardian copy by naming the child or the children; a student copy has no suffix', () => {
    expect(childrenSuffix([], 'ar')).toBe('');
    expect(childrenSuffix(['أحمد'], 'ar')).toBe('الطالب: أحمد.');
    expect(childrenSuffix(['أحمد', 'سارة'], 'ar')).toBe('الطلاب: أحمد، سارة.');
    expect(childrenSuffix(['Ahmad'], 'en')).toBe('Student: Ahmad.');
    expect(childrenSuffix(['Ahmad', 'Sara'], 'en')).toBe('Students: Ahmad, Sara.');
  });
});
