// TEST-172 — LR-01-T01: the Resend transport against a stubbed fetch (no
// network): request shape, success, refusals, timeouts and the log policy.
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import type { Env } from '../config/env.schema.js';
import { LogMailTransport } from './log.transport.js';
import { mailTransportFor } from './mail.module.js';
import type { MailMessage } from './mail.transport.js';
import { NoopMailTransport } from './noop.transport.js';
import { RESEND_API_URL, ResendMailTransport } from './resend.transport.js';

const KEY = 're_test_not_a_real_key';
const MESSAGE: MailMessage = {
  kind: 'password_reset',
  to: 'sara@example.test',
  locale: 'ar',
  subject: 'SUBJECT-LINE',
  text: 'open https://academy.example/reset-password/SECRET-TOKEN',
  html: '<p>open https://academy.example/reset-password/SECRET-TOKEN</p>',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ResendMailTransport (TEST-172)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let lines: () => string[];

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log: MockInstance = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn: MockInstance = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    lines = () => [...log.mock.calls, ...warn.mock.calls].map((call) => String(call[0]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs one JSON message with the key, the sender, both bodies and a kind tag, and returns the provider id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'msg_123' }));
    const transport = new ResendMailTransport({ apiKey: KEY, from: 'Arti <no-reply@academy.example>', replyTo: 'office@academy.example' });

    expect(await transport.send(MESSAGE)).toEqual({ transport: 'resend', status: 'sent', messageId: 'msg_123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toMatch(/^articode-academy-mail\//);
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Arti <no-reply@academy.example>',
      to: ['sara@example.test'],
      subject: 'SUBJECT-LINE',
      text: MESSAGE.text,
      html: MESSAGE.html,
      reply_to: 'office@academy.example',
      tags: [{ name: 'kind', value: 'password_reset' }],
    });
    expect(lines()).toEqual(['mail sent (transport=resend, kind=password_reset, id=msg_123)']);
  });

  it('omits reply_to when none is configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'msg_1' }));
    await new ResendMailTransport({ apiKey: KEY, from: 'no-reply@academy.example' }).send(MESSAGE);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).not.toHaveProperty('reply_to');
  });

  it('turns a refusal into failed with the status and the error name only — never the provider message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { statusCode: 403, name: 'validation_error', message: 'You can only send to sara@example.test' }),
    );
    const transport = new ResendMailTransport({ apiKey: KEY, from: 'no-reply@academy.example' });

    expect(await transport.send(MESSAGE)).toEqual({
      transport: 'resend',
      status: 'failed',
      messageId: null,
      failure: { reason: 'http', httpStatus: 403, providerCode: 'validation_error' },
    });

    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    expect((await transport.send(MESSAGE)).failure).toEqual({ reason: 'http', httpStatus: 502 });

    fetchMock.mockResolvedValue(jsonResponse(422, { name: 'Not A Code <sara@example.test>' }));
    expect((await transport.send(MESSAGE)).failure).toEqual({ reason: 'http', httpStatus: 422 });

    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    expect((await transport.send(MESSAGE)).failure).toEqual({ reason: 'invalid_response', httpStatus: 200 });

    expect(lines()).toContain('mail delivery failed (transport=resend, kind=password_reset, reason=http, status=403, code=validation_error)');
    for (const line of lines()) {
      expect(line).not.toMatch(/sara|SUBJECT|SECRET|reset-password|re_test/);
    }
  });

  it('reports a timeout and a network error as failed without throwing', async () => {
    const transport = new ResendMailTransport({ apiKey: KEY, from: 'no-reply@academy.example' });

    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    expect((await transport.send(MESSAGE)).failure).toEqual({ reason: 'timeout' });

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await transport.send(MESSAGE)).toEqual({ transport: 'resend', status: 'failed', messageId: null, failure: { reason: 'network' } });
  });

  it('MailModule builds the transport MAIL_TRANSPORT names', () => {
    const config = (values: Partial<Env>) =>
      ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

    expect(mailTransportFor(config({ MAIL_TRANSPORT: 'none' }))).toBeInstanceOf(NoopMailTransport);
    expect(mailTransportFor(config({ MAIL_TRANSPORT: 'log' }))).toBeInstanceOf(LogMailTransport);
    const resend = mailTransportFor(config({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: KEY, MAIL_FROM: 'no-reply@academy.example' }));
    expect(resend).toBeInstanceOf(ResendMailTransport);
    expect(resend.name).toBe('resend');
  });
});
