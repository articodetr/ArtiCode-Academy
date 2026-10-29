import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';

/** 256 random bits per token. */
export const VERIFICATION_TOKEN_BYTES = 32;
/** base64url of 32 bytes is exactly 43 characters; anything else is rejected before touching the database. */
export const VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedVerificationToken {
  /** The raw token handed over once (in the API response, D-R01). Never stored. */
  token: string;
  /** SHA-256 hex of the token — the only thing stored in `verification_tokens.token_hash`. */
  hash: string;
}

/**
 * One-time tokens of the account flows (MOD-03-T03 invitations, T05 password
 * reset; LR-01 e-mail verification): random, stored hashed, with lifetimes from
 * `AUTH_INVITATION_TTL_HOURS` and `AUTH_PASSWORD_RESET_TTL_MINUTES` (D-R02).
 */
@Injectable()
export class VerificationTokenService {
  readonly invitationTtlMs: number;
  readonly passwordResetTtlMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.invitationTtlMs = config.get('AUTH_INVITATION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000;
    this.passwordResetTtlMs = config.get('AUTH_PASSWORD_RESET_TTL_MINUTES', { infer: true }) * 60 * 1000;
  }

  generate(): GeneratedVerificationToken {
    const token = randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** True for a string shaped like a token this service generates. */
  isWellFormed(token: unknown): token is string {
    return typeof token === 'string' && VERIFICATION_TOKEN_PATTERN.test(token);
  }

  invitationExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + this.invitationTtlMs);
  }

  passwordResetExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + this.passwordResetTtlMs);
  }
}
