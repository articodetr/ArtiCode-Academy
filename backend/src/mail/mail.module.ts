import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { LogMailTransport } from './log.transport.js';
import { MailService } from './mail.service.js';
import { MAIL_TRANSPORT } from './mail.transport.js';
import type { MailTransport } from './mail.transport.js';
import { NoopMailTransport } from './noop.transport.js';

/**
 * Outgoing e-mail (D-R08, ADR-031). `MAIL_TRANSPORT` selects the transport:
 * `none` (default — nothing is sent) or `log` (development only; refused in
 * production by env.schema.ts). A real provider is a third transport added in
 * launch task LR-01. Consumers import this module and inject MailService.
 */
@Module({
  providers: [
    NoopMailTransport,
    LogMailTransport,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService, NoopMailTransport, LogMailTransport],
      useFactory: (config: ConfigService<Env, true>, none: NoopMailTransport, log: LogMailTransport): MailTransport =>
        config.get('MAIL_TRANSPORT', { infer: true }) === 'log' ? log : none,
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
