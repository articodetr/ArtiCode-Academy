// Wording of the fifteen automatic notifications in Arabic (reference
// language) and English (owner decision D-R83: templates in code, rendered in
// the recipient's language at creation). Pure functions, unit-tested in
// notifications.templates.spec.ts.
//
// Two rules the tests hold every template to:
//   * the TITLE names the event and the thing it is about (a lesson, an
//     assignment, a class, a document number) and never a score, an amount or
//     a percentage — the title is the only event text an e-mail carries;
//   * nothing here can word a reason, a teacher's note or the name of whoever
//     graded, recorded or cancelled: the parameters do not even carry them.
// The BODY is for the inbox inside the app and may state what the recipient
// already sees on their own «my …» pages (their score, their invoice total).
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';
import { pickLocalized } from '../authorization/localized-text.js';
import type { TemplateLocale } from '../mail/mail.templates.js';
import type { NotificationEventKey, NotificationEventParams } from './notifications.events.js';

export interface RenderedNotification {
  title: string;
  body: string;
}

/** Arabic with Latin digits and the Gregorian calendar, as the frontend formats dates; British English. */
function intlTag(locale: TemplateLocale): string {
  return locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';
}

/**
 * A day and time in the zone the event is shown in (D-R41), with the zone's
 * short name because the reader may be elsewhere. Falls back to UTC when the
 * stored zone name is not valid for Intl.
 */
