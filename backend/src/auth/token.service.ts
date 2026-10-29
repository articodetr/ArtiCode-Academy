import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import type { Env } from '../config/env.schema.js';
import { authError } from './auth.errors.js';

export const JWT_ALGORITHM = 'HS256';

/** Claims the API relies on after verification. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Role keys at issue time (informational; permissions are re-read per request). */
  roles: string[];
  /** Token id. */
  jti: string;
  /** Issued at, in seconds. */
  iat: number;
  /** Expiry, in seconds. */
  exp: number;
}

export interface SignedAccessToken {
  token: string;
  /** Seconds until expiry. */
  expiresIn: number;
  expiresAt: Date;
}

export interface GeneratedRefreshToken {
  /** The opaque token handed to the client (cookie). Never stored. */
  token: string;
  /** SHA-256 hex of the token; the only thing stored (P9). */
  hash: string;
}

/**
 * Access tokens: HS256 JWTs with issuer, audience, expiry and a token id.
 * Refresh tokens: 256-bit random strings, stored as SHA-256 hashes only.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly key: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlMs: number;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('JWT_SECRET', { infer: true });
    if (secret) {
      this.key = new TextEncoder().encode(secret);
    } else {
      // Outside production only (env.schema.ts enforces the secret there).
      this.key = randomBytes(48);
      this.logger.warn(
        'JWT_SECRET is not set; using an ephemeral secret — access tokens will not survive a restart',
      );
    }
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlMs = config.get('AUTH_REFRESH_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  async signAccessToken(
    input: { userId: string; roles: readonly string[] },
    ttlSeconds: number = this.accessTtlSeconds,
  ): Promise<SignedAccessToken> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = nowSeconds + ttlSeconds;
    const token = await new SignJWT({ roles: [...input.roles] })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(input.userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(randomUUID())
      .setIssuedAt(nowSeconds)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresIn: ttlSeconds, expiresAt: new Date(exp * 1000) };
  }

  /** Verifies signature, issuer, audience and expiry (5 s clock tolerance). */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [JWT_ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: 5,
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        throw authError.tokenInvalid();
      }
      const roles = Array.isArray(payload['roles'])
        ? payload['roles'].filter((role): role is string => typeof role === 'string')
        : [];
      return { sub: payload.sub, jti: payload.jti, iat: payload.iat, exp: payload.exp, roles };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) throw authError.tokenExpired();
      if (error instanceof Error && error.name === 'AuthHttpException') throw error;
      throw authError.tokenInvalid();
    }
  }

  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + this.refreshTtlMs);
  }
}
