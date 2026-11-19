// Wording of the twenty automatic notifications (fifteen of MOD-12, four of MOD-19, one of MOD-20) in Arabic (reference
// language), English and Turkish (owner decision D-R83: templates in code,
// rendered in the recipient's language at creation; Turkish since S6-C).
// Every event words itself once per template locale through `w.pick()`, so a
// locale without its wording does not compile. Pure functions, unit-tested in
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
import type { PerTemplateLocale, TemplateLocale } from '../mail/mail.templates.js';
import type { NotificationEventKey, NotificationEventParams } from './notifications.events.js';

export interface RenderedNotification {
  title: string;
  body: string;
}

/** Arabic with Latin digits and the Gregorian calendar, as the frontend formats dates; British English; Turkish. */
const INTL_TAGS: PerTemplateLocale<string> = { ar: 'ar-u-ca-gregory-nu-latn', en: 'en-GB', tr: 'tr-TR' };

function intlTag(locale: TemplateLocale): string {
  return INTL_TAGS[locale];
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
  /** The reader's wording among one per template locale. */
  pick<T>(variants: PerTemplateLocale<T>): T;
  /** A stored `{ ar, en?, tr? }` text in the reader's language (D1 fallback order). */
  text(value: LocalizedText): string;
  when(date: Date, timeZone: string): string;
  time(date: Date, timeZone: string): string;
  day(day: string): string;
}

type Renderer<K extends NotificationEventKey> = (params: NotificationEventParams[K], w: Wording) => RenderedNotification;

/**
 * «N new lessons» in Arabic, where the counted noun follows the number: one
 * and two are worded without a digit, 3–10 take the plural, 11–99 the
 * singular accusative, and above 100 the last two digits decide (100, 101 and
 * 102 the singular genitive).
 */
export function arabicNewLessons(count: number): string {
  if (count === 1) return 'درس جديد';
  if (count === 2) return 'درسان جديدان';
  const rest = count % 100;
  if (count >= 100 && rest <= 2) return `${count} درس جديد`;
  if (rest >= 3 && rest <= 10) return `${count} دروس جديدة`;
  return `${count} درسًا جديدًا`;
}

