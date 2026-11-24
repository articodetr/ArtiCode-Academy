// TEST-017 — MailService, the two built-in transports and the templates (and,
// since TEST-175, the notification e-mail of MOD-12; since TEST-215, the
// Turkish templates of S6-C), with
// no network and no database (stubs for the transport, Prisma and ConfigService).
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import type { AuditEntry, AuditService } from '../audit/audit.service.js';
import { LOCALES } from '../authorization/localized-text.js';
import type { Env } from '../config/env.schema.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { LogMailTransport } from './log.transport.js';
import { MailService } from './mail.service.js';
import {
  TEMPLATE_LOCALES,
  formatExpiry,
  renderEmailVerification,
  renderExistingAccount,
  renderInvitation,
  renderNotificationMail,
  renderPasswordReset,
  renderRegistration,
  subjectTitle,
  templateLocale,
} from './mail.templates.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from './mail.transport.js';
import { NoopMailTransport } from './noop.transport.js';

const TOKEN = 'a'.repeat(43);
const EXPIRES = new Date('2026-11-01T10:00:00.000Z');
const ACADEMY = { name: { ar: 'أكاديمية آرتي', en: 'Arti Academy' }, defaultLocale: 'ar' as const, timezone: 'Europe/Istanbul' };

class CapturingTransport implements MailTransport {
  readonly name = 'fake';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `m-${this.sent.length}` };
  }
}

function configWith(publicUrl?: string): ConfigService<Env, true> {
  return { get: (key: string) => (key === 'APP_PUBLIC_URL' ? publicUrl : undefined) } as unknown as ConfigService<Env, true>;
}

/** An AuditService stub that keeps what it was asked to record (TEST-172). */
function recordingAudit(fail = false): AuditService & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    record: async (entry: AuditEntry) => {
      if (fail) throw new Error('audit down');
      entries.push(entry);
    },
  } as unknown as AuditService & { entries: AuditEntry[] };
}

function prismaWith(academy: typeof ACADEMY | null): PrismaService {
  return { db: { academy: { findFirst: async () => academy } } } as unknown as PrismaService;
}

const USER_ID = '01900000-0000-7000-8000-000000000001';

const mailTo = (to: string | null, locale: 'ar' | 'en' | 'tr' | null, recipientName = 'Sara') => ({
  userId: USER_ID,
  to,
  recipientName,
  locale,
  token: TOKEN,
  expiresAt: EXPIRES,
});