export function formatWhen(date: Date, timeZone: string, locale: TemplateLocale): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat(intlTag(locale), { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(intlTag(locale), { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** The clock time alone (`12:00`) in the zone of the event — the end of a time range whose start `formatWhen()` already dated. */
export function formatTime(date: Date, timeZone: string, locale: TemplateLocale): string {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return new Intl.DateTimeFormat(intlTag(locale), { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(intlTag(locale), { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** A calendar day `YYYY-MM-DD` (a due date) worded for the reader; anything else is returned as it is. */
export function formatDay(day: string, locale: TemplateLocale): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** A score or a percentage without trailing zeros: `8.50` → `8.5`, `10.00` → `10`. */
export function formatNumber(value: number | string | { toString(): string }): string {
  const text = String(value);
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

interface Wording {
  en: boolean;
  /** A stored `{ ar, en?, tr? }` text in the reader's language (D1 fallback order). */
  text(value: LocalizedText): string;
  when(date: Date, timeZone: string): string;
  time(date: Date, timeZone: string): string;
  day(day: string): string;
}

type Renderer<K extends NotificationEventKey> = (params: NotificationEventParams[K], w: Wording) => RenderedNotification;

const RENDERERS: { [K in NotificationEventKey]: Renderer<K> } = {
  'lesson.cancelled': (p, w) => {
    const lesson = w.text(p.lessonTitle);
    const klass = w.text(p.className);
    const when = w.when(p.startsAt, p.timeZone);
    return w.en
      ? { title: `Lesson cancelled: ${lesson}`, body: `The lesson “${lesson}” of class “${klass}”, planned for ${when}, was cancelled.` }
      : { title: `أُلغي درس: ${lesson}`, body: `أُلغي درس «${lesson}» في فصل «${klass}» الذي كان موعده ${when}.` };
  },
  'lesson.rescheduled': (p, w) => {
    const lesson = w.text(p.lessonTitle);
    const klass = w.text(p.className);
    const when = w.when(p.startsAt, p.timeZone);
    const until = w.time(p.endsAt, p.timeZone);
    const room = p.room ? (p.room.name ? w.text(p.room.name) : p.room.code) : null;
    return w.en
      ? { title: `Lesson changed: ${lesson}`, body: `The lesson “${lesson}” of class “${klass}” is now on ${when}, until ${until}${room ? `, in ${room}` : ''}.` }
      : { title: `تغيّر موعد أو قاعة درس: ${lesson}`, body: `درس «${lesson}» في فصل «${klass}» صار موعده ${when} حتى ${until}${room ? `، في ${room}` : ''}.` };
  },
  'attendance.absent': (p, w) => {
    const lesson = w.text(p.lessonTitle);
    const klass = w.text(p.className);
    const when = w.when(p.startsAt, p.timeZone);
    return w.en
      ? { title: `Absence recorded: ${lesson}`, body: `An absence was recorded for the lesson “${lesson}” of class “${klass}” on ${when}.` }
      : { title: `سُجّل غياب عن درس: ${lesson}`, body: `سُجّل غياب عن درس «${lesson}» في فصل «${klass}» بتاريخ ${when}.` };
  },
  'assignment.published': (p, w) => {
    const title = w.text(p.title);
    const klass = w.text(p.className);
    const due = p.dueAt ? w.when(p.dueAt, p.timeZone) : null;
    return w.en
      ? { title: `New assignment: ${title}`, body: `The assignment “${title}” was published in class “${klass}”. ${due ? `It is due on ${due}.` : 'It has no due date.'}` }
      : { title: `واجب جديد: ${title}`, body: `نُشر واجب «${title}» في فصل «${klass}». ${due ? `آخر موعد للتسليم ${due}.` : 'بلا موعد تسليم محدد.'}` };
  },
  'submission.graded': (p, w) => {
    const title = w.text(p.title);
    return w.en
      ? { title: `Assignment graded: ${title}`, body: `The submission for “${title}” was graded: ${p.score} out of ${p.maxScore}.` }
      : { title: `صُحّح واجب: ${title}`, body: `صُحّح تسليم واجب «${title}»: الدرجة ${p.score} من ${p.maxScore}.` };
  },
  'submission.returned': (p, w) => {
    const title = w.text(p.title);
    return w.en
      ? { title: `Assignment returned for rework: ${title}`, body: `The submission for “${title}” was returned for rework; the feedback is in “My assignments”.` }
      : { title: `أُعيد واجب للتعديل: ${title}`, body: `أُعيد تسليم واجب «${title}» للتعديل؛ الملاحظات في «واجباتي».` };
  },
  'exam.scheduled': (p, w) => {
    const title = w.text(p.title);
    const klass = w.text(p.className);
    const at = p.scheduledAt ? w.when(p.scheduledAt, p.timeZone) : null;
    return w.en
      ? { title: `Exam scheduled: ${title}`, body: `The exam “${title}” of class “${klass}” ${at ? `is scheduled for ${at}.` : 'was scheduled; its time will follow.'}` }
      : { title: `اختبار مجدول: ${title}`, body: `اختبار «${title}» في فصل «${klass}» ${at ? `موعده ${at}.` : 'جُدول وسيُعلن موعده لاحقاً.'}` };
  },
  'exam.results_published': (p, w) => {
    const title = w.text(p.title);
    if (w.en) {
      const result = p.result === 'scored' ? `${p.score ?? '—'} out of ${p.maxScore}` : p.result;
      return { title: `Exam result published: ${title}`, body: `Result of the exam “${title}”: ${result}.` };
    }
    const result = p.result === 'scored' ? `${p.score ?? '—'} من ${p.maxScore}` : p.result === 'absent' ? 'غائب' : 'معذور';
    return { title: `نُشرت نتيجة اختبار: ${title}`, body: `نتيجة اختبار «${title}»: ${result}.` };
  },
  'grades.finalized': (p, w) => {
    const klass = w.text(p.className);
    const band = `${w.text(p.bandLabel)}${p.bandLetter ? ` (${p.bandLetter})` : ''}`;
    return w.en
      ? { title: `Final grade: ${klass}`, body: `The final grade of class “${klass}” is ${p.percent}% — ${band}.` }
      : { title: `الدرجة النهائية: ${klass}`, body: `الدرجة النهائية في فصل «${klass}»: ${p.percent}% — ${band}.` };
  },
  'certificate.issued': (p, w) => {
    const course = w.text(p.courseName);
    return w.en
      ? { title: `Certificate issued: ${course}`, body: `A completion certificate for the course “${course}” was issued with the serial ${p.serial}.` }
      : { title: `صدرت شهادة: ${course}`, body: `صدرت شهادة إتمام دورة «${course}» بالرقم التسلسلي ${p.serial}.` };
  },
  'certificate.revoked': (p, w) => {
    const course = w.text(p.courseName);
    return w.en
      ? { title: `Certificate revoked: ${course}`, body: `The certificate ${p.serial} of the course “${course}” was revoked.` }
      : { title: `أُبطلت شهادة: ${course}`, body: `أُبطلت الشهادة ${p.serial} لدورة «${course}».` };
  },
  'invoice.issued': (p, w) => {
    const due = p.firstDueOn ? w.day(p.firstDueOn) : null;
    return w.en
      ? { title: `New invoice: ${p.number}`, body: `Invoice ${p.number} was issued for ${p.total} ${p.currency}${due ? `; the first installment is due on ${due}` : ''}.` }
      : { title: `فاتورة جديدة: ${p.number}`, body: `صدرت الفاتورة ${p.number} بمبلغ ${p.total} ${p.currency}${due ? `؛ أول استحقاق في ${due}` : ''}.` };
  },
  'invoice.cancelled': (p, w) =>
    w.en
      ? { title: `Invoice cancelled: ${p.number}`, body: `Invoice ${p.number} was cancelled.` }
      : { title: `أُلغيت فاتورة: ${p.number}`, body: `أُلغيت الفاتورة ${p.number}.` },
  'payment.recorded': (p, w) =>
    w.en
      ? { title: `Payment recorded: ${p.receiptNumber}`, body: `A payment of ${p.amount} ${p.currency} was recorded on invoice ${p.invoiceNumber}; receipt ${p.receiptNumber}.` }
      : { title: `سُجّلت دفعة: ${p.receiptNumber}`, body: `سُجّلت دفعة بمبلغ ${p.amount} ${p.currency} على الفاتورة ${p.invoiceNumber}؛ رقم الإيصال ${p.receiptNumber}.` },
  'payment.reversed': (p, w) =>
    w.en
      ? { title: `Payment reversed: ${p.receiptNumber}`, body: `The payment with receipt ${p.receiptNumber} on invoice ${p.invoiceNumber} was reversed.` }
      : { title: `عُكست دفعة: ${p.receiptNumber}`, body: `عُكست الدفعة ذات الإيصال ${p.receiptNumber} على الفاتورة ${p.invoiceNumber}.` },
};

/**
 * Title and body of one event for one reader. `locale` is the reader's
 * template language (their own, else the academy's — `templateLocale()`);
 * stored texts fall back through `defaultLocale` to Arabic (D1).
 */
export function renderNotification<K extends NotificationEventKey>(
  key: K,
  params: NotificationEventParams[K],
  locale: TemplateLocale,
  defaultLocale: LocaleCode = 'ar',
): RenderedNotification {
  const wording: Wording = {
    en: locale === 'en',
    text: (value) => pickLocalized(value, locale, defaultLocale),
    when: (date, timeZone) => formatWhen(date, timeZone, locale),
    time: (date, timeZone) => formatTime(date, timeZone, locale),
    day: (day) => formatDay(day, locale),
  };
  return RENDERERS[key](params, wording);
}

/**
 * The sentence a guardian's copy ends with: the child (or children) the
 * notification is about. Empty for a student's own copy.
 */
export function childrenSuffix(names: readonly string[], locale: TemplateLocale): string {
  if (names.length === 0) return '';
  if (locale === 'en') return `${names.length === 1 ? 'Student' : 'Students'}: ${names.join(', ')}.`;
  return `${names.length === 1 ? 'الطالب' : 'الطلاب'}: ${names.join('، ')}.`;
}
