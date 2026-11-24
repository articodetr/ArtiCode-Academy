// Plain-text templates of the account e-mails, in Arabic (reference language),
// English and Turkish (S6-C). Every template is a table with one entry per
// template locale, so a locale without its wording does not compile. The
// locale follows the D1 order (requested locale → academy default → ar).
// Pure functions, unit-tested in mail.service.spec.ts.
import type { LocaleCode } from '../authorization/localized-text.js';

/** Frontend paths the links point to (the pages are MOD-03-T12). */
export const INVITATION_PATH = '/invite';
export const PASSWORD_RESET_PATH = '/reset-password';
/** LR-01-T02: the page that confirms an address (frontend task). */
export const EMAIL_VERIFICATION_PATH = '/verify-email';
/** PORTAL-03 (#207): the page where a self-registered visitor chooses the password. */
export const REGISTRATION_COMPLETE_PATH = '/register/complete';
/** The sign-in page (the notice to an address that already has an account points there). */
export const LOGIN_PATH = '/login';

/** Locales that have templates — every locale of the `locale` enum since S6-C. */
export const TEMPLATE_LOCALES = ['ar', 'en', 'tr'] as const satisfies readonly LocaleCode[];
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

/** One wording per template locale: a missing locale is a compile error. */
export type PerTemplateLocale<T> = Record<TemplateLocale, T>;

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

/** Intl tags of the expiry line (the account e-mails keep plain `ar`; the notifications force Latin digits). */
const EXPIRY_TAGS: PerTemplateLocale<string> = { ar: 'ar', en: 'en-GB', tr: 'tr-TR' };

/**
 * Expiry formatted for the recipient in the academy time zone; falls back to
 * UTC when the stored zone name is not valid for Intl.
 */
export function formatExpiry(date: Date, locale: TemplateLocale, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeStyle: 'short' };
  const tag = EXPIRY_TAGS[locale];
  try {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' }).format(date);
  }
}

const INVITATION: PerTemplateLocale<(input: AccountMailInput) => RenderedMail> = {
  ar: (input) => ({
    subject: `دعوة للانضمام إلى ${input.academyName}`,
    text:
      `مرحباً ${input.recipientName}،\n\n` +
      `أُنشئ لك حساب في ${input.academyName}. ` +
      `لتفعيل حسابك وتعيين كلمة المرور افتح الرابط التالي:\n${input.link}\n\n` +
      `تنتهي صلاحية هذا الرابط في ${input.expiresAt}. ` +
      `إن لم تكن تتوقع هذه الدعوة فتجاهل هذه الرسالة.`,
  }),
  en: (input) => ({
    subject: `Your invitation to ${input.academyName}`,
    text:
      `Hello ${input.recipientName},\n\n` +
      `An account has been created for you at ${input.academyName}. ` +
      `To activate it and choose your password, open this link:\n${input.link}\n\n` +
      `The link expires on ${input.expiresAt}. ` +
      `If you were not expecting this invitation, you can ignore this message.`,
  }),
  tr: (input) => ({
    subject: `${input.academyName} davetiniz`,
    text:
      `Merhaba ${input.recipientName},\n\n` +
      `${input.academyName} bünyesinde sizin için bir hesap oluşturuldu. ` +
      `Hesabınızı etkinleştirmek ve şifrenizi belirlemek için şu bağlantıyı açın:\n${input.link}\n\n` +
      `Bu bağlantı ${input.expiresAt} tarihine kadar geçerlidir. ` +
      `Bu daveti beklemiyorsanız bu e-postayı dikkate almayabilirsiniz.`,
  }),
};

