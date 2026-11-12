import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';
import { pickLocalized } from '../authorization/localized-text.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { renderMailHtml } from './mail.html.js';
import {
  EMAIL_VERIFICATION_PATH,
  INVITATION_PATH,
  NOTIFICATIONS_PATH,
  PASSWORD_RESET_PATH,
  formatExpiry,
  renderEmailVerification,
  renderInvitation,
  renderNotificationMail,
  renderPasswordReset,
  templateLocale,
} from './mail.templates.js';
import type { AccountMailInput, RenderedMail, TemplateLocale } from './mail.templates.js';
import { MAIL_TRANSPORT } from './mail.transport.js';
import type { MailDeliveryResult, MailKind, MailMessage, MailTransport } from './mail.transport.js';

/** Delivery events of the real transports (LR-01, D-R76): kind + provider id or failure code — never the address, the link or the body. */
export const MAIL_AUDIT_ACTIONS = {
  sent: 'mail.delivery.sent',
  failed: 'mail.delivery.failed',
} as const;

/** What the account flows know about a recipient and the one-time token they hold. */
export interface AccountMail {
  /** The recipient account: the entity of the `mail.delivery.*` events. */
  userId: string;
  /** Recipient address; null when the account has a username only (nothing is sent). */
  to: string | null;
  recipientName: string;
  /** Recipient's preferred locale; null = academy default. */
  locale: LocaleCode | null;
  /** The raw one-time token (becomes part of the link; never logged by this service). */
  token: string;
  expiresAt: Date;
}

/** The e-mail copy of an in-app notification (MOD-12, D-R83): the title and a path — never the body. */
export interface NotificationMail {
  /** A verified address (the notification engine sends to nothing else — D-R84). */
  to: string;
  recipientName: string;
  /** Recipient's preferred locale; null = academy default. */
  locale: LocaleCode | null;
  title: string;
  /** Root-relative frontend path of the notification (`data.link`); anything else falls back to the notifications page. */
  path: string;
}

/** A path of this app only: one leading slash, no scheme, no host, no line break. */
function appPath(path: string): string {
  return /^\/(?!\/)[^\s\\]*$/.test(path) ? path : NOTIFICATIONS_PATH;
}

interface AcademyContext {
  name: LocalizedText;
  defaultLocale: LocaleCode;
  timezone: string;
}

const FALLBACK_ACADEMY: AcademyContext = { name: { ar: 'الأكاديمية', en: 'the academy' }, defaultLocale: 'ar', timezone: 'UTC' };

function asLocalizedText(value: Prisma.JsonValue): LocalizedText | null {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['ar'] === 'string') {
    return value as LocalizedText;
  }
  return null;
}

