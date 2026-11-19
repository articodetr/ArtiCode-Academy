// TEST-175 — MOD-12-T02: the catalog of the fifteen automatic events and
// their wording in Arabic and English (D-R80, D-R83). Pure, no database.
// TEST-215 — S6-C: and in Turkish, every event, with the same privacy rules.
import { describe, expect, it } from 'vitest';
import { TEMPLATE_LOCALES, templateLocale } from '../mail/mail.templates.js';
import type { TemplateLocale } from '../mail/mail.templates.js';
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

// Every stored text has an English and a Turkish form, so neither of those notifications carries Arabic.
const lesson = {
  lessonId: LESSON_ID,
  classId: CLASS_ID,
  lessonTitle: { ar: 'الدرس الثالث', en: 'Lesson three', tr: 'Üçüncü ders' },
  className: { ar: 'فصل الصباح', en: 'Morning class', tr: 'Sabah sınıfı' },
  startsAt: AT,
  timeZone: ZONE,
};
const ESSAY = { ar: 'مقال', en: 'Essay', tr: 'Kompozisyon' };
const MIDTERM = { ar: 'اختبار منتصف الفصل', en: 'Midterm', tr: 'Ara sınav' };
const ARABIC_COURSE = { ar: 'اللغة العربية', en: 'Arabic', tr: 'Arapça' };

const SAMPLES: { [K in NotificationEventKey]: NotificationEventParams[K] } = {
  'lesson.cancelled': lesson,
  // The lesson now ends at 12:00 in Riyadh.
  'lesson.rescheduled': { ...lesson, endsAt: new Date('2026-11-15T09:00:00Z'), room: { code: 'A-101', name: null } },
  'attendance.absent': lesson,
  'assignment.published': { assignmentId: OTHER_ID, classId: CLASS_ID, title: ESSAY, className: lesson.className, dueAt: AT, timeZone: ZONE },
  'submission.graded': { submissionId: LESSON_ID, assignmentId: OTHER_ID, classId: CLASS_ID, title: ESSAY, score: SCORE, maxScore: MAX_SCORE },
  'submission.returned': { submissionId: LESSON_ID, assignmentId: OTHER_ID, classId: CLASS_ID, title: ESSAY },
  'exam.scheduled': { examId: OTHER_ID, classId: CLASS_ID, title: MIDTERM, className: lesson.className, scheduledAt: AT, timeZone: ZONE },
  'exam.results_published': { examId: OTHER_ID, classId: CLASS_ID, title: MIDTERM, result: 'scored', score: SCORE, maxScore: MAX_SCORE },
  'grades.finalized': { classId: CLASS_ID, className: lesson.className, percent: PERCENT, bandLabel: { ar: 'جيد جداً', en: 'Very good', tr: 'Çok iyi' }, bandLetter: 'B' },
  'certificate.issued': { certificateId: OTHER_ID, serial: 'CERT-2026-00024', courseName: ARABIC_COURSE },
  'certificate.revoked': { certificateId: OTHER_ID, serial: 'CERT-2026-00023', courseName: ARABIC_COURSE },
  'invoice.issued': { invoiceId: OTHER_ID, number: 'INV-2026-00082', total: TOTAL, currency: 'SAR', firstDueOn: '2026-12-01' },
  'invoice.cancelled': { invoiceId: OTHER_ID, number: 'INV-2026-00082' },
  'payment.recorded': { paymentId: LESSON_ID, invoiceId: OTHER_ID, receiptNumber: 'RCPT-2026-00052', invoiceNumber: 'INV-2026-00082', amount: AMOUNT, currency: 'SAR' },
  'payment.reversed': { paymentId: LESSON_ID, invoiceId: OTHER_ID, receiptNumber: 'RCPT-2026-00052', invoiceNumber: 'INV-2026-00082' },
  // MOD-19 (D-R128, TEST-244).
  'enrollment.requested': {
    enrollmentId: LESSON_ID,
    invoiceId: OTHER_ID,
    courseName: ARABIC_COURSE,
    className: lesson.className,
    number: 'INV-2026-00082',
    total: TOTAL,
    currency: 'SAR',
    firstDueOn: '2026-12-01',
  },
  'enrollment.request_received': { enrollmentId: LESSON_ID, studentName: 'Lina Haddad', courseName: ARABIC_COURSE, className: lesson.className },
  'enrollment.activated': { enrollmentId: LESSON_ID, classId: CLASS_ID, courseName: ARABIC_COURSE, className: lesson.className },
  'enrollment.rejected': { enrollmentId: LESSON_ID, courseName: ARABIC_COURSE, className: lesson.className },
};