const PASSWORD_RESET: PerTemplateLocale<(input: AccountMailInput) => RenderedMail> = {
  ar: (input) => ({
    subject: `إعادة ضبط كلمة المرور في ${input.academyName}`,
    text:
      `مرحباً ${input.recipientName}،\n\n` +
      `طُلب إعادة ضبط كلمة المرور لحسابك في ${input.academyName}. ` +
      `لتعيين كلمة مرور جديدة افتح الرابط التالي:\n${input.link}\n\n` +
      `تنتهي صلاحية هذا الرابط في ${input.expiresAt}. ` +
      `إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك تبقى كما هي.`,
  }),
  en: (input) => ({
    subject: `Reset your ${input.academyName} password`,
    text:
      `Hello ${input.recipientName},\n\n` +
      `A password reset was requested for your ${input.academyName} account. ` +
      `To choose a new password, open this link:\n${input.link}\n\n` +
      `The link expires on ${input.expiresAt}. ` +
      `If you did not request this, you can ignore this message; your password stays unchanged.`,
  }),
  tr: (input) => ({
    subject: `${input.academyName} şifrenizi sıfırlayın`,
    text:
      `Merhaba ${input.recipientName},\n\n` +
      `${input.academyName} hesabınız için şifre sıfırlama talebinde bulunuldu. ` +
      `Yeni bir şifre belirlemek için şu bağlantıyı açın:\n${input.link}\n\n` +
      `Bu bağlantı ${input.expiresAt} tarihine kadar geçerlidir. ` +
      `Bu talebi siz yapmadıysanız bu e-postayı dikkate almayabilirsiniz; şifreniz değişmeden kalır.`,
  }),
};

const EMAIL_VERIFICATION: PerTemplateLocale<(input: AccountMailInput) => RenderedMail> = {
  ar: (input) => ({
    subject: `تأكيد بريدك الإلكتروني في ${input.academyName}`,
    text:
      `مرحباً ${input.recipientName}،\n\n` +
      `نرجو تأكيد أن هذا البريد الإلكتروني يخص حسابك في ${input.academyName}. ` +
      `للتأكيد افتح الرابط التالي:\n${input.link}\n\n` +
      `تنتهي صلاحية هذا الرابط في ${input.expiresAt}. ` +
      `إن لم يكن لديك حساب لدينا فتجاهل هذه الرسالة.`,
  }),
  en: (input) => ({
    subject: `Confirm your e-mail address at ${input.academyName}`,
    text:
      `Hello ${input.recipientName},\n\n` +
      `Please confirm that this e-mail address belongs to your ${input.academyName} account. ` +
      `To confirm it, open this link:\n${input.link}\n\n` +
      `The link expires on ${input.expiresAt}. ` +
      `If you do not have an account with us, you can ignore this message.`,
  }),
  tr: (input) => ({
    subject: `${input.academyName} için e-posta adresinizi doğrulayın`,
    text:
      `Merhaba ${input.recipientName},\n\n` +
      `Lütfen bu e-posta adresinin ${input.academyName} hesabınıza ait olduğunu doğrulayın. ` +
      `Doğrulamak için şu bağlantıyı açın:\n${input.link}\n\n` +
      `Bu bağlantı ${input.expiresAt} tarihine kadar geçerlidir. ` +
      `Bizde bir hesabınız yoksa bu e-postayı dikkate almayabilirsiniz.`,
  }),
};

export function renderInvitation(locale: TemplateLocale, input: AccountMailInput): RenderedMail {
  return INVITATION[locale](input);
}

export function renderPasswordReset(locale: TemplateLocale, input: AccountMailInput): RenderedMail {
  return PASSWORD_RESET[locale](input);
}

/** LR-01-T02 (D-R78): the only message whose link proves the recipient owns the address. */
export function renderEmailVerification(locale: TemplateLocale, input: AccountMailInput): RenderedMail {
  return EMAIL_VERIFICATION[locale](input);
}

// ------------------------------------------------- PORTAL-03 — self-registration (#207)

/**
 * What a self-registration e-mail may say. Anybody can type any address on the
 * public form, so these messages carry NOTHING the visitor typed — not even the
 * name: only the academy's own name, the link and its expiry.
 */
export interface RegistrationMailInput {
  /** Academy name in the chosen locale. */
  academyName: string;
  /** `<APP_PUBLIC_URL>/register/complete/<token>`. */
  link: string;
  /** Expiry, already formatted for the recipient. */
  expiresAt: string;
}

