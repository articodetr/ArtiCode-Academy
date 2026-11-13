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
 * account lock caps the attempts per account; a signed-in route (the password
 * change) per (IP, platform user); anything else per IP. A refusal is the
 * platform's `429 rate_limited`. In-memory storage: per process (the academy's
 * documented limitation). Runs after the global guards, so `platformUser` is
 * already set on a signed-in route.
 */
@Injectable()
export class PlatformThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
    const body = req['body'] as { identifier?: unknown } | undefined;
    const identifier =
      typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 320) : '';
    if (identifier) return `${ip}|${identifier}`;
    const userId = (req as PlatformAuthenticatedRequest).platformUser?.id;
    return userId ? `${ip}|user:${userId}` : ip;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw platformAuthError.rateLimited();
  }
}
