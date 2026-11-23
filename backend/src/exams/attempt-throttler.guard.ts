import { Injectable } from '@nestjs/common';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';

/**
 * The rate limit of a learner's attempt routes (start, save, submit — D-R165):
 * the key is ALWAYS (IP, signed-in user).
 *
 * `AuthThrottlerGuard` was written for the sign-in routes and prefers an
 * `identifier` or a `challenge` found in the request body as its key; on a
 * route of a signed-in user that would let a client pick a fresh bucket with
 * every request by sending a different value. Here the body is never looked at:
 * the global guards have already identified the caller.
 */
@Injectable()
export class AttemptThrottlerGuard extends AuthThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the library's own signature
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
    const userId = (req['user'] as { id?: unknown } | undefined)?.id;
    return typeof userId === 'string' && userId ? `${ip}|user:${userId}` : ip;
  }
}