describe('MailService (TEST-017)', () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the invitation in the recipient locale with the absolute link and hands it to the transport', async () => {
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), recordingAudit());

    const result = await service.sendInvitation(mailTo('sara@example.test', 'en'));

    expect(result).toEqual({ transport: 'fake', status: 'sent', messageId: 'm-1' });
    expect(transport.sent).toHaveLength(1);
    const message = transport.sent[0]!;
    expect(message).toMatchObject({ kind: 'invitation', to: 'sara@example.test', locale: 'en' });
    expect(message.subject).toBe('Your invitation to Arti Academy');
    expect(message.text).toContain('Hello Sara,');
    expect(message.text).toContain(`https://academy.example/invite/${TOKEN}`);
    expect(service.invitationLink(TOKEN)).toBe(`https://academy.example/invite/${TOKEN}`);
    expect(service.transportName).toBe('fake');
  });

  it('falls back to the academy default locale and builds root-relative links without APP_PUBLIC_URL', async () => {
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith(undefined), recordingAudit());

    await service.sendInvitation(mailTo('x@example.test', null, 'سارة'));

    expect(transport.sent.map((message) => message.locale)).toEqual(['ar']);
    expect(transport.sent[0]!.subject).toBe('دعوة للانضمام إلى أكاديمية آرتي');
    expect(transport.sent[0]!.text).toContain('مرحباً سارة،');
    expect(transport.sent[0]!.text).toContain(`/invite/${TOKEN}`);
    expect(transport.sent[0]!.text).not.toContain('https://');
    expect(service.invitationLink(TOKEN)).toBe(`/invite/${TOKEN}`);
    expect(service.passwordResetLink(TOKEN)).toBe(`/reset-password/${TOKEN}`);

    const english = new CapturingTransport();
    await new MailService(english, prismaWith({ ...ACADEMY, defaultLocale: 'en' as never }), configWith(), recordingAudit()).sendPasswordReset(
      mailTo('x@example.test', null),
    );
    expect(english.sent[0]).toMatchObject({ kind: 'password_reset', locale: 'en', subject: 'Reset your Arti Academy password' });
    expect(english.sent[0]!.text).toContain(`/reset-password/${TOKEN}`);
  });

  // TEST-215 — S6-C: Turkish templates.
  it('writes to a Turkish recipient, and to a recipient without a locale in a Turkish academy, in Turkish; ar/en recipients are unchanged', async () => {
    const turkishAcademy = { name: { ar: 'أكاديمية آرتي', en: 'Arti Academy', tr: 'Arti Akademi' }, defaultLocale: 'tr' as const, timezone: 'Europe/Istanbul' };
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), recordingAudit());
    await service.sendInvitation(mailTo('x@example.test', 'tr'));
    await service.sendInvitation(mailTo('x@example.test', 'ar', 'سارة'));
    await service.sendInvitation(mailTo('x@example.test', 'en'));
    expect(transport.sent.map((message) => message.locale)).toEqual(['tr', 'ar', 'en']);
    // The academy has no Turkish name: the academy default (Arabic) stands in, per D1.
    expect(transport.sent[0]!.subject).toBe('أكاديمية آرتي davetiniz');
    expect(transport.sent[0]!.text).toContain('Merhaba Sara,');
    expect(transport.sent[0]!.text).toContain(`https://academy.example/invite/${TOKEN}`);
    expect(transport.sent[0]!.text).toContain(`Bu bağlantı ${formatExpiry(EXPIRES, 'tr', 'Europe/Istanbul')} tarihine kadar geçerlidir.`);
    expect(transport.sent[1]!.subject).toBe('دعوة للانضمام إلى أكاديمية آرتي');
    expect(transport.sent[2]!.subject).toBe('Your invitation to Arti Academy');

    const turkish = new CapturingTransport();
    const inTurkey = new MailService(turkish, prismaWith(turkishAcademy as never), configWith('https://academy.example'), recordingAudit());
    await inTurkey.sendPasswordReset(mailTo('x@example.test', null));
    await inTurkey.sendEmailVerification(mailTo('x@example.test', null));
    await inTurkey.sendNotification({ to: 'x@example.test', recipientName: 'Ayşe', locale: null, title: 'Ödev notlandırıldı: Deneme', path: '/my-assignments' });
    await inTurkey.sendInvitation(mailTo('x@example.test', 'en'));
    expect(turkish.sent.map((message) => [message.kind, message.locale])).toEqual([
      ['password_reset', 'tr'],
      ['email_verification', 'tr'],
      ['notification', 'tr'],
      ['invitation', 'en'],
    ]);
    expect(turkish.sent[0]!.subject).toBe('Arti Akademi şifrenizi sıfırlayın');
    expect(turkish.sent[0]!.text).toContain(`https://academy.example/reset-password/${TOKEN}`);
    expect(turkish.sent[1]!.subject).toBe('Arti Akademi için e-posta adresinizi doğrulayın');
    expect(turkish.sent[1]!.text).toContain(`https://academy.example/verify-email/${TOKEN}`);
    expect(turkish.sent[2]!.subject).toBe('Yeni bildirim: Ödev notlandırıldı: Deneme');
    expect(turkish.sent[2]!.text).toContain('Merhaba Ayşe,');
    expect(turkish.sent[2]!.text).toContain('Arti Akademi size yeni bir bildirim gönderdi:\nÖdev notlandırıldı: Deneme');
    expect(turkish.sent[2]!.text).toContain('https://academy.example/my-assignments');
    expect(turkish.sent[3]!.subject).toBe('Your invitation to Arti Academy');
    for (const message of turkish.sent.slice(0, 3)) {
      // The HTML twin of a Turkish e-mail reads left to right and says it is Turkish.
      expect(message.html).toMatch(/^<!doctype html><html lang="tr" dir="ltr">/);
      expect(message.html).toContain('text-align:left');
      expect(message.html).not.toContain('dir="rtl"');
      for (const part of [message.subject, message.text, message.html]) expect(part).not.toMatch(/undefined|null|\[object |NaN|\$\{/);
      expect(`${message.subject} ${message.text}`).not.toMatch(/[؀-ۿ]/);
    }
  });

  it('skips accounts without an e-mail address and survives a failing transport or a missing academy row', async () => {
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith(), recordingAudit());

    expect(await service.sendInvitation(mailTo(null, 'ar'))).toEqual({ transport: 'fake', status: 'skipped', messageId: null });
    expect(transport.sent).toEqual([]);

    const failing: MailTransport = {
      name: 'broken',
      send: async () => {
        throw new Error('provider down');
      },
    };
    const result = await new MailService(failing, prismaWith(null), configWith(), recordingAudit()).sendInvitation(mailTo('x@example.test', 'ar'));
    expect(result).toEqual({ transport: 'broken', status: 'failed', messageId: null, failure: { reason: 'error' } });
  });

  it('the none transport logs only the kind; the log transport logs the whole message (development only)', async () => {
    const message: MailMessage = {
      kind: 'invitation',
      to: 'sara@example.test',
      locale: 'ar',
      subject: 'Subject line',
      text: `open /invite/${TOKEN}`,
      html: `<p>open /invite/${TOKEN}</p>`,
    };

    expect(await new NoopMailTransport().send(message)).toEqual({ transport: 'none', status: 'skipped', messageId: null });
    const noopLines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(noopLines).toHaveLength(1);
    expect(noopLines[0]).toContain('kind=invitation');
    expect(noopLines[0]).not.toMatch(/sara|Subject line|invite|aaaa/);

    logSpy.mockClear();
    expect(await new LogMailTransport().send(message)).toEqual({ transport: 'log', status: 'logged', messageId: null });
    expect(String(logSpy.mock.calls[0]![0])).toContain(`/invite/${TOKEN}`);
    expect(String(logSpy.mock.calls[0]![0])).toContain('sara@example.test');
  });

  it('templates exist in every locale with every placeholder, locale fallback follows D1, expiry formatting tolerates a bad zone', () => {
    expect(templateLocale('en', 'ar')).toBe('en');
    expect(templateLocale('ar', 'en')).toBe('ar');
    expect(templateLocale(null, 'ar')).toBe('ar');
    expect(templateLocale(undefined, 'en')).toBe('en');
    // TEST-215 — S6-C: Turkish has its own templates — for a Turkish reader and as an academy default.
    expect(templateLocale('tr', 'en')).toBe('tr');
    expect(templateLocale('tr', 'ar')).toBe('tr');
    expect(templateLocale(null, 'tr')).toBe('tr');
    expect(templateLocale(undefined, 'tr')).toBe('tr');
    expect(templateLocale('ar', 'tr')).toBe('ar');
    expect(templateLocale('en', 'tr')).toBe('en');
    // Every locale of the enum has templates: a new locale without them fails here.
    expect([...TEMPLATE_LOCALES].sort()).toEqual([...LOCALES].sort());

    const input = { academyName: 'ACADEMY', recipientName: 'RECIPIENT', link: 'https://l.example/x', expiresAt: 'EXPIRY' };
    const renderers = { invitation: renderInvitation, password_reset: renderPasswordReset, email_verification: renderEmailVerification };
    for (const [kind, render] of Object.entries(renderers)) {
      const subjects = new Set<string>();
      for (const locale of TEMPLATE_LOCALES) {
        const { subject, text } = render(locale, input);
        expect(subject, `${kind} (${locale})`).toContain('ACADEMY');
        expect(text, `${kind} (${locale})`).toContain('RECIPIENT');
        expect(text, `${kind} (${locale})`).toContain('https://l.example/x');
        expect(text, `${kind} (${locale})`).toContain('EXPIRY');
        expect(`${subject}\n${text}`, `${kind} (${locale})`).not.toMatch(/undefined|null|\[object |NaN|\$\{/);
        subjects.add(subject);
      }
      // Each locale has its own wording, not a copy of another.
      expect(subjects.size, kind).toBe(TEMPLATE_LOCALES.length);
    }
    const notification = { academyName: 'ACADEMY', recipientName: 'RECIPIENT', title: 'TITLE', link: 'https://l.example/n' };
    for (const locale of TEMPLATE_LOCALES) {
      const { subject, text } = renderNotificationMail(locale, notification);
      expect(subject, locale).toContain('TITLE');
      for (const value of ['ACADEMY', 'RECIPIENT', 'TITLE', 'https://l.example/n']) expect(text, locale).toContain(value);
      expect(`${subject}\n${text}`, locale).not.toMatch(/undefined|null|\[object |NaN|\$\{/);
    }

    // Turkish, word for word: the invitation and the notification e-mail.
    expect(renderInvitation('tr', input)).toEqual({
      subject: 'ACADEMY davetiniz',
      text:
        'Merhaba RECIPIENT,\n\n' +
        'ACADEMY bünyesinde sizin için bir hesap oluşturuldu. ' +
        'Hesabınızı etkinleştirmek ve şifrenizi belirlemek için şu bağlantıyı açın:\nhttps://l.example/x\n\n' +
        'Bu bağlantı EXPIRY tarihine kadar geçerlidir. ' +
        'Bu daveti beklemiyorsanız bu e-postayı dikkate almayabilirsiniz.',
    });
    expect(renderNotificationMail('tr', notification).subject).toBe('Yeni bildirim: TITLE');
    // The subject title is still one line and capped at 160 characters in Turkish.
    const long = renderNotificationMail('tr', { ...notification, title: `İlk satır\n${'ş'.repeat(400)}` }).subject;
    expect(long).toBe(`Yeni bildirim: ${subjectTitle(`İlk satır ${'ş'.repeat(400)}`)}`);
    expect([...long].length).toBe('Yeni bildirim: '.length + 160);
    expect(long.endsWith('…')).toBe(true);

    expect(formatExpiry(EXPIRES, 'en', 'Europe/Istanbul')).toContain('2026');
    expect(formatExpiry(EXPIRES, 'ar', 'Europe/Istanbul')).not.toBe('');
    expect(formatExpiry(EXPIRES, 'en', 'Not/AZone')).toBe(formatExpiry(EXPIRES, 'en', 'UTC'));
    // Turkish (tr-TR) in the academy zone: 10:00 UTC is 13:00 in Istanbul.
    expect(formatExpiry(EXPIRES, 'tr', 'Europe/Istanbul')).toContain('1 Kasım 2026');
    expect(formatExpiry(EXPIRES, 'tr', 'Europe/Istanbul')).toContain('13:00');
    expect(formatExpiry(EXPIRES, 'tr', 'Not/AZone')).toBe(formatExpiry(EXPIRES, 'tr', 'UTC'));
    expect(formatExpiry(EXPIRES, 'tr', 'UTC')).toContain('10:00');
  });

  // TEST-172 — LR-01-T01: the HTML twin and the delivery events (D-R76/D-R77).
  it('hands the transport an HTML twin in the reading direction of the locale', async () => {
    const transport = new CapturingTransport();
    await new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), recordingAudit()).sendInvitation(
      mailTo('sara@example.test', 'ar'),
    );
    const { html } = transport.sent[0]!;
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain(`<a href="https://academy.example/invite/${TOKEN}" dir="ltr"`);
    expect(html).toContain('مرحباً Sara،');
  });

  it('records mail.delivery.sent / failed with the kind and the id or the failure code only; none and log record nothing', async () => {
    const audit = recordingAudit();
    await new MailService(new CapturingTransport(), prismaWith(ACADEMY), configWith('https://academy.example'), audit).sendPasswordReset(
      mailTo('sara@example.test', 'en'),
    );
    const refusing: MailTransport = {
      name: 'resend',
      send: async () => ({
        transport: 'resend',
        status: 'failed',
        messageId: null,
        failure: { reason: 'http', httpStatus: 403, providerCode: 'validation_error' },
      }),
    };
    await new MailService(refusing, prismaWith(ACADEMY), configWith('https://academy.example'), audit).sendInvitation(
      mailTo('sara@example.test', 'ar'),
    );
    const throwing: MailTransport = { name: 'resend', send: async () => Promise.reject(new Error('boom')) };
    await new MailService(throwing, prismaWith(ACADEMY), configWith(), audit).sendInvitation(mailTo('sara@example.test', 'ar'));

    expect(audit.entries).toEqual([
      {
        action: 'mail.delivery.sent',
        actorUserId: null,
        entityType: 'users',
        entityId: USER_ID,
        metadata: { kind: 'password_reset', transport: 'fake', messageId: 'm-1' },
      },
      {
        action: 'mail.delivery.failed',
        actorUserId: null,
        entityType: 'users',
        entityId: USER_ID,
        metadata: { kind: 'invitation', transport: 'resend', reason: 'http', httpStatus: 403, providerCode: 'validation_error' },
      },
      {
        action: 'mail.delivery.failed',
        actorUserId: null,
        entityType: 'users',
        entityId: USER_ID,
        metadata: { kind: 'invitation', transport: 'resend', reason: 'error' },
      },
    ]);
    expect(JSON.stringify(audit.entries)).not.toMatch(/sara|invite\/|reset-password|aaaa/);

    const quiet = recordingAudit();
    for (const transport of [new NoopMailTransport(), new LogMailTransport()]) {
      await new MailService(transport, prismaWith(ACADEMY), configWith(), quiet).sendInvitation(mailTo('sara@example.test', 'ar'));
    }
    await new MailService(new CapturingTransport(), prismaWith(ACADEMY), configWith(), quiet).sendInvitation(mailTo(null, 'ar'));
    expect(quiet.entries).toEqual([]);
  });

  it('a lost delivery event never fails the mail: the result stands', async () => {
    const result = await new MailService(new CapturingTransport(), prismaWith(ACADEMY), configWith(), recordingAudit(true)).sendInvitation(
      mailTo('sara@example.test', 'ar'),
    );
    expect(result).toEqual({ transport: 'fake', status: 'sent', messageId: 'm-1' });
  });

  // TEST-173 — LR-01-T02: the confirmation e-mail (D-R78).
  it('sends the e-mail confirmation in the recipient locale with the /verify-email link', async () => {
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), recordingAudit());

    await service.sendEmailVerification(mailTo('sara@example.test', 'en'));
    await service.sendEmailVerification(mailTo('sara@example.test', 'ar'));

    expect(transport.sent.map((message) => message.kind)).toEqual(['email_verification', 'email_verification']);
    expect(transport.sent[0]!.subject).toBe('Confirm your e-mail address at Arti Academy');
    expect(transport.sent[0]!.text).toContain(`https://academy.example/verify-email/${TOKEN}`);
    expect(transport.sent[1]!.subject).toBe('تأكيد بريدك الإلكتروني في أكاديمية آرتي');
    expect(service.emailVerificationLink(TOKEN)).toBe(`https://academy.example/verify-email/${TOKEN}`);
  });

  // PORTAL-03 (#207): the two self-registration e-mails carry nothing the visitor typed.
  it('sends the registration link and the existing-account notice in the asked locale, with no name, and records their delivery', async () => {
    const transport = new CapturingTransport();
    const audit = recordingAudit();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), audit);

    await service.sendRegistration({ userId: USER_ID, to: 'sara@example.test', locale: 'en', token: TOKEN, expiresAt: EXPIRES });
    await service.sendRegistration({ userId: USER_ID, to: 'sara@example.test', locale: null, token: TOKEN, expiresAt: EXPIRES });
    await service.sendExistingAccountNotice({ userId: USER_ID, to: 'sara@example.test', locale: 'tr' });
    await service.sendExistingAccountNotice({ userId: USER_ID, to: 'sara@example.test', locale: null });

    expect(transport.sent.map((message) => [message.kind, message.locale])).toEqual([
      ['registration', 'en'],
      ['registration', 'ar'],
      ['registration_existing', 'tr'],
      ['registration_existing', 'ar'],
    ]);
    const [en, ar, tr, existingAr] = transport.sent;
    expect(en!.subject).toBe('Complete your Arti Academy account');
    expect(en!.text).toContain(`https://academy.example/register/complete/${TOKEN}`);
    expect(en!.text.startsWith('Hello,\n')).toBe(true);
    expect(ar!.subject).toBe('أكمل إنشاء حسابك في أكاديمية آرتي');
    // The academy has no Turkish name: it falls back to the default locale's (D1).
    expect(tr!.subject).toBe('أكاديمية آرتي bünyesinde zaten bir hesabınız var');
    expect(tr!.text).toContain('https://academy.example/login');
    expect(existingAr!.subject).toBe('لديك حساب بالفعل في أكاديمية آرتي');
    expect(existingAr!.text).not.toContain(TOKEN);
    expect(service.registrationLink(TOKEN)).toBe(`https://academy.example/register/complete/${TOKEN}`);
    expect(service.loginLink()).toBe('https://academy.example/login');
    expect(audit.entries.map((entry) => entry.metadata)).toEqual([
      { kind: 'registration', transport: 'fake', messageId: 'm-1' },
      { kind: 'registration', transport: 'fake', messageId: 'm-2' },
      { kind: 'registration_existing', transport: 'fake', messageId: 'm-3' },
      { kind: 'registration_existing', transport: 'fake', messageId: 'm-4' },
    ]);
  });

  it('has the two self-registration templates in every locale, with the link and without any typed text', () => {
    for (const locale of TEMPLATE_LOCALES) {
      const registration = renderRegistration(locale, { academyName: '{ACADEMY}', link: '{LINK}', expiresAt: '{EXPIRES}' });
      for (const part of ['{ACADEMY}', '{LINK}', '{EXPIRES}']) expect(registration.text, `${locale} ${part}`).toContain(part);
      expect(registration.subject).toContain('{ACADEMY}');
      const notice = renderExistingAccount(locale, { academyName: '{ACADEMY}', link: '{LOGIN}' });
      for (const part of ['{ACADEMY}', '{LOGIN}']) expect(notice.text, `${locale} ${part}`).toContain(part);
      expect(notice.subject).toContain('{ACADEMY}');
      expect(notice.text).not.toContain('{LINK}');
    }
  });

  // TEST-175 — MOD-12-T02: the e-mail copy of a notification (D-R83/D-R86).
  it('sends a notification e-mail with the title and the link only, in the recipient locale, and records no delivery event', async () => {
    const transport = new CapturingTransport();
    const audit = recordingAudit();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), audit);

    const result = await service.sendNotification({ to: 'sara@example.test', recipientName: 'Sara', locale: 'en', title: 'Assignment graded: Essay', path: '/my-assignments' });
    await service.sendNotification({ to: 'sara@example.test', recipientName: 'سارة', locale: null, title: 'صُحّح واجب: مقال', path: '/my-assignments' });

    expect(result).toEqual({ transport: 'fake', status: 'sent', messageId: 'm-1' });
    const [english, arabic] = transport.sent;
    expect(english).toMatchObject({ kind: 'notification', to: 'sara@example.test', locale: 'en', subject: 'New notification: Assignment graded: Essay' });
    expect(english!.text).toContain('Hello Sara,');
    expect(english!.text).toContain('Arti Academy');
    expect(english!.text).toContain('https://academy.example/my-assignments');
    expect(english!.html).toContain('dir="ltr"');
    // No locale of their own: the academy's default (Arabic), right to left.
    expect(arabic).toMatchObject({ kind: 'notification', locale: 'ar', subject: 'لديك إشعار جديد: صُحّح واجب: مقال' });
    expect(arabic!.text).toContain('أكاديمية آرتي');
    expect(arabic!.html).toContain('dir="rtl"');
    // D-R86: the notification row keeps the state of its e-mail; the audit log gets nothing.
    expect(audit.entries).toEqual([]);
  });

  it('keeps a notification e-mail on this app and on one subject line, and survives a failing transport', async () => {
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith('https://academy.example'), recordingAudit());
    const send = (title: string, path: string) => service.sendNotification({ to: 'sara@example.test', recipientName: 'Sara', locale: 'en', title, path });

    // Anything but a root-relative path of the app falls back to the notifications page.
    for (const path of ['https://evil.example/x', '//evil.example/x', 'my-assignments', '/my assignments', '/a\nb', '']) await send('T', path);
    for (const message of transport.sent) {
      expect(message.text).toContain('https://academy.example/notifications\n');
      expect(message.text).not.toContain('evil.example');
    }
    await send('First line\nSecond   line', '/my-lessons?x=1#top');
    const kept = transport.sent.at(-1)!;
    expect(kept.subject).toBe('New notification: First line Second line');
    expect(kept.text).toContain('https://academy.example/my-lessons?x=1#top');
    await send('x'.repeat(400), '/my-lessons');
    expect(transport.sent.at(-1)!.subject.length).toBeLessThanOrEqual('New notification: '.length + 160);
    expect(transport.sent.at(-1)!.subject.endsWith('…')).toBe(true);
    // The cap counts characters, not UTF-16 units: 200 emoji (an announcement title may be that) are cut after the
    // 159th — never between the two halves of a surrogate pair, which no mail provider has to accept.
    await send('\u{1F600}'.repeat(200), '/notifications');
    const cut = transport.sent.at(-1)!;
    expect(cut.subject).toBe(`New notification: ${'\u{1F600}'.repeat(159)}…`);
    // A lone surrogate does not survive UTF-8: well-formed text comes back unchanged.
    for (const part of [cut.subject, cut.text, cut.html ?? '']) expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part);
    await send('\u{1F600}'.repeat(160), '/notifications');
    expect(transport.sent.at(-1)!.subject).toBe(`New notification: ${'\u{1F600}'.repeat(160)}`);
    // Without APP_PUBLIC_URL the link is root-relative, as in the account e-mails.
    const relative = new CapturingTransport();
    await new MailService(relative, prismaWith(null), configWith(), recordingAudit()).sendNotification({ to: 'a@example.test', recipientName: 'A', locale: 'ar', title: 'عنوان', path: '/my-grades' });
    expect(relative.sent[0]!.text).toContain('\n/my-grades\n');

    const failing: MailTransport = {
      name: 'fake',
      send: async () => {
        throw new Error('boom to sara@example.test');
      },
    };
    const audit = recordingAudit();
    const failed = await new MailService(failing, prismaWith(ACADEMY), configWith(), audit).sendNotification({ to: 'sara@example.test', recipientName: 'Sara', locale: 'en', title: 'T', path: '/x' });
    expect(failed).toEqual({ transport: 'fake', status: 'failed', messageId: null, failure: { reason: 'error' } });
    expect(audit.entries).toEqual([]);
  });
});
