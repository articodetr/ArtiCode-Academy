// Outgoing e-mail abstraction (MOD-03-T03, owner decision D-R08 / ADR-031).
// Feature code talks to MailService only; MailService renders a message and
// hands it to the configured MailTransport. Adding a real provider later
// (launch task LR-01) means one more transport class and its env variables —
// nothing changes in AccountModule, the auth flows or the API contracts.
import type { LocaleCode } from '../authorization/localized-text.js';
import type { Env } from '../config/env.schema.js';

/** Injection token of the configured transport (see MailModule). */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Names accepted by the `MAIL_TRANSPORT` variable (declared in env.schema.ts; `log` is refused in production). */
export type MailTransportName = Env['MAIL_TRANSPORT'];

export type MailKind = 'invitation' | 'password_reset' | 'email_verification';

/** A rendered, ready-to-send message. */
export interface MailMessage {
  kind: MailKind;
  /** Recipient address. */
  to: string;
  /** Locale the templates were rendered in. */
  locale: LocaleCode;
  subject: string;
  /** Plain-text body (HTML variants can be added without changing the transport contract). */
  text: string;
}

/**
 * `skipped`: nothing was sent (no transport or no address); `logged`: written
 * to the server log only (development); `sent`: accepted by a real provider;
 * `failed`: the provider refused or was unreachable (the request that
 * triggered the mail still succeeds — the manual link remains available).
 */
export type MailDeliveryStatus = 'skipped' | 'logged' | 'sent' | 'failed';

export interface MailDeliveryResult {
  /** Name of the transport that handled the message (`none`, `log`, …). */
  transport: string;
  status: MailDeliveryStatus;
  /** Provider message id when one exists (LR-01); null otherwise. */
  messageId: string | null;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<MailDeliveryResult>;
}
