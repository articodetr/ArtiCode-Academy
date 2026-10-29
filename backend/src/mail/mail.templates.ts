// Plain-text templates of the account e-mails, in Arabic (reference language)
// and English. `tr` has no template yet and falls back per the D1 order
// (requested locale → academy default → ar). Pure functions, unit-tested in
// mail.service.spec.ts.
import type { LocaleCode } from '../authorization/localized-text.js';

/** Frontend paths the links point to (the pages are MOD-03-T12). */
export const INVITATION_PATH = '/invite';
export const PASSWORD_RESET_PATH = '/reset-password';

/** Locales that have templates. */
export const TEMPLATE_LOCALES = ['ar', 'en'] as const satisfies readonly LocaleCode[];
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

export interface RenderedMail {
  subject: string;
  text: string;
}

export interface AccountMailInput {
  /** Academy name in the chosen locale. */
  academyName: string;
  recipientName: string;
  /** Absolute or root-relative link the recipient opens. */
  link: string;
  /** Expiry, already formatted for the recipient. */
  expiresAt: string;
}

function isTemplateLocale(value: LocaleCode): value is TemplateLocale {
  return (TEMPLATE_LOCALES as readonly string[]).includes(value);
}

/** The template locale for a recipient: own locale, else the academy default, else `ar`. */
export function templateLocale(locale: LocaleCode | null | undefined, defaultLocale: LocaleCode): TemplateLocale {
  if (locale && isTemplateLocale(locale)) return locale;
  if (isTemplateLocale(defaultLocale)) return defaultLocale;
  return 'ar';
}

/**
 * Expiry formatted for the recipient in the academy time zone; falls back to
 * UTC when the stored zone name is not valid for Intl.
 */
export function formatExpiry(date: Date, locale: TemplateLocale, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeStyle: 'short' };
  const tag = locale === 'ar' ? 'ar' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' }).format(date);
  }
}

export function renderInvitation(locale: TemplateLocale, input: AccountMailInput): RenderedMail {
  if (locale === 'en') {
    return {
      subject: `Your invitation to ${input.academyName}`,
      text:
        `Hello ${input.recipientName},\n\n` +
        `An account has been created for you at ${input.academyName}. ` +
        `To activate it and choose your password, open this link:\n${input.link}\n\n` +
        `The link expires on ${input.expiresAt}. ` +
        `If you were not expecting this invitation, you can ignore this message.`,
    };
  }
  return {
    subject: `دعوة للانضمام إلى ${input.academyName}`,
    text:
      `مرحباً ${input.recipientName}،\n\n` +
      `أُنشئ لك حساب في ${input.academyName}. ` +
      `لتفعيل حسابك وتعيين كلمة المرور افتح الرابط التالي:\n${input.link}\n\n` +
      `تنتهي صلاحية هذا الرابط في ${input.expiresAt}. ` +
      `إن لم تكن تتوقع هذه الدعوة فتجاهل هذه الرسالة.`,
  };
}

export function renderPasswordReset(locale: TemplateLocale, input: AccountMailInput): RenderedMail {
  if (locale === 'en') {
    return {
      subject: `Reset your ${input.academyName} password`,
      text:
        `Hello ${input.recipientName},\n\n` +
        `A password reset was requested for your ${input.academyName} account. ` +
        `To choose a new password, open this link:\n${input.link}\n\n` +
        `The link expires on ${input.expiresAt}. ` +
        `If you did not request this, you can ignore this message; your password stays unchanged.`,
    };
  }
  return {
    subject: `إعادة ضبط كلمة المرور في ${input.academyName}`,
    text:
      `مرحباً ${input.recipientName}،\n\n` +
      `طُلب إعادة ضبط كلمة المرور لحسابك في ${input.academyName}. ` +
      `لتعيين كلمة مرور جديدة افتح الرابط التالي:\n${input.link}\n\n` +
      `تنتهي صلاحية هذا الرابط في ${input.expiresAt}. ` +
      `إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك تبقى كما هي.`,
  };
}
