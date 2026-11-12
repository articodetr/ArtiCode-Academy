// TEST-175 — MOD-12-T02: what a transport result does to a queued
// notification e-mail and to the pace of the queue (D-R82, ADR-071). Pure.
import { describe, expect, it } from 'vitest';
import type { MailDeliveryResult } from '../mail/mail.transport.js';
import { DELIVERY_FAILURE, QUOTA_BLOCK_MS, RATE_LIMIT_BACKOFF_MS, RESEND_SEND_INTERVAL_MS, STALE_AFTER_MS, failureCode, outcomeOf, pacingAfter } from './notifications.delivery.js';

const NOW = new Date('2026-11-12T10:00:00Z');
const sent = (messageId: string | null, transport = 'resend'): MailDeliveryResult => ({ transport, status: 'sent', messageId });
const failed = (failure: MailDeliveryResult['failure'], transport = 'resend'): MailDeliveryResult => ({ transport, status: 'failed', messageId: null, ...(failure ? { failure } : {}) });

describe('outcome of a notification e-mail (TEST-175)', () => {
  it('an accepted message is `sent` with its instant and the provider id; the development log transport has no id', () => {
    expect(outcomeOf(sent('re_123'), NOW)).toEqual({ emailStatus: 'sent', emailSentAt: NOW, emailMessageId: 're_123' });
    // A blank id would break the row's CHECK: it is stored as no id.
    expect(outcomeOf(sent('  '), NOW)).toEqual({ emailStatus: 'sent', emailSentAt: NOW, emailMessageId: null });
    expect(outcomeOf({ transport: 'log', status: 'logged', messageId: null }, NOW)).toEqual({ emailStatus: 'sent', emailSentAt: NOW, emailMessageId: null });
  });

  it('a refusal is `failed` with a code and never the provider text; a transport that sends nothing leaves `skipped`', () => {
    expect(outcomeOf(failed({ reason: 'http', httpStatus: 429, providerCode: 'rate_limit_exceeded' }), NOW)).toEqual({ emailStatus: 'failed', emailFailure: 'http_429' });
    expect(outcomeOf(failed({ reason: 'http', httpStatus: 422, providerCode: 'validation_error' }), NOW)).toEqual({ emailStatus: 'failed', emailFailure: 'http_422' });
    expect(outcomeOf(failed({ reason: 'timeout' }), NOW)).toEqual({ emailStatus: 'failed', emailFailure: 'timeout' });
    expect(outcomeOf(failed({ reason: 'network' }), NOW)).toEqual({ emailStatus: 'failed', emailFailure: 'network' });
    expect(outcomeOf(failed({ reason: 'invalid_response', httpStatus: 200 }), NOW)).toEqual({ emailStatus: 'failed', emailFailure: 'invalid_response' });
    // `failed` always carries a code (the row's CHECK requires one).
    expect(outcomeOf(failed(undefined), NOW)).toEqual({ emailStatus: 'failed', emailFailure: 'error' });
    expect(outcomeOf({ transport: 'none', status: 'skipped', messageId: null }, NOW)).toEqual({ emailStatus: 'skipped' });
  });

  it('every failure code fits the column: trimmed, not empty, at most 32 characters', () => {
    const codes = [
      ...Object.values(DELIVERY_FAILURE),
      failureCode(undefined),
      failureCode({ reason: 'http', httpStatus: 503 }),
      failureCode({ reason: 'http' }),
      ...(['timeout', 'network', 'invalid_response', 'error'] as const).map((reason) => failureCode({ reason })),
    ];
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9_]{1,32}$/);
    }
    expect(Object.values(DELIVERY_FAILURE)).toEqual(['stale', 'quota_exceeded', 'recipient_unavailable']);
    expect(STALE_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('pace of the notification queue (TEST-175)', () => {
  it('waits between two sends through Resend and not at all through the other transports', () => {
    expect(pacingAfter(sent('re_1'), 'resend')).toEqual({ waitMs: RESEND_SEND_INTERVAL_MS, quotaBlockMs: 0 });
    expect(pacingAfter(failed({ reason: 'http', httpStatus: 500 }), 'resend')).toEqual({ waitMs: RESEND_SEND_INTERVAL_MS, quotaBlockMs: 0 });
    expect(pacingAfter(failed({ reason: 'timeout' }), 'resend')).toEqual({ waitMs: RESEND_SEND_INTERVAL_MS, quotaBlockMs: 0 });
    expect(pacingAfter({ transport: 'log', status: 'logged', messageId: null }, 'log')).toEqual({ waitMs: 0, quotaBlockMs: 0 });
    expect(pacingAfter({ transport: 'none', status: 'skipped', messageId: null }, 'none')).toEqual({ waitMs: 0, quotaBlockMs: 0 });
    // Ten requests a second is the provider's limit; the queue alone stays well under it.
    expect(1000 / RESEND_SEND_INTERVAL_MS).toBeLessThan(10);
  });

  it('backs off after a rate-limit answer and stops asking for a while once the quota is used up', () => {
    expect(pacingAfter(failed({ reason: 'http', httpStatus: 429, providerCode: 'rate_limit_exceeded' }), 'resend')).toEqual({ waitMs: RATE_LIMIT_BACKOFF_MS, quotaBlockMs: 0 });
    expect(pacingAfter(failed({ reason: 'http', httpStatus: 429 }), 'resend')).toEqual({ waitMs: RATE_LIMIT_BACKOFF_MS, quotaBlockMs: 0 });
    expect(pacingAfter(failed({ reason: 'http', httpStatus: 429, providerCode: 'daily_quota_exceeded' }), 'resend')).toEqual({ waitMs: RESEND_SEND_INTERVAL_MS, quotaBlockMs: QUOTA_BLOCK_MS });
    expect(pacingAfter(failed({ reason: 'http', httpStatus: 429, providerCode: 'monthly_quota_exceeded' }), 'resend')).toEqual({ waitMs: RESEND_SEND_INTERVAL_MS, quotaBlockMs: QUOTA_BLOCK_MS });
    // A quota code only counts with the status that carries it.
    expect(pacingAfter(failed({ reason: 'http', httpStatus: 403, providerCode: 'daily_quota_exceeded' }), 'resend')).toEqual({ waitMs: RESEND_SEND_INTERVAL_MS, quotaBlockMs: 0 });
    expect(RATE_LIMIT_BACKOFF_MS).toBeGreaterThanOrEqual(1000);
    expect(QUOTA_BLOCK_MS).toBeGreaterThanOrEqual(60_000);
  });
});