const ARABIC_LETTER = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
/** What a template that lost a parameter or a wording would print. */
const LEAK = /undefined|null|\[object |NaN|\$\{/;
const render = <K extends NotificationEventKey>(key: K, locale: TemplateLocale) => renderNotification(key, SAMPLES[key], locale);

describe('notification events (D-R80, TEST-175)', () => {
  it('lists the nineteen automatic events in six categories, each with a scope and a link of this app', () => {
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
      'enrollment.requested',
      'enrollment.request_received',
      'enrollment.activated',
      'enrollment.rejected',
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
      // MOD-19 (D-R128): the seventh e-mail switch.
      ['enrollments', 4],
    ]);
    // A class event reaches the class once per recipient; every other event is about one student.
    expect(NOTIFICATION_EVENT_KEYS.filter((key) => NOTIFICATION_EVENTS[key].scope === 'class')).toEqual(['lesson.cancelled', 'lesson.rescheduled', 'assignment.published', 'exam.scheduled']);
    // MOD-19: the one office event reaches the holders of enrollments.manage.
    expect(NOTIFICATION_EVENT_KEYS.filter((key) => NOTIFICATION_EVENTS[key].scope === 'staff')).toEqual(['enrollment.request_received']);
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
    // MOD-19: the ids only — the class is in `data` for the activation alone (the pending request is no «my …» class yet).
    expect(notificationData('enrollment.requested', SAMPLES['enrollment.requested'])).toEqual({ link: '/my-courses', enrollmentId: LESSON_ID, invoiceId: OTHER_ID });
    expect(notificationData('enrollment.request_received', SAMPLES['enrollment.request_received'])).toEqual({ link: '/enrollment-requests', enrollmentId: LESSON_ID });
    expect(notificationData('enrollment.activated', SAMPLES['enrollment.activated'])).toEqual({ link: '/my-courses', enrollmentId: LESSON_ID, classId: CLASS_ID });
    // A single child is the row's own student; several are named in `data`.
    expect(notificationData('lesson.cancelled', lesson, [OTHER_ID])).toEqual({ link: '/my-lessons', lessonId: LESSON_ID, classId: CLASS_ID });
    expect(notificationData('lesson.cancelled', lesson, [OTHER_ID, LESSON_ID])).toEqual({ link: '/my-lessons', lessonId: LESSON_ID, classId: CLASS_ID, studentIds: [OTHER_ID, LESSON_ID] });
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const serialized = JSON.stringify(notificationData(key, SAMPLES[key]));
      for (const value of [...SENSITIVE, 'مقال', 'Essay', 'Kompozisyon', 'INV-2026-00082', 'CERT-2026-00024']) expect(serialized, key).not.toContain(value);
    }
  });
});

