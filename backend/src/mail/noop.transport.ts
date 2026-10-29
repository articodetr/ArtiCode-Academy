import { Injectable, Logger } from '@nestjs/common';
import type { MailDeliveryResult, MailMessage, MailTransport } from './mail.transport.js';

/**
 * The default transport (`MAIL_TRANSPORT=none`, D-R08): sends nothing. The only
 * trace is a log line with the message kind — never the address, the subject,
 * the link or the token. Tokens reach the authorized admin once, in the API
 * response of the route that issued them (D-R01).
 */
@Injectable()
export class NoopMailTransport implements MailTransport {
  readonly name = 'none';
  private readonly logger = new Logger('MailTransport');

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.logger.log(`mail skipped (transport=none, kind=${message.kind})`);
    return { transport: this.name, status: 'skipped', messageId: null };
  }
}
