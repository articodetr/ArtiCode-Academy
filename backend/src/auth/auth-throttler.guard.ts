import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { authError } from './auth.errors.js';

/**
 * Rate limiting for the auth routes. Login attempts are tracked per
 * (IP, identifier) so one guessed account cannot lock out a whole office,
 * while the account lock in AuthService caps attempts per account globally.
 * The second step of a two-step sign-in (API-211) carries no identifier: it is
 * tracked per (IP, challenge) — a challenge already allows 5 wrong codes and
 * counts in the account lockout, and staff signing in together behind one
 * school NAT never share a budget (MOD-01-H06). A signed-in caller without
 * either (the MFA account routes, the password change) is tracked per
 * (IP, user). Everything else per IP. In-memory storage: per process
 * (documented limitation).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
    const body = req['body'] as { identifier?: unknown; challenge?: unknown } | undefined;
    const identifier =
      typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 320) : '';
    if (identifier) return `${ip}|${identifier}`;
    // Only a digest of the challenge is kept as the key (never the challenge itself).
    const challenge = typeof body?.challenge === 'string' ? body.challenge.slice(0, 256) : '';
    if (challenge) return `${ip}|challenge:${createHash('sha256').update(challenge).digest('hex').slice(0, 32)}`;
    const userId = (req['user'] as { id?: unknown } | undefined)?.id;
    if (typeof userId === 'string' && userId) return `${ip}|user:${userId}`;
    return ip;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw authError.rateLimited();
  }
}
