// What happens to a queued notification e-mail once the transport answered
// (owner decision D-R82, ADR-071) — pure rules, unit-tested in
// notifications.delivery.spec.ts: the state written back into the row, and
// how long the in-process queue waits before the next message.
import type { NotificationEmailStatus } from '../generated/prisma/client.js';
import type { MailDeliveryFailure, MailDeliveryResult } from '../mail/mail.transport.js';

/** A queued e-mail older than this at boot is not sent any more; it becomes `failed` with `stale`. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Pause between two sends through Resend. Its API allows 10 requests per
 * second per team across all keys (documentation read on 2026-11-12); 150 ms
 * keeps the notification queue well under it and leaves room for the account
 * e-mails, which are not queued.
 */
export const RESEND_SEND_INTERVAL_MS = 150;
/** After a `429` that is not a quota answer: let the provider's window pass. */
export const RATE_LIMIT_BACKOFF_MS = 1000;
/**
 * After the provider said the day's or the month's quota is used up, further
 * sends cannot succeed for a long while: for this window the queue fails
 * them at once (`quota_exceeded`) instead of asking the provider each time.
 */
export const QUOTA_BLOCK_MS = 15 * 60 * 1000;

const QUOTA_CODES = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

/** Reason codes the dispatcher itself writes (the transport's codes come from `MailDeliveryFailure`). */
export const DELIVERY_FAILURE = {
  /** Still queued at a boot more than `STALE_AFTER_MS` after its creation. */
  stale: 'stale',
  /** Not attempted: the provider's quota is used up (see `QUOTA_BLOCK_MS`). */
  quotaExceeded: 'quota_exceeded',
  /** Since it was queued the recipient lost the address, its confirmation or the active account. */
  recipientUnavailable: 'recipient_unavailable',
} as const;

export interface DeliveryOutcome {
  emailStatus: Extract<NotificationEmailStatus, 'sent' | 'failed' | 'skipped'>;
  emailSentAt?: Date;
  emailMessageId?: string | null;
  emailFailure?: string;
}

/** A code for `email_failure` (≤ 32 characters, never the provider's text): `http_429`, `timeout`, `network` … */
export function failureCode(failure: MailDeliveryFailure | undefined): string {
  if (!failure) return 'error';
  return failure.reason === 'http' && failure.httpStatus !== undefined ? `http_${failure.httpStatus}` : failure.reason;
}

/**
 * The row state for a transport result: an accepted message is `sent` with
 * its instant (and the provider's id when there is one — the development
 * `log` transport has none); a refusal is `failed` with a code; a transport
 * that sends nothing leaves `skipped`.
 */
export function outcomeOf(result: MailDeliveryResult, now: Date): DeliveryOutcome {
  if (result.status === 'sent' || result.status === 'logged') {
    return { emailStatus: 'sent', emailSentAt: now, emailMessageId: result.messageId?.trim() ? result.messageId : null };
  }
  if (result.status === 'failed') return { emailStatus: 'failed', emailFailure: failureCode(result.failure) };
  return { emailStatus: 'skipped' };
}

export interface Pacing {
  /** How long to wait before the next send. */
  waitMs: number;
  /** For how long further sends are failed without asking the provider (0 = not at all). */
  quotaBlockMs: number;
}

/** How the queue goes on after a result, for the configured transport. */
export function pacingAfter(result: MailDeliveryResult, transport: string): Pacing {
  const interval = transport === 'resend' ? RESEND_SEND_INTERVAL_MS : 0;
  const failure = result.status === 'failed' ? result.failure : undefined;
  if (failure?.reason === 'http' && failure.httpStatus === 429) {
    if (failure.providerCode && QUOTA_CODES.has(failure.providerCode)) return { waitMs: interval, quotaBlockMs: QUOTA_BLOCK_MS };
    return { waitMs: Math.max(interval, RATE_LIMIT_BACKOFF_MS), quotaBlockMs: 0 };
  }
  return { waitMs: interval, quotaBlockMs: 0 };
}