/** The notice to an address that already has an account: the academy's name and the sign-in link only. */
export interface ExistingAccountMailInput {
  academyName: string;
  /** `<APP_PUBLIC_URL>/login`. */
  link: string;
}

const REGISTRATION: PerTemplateLocale<(input: RegistrationMailInput) => RenderedMail> = {
  ar: (input) => ({
    subject: `أكمل إنشاء حسابك في ${input.academyName}`,
    text:
      `مرحباً،\n\n` +
      `طُلب إنشاء حساب طالب في ${input.academyName} بهذا البريد الإلكتروني. ` +
      `لإكمال إنشاء حسابك واختيار كلمة المرور افتح الرابط التالي:\n${input.link}\n\n` +
      `تنتهي صلاحية هذا الرابط في ${input.expiresAt}. ` +
      `إن لم تطلب إنشاء حساب فتجاهل هذه الرسالة؛ لا يُفعَّل أي حساب دون فتح هذا الرابط.`,
  }),
  en: (input) => ({
    subject: `Complete your ${input.academyName} account`,
    text:
      `Hello,\n\n` +
      `A student account was requested at ${input.academyName} with this e-mail address. ` +
      `To complete it and choose your password, open this link:\n${input.link}\n\n` +
      `The link expires on ${input.expiresAt}. ` +
      `If you did not ask for an account, you can ignore this message; no account is activated without this link.`,
  }),
  tr: (input) => ({
    subject: `${input.academyName} hesabınızı tamamlayın`,
    text:
      `Merhaba,\n\n` +
      `${input.academyName} bünyesinde bu e-posta adresiyle bir öğrenci hesabı talep edildi. ` +
      `Hesabınızı tamamlamak ve şifrenizi belirlemek için şu bağlantıyı açın:\n${input.link}\n\n` +
      `Bu bağlantı ${input.expiresAt} tarihine kadar geçerlidir. ` +
      `Hesap talebinde bulunmadıysanız bu e-postayı dikkate almayabilirsiniz; bu bağlantı açılmadan hiçbir hesap etkinleştirilmez.`,
  }),
};

const EXISTING_ACCOUNT: PerTemplateLocale<(input: ExistingAccountMailInput) => RenderedMail> = {
  ar: (input) => ({
    subject: `لديك حساب بالفعل في ${input.academyName}`,
    text:
      `مرحباً،\n\n` +
      `طُلب إنشاء حساب في ${input.academyName} بهذا البريد الإلكتروني، لكن لديك حساب بالفعل بهذا العنوان؛ ` +
      `فلم يُنشأ حساب جديد ولم يتغير شيء في حسابك. لتسجيل الدخول افتح الرابط التالي:\n${input.link}\n\n` +
      `إن لم تتذكر كلمة المرور فاستخدم «نسيت كلمة المرور» في صفحة الدخول أو تواصل مع الأكاديمية. ` +
      `إن لم تطلب ذلك فتجاهل هذه الرسالة.`,
  }),
  en: (input) => ({
    subject: `You already have an account at ${input.academyName}`,
    text:
      `Hello,\n\n` +
      `Someone asked to create an account at ${input.academyName} with this e-mail address, but an account with this address already exists, ` +
      `so no new account was created and nothing in your account changed. To sign in, open this link:\n${input.link}\n\n` +
      `If you do not remember your password, use "Forgot your password?" on the sign-in page or contact the academy. ` +
      `If you did not ask for this, you can ignore this message.`,
  }),
  tr: (input) => ({
    subject: `${input.academyName} bünyesinde zaten bir hesabınız var`,
    text:
      `Merhaba,\n\n` +
      `${input.academyName} bünyesinde bu e-posta adresiyle bir hesap oluşturulması istendi; ancak bu adresle kayıtlı bir hesap zaten var, ` +
      `bu nedenle yeni bir hesap oluşturulmadı ve hesabınızda hiçbir şey değişmedi. Giriş yapmak için şu bağlantıyı açın:\n${input.link}\n\n` +
      `Şifrenizi hatırlamıyorsanız giriş sayfasındaki "Şifremi unuttum" seçeneğini kullanın veya akademiyle iletişime geçin. ` +
      `Bu talebi siz yapmadıysanız bu e-postayı dikkate almayabilirsiniz.`,
  }),
};

