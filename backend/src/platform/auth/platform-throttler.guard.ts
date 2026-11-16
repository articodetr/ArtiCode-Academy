import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { platformAuthError } from '../platform.errors.js';
import type { PlatformAuthenticatedRequest } from './platform-principal.js';

/** Throttler name of the platform session routes (ThrottlerModule.forRoot of PlatformSessionModule). */
export const PLATFORM_AUTH_THROTTLER = 'platform_auth';

/**
 * Rate limiting of the platform session routes, the academy AuthThrottlerGuard
 * rule (src/auth/auth-throttler.guard.ts): a sign-in is tracked per
 * (IP, identifier), so guessing one account never blocks the others, while the
 * account lock caps the attempts per account; the second sign-in step (API-218)
 * per (IP, challenge); a signed-in route (the password
 * change) per (IP, platform user); anything else per IP. A refusal is the
 * platform's `429 rate_limited`. In-memory storage: per process (the academy's
 * documented limitation). Runs after the global guards, so `platformUser` is
 * already set on a signed-in route.
 */
@Injectable()
export class PlatformThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
    const body = req['body'] as { identifier?: unknown; challenge?: unknown } | undefined;
    const identifier =
      typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 320) : '';
    if (identifier) return `${ip}|${identifier}`;
    // PMFA: the second sign-in step (API-218) is tracked per (IP, challenge), as the academy's API-211 —
    // a challenge allows 5 wrong codes and counts in the lockout, and operators behind one NAT never share
    // a budget. Only a digest of the challenge is kept as the key, never the challenge itself.
    const challenge = typeof body?.challenge === 'string' ? body.challenge.slice(0, 256) : '';
    if (challenge) return `${ip}|challenge:${createHash('sha256').update(challenge).digest('hex').slice(0, 32)}`;
    const userId = (req as PlatformAuthenticatedRequest).platformUser?.id;
    return userId ? `${ip}|user:${userId}` : ip;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw platformAuthError.rateLimited();
  }
}