describe('notification wording (D-R83, TEST-175)', () => {
  it('words every event in Arabic, English and Turkish with a title and a body', () => {
    // The wording covers every locale that has templates (TEST-215): a new locale or event without one fails here.
    expect(TEMPLATE_LOCALES).toEqual(['ar', 'en', 'tr']);
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const arabic = render(key, 'ar');
      const english = render(key, 'en');
      const turkish = render(key, 'tr');
      for (const text of [arabic.title, arabic.body, english.title, english.body, turkish.title, turkish.body]) {
        expect(text.trim(), key).not.toBe('');
        expect(text, key).not.toMatch(LEAK);
      }
      expect(arabic.title, key).toMatch(ARABIC_LETTER);
      expect(arabic.body, key).toMatch(ARABIC_LETTER);
      // Every sample text has an English and a Turkish form, so neither notification carries Arabic at all.
      for (const latin of [english, turkish]) {
        expect(latin.title, key).not.toMatch(ARABIC_LETTER);
        expect(latin.body, key).not.toMatch(ARABIC_LETTER);
      }
      // Latin digits in every language, as the frontend shows numbers and dates.
      for (const rendered of [arabic, english, turkish]) expect(`${rendered.title} ${rendered.body}`, key).not.toMatch(ARABIC_INDIC_DIGIT);
      // Each language has its own wording, not a copy of another.
      expect(new Set([arabic.title, english.title, turkish.title]).size, key).toBe(3);
      expect(new Set([arabic.body, english.body, turkish.body]).size, key).toBe(3);
    }
  });

  it('never puts a score, an amount or a percentage into a title, while the body states what the reader already sees', () => {
    for (const key of NOTIFICATION_EVENT_KEYS) {
      for (const locale of TEMPLATE_LOCALES) {
        const { title } = render(key, locale);
        for (const value of SENSITIVE) expect(title, `${key} (${locale})`).not.toContain(value);
        expect(title, `${key} (${locale})`).not.toContain('%');
      }
    }
    for (const locale of TEMPLATE_LOCALES) {
      expect(render('submission.graded', locale).body).toContain(SCORE);
      expect(render('submission.graded', locale).body).toContain(MAX_SCORE);
      expect(render('exam.results_published', locale).body).toContain(SCORE);
      // Turkish writes the percent sign before the number.
      expect(render('grades.finalized', locale).body).toContain(locale === 'tr' ? `%${PERCENT}` : `${PERCENT}%`);
      expect(render('grades.finalized', locale).body).toContain('(B)');
      expect(render('invoice.issued', locale).body).toContain(`${TOTAL} SAR`);
      expect(render('payment.recorded', locale).body).toContain(`${AMOUNT} SAR`);
      expect(render('payment.recorded', locale).body).toContain('RCPT-2026-00052');
      expect(render('certificate.issued', locale).body).toContain('CERT-2026-00024');
      // MOD-19: the request's body states the invoice the student sees on «my invoices»; its title names the course only.
      expect(render('enrollment.requested', locale).body).toContain(`${TOTAL} SAR`);
      expect(render('enrollment.requested', locale).body).toContain('INV-2026-00082');
      expect(render('enrollment.requested', locale).title).not.toContain('INV-2026-00082');
      expect(render('enrollment.request_received', locale).body).toContain('Lina Haddad');
    }
    expect(render('submission.graded', 'tr')).toEqual({ title: 'Ödev notlandırıldı: Kompozisyon', body: '“Kompozisyon” ödevinin teslimi notlandırıldı: 19.75 üzerinden 7.25.' });
    expect(render('grades.finalized', 'tr')).toEqual({ title: 'Nihai not: Sabah sınıfı', body: '“Sabah sınıfı” sınıfının nihai notu: %86.4 — Çok iyi (B).' });
    expect(render('invoice.issued', 'tr')).toEqual({
      title: 'Yeni fatura: INV-2026-00082',
      body: 'INV-2026-00082 numaralı fatura 1234.56 SAR tutarında düzenlendi; ilk taksidin son ödeme tarihi 1 Aralık 2026.',
    });
    expect(render('payment.reversed', 'tr')).toEqual({ title: 'Ödeme geri alındı: RCPT-2026-00052', body: 'INV-2026-00082 numaralı faturadaki RCPT-2026-00052 makbuz numaralı ödeme geri alındı.' });
    expect(render('lesson.cancelled', 'tr')).toEqual({
      title: 'Ders iptal edildi: Üçüncü ders',
      body: `“Sabah sınıfı” sınıfının ${formatWhen(AT, ZONE, 'tr')} için planlanan “Üçüncü ders” dersi iptal edildi.`,
    });
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
    // A Turkish reader gets the Turkish text, and the academy default, then Arabic, when there is none.
    expect(renderNotification('assignment.published', arabicOnly, 'tr').body).toContain('“Sabah sınıfı”');
    expect(renderNotification('assignment.published', arabicOnly, 'tr').title).toBe('Yeni ödev: مقال');
    const englishToo = { ...arabicOnly, title: { ar: 'مقال', en: 'Essay' } };
    expect(renderNotification('assignment.published', englishToo, 'tr', 'en').title).toBe('Yeni ödev: Essay');
  });

  it('words a Turkish recipient in Turkish, and a recipient without a locale in a Turkish academy too (TEST-215)', () => {
    // The engine renders with templateLocale(recipient locale, academy default) — notifications.service.ts.
    const asRecipient = (own: 'ar' | 'en' | 'tr' | null, academy: 'ar' | 'en' | 'tr') => {
      const locale = templateLocale(own, academy);
      return { locale, ...renderNotification('invoice.cancelled', SAMPLES['invoice.cancelled'], locale, academy) };
    };
    expect(asRecipient('tr', 'ar')).toEqual({ locale: 'tr', title: 'Fatura iptal edildi: INV-2026-00082', body: 'INV-2026-00082 numaralı fatura iptal edildi.' });
    expect(asRecipient(null, 'tr')).toEqual({ locale: 'tr', title: 'Fatura iptal edildi: INV-2026-00082', body: 'INV-2026-00082 numaralı fatura iptal edildi.' });
    expect(asRecipient('ar', 'tr')).toEqual({ locale: 'ar', title: 'أُلغيت فاتورة: INV-2026-00082', body: 'أُلغيت الفاتورة INV-2026-00082.' });
    expect(asRecipient('en', 'tr')).toEqual({ locale: 'en', title: 'Invoice cancelled: INV-2026-00082', body: 'Invoice INV-2026-00082 was cancelled.' });
    expect(asRecipient(null, 'ar').locale).toBe('ar');
    expect(asRecipient(null, 'en').locale).toBe('en');
    // A guardian's Turkish copy names the children in Turkish.
    expect(childrenSuffix(['Ahmet'], templateLocale(null, 'tr'))).toBe('Öğrenci: Ahmet.');
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

  it('words the same variants in Turkish (TEST-215)', () => {
    const noDue = { ...SAMPLES['assignment.published'], dueAt: null };
    expect(renderNotification('assignment.published', noDue, 'tr').body).toBe('“Sabah sınıfı” sınıfında “Kompozisyon” ödevi yayımlandı. Son teslim tarihi belirlenmedi.');
    expect(render('assignment.published', 'tr').body).toBe(`“Sabah sınıfı” sınıfında “Kompozisyon” ödevi yayımlandı. Son teslim tarihi: ${formatWhen(AT, ZONE, 'tr')}.`);
    expect(render('lesson.rescheduled', 'tr').body).toBe(`“Sabah sınıfı” sınıfının “Üçüncü ders” dersinin yeni zamanı: ${formatWhen(AT, ZONE, 'tr')}, bitiş: 12:00, derslik: A-101.`);
    const named = { ...SAMPLES['lesson.rescheduled'], room: { code: 'A-101', name: { ar: 'قاعة الحاسوب', en: 'Computer lab', tr: 'Bilgisayar laboratuvarı' } } };
    expect(renderNotification('lesson.rescheduled', named, 'tr').body).toContain(', derslik: Bilgisayar laboratuvarı.');
    expect(renderNotification('lesson.rescheduled', { ...SAMPLES['lesson.rescheduled'], room: null }, 'tr').body.endsWith(', bitiş: 12:00.')).toBe(true);
    expect(render('attendance.absent', 'tr').title).toBe('Devamsızlık kaydedildi: Üçüncü ders');
    expect(render('submission.returned', 'tr')).toEqual({
      title: 'Ödev düzeltme için geri gönderildi: Kompozisyon',
      body: '“Kompozisyon” ödevinin teslimi düzeltme için geri gönderildi; geri bildirim “Ödevlerim” sayfasında.',
    });
    const unscheduled = { ...SAMPLES['exam.scheduled'], scheduledAt: null };
    expect(renderNotification('exam.scheduled', unscheduled, 'tr').body).toBe('“Sabah sınıfı” sınıfının “Ara sınav” sınavı planlandı; saati daha sonra bildirilecek.');
    expect(render('exam.scheduled', 'tr').body).toBe(`“Sabah sınıfı” sınıfının “Ara sınav” sınavı ${formatWhen(AT, ZONE, 'tr')} için planlandı.`);
    expect(render('exam.results_published', 'tr')).toEqual({ title: 'Sınav sonucu yayımlandı: Ara sınav', body: '“Ara sınav” sınavının sonucu: 19.75 üzerinden 7.25.' });
    const result = (value: 'absent' | 'excused') => renderNotification('exam.results_published', { ...SAMPLES['exam.results_published'], result: value, score: null }, 'tr').body;
    expect(result('absent')).toBe('“Ara sınav” sınavının sonucu: sınava girmedi.');
    expect(result('excused')).toBe('“Ara sınav” sınavının sonucu: mazeretli.');
    expect(renderNotification('grades.finalized', { ...SAMPLES['grades.finalized'], bandLetter: null }, 'tr').body).toBe('“Sabah sınıfı” sınıfının nihai notu: %86.4 — Çok iyi.');
    expect(render('certificate.issued', 'tr')).toEqual({ title: 'Sertifika düzenlendi: Arapça', body: '“Arapça” kursunun bitirme sertifikası CERT-2026-00024 seri numarasıyla düzenlendi.' });
    expect(render('certificate.revoked', 'tr')).toEqual({ title: 'Sertifika iptal edildi: Arapça', body: '“Arapça” kursuna ait CERT-2026-00023 seri numaralı sertifika iptal edildi.' });
    expect(renderNotification('invoice.issued', { ...SAMPLES['invoice.issued'], firstDueOn: null }, 'tr').body).toBe('INV-2026-00082 numaralı fatura 1234.56 SAR tutarında düzenlendi.');
    expect(render('payment.recorded', 'tr')).toEqual({
      title: 'Ödeme kaydedildi: RCPT-2026-00052',
      body: 'INV-2026-00082 numaralı faturaya 654.32 SAR tutarında bir ödeme kaydedildi; makbuz numarası RCPT-2026-00052.',
    });
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
    // TEST-215 — Turkish (tr-TR): Latin digits, Turkish month and day names, the event's zone.
    const turkish = formatWhen(AT, ZONE, 'tr');
    expect(turkish).toContain('15 Kasım 2026');
    expect(turkish).toContain('Pazar');
    expect(turkish).toContain('10:30');
    expect(formatWhen(AT, 'Europe/Berlin', 'tr')).toContain('08:30');
    expect(formatWhen(AT, 'Not/AZone', 'tr')).toContain('07:30');
    expect(formatTime(new Date('2026-11-15T09:00:00Z'), ZONE, 'tr')).toBe('12:00');
    expect(formatDay('2026-12-01', 'tr')).toBe('1 Aralık 2026');
    expect(formatDay('soon', 'tr')).toBe('soon');
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
    expect(childrenSuffix([], 'tr')).toBe('');
    expect(childrenSuffix(['Ahmet'], 'tr')).toBe('Öğrenci: Ahmet.');
    expect(childrenSuffix(['Ahmet', 'Ayşe'], 'tr')).toBe('Öğrenciler: Ahmet, Ayşe.');
  });
});