/** PORTAL-03: «أكمل إنشاء حسابك» — opening its link proves the address; the password is chosen there. */
export function renderRegistration(locale: TemplateLocale, input: RegistrationMailInput): RenderedMail {
  return REGISTRATION[locale](input);
}

/** PORTAL-03: «لديك حساب بالفعل» — the address already belongs to an account; nothing changed. */
export function renderExistingAccount(locale: TemplateLocale, input: ExistingAccountMailInput): RenderedMail {
  return EXISTING_ACCOUNT[locale](input);
}

/** MOD-12: the notifications page — where a notification e-mail sends its reader when the notification has no page of its own. */
export const NOTIFICATIONS_PATH = '/notifications';
/** A subject line stays one line and readable in a mailbox list. */
export const NOTIFICATION_SUBJECT_TITLE_MAX = 160;

export interface NotificationMailInput {
  /** Academy name in the chosen locale. */
  academyName: string;
  recipientName: string;
  /** The notification's title — the only event text an e-mail carries (D-R83). */
  title: string;
  /** Absolute or root-relative link to the page that shows the details after sign-in. */
  link: string;
}

/**
 * One line, trimmed and capped: a title typed with line breaks must not break
 * the subject. The cap counts characters (code points), so the cut never
 * leaves half of a surrogate pair behind — an announcement title may be 200
 * emoji long (MOD-12-T05).
 */
export function subjectTitle(title: string): string {
  const characters = [...title.replace(/\s+/g, ' ').trim()];
  if (characters.length <= NOTIFICATION_SUBJECT_TITLE_MAX) return characters.join('');
  return `${characters.slice(0, NOTIFICATION_SUBJECT_TITLE_MAX - 1).join('')}…`;
}

/** `title` is already one line and capped by `subjectTitle()`. */
const NOTIFICATION_MAIL: PerTemplateLocale<(input: NotificationMailInput, title: string) => RenderedMail> = {
  ar: (input, title) => ({
    subject: `لديك إشعار جديد: ${title}`,
    text:
      `مرحباً ${input.recipientName}،\n\n` +
      `لديك إشعار جديد من ${input.academyName}:\n${title}\n\n` +
      `سجّل الدخول وافتح الرابط التالي لقراءة التفاصيل:\n${input.link}\n\n` +
      `تصلك هذه الرسالة لأن إشعارات البريد مفعّلة في حسابك؛ ` +
      `يمكنك إيقافها لكل فئة من صفحة الملف الشخصي.`,
  }),
  en: (input, title) => ({
    subject: `New notification: ${title}`,
    text:
      `Hello ${input.recipientName},\n\n` +
      `You have a new notification from ${input.academyName}:\n${title}\n\n` +
      `Sign in and open this link to read the details:\n${input.link}\n\n` +
      `You receive this message because e-mail notifications are on in your account; ` +
      `you can switch them off per category on your profile page.`,
  }),
  tr: (input, title) => ({
    subject: `Yeni bildirim: ${title}`,
    text:
      `Merhaba ${input.recipientName},\n\n` +
      `${input.academyName} size yeni bir bildirim gönderdi:\n${title}\n\n` +
      `Ayrıntıları okumak için giriş yapın ve şu bağlantıyı açın:\n${input.link}\n\n` +
      `Bu e-postayı, hesabınızda e-posta bildirimleri açık olduğu için alıyorsunuz; ` +
      `bunları profil sayfanızdan her kategori için ayrı ayrı kapatabilirsiniz.`,
  }),
};

/**
 * MOD-12 (D-R83): "you have a new notification" — the title and a link, and
 * nothing else of the event: no score, amount, reason or note ever travels by
 * e-mail; the reader signs in to see them.
 */
export function renderNotificationMail(locale: TemplateLocale, input: NotificationMailInput): RenderedMail {
  return NOTIFICATION_MAIL[locale](input, subjectTitle(input.title));
}