/**
 * Renders the account e-mails (invitation, password reset, address
 * confirmation) and the notification e-mails of MOD-12 from the ar/en
 * templates and hands them to the configured transport. It never throws
 * because of the transport: a delivery failure is reported in the result and
 * the manual link stays available to the admin (D-R01/D-R08). The academy
 * name, default locale and time zone come from the single `academy` row.
 * A message the provider accepted or refused records `mail.delivery.sent` or
 * `mail.delivery.failed` (LR-01, D-R76); `none` and `log` record nothing.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly publicUrl: string | undefined;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {
    this.publicUrl = config.get('APP_PUBLIC_URL', { infer: true });
  }

  /** Name of the configured transport (`none`, `log`, `resend`). */
  get transportName(): string {
    return this.transport.name;
  }

  /** `<APP_PUBLIC_URL>/invite/<token>`, or the root-relative path when no public URL is configured. */
  invitationLink(token: string): string {
    return `${this.publicUrl ?? ''}${INVITATION_PATH}/${encodeURIComponent(token)}`;
  }

  passwordResetLink(token: string): string {
    return `${this.publicUrl ?? ''}${PASSWORD_RESET_PATH}/${encodeURIComponent(token)}`;
  }

  /** LR-01-T02: `<APP_PUBLIC_URL>/verify-email/<token>`. Never returned by the API — the link travels in the e-mail only (D-R78). */
  emailVerificationLink(token: string): string {
    return `${this.publicUrl ?? ''}${EMAIL_VERIFICATION_PATH}/${encodeURIComponent(token)}`;
  }

  sendInvitation(mail: AccountMail): Promise<MailDeliveryResult> {
    return this.deliver('invitation', mail, this.invitationLink(mail.token), renderInvitation);
  }

  /** MOD-03-T05: the reset link, for administrative issuing and the self-service request alike. */
  sendPasswordReset(mail: AccountMail): Promise<MailDeliveryResult> {
    return this.deliver('password_reset', mail, this.passwordResetLink(mail.token), renderPasswordReset);
  }

  /** LR-01-T02: the address-ownership message (D-R78). */
  sendEmailVerification(mail: AccountMail): Promise<MailDeliveryResult> {
    return this.deliver('email_verification', mail, this.emailVerificationLink(mail.token), renderEmailVerification);
  }

  /**
   * MOD-12 (D-R83/D-R86): "you have a new notification" with the title and a
   * link to the page that shows the rest after sign-in. Unlike the account
   * e-mails it records no `mail.delivery.*` event — the notification row
   * keeps the state of its own e-mail — and like them it never throws.
   */
  async sendNotification(mail: NotificationMail): Promise<MailDeliveryResult> {
    const academy = await this.academy();
    const locale = templateLocale(mail.locale, academy.defaultLocale);
    const rendered = renderNotificationMail(locale, {
      academyName: pickLocalized(academy.name, locale, academy.defaultLocale),
      recipientName: mail.recipientName,
      title: mail.title,
      link: `${this.publicUrl ?? ''}${appPath(mail.path)}`,
    });
    const html = renderMailHtml(rendered.text, locale, rendered.subject);
    return this.transmit({ kind: 'notification', to: mail.to, locale, subject: rendered.subject, text: rendered.text, html });
  }

  private async deliver(
    kind: MailKind,
    mail: AccountMail,
    link: string,
    render: (locale: TemplateLocale, input: AccountMailInput) => RenderedMail,
  ): Promise<MailDeliveryResult> {
    if (!mail.to) {
      this.logger.log(`mail skipped (no address, kind=${kind})`);
      return { transport: this.transport.name, status: 'skipped', messageId: null };
    }
    const academy = await this.academy();
    const locale = templateLocale(mail.locale, academy.defaultLocale);
    const rendered = render(locale, {
      academyName: pickLocalized(academy.name, locale, academy.defaultLocale),
      recipientName: mail.recipientName,
      link,
      expiresAt: formatExpiry(mail.expiresAt, locale, academy.timezone),
    });
    const html = renderMailHtml(rendered.text, locale, rendered.subject);
    const result = await this.transmit({ kind, to: mail.to, locale, subject: rendered.subject, text: rendered.text, html });
    await this.recordDelivery(kind, mail.userId, result);
    return result;
  }

  /** Hands a rendered message to the transport; a transport that throws becomes a `failed` result. */
  private async transmit(message: MailMessage): Promise<MailDeliveryResult> {
    try {
      return await this.transport.send(message);
    } catch (error) {
      // Never the message, the address or the link: only that the transport failed.
      this.logger.error(
        `mail delivery failed (transport=${this.transport.name}, kind=${message.kind})`,
        error instanceof Error ? error.stack : String(error),
      );
      return { transport: this.transport.name, status: 'failed', messageId: null, failure: { reason: 'error' } };
    }
  }

  /**
   * One `mail.delivery.sent|failed` event per message a provider accepted or
   * refused, on the recipient account and without an actor (the system sent
   * it). Recorded after the triggering write has committed and never allowed
   * to fail the request: a lost event is logged, the delivery result stands.
   */
  private async recordDelivery(kind: MailKind, userId: string, result: MailDeliveryResult): Promise<void> {
    if (result.status !== 'sent' && result.status !== 'failed') return;
    const failure = result.failure;
    const metadata =
      result.status === 'sent'
        ? { kind, transport: result.transport, messageId: result.messageId }
        : {
            kind,
            transport: result.transport,
            reason: failure?.reason ?? 'error',
            ...(failure?.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
            ...(failure?.providerCode === undefined ? {} : { providerCode: failure.providerCode }),
          };
    try {
      await this.audit.record({
        action: result.status === 'sent' ? MAIL_AUDIT_ACTIONS.sent : MAIL_AUDIT_ACTIONS.failed,
        actorUserId: null,
        entityType: 'users',
        entityId: userId,
        metadata,
      });
    } catch (error) {
      this.logger.error(`mail delivery event not recorded (kind=${kind})`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async academy(): Promise<AcademyContext> {
    const row = await this.prisma.db.academy.findFirst({ select: { name: true, defaultLocale: true, timezone: true } });
    if (!row) return FALLBACK_ACADEMY;
    return {
      name: asLocalizedText(row.name) ?? FALLBACK_ACADEMY.name,
      defaultLocale: row.defaultLocale,
      timezone: row.timezone,
    };
  }
}
