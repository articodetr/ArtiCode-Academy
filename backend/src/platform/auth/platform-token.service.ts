// MOD-18-T02 (D-R100) — platform access tokens, modelled on the academy
// TokenService (src/auth/token.service.ts) with their OWN key, issuer and
// audience: an academy access token never verifies here, and a platform token
// never verifies in an academy API (different secret, `iss` and `aud`).
// Refresh-token helpers for the session routes of T03 (cookie `pla_refresh`).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { familyDeadline } from '../../auth/refresh-family.js';
import { PlatformRole } from '../../generated/platform/enums.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { isPlatformHttpException, platformAuthError } from '../platform.errors.js';

export const PLATFORM_JWT_ALGORITHM = 'HS256';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLATFORM_ROLES: ReadonlySet<string> = new Set(Object.values(PlatformRole));
/** `platform_users.id` is a uuid; any other subject is refused before the database is asked. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claims of a verified platform access token. */
export interface PlatformAccessTokenClaims {
  /** Platform user id. */
  sub: string;
  /** Platform role at issue time (informational; the guard re-reads the user's row). */
  role: PlatformRole;
  /** Token id. */
  jti: string;
  /** Issued at, in seconds. */
  iat: number;
  /** Expiry, in seconds. */
  exp: number;
}

export interface SignedPlatformAccessToken {
  token: string;
  /** Seconds until expiry. */
  expiresIn: number;
  expiresAt: Date;
}

export interface NewPlatformRefreshToken {
  /** The opaque token handed to the client (cookie `pla_refresh`). Never stored. */
  token: string;
  /** SHA-256 hex of the token: the only thing stored (`platform_refresh_tokens.token_hash`). */
  hash: string;
}

@Injectable()
export class PlatformTokenService {
  private readonly logger = new Logger(PlatformTokenService.name);
  private readonly key: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
  /** PLATFORM_REFRESH_TTL_DAYS in milliseconds. */
  readonly refreshTtlMs: number;
  /** PLATFORM_REFRESH_FAMILY_MAX_DAYS in milliseconds: the absolute lifetime of a session from sign-in. */
  readonly refreshFamilyMaxMs: number;

  constructor(config: ConfigService<PlatformEnv, true>) {
    const secret = config.get('PLATFORM_JWT_SECRET', { infer: true });
    if (secret) {
      this.key = new TextEncoder().encode(secret);
    } else {
      // Outside production only (platform.env.schema.ts requires the secret there).
      this.key = randomBytes(48);
      this.logger.warn(
        'PLATFORM_JWT_SECRET is not set; using an ephemeral secret — platform access tokens will not survive a restart',
      );
    }
    this.issuer = config.get('PLATFORM_JWT_ISSUER', { infer: true });
    this.audience = config.get('PLATFORM_JWT_AUDIENCE', { infer: true });
    this.accessTtlSeconds = config.get('PLATFORM_JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlMs = config.get('PLATFORM_REFRESH_TTL_DAYS', { infer: true }) * DAY_MS;
    this.refreshFamilyMaxMs = config.get('PLATFORM_REFRESH_FAMILY_MAX_DAYS', { infer: true }) * DAY_MS;
  }

  async signAccessToken(
    input: { userId: string; role: PlatformRole },
    ttlSeconds: number = this.accessTtlSeconds,
  ): Promise<SignedPlatformAccessToken> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = nowSeconds + ttlSeconds;
    const token = await new SignJWT({ role: input.role })
      .setProtectedHeader({ alg: PLATFORM_JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(input.userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(randomUUID())
      .setIssuedAt(nowSeconds)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresIn: ttlSeconds, expiresAt: new Date(exp * 1000) };
  }

  /**
   * Verifies signature, issuer, audience and expiry (5 s clock tolerance) and
   * the claim shapes. Throws `401 token_expired` or `401 token_invalid`.
   */
  async verifyAccessToken(token: string): Promise<PlatformAccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [PLATFORM_JWT_ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: 5,
      });
      const role = payload['role'];
      if (
        typeof payload.sub !== 'string' ||
        !UUID.test(payload.sub) ||
        typeof payload.jti !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        typeof role !== 'string' ||
        !PLATFORM_ROLES.has(role)
      ) {
        throw platformAuthError.tokenInvalid();
      }
      return { sub: payload.sub, role: role as PlatformRole, jti: payload.jti, iat: payload.iat, exp: payload.exp };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) throw platformAuthError.tokenExpired();
      if (isPlatformHttpException(error)) throw error;
      throw platformAuthError.tokenInvalid();
    }
  }

  /** A fresh 256-bit refresh token and its SHA-256 hex (store the hash only). */
  newRefreshToken(): NewPlatformRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** A fresh refresh token's expiry: a full lifetime, but never past the family's deadline. */
  refreshExpiry(from: Date = new Date(), deadline: Date | null = null): Date {
    const full = from.getTime() + this.refreshTtlMs;
    return new Date(deadline ? Math.min(full, deadline.getTime()) : full);
  }

  /** When the family behind `familyId` (a UUIDv7) must stop rotating; null (= expired) for any other id. */
  familyDeadline(familyId: string): Date | null {
    return familyDeadline(familyId, this.refreshFamilyMaxMs);
  }
}
