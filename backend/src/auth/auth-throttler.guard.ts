import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { authError } from './auth.errors.js';

/**
 * Rate limiting for the auth routes. Login attempts are tracked per
 * (IP, identifier) so one guessed account cannot lock out a whole office,
 * while the account lock in AuthService caps attempts per account globally.
 * In-memory storage: per process (documented limitation).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = typeof req['ip'] === 'string' ? req['ip'] : '';
    const body = req['body'] as { identifier?: unknown } | undefined;
    const identifier =
      typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 320) : '';
    return identifier ? `${ip}|${identifier}` : ip;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw authError.rateLimited();
  }
}
