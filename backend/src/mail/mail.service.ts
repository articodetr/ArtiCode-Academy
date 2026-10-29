import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';
import { pickLocalized } from '../authorization/localized-text.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

/** What the account flows know about a recipient and the one-time token they hold. */
export interface AccountMail {
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
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly publicUrl: string | undefined;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.publicUrl = config.get('APP_PUBLIC_URL', { infer: true });
  }

  /** Name of the configured transport (`none`, `log`, …). */
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

  /** Reserved for MOD-03-T05 (no caller yet). */
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
    try {
      return await this.transport.send({ kind, to: mail.to, locale, subject: rendered.subject, text: rendered.text });
    } catch (error) {
      // Never the message, the address or the link: only that the transport failed.
      this.logger.error(
        `mail delivery failed (transport=${this.transport.name}, kind=${kind})`,
        error instanceof Error ? error.stack : String(error),
      );
      return { transport: this.transport.name, status: 'failed', messageId: null };
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
