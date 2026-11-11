import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { LogMailTransport } from './log.transport.js';
import { MailService } from './mail.service.js';
import { MAIL_TRANSPORT } from './mail.transport.js';
import type { MailTransport } from './mail.transport.js';
import { NoopMailTransport } from './noop.transport.js';
import { ResendMailTransport } from './resend.transport.js';

/** Builds the transport chosen by `MAIL_TRANSPORT` (env.schema.ts has already checked its settings). */
export function mailTransportFor(config: ConfigService<Env, true>): MailTransport {
  switch (config.get('MAIL_TRANSPORT', { infer: true })) {
    case 'resend':
      return new ResendMailTransport({
        apiKey: config.get('RESEND_API_KEY', { infer: true }) ?? '',
        from: config.get('MAIL_FROM', { infer: true }) ?? '',
        replyTo: config.get('MAIL_REPLY_TO', { infer: true }),
      });
    case 'log':
      return new LogMailTransport();
    default:
      return new NoopMailTransport();
  }
}

/**
 * Outgoing e-mail (D-R08, ADR-031; LR-01 — ADR-070). `MAIL_TRANSPORT` selects
 * the transport: `none` (default — nothing is sent), `log` (development only;
 * refused in production by env.schema.ts) or `resend` (the real provider —
 * D-R74). Consumers import this module and inject MailService.
 */
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: mailTransportFor,
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
