// TEST-017 — MailService, the two built-in transports and the templates (and,
// since TEST-175, the notification e-mail of MOD-12), with
// no network and no database (stubs for the transport, Prisma and ConfigService).
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import type { AuditEntry, AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.schema.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { LogMailTransport } from './log.transport.js';
import { MailService } from './mail.service.js';
import { formatExpiry, renderEmailVerification, renderInvitation, renderPasswordReset, templateLocale } from './mail.templates.js';
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

  it('falls back to the academy default locale, then Arabic, and builds root-relative links without APP_PUBLIC_URL', async () => {
    const transport = new CapturingTransport();
    const service = new MailService(transport, prismaWith(ACADEMY), configWith(undefined), recordingAudit());

    await service.sendInvitation(mailTo('x@example.test', 'tr', 'سارة'));
    await service.sendInvitation(mailTo('x@example.test', null, 'سارة'));

    expect(transport.sent.map((message) => message.locale)).toEqual(['ar', 'ar']);
    expect(transport.sent[0]!.subject).toBe('دعوة للانضمام إلى أكاديمية آرتي');
    expect(transport.sent[0]!.text).toContain('مرحباً سارة،');
    expect(transport.sent[0]!.text).toContain(`/invite/${TOKEN}`);
    expect(transport.sent[0]!.text).not.toContain('https://');
    expect(service.invitationLink(TOKEN)).toBe(`/invite/${TOKEN}`);
    expect(service.passwordResetLink(TOKEN)).toBe(`/reset-password/${TOKEN}`);

    const english = new CapturingTransport();
    await new MailService(english, prismaWith({ ...ACADEMY, defaultLocale: 'en' as never }), configWith(), recordingAudit()).sendPasswordReset(
      mailTo('x@example.test', 'tr'),
    );
    expect(english.sent[0]).toMatchObject({ kind: 'password_reset', locale: 'en', subject: 'Reset your Arti Academy password' });
    expect(english.sent[0]!.text).toContain(`/reset-password/${TOKEN}`);
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

  it('templates exist in both locales with every placeholder, locale fallback follows D1, expiry formatting tolerates a bad zone', () => {
    expect(templateLocale('en', 'ar')).toBe('en');
    expect(templateLocale('ar', 'en')).toBe('ar');
    expect(templateLocale('tr', 'en')).toBe('en');
    expect(templateLocale('tr', 'tr')).toBe('ar');
    expect(templateLocale(null, 'ar')).toBe('ar');
    expect(templateLocale(undefined, 'en')).toBe('en');

    const input = { academyName: 'ACADEMY', recipientName: 'RECIPIENT', link: 'https://l.example/x', expiresAt: 'EXPIRY' };
    for (const render of [renderInvitation, renderPasswordReset, renderEmailVerification]) {
      for (const locale of ['ar', 'en'] as const) {
        const { subject, text } = render(locale, input);
        expect(subject).toContain('ACADEMY');
        expect(text).toContain('RECIPIENT');
        expect(text).toContain('https://l.example/x');
        expect(text).toContain('EXPIRY');
      }
    }

    expect(formatExpiry(EXPIRES, 'en', 'Europe/Istanbul')).toContain('2026');
    expect(formatExpiry(EXPIRES, 'ar', 'Europe/Istanbul')).not.toBe('');
    expect(formatExpiry(EXPIRES, 'en', 'Not/AZone')).toBe(formatExpiry(EXPIRES, 'en', 'UTC'));
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