const RENDERERS: { [K in NotificationEventKey]: Renderer<K> } = {
  'lesson.cancelled': (p, w) => {
    const lesson = w.text(p.lessonTitle);
    const klass = w.text(p.className);
    const when = w.when(p.startsAt, p.timeZone);
    return w.pick({
      ar: { title: `أُلغي درس: ${lesson}`, body: `أُلغي درس «${lesson}» في فصل «${klass}» الذي كان موعده ${when}.` },
      en: { title: `Lesson cancelled: ${lesson}`, body: `The lesson “${lesson}” of class “${klass}”, planned for ${when}, was cancelled.` },
      tr: { title: `Ders iptal edildi: ${lesson}`, body: `“${klass}” sınıfının ${when} için planlanan “${lesson}” dersi iptal edildi.` },
    });
  },
  'lesson.rescheduled': (p, w) => {
    const lesson = w.text(p.lessonTitle);
    const klass = w.text(p.className);
    const when = w.when(p.startsAt, p.timeZone);
    const until = w.time(p.endsAt, p.timeZone);
    const room = p.room ? (p.room.name ? w.text(p.room.name) : p.room.code) : null;
    return w.pick({
      ar: { title: `تغيّر موعد أو قاعة درس: ${lesson}`, body: `درس «${lesson}» في فصل «${klass}» صار موعده ${when} حتى ${until}${room ? `، في ${room}` : ''}.` },
      en: { title: `Lesson changed: ${lesson}`, body: `The lesson “${lesson}” of class “${klass}” is now on ${when}, until ${until}${room ? `, in ${room}` : ''}.` },
      tr: { title: `Ders güncellendi: ${lesson}`, body: `“${klass}” sınıfının “${lesson}” dersinin yeni zamanı: ${when}, bitiş: ${until}${room ? `, derslik: ${room}` : ''}.` },
    });
  },
  'attendance.absent': (p, w) => {
    const lesson = w.text(p.lessonTitle);
    const klass = w.text(p.className);
    const when = w.when(p.startsAt, p.timeZone);
    return w.pick({
      ar: { title: `سُجّل غياب عن درس: ${lesson}`, body: `سُجّل غياب عن درس «${lesson}» في فصل «${klass}» بتاريخ ${when}.` },
      en: { title: `Absence recorded: ${lesson}`, body: `An absence was recorded for the lesson “${lesson}” of class “${klass}” on ${when}.` },
      tr: { title: `Devamsızlık kaydedildi: ${lesson}`, body: `“${klass}” sınıfının ${when} tarihli “${lesson}” dersi için devamsızlık kaydedildi.` },
    });
  },
  'assignment.published': (p, w) => {
    const title = w.text(p.title);
    const klass = w.text(p.className);
    const due = p.dueAt ? w.when(p.dueAt, p.timeZone) : null;
    return w.pick({
      ar: { title: `واجب جديد: ${title}`, body: `نُشر واجب «${title}» في فصل «${klass}». ${due ? `آخر موعد للتسليم ${due}.` : 'بلا موعد تسليم محدد.'}` },
      en: { title: `New assignment: ${title}`, body: `The assignment “${title}” was published in class “${klass}”. ${due ? `It is due on ${due}.` : 'It has no due date.'}` },
      tr: { title: `Yeni ödev: ${title}`, body: `“${klass}” sınıfında “${title}” ödevi yayımlandı. ${due ? `Son teslim tarihi: ${due}.` : 'Son teslim tarihi belirlenmedi.'}` },
    });
  },
  'submission.graded': (p, w) => {
    const title = w.text(p.title);
    return w.pick({
      ar: { title: `صُحّح واجب: ${title}`, body: `صُحّح تسليم واجب «${title}»: الدرجة ${p.score} من ${p.maxScore}.` },
      en: { title: `Assignment graded: ${title}`, body: `The submission for “${title}” was graded: ${p.score} out of ${p.maxScore}.` },
      tr: { title: `Ödev notlandırıldı: ${title}`, body: `“${title}” ödevinin teslimi notlandırıldı: ${p.maxScore} üzerinden ${p.score}.` },
    });
  },
  'submission.returned': (p, w) => {
    const title = w.text(p.title);
    return w.pick({
      ar: { title: `أُعيد واجب للتعديل: ${title}`, body: `أُعيد تسليم واجب «${title}» للتعديل؛ الملاحظات في «واجباتي».` },
      en: { title: `Assignment returned for rework: ${title}`, body: `The submission for “${title}” was returned for rework; the feedback is in “My assignments”.` },
      tr: { title: `Ödev düzeltme için geri gönderildi: ${title}`, body: `“${title}” ödevinin teslimi düzeltme için geri gönderildi; geri bildirim “Ödevlerim” sayfasında.` },
    });
  },
  'exam.scheduled': (p, w) => {
    const title = w.text(p.title);
    const klass = w.text(p.className);
    const at = p.scheduledAt ? w.when(p.scheduledAt, p.timeZone) : null;
    return w.pick({
      ar: { title: `اختبار مجدول: ${title}`, body: `اختبار «${title}» في فصل «${klass}» ${at ? `موعده ${at}.` : 'جُدول وسيُعلن موعده لاحقاً.'}` },
      en: { title: `Exam scheduled: ${title}`, body: `The exam “${title}” of class “${klass}” ${at ? `is scheduled for ${at}.` : 'was scheduled; its time will follow.'}` },
      tr: { title: `Sınav planlandı: ${title}`, body: `“${klass}” sınıfının “${title}” sınavı ${at ? `${at} için planlandı.` : 'planlandı; saati daha sonra bildirilecek.'}` },
    });
  },
  'exam.results_published': (p, w) => {
    const title = w.text(p.title);
    const score = p.score ?? '—';
    const scored = p.result === 'scored';
    const absent = p.result === 'absent';
    return w.pick({
      ar: { title: `نُشرت نتيجة اختبار: ${title}`, body: `نتيجة اختبار «${title}»: ${scored ? `${score} من ${p.maxScore}` : absent ? 'غائب' : 'معذور'}.` },
      en: { title: `Exam result published: ${title}`, body: `Result of the exam “${title}”: ${scored ? `${score} out of ${p.maxScore}` : p.result}.` },
      tr: { title: `Sınav sonucu yayımlandı: ${title}`, body: `“${title}” sınavının sonucu: ${scored ? `${p.maxScore} üzerinden ${score}` : absent ? 'sınava girmedi' : 'mazeretli'}.` },
    });
  },
  'grades.finalized': (p, w) => {
    const klass = w.text(p.className);
    const band = `${w.text(p.bandLabel)}${p.bandLetter ? ` (${p.bandLetter})` : ''}`;
    return w.pick({
      ar: { title: `الدرجة النهائية: ${klass}`, body: `الدرجة النهائية في فصل «${klass}»: ${p.percent}% — ${band}.` },
      en: { title: `Final grade: ${klass}`, body: `The final grade of class “${klass}” is ${p.percent}% — ${band}.` },
      // Turkish writes the percent sign before the number.
      tr: { title: `Nihai not: ${klass}`, body: `“${klass}” sınıfının nihai notu: %${p.percent} — ${band}.` },
    });
  },
  'certificate.issued': (p, w) => {
    const course = w.text(p.courseName);
    return w.pick({
      ar: { title: `صدرت شهادة: ${course}`, body: `صدرت شهادة إتمام دورة «${course}» بالرقم التسلسلي ${p.serial}.` },
      en: { title: `Certificate issued: ${course}`, body: `A completion certificate for the course “${course}” was issued with the serial ${p.serial}.` },
      tr: { title: `Sertifika düzenlendi: ${course}`, body: `“${course}” kursunun bitirme sertifikası ${p.serial} seri numarasıyla düzenlendi.` },
    });
  },
  'certificate.revoked': (p, w) => {
    const course = w.text(p.courseName);
    return w.pick({
      ar: { title: `أُبطلت شهادة: ${course}`, body: `أُبطلت الشهادة ${p.serial} لدورة «${course}».` },
      en: { title: `Certificate revoked: ${course}`, body: `The certificate ${p.serial} of the course “${course}” was revoked.` },
      tr: { title: `Sertifika iptal edildi: ${course}`, body: `“${course}” kursuna ait ${p.serial} seri numaralı sertifika iptal edildi.` },
    });
  },
  'invoice.issued': (p, w) => {
    const due = p.firstDueOn ? w.day(p.firstDueOn) : null;
    return w.pick({
      ar: { title: `فاتورة جديدة: ${p.number}`, body: `صدرت الفاتورة ${p.number} بمبلغ ${p.total} ${p.currency}${due ? `؛ أول استحقاق في ${due}` : ''}.` },
      en: { title: `New invoice: ${p.number}`, body: `Invoice ${p.number} was issued for ${p.total} ${p.currency}${due ? `; the first installment is due on ${due}` : ''}.` },
      tr: { title: `Yeni fatura: ${p.number}`, body: `${p.number} numaralı fatura ${p.total} ${p.currency} tutarında düzenlendi${due ? `; ilk taksidin son ödeme tarihi ${due}` : ''}.` },
    });
  },
  'invoice.cancelled': (p, w) =>
    w.pick({
      ar: { title: `أُلغيت فاتورة: ${p.number}`, body: `أُلغيت الفاتورة ${p.number}.` },
      en: { title: `Invoice cancelled: ${p.number}`, body: `Invoice ${p.number} was cancelled.` },
      tr: { title: `Fatura iptal edildi: ${p.number}`, body: `${p.number} numaralı fatura iptal edildi.` },
    }),
  'payment.recorded': (p, w) =>
    w.pick({
      ar: { title: `سُجّلت دفعة: ${p.receiptNumber}`, body: `سُجّلت دفعة بمبلغ ${p.amount} ${p.currency} على الفاتورة ${p.invoiceNumber}؛ رقم الإيصال ${p.receiptNumber}.` },
      en: { title: `Payment recorded: ${p.receiptNumber}`, body: `A payment of ${p.amount} ${p.currency} was recorded on invoice ${p.invoiceNumber}; receipt ${p.receiptNumber}.` },
      tr: { title: `Ödeme kaydedildi: ${p.receiptNumber}`, body: `${p.invoiceNumber} numaralı faturaya ${p.amount} ${p.currency} tutarında bir ödeme kaydedildi; makbuz numarası ${p.receiptNumber}.` },
    }),
  'payment.reversed': (p, w) =>
    w.pick({
      ar: { title: `عُكست دفعة: ${p.receiptNumber}`, body: `عُكست الدفعة ذات الإيصال ${p.receiptNumber} على الفاتورة ${p.invoiceNumber}.` },
      en: { title: `Payment reversed: ${p.receiptNumber}`, body: `The payment with receipt ${p.receiptNumber} on invoice ${p.invoiceNumber} was reversed.` },
      tr: { title: `Ödeme geri alındı: ${p.receiptNumber}`, body: `${p.invoiceNumber} numaralı faturadaki ${p.receiptNumber} makbuz numaralı ödeme geri alındı.` },
    }),
  // MOD-19 (D-R128): the enrollment events. The request's title names the
  // course only — the amount is in the body; the rejection never words its
  // reason (the parameters do not carry it).
  'enrollment.requested': (p, w) => {
    const course = w.text(p.courseName);
    const klass = w.text(p.className);
    const due = p.firstDueOn ? w.day(p.firstDueOn) : null;
    return w.pick({
      ar: {
        title: `طلب اشتراك: ${course}`,
        body: `استُلم طلب اشتراكك في دورة «${course}» — فصل «${klass}». صدرت الفاتورة ${p.number} بمبلغ ${p.total} ${p.currency}${due ? `؛ أول استحقاق في ${due}` : ''}. يُفعَّل الاشتراك بعد تأكيد الدفع وموافقة الإدارة.`,
      },
      en: {
        title: `Enrollment request: ${course}`,
        body: `Your request to join the course “${course}” — class “${klass}” — was received. Invoice ${p.number} was issued for ${p.total} ${p.currency}${due ? `; the first installment is due on ${due}` : ''}. The enrollment becomes active once the payment is confirmed and the academy approves it.`,
      },
      tr: {
        title: `Kayıt talebi: ${course}`,
        body: `“${course}” kursunun “${klass}” sınıfı için kayıt talebiniz alındı. ${p.number} numaralı fatura ${p.total} ${p.currency} tutarında düzenlendi${due ? `; ilk taksidin son ödeme tarihi ${due}` : ''}. Kayıt, ödeme onaylanıp akademi talebi kabul ettiğinde etkinleşir.`,
      },
    });
  },
  'enrollment.request_received': (p, w) => {
    const course = w.text(p.courseName);
    const klass = w.text(p.className);
    return w.pick({
      ar: { title: `طلب اشتراك جديد: ${course}`, body: `طلب ${p.studentName} الاشتراك في دورة «${course}» — فصل «${klass}». يُراجع الطلب في صفحة طلبات الاشتراك.` },
      en: { title: `New enrollment request: ${course}`, body: `${p.studentName} asked to join the course “${course}” — class “${klass}”. Review it on the enrollment requests page.` },
      tr: { title: `Yeni kayıt talebi: ${course}`, body: `${p.studentName}, “${course}” kursunun “${klass}” sınıfına katılmak istedi. Talebi kayıt talepleri sayfasında inceleyin.` },
    });
  },
  'enrollment.activated': (p, w) => {
    const course = w.text(p.courseName);
    const klass = w.text(p.className);
    return w.pick({
      ar: { title: `تفعّل الاشتراك: ${course}`, body: `صار اشتراكك في دورة «${course}» — فصل «${klass}» — مفعّلاً، فتظهر دروسه وواجباته واختباراته في صفحاتك.` },
      en: { title: `Enrollment active: ${course}`, body: `Your enrollment in the course “${course}” — class “${klass}” — is active; its lessons, assignments and exams now show on your pages.` },
      tr: { title: `Kayıt etkin: ${course}`, body: `“${course}” kursunun “${klass}” sınıfındaki kaydınız etkinleşti; dersleri, ödevleri ve sınavları artık sayfalarınızda görünür.` },
    });
  },
  'enrollment.rejected': (p, w) => {
    const course = w.text(p.courseName);
    const klass = w.text(p.className);
    return w.pick({
      ar: { title: `رُفض طلب اشتراك: ${course}`, body: `رُفض طلب اشتراكك في دورة «${course}» — فصل «${klass}». سبب الرفض في صفحة «دوراتي».` },
      en: { title: `Enrollment request declined: ${course}`, body: `Your request to join the course “${course}” — class “${klass}” — was declined. The reason is on your “My courses” page.` },
      tr: { title: `Kayıt talebi reddedildi: ${course}`, body: `“${course}” kursunun “${klass}” sınıfı için kayıt talebiniz reddedildi. Gerekçe “Kurslarım” sayfanızda.` },
    });
  },
  // MOD-20 LRN-T06 (D-R146): lessons newly published in a course. The title
  // names the course; the body says how many and where to find them.
  'curriculum.lessons_published': (p, w) => {
    const course = w.text(p.courseName);
    const one = p.count === 1;
    return w.pick({
      ar: {
        title: one ? `درس جديد في ${course}` : `دروس جديدة في ${course}`,
        body: `نُشر في دورة «${course}» ${arabicNewLessons(p.count)}. افتح «مدرستي» لمتابعة التعلّم.`,
      },
      en: {
        title: one ? `New lesson in ${course}` : `New lessons in ${course}`,
        body: `${one ? 'A new lesson was' : `${p.count} new lessons were`} published in the course “${course}”. Open “My School” to continue learning.`,
      },
      tr: {
        title: one ? `Yeni ders: ${course}` : `Yeni dersler: ${course}`,
        body: `“${course}” kursunda ${one ? 'yeni bir ders' : `${p.count} yeni ders`} yayımlandı. Öğrenmeye devam etmek için “Okulum” sayfasını açın.`,
      },
    });
  },
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
    pick: (variants) => variants[locale],
    text: (value) => pickLocalized(value, locale, defaultLocale),
    when: (date, timeZone) => formatWhen(date, timeZone, locale),
    time: (date, timeZone) => formatTime(date, timeZone, locale),
    day: (day) => formatDay(day, locale),
  };
  return RENDERERS[key](params, wording);
}

/** The word for the child (or children) a guardian's copy names, and the separator of several names. */
const CHILDREN_WORDING: PerTemplateLocale<{ one: string; many: string; separator: string }> = {
  ar: { one: 'الطالب', many: 'الطلاب', separator: '، ' },
  en: { one: 'Student', many: 'Students', separator: ', ' },
  tr: { one: 'Öğrenci', many: 'Öğrenciler', separator: ', ' },
};

/**
 * The sentence a guardian's copy ends with: the child (or children) the
 * notification is about. Empty for a student's own copy.
 */
export function childrenSuffix(names: readonly string[], locale: TemplateLocale): string {
  if (names.length === 0) return '';
  const wording = CHILDREN_WORDING[locale];
  return `${names.length === 1 ? wording.one : wording.many}: ${names.join(wording.separator)}.`;
}
