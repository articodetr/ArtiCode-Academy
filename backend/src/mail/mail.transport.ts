// Outgoing e-mail abstraction (MOD-03-T03, owner decision D-R08 / ADR-031).
// Feature code talks to MailService only; MailService renders a message and
// hands it to the configured MailTransport. The real provider (Resend, launch
// task LR-01 — D-R74, ADR-070) is one more transport class and its env
// variables: nothing changed in AccountModule, the auth flows or the API contracts.
import type { LocaleCode } from '../authorization/localized-text.js';
import type { Env } from '../config/env.schema.js';

/** Injection token of the configured transport (see MailModule). */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Names accepted by the `MAIL_TRANSPORT` variable (declared in env.schema.ts; `log` is refused in production). */
export type MailTransportName = Env['MAIL_TRANSPORT'];

/** `notification` (MOD-12): the e-mail copy of an in-app notification — its delivery state lives in the notification row, not in the audit log (D-R86). */
export type MailKind = 'invitation' | 'password_reset' | 'email_verification' | 'notification';

/** A rendered, ready-to-send message. */
export interface MailMessage {
  kind: MailKind;
  /** Recipient address. */
  to: string;
  /** Locale the templates were rendered in. */
  locale: LocaleCode;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** The same body as HTML, in the reading direction of the locale (D-R77). */
  html: string;
}

/**
 * `skipped`: nothing was sent (no transport or no address); `logged`: written
 * to the server log only (development); `sent`: accepted by a real provider;
 * `failed`: the provider refused or was unreachable (the request that
 * triggered the mail still succeeds — the manual link remains available).
 */
export type MailDeliveryStatus = 'skipped' | 'logged' | 'sent' | 'failed';

/**
 * Why a delivery failed — codes only, never the provider's message (it may
 * echo an address): `http` = the provider answered with an error status,
 * `timeout`/`network` = no answer, `invalid_response` = a 2xx without a
 * message id, `error` = anything else thrown by the transport.
 */
export interface MailDeliveryFailure {
  reason: 'http' | 'timeout' | 'network' | 'invalid_response' | 'error';
  /** The provider's HTTP status when it answered. */
  httpStatus?: number;
  /** The provider's error name (e.g. `validation_error`), when it sent one. */
  providerCode?: string;
}

export interface MailDeliveryResult {
  /** Name of the transport that handled the message (`none`, `log`, `resend`). */
  transport: string;
  status: MailDeliveryStatus;
  /** Provider message id when one exists; null otherwise. */
  messageId: string | null;
  /** Present when `status` is `failed`. */
  failure?: MailDeliveryFailure;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<MailDeliveryResult>;
}
