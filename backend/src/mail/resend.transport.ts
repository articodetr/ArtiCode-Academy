import { Logger } from '@nestjs/common';
import type { MailDeliveryFailure, MailDeliveryResult, MailMessage, MailTransport } from './mail.transport.js';

/** Resend's send endpoint (https://resend.com/docs/api-reference/emails/send-email). */
export const RESEND_API_URL = 'https://api.resend.com/emails';
/** A send that has not answered within 10 s counts as failed (`timeout`); the request goes on without it. */
export const RESEND_TIMEOUT_MS = 10_000;
/** Generic client name: no academy, person or address in it. */
const USER_AGENT = 'articode-academy-mail/1';

export interface ResendSettings {
  apiKey: string;
  /** `address` or `Display Name <address>` on a domain verified at Resend. */
  from: string;
  replyTo?: string | undefined;
}

/** The provider's error name, kept only when it looks like a code (`validation_error`) — never its message. */
function providerCodeOf(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'name' in body && typeof body.name === 'string' && /^[a-z_]{1,64}$/.test(body.name)) {
    return body.name;
  }
  return undefined;
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function describeFailure(failure: MailDeliveryFailure): string {
  return [
    `reason=${failure.reason}`,
    failure.httpStatus === undefined ? null : `status=${failure.httpStatus}`,
    failure.providerCode === undefined ? null : `code=${failure.providerCode}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The real transport (`MAIL_TRANSPORT=resend`, LR-01 — D-R74, ADR-070): one
 * POST to the Resend REST API with Node's built-in fetch, no SDK, no retry.
 * It never throws: a refusal or a silent provider becomes `status: 'failed'`
 * with a reason code. Its log lines carry the kind and the provider id or the
 * failure code — never the address, the subject, the body or the link.
 */
export class ResendMailTransport implements MailTransport {
  readonly name = 'resend';
  private readonly logger = new Logger('MailTransport');

  constructor(private readonly settings: ResendSettings) {}

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const body = {
      from: this.settings.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(this.settings.replyTo ? { reply_to: this.settings.replyTo } : {}),
      tags: [{ name: 'kind', value: message.kind }],
    };
    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.settings.apiKey}`,
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return this.failed(message, { reason: timedOut ? 'timeout' : 'network' });
    }

    const payload = await jsonOrNull(response);
    if (!response.ok) {
      const providerCode = providerCodeOf(payload);
      return this.failed(message, { reason: 'http', httpStatus: response.status, ...(providerCode ? { providerCode } : {}) });
    }
    const id = payload && typeof payload === 'object' && 'id' in payload && typeof payload.id === 'string' && payload.id ? payload.id : null;
    if (!id) return this.failed(message, { reason: 'invalid_response', httpStatus: response.status });

    this.logger.log(`mail sent (transport=resend, kind=${message.kind}, id=${id})`);
    return { transport: this.name, status: 'sent', messageId: id };
  }

  private failed(message: MailMessage, failure: MailDeliveryFailure): MailDeliveryResult {
    this.logger.warn(`mail delivery failed (transport=resend, kind=${message.kind}, ${describeFailure(failure)})`);
    return { transport: this.name, status: 'failed', messageId: null, failure };
  }
}
