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
  INVITATION_PATH,
  PASSWORD_RESET_PATH,
  formatExpiry,
  renderInvitation,
  renderPasswordReset,
  templateLocale,
} from './mail.templates.js';
import type { AccountMailInput, RenderedMail, TemplateLocale } from './mail.templates.js';
import { MAIL_TRANSPORT } from './mail.transport.js';
import type { MailDeliveryResult, MailKind, MailTransport } from './mail.transport.js';

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
 * Renders the account e-mails (invitation, password reset) from the ar/en
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

  sendInvitation(mail: AccountMail): Promise<MailDeliveryResult> {
    return this.deliver('invitation', mail, this.invitationLink(mail.token), renderInvitation);
  }

  /** MOD-03-T05: the reset link, for administrative issuing and the self-service request alike. */
  sendPasswordReset(mail: AccountMail): Promise<MailDeliveryResult> {
    return this.deliver('password_reset', mail, this.passwordResetLink(mail.token), renderPasswordReset);
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
    let result: MailDeliveryResult;
    try {
      result = await this.transport.send({ kind, to: mail.to, locale, subject: rendered.subject, text: rendered.text, html });
    } catch (error) {
      // Never the message, the address or the link: only that the transport failed.
      this.logger.error(
        `mail delivery failed (transport=${this.transport.name}, kind=${kind})`,
        error instanceof Error ? error.stack : String(error),
      );
      result = { transport: this.transport.name, status: 'failed', messageId: null, failure: { reason: 'error' } };
    }
    await this.recordDelivery(kind, mail.userId, result);
    return result;
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
