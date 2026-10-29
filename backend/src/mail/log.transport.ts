import { Injectable, Logger } from '@nestjs/common';
import type { MailDeliveryResult, MailMessage, MailTransport } from './mail.transport.js';

/**
 * Development-only transport (`MAIL_TRANSPORT=log`): writes the whole message,
 * link included, to the server log so a developer can follow the flow without
 * a mailbox. env.schema.ts refuses this transport when NODE_ENV=production, so
 * no token can ever leak into production logs through it (ADR-031).
 */
@Injectable()
export class LogMailTransport implements MailTransport {
  readonly name = 'log';
  private readonly logger = new Logger('MailTransport');

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.logger.log(
      `mail logged (transport=log, kind=${message.kind}, to=${message.to}, locale=${message.locale})\n` +
        `Subject: ${message.subject}\n${message.text}`,
    );
    return { transport: this.name, status: 'logged', messageId: null };
  }
}
