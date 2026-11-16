// PMFA-T02 (roadmap §4o, D-R113..D-R120) — the platform user's own two-step
// verification (API-213..API-217): status, setup, enabling, disabling and new
// recovery codes. The academy's MfaService (src/auth/mfa/mfa.service.ts,
// MFA-T02) on the platform accounts, through PlatformMfaCore and the platform
// client only (ADR-073; the pure helpers of src/auth/mfa/ — D-R120). Every
// write runs in one transaction after `PlatformMfaCore.lockUser()` and records
// exactly one platform audit event; a refusal writes and records nothing. A
// wrong password or code here never counts towards the sign-in lockout
// (`failed_login_count`) — the platform_auth limiter of the controller limits
// the guessing.
import { Injectable } from '@nestjs/common';
import { PasswordService } from '../../../auth/password.service.js';
import type { RequestContext } from '../../../auth/principal.js';
import { factorOf, mfaAccountLabel } from '../../../auth/mfa/mfa.rules.js';
import { generateTotpSecret, otpauthUri } from '../../../auth/mfa/totp.js';
import { PlatformAuditService } from '../../audit/platform-audit.service.js';
import { platformAuthError } from '../../platform.errors.js';
import { PlatformPrismaService } from '../../prisma/platform-prisma.service.js';
import type { PlatformTransaction } from '../../prisma/platform-prisma.service.js';
import type { PlatformPrincipal } from '../platform-principal.js';
import { PLATFORM_USERS_ENTITY } from '../platform-session.rules.js';
import type {
  PlatformMfaDisabledDto,
  PlatformMfaEnabledDto,
  PlatformMfaRecoveryCodesDto,
  PlatformMfaSetupDto,
  PlatformMfaStatusDto,
} from './platform-mfa.dto.js';
import { PLATFORM_MFA_SETUP_TTL_MS, PLATFORM_MFA_USER_SELECT, PlatformMfaCore } from './platform-mfa-core.service.js';
import type { PlatformMfaUserState } from './platform-mfa-core.service.js';

/** Event names of the platform user's own MFA writes (master doc 12.4). */
export const PLATFORM_MFA_EVENTS = {
  enabled: 'platform.auth.mfa.enabled',
  disabled: 'platform.auth.mfa.disabled',
  recoveryCodesRegenerated: 'platform.auth.mfa.recovery_codes.regenerated',
} as const;

/** The issuer an authenticator app shows for a platform account (one control plane, no per-academy name). */
export const PLATFORM_MFA_ISSUER = 'ArtiCode Platform';

@Injectable()
export class PlatformMfaService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly passwords: PasswordService,
    private readonly mfa: PlatformMfaCore,
    private readonly audit: PlatformAuditService,
  ) {}

  // ------------------------------------------------------------ API-213

  /** The caller's MFA state. Reads only the database, so it answers without the key too (`available: false`). */
  async status(userId: string): Promise<PlatformMfaStatusDto> {
    const db = this.prisma.db;
    const state = await db.platformUser.findUnique({ where: { id: userId }, select: PLATFORM_MFA_USER_SELECT });
    if (state === null || state.mfaSecret === null) {
      return {
        available: this.mfa.available,
        enabled: false,
        enabledAt: null,
        recoveryCodesLeft: null,
        pendingSetup: state !== null && this.mfa.setupIsFresh(state),
      };
    }
    return {
      available: this.mfa.available,
      enabled: true,
      enabledAt: state.mfaEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft: await this.mfa.recoveryCodesLeft(db, userId),
      pendingSetup: false,
    };
  }

  // ------------------------------------------------------------ API-214

  /**
   * Starts a setup: a new secret, sealed into `mfa_pending_secret` (an older
   * pending setup is replaced). The plain secret leaves the server in this
   * answer only. No audit event — the account's security has not changed yet.
   */
  async setup(caller: PlatformPrincipal, password: string): Promise<PlatformMfaSetupDto> {
    this.mfa.assertAvailable();
    await this.verifyPassword(caller.id, password);
    const secret = generateTotpSecret();
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, caller.id);
      if (state.mfaSecret !== null) throw platformAuthError.mfaAlreadyEnabled();
      await tx.platformUser.update({
        where: { id: caller.id },
        data: { mfaPendingSecret: this.mfa.seal(caller.id, secret), mfaPendingAt: now },
      });
    });
    return {
      secret,
      otpauthUri: otpauthUri({
        issuer: PLATFORM_MFA_ISSUER,
        account: mfaAccountLabel({ id: caller.id, email: caller.email, username: null }),
        secret,
      }),
      expiresAt: new Date(now.getTime() + PLATFORM_MFA_SETUP_TTL_MS).toISOString(),
    };
  }

  // ------------------------------------------------------------ API-215

  /**
   * Confirms the pending setup with a code of its secret: MFA on, ten new
   * recovery codes (shown once), every other platform session of the caller
   * signed out — the family of the caller's own `pla_refresh` cookie stays
   * (D-R118). One `platform.auth.mfa.enabled { revokedSessions }`.
   */
  async enable(
    callerId: string,
    code: string,
    refreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<PlatformMfaEnabledDto> {
    this.mfa.assertAvailable();
    const keepFamilyId = await this.mfa.familyOf(callerId, refreshToken);
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, callerId);
      if (state.mfaSecret !== null) throw platformAuthError.mfaAlreadyEnabled();
      if (!this.mfa.setupIsFresh(state, now)) throw platformAuthError.mfaSetupRequired();
      const step = this.mfa.matchPending(state, code, now.getTime());
      if (step === null) throw platformAuthError.mfaCodeInvalid();

      await tx.platformUser.update({
        where: { id: callerId },
        data: {
          mfaSecret: state.mfaPendingSecret,
          mfaEnabledAt: now,
          mfaLastStep: BigInt(step),
          mfaPendingSecret: null,
          mfaPendingAt: null,
        },
      });
      const recoveryCodes = await this.mfa.replaceRecoveryCodes(tx, callerId);
      const revokedSessions = await this.mfa.revokeSessions(tx, callerId, keepFamilyId, now);
      await this.audit.record(tx, {
        actorId: callerId,
        action: PLATFORM_MFA_EVENTS.enabled,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: callerId,
        metadata: { revokedSessions },
        ctx,
      });
      return { enabledAt: now.toISOString(), recoveryCodes, revokedSessions };
    });
  }

  // ------------------------------------------------------------ API-216

  /**
   * Turns MFA off with the password and one second factor (a TOTP code or an
   * unused recovery code, which is spent); the secret, the recovery codes and
   * any open sign-in challenge go, and every other platform session is signed
   * out (D-R118). One `platform.auth.mfa.disabled { via, revokedSessions }`.
   */
  async disable(
    callerId: string,
    body: { password: string; code?: string | null; recoveryCode?: string | null },
    refreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<PlatformMfaDisabledDto> {
    this.mfa.assertAvailable();
    const factor = factorOf(body);
    if (!factor) throw platformAuthError.mfaFactorRequired();
    await this.verifyPassword(callerId, body.password);
    const keepFamilyId = await this.mfa.familyOf(callerId, refreshToken);
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, callerId);
      if (state.mfaSecret === null) throw platformAuthError.mfaNotEnabled();
      // A wrong factor throws here and the transaction writes nothing.
      const accepted =
        factor.kind === 'code'
          ? await this.mfa.acceptCode(tx, state, factor.value, now.getTime())
          : (await this.mfa.consumeRecoveryCode(tx, callerId, factor.value)) !== null;
      if (!accepted) throw platformAuthError.mfaCodeInvalid();

      await this.mfa.clear(tx, callerId, now);
      const revokedSessions = await this.mfa.revokeSessions(tx, callerId, keepFamilyId, now);
      await this.audit.record(tx, {
        actorId: callerId,
        action: PLATFORM_MFA_EVENTS.disabled,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: callerId,
        metadata: { via: factor.kind, revokedSessions },
        ctx,
      });
      return { revokedSessions };
    });
  }

  // ------------------------------------------------------------ API-217

  /**
   * Replaces the recovery codes after the password and a current TOTP code;
   * every earlier code stops working, sessions are not touched. One
   * `platform.auth.mfa.recovery_codes.regenerated { count }`.
   */
  async regenerateRecoveryCodes(
    callerId: string,
    password: string,
    code: string,
    ctx: RequestContext,
  ): Promise<PlatformMfaRecoveryCodesDto> {
    this.mfa.assertAvailable();
    await this.verifyPassword(callerId, password);
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, callerId);
      if (state.mfaSecret === null) throw platformAuthError.mfaNotEnabled();
      if (!(await this.mfa.acceptCode(tx, state, code, now.getTime()))) throw platformAuthError.mfaCodeInvalid();

      const recoveryCodes = await this.mfa.replaceRecoveryCodes(tx, callerId);
      await this.audit.record(tx, {
        actorId: callerId,
        action: PLATFORM_MFA_EVENTS.recoveryCodesRegenerated,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: callerId,
        metadata: { count: recoveryCodes.length },
        ctx,
      });
      return { recoveryCodes };
    });
  }

  // ------------------------------------------------------------ helpers

  /**
   * `400 password_invalid` unless `password` is the caller's current one —
   * exactly as `changePassword()` of platform-session.service.ts checks it
   * (the same Argon2 time without a hash). Never counts towards the lockout.
   */
  private async verifyPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.db.platformUser.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) {
      await this.passwords.verifyDummy(password);
      throw platformAuthError.passwordInvalid();
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) throw platformAuthError.passwordInvalid();
  }

  /** The caller's MFA columns under the row lock (`FOR NO KEY UPDATE`); a row gone since the guard read it ends the session. */
  private async lockedState(tx: PlatformTransaction, userId: string): Promise<PlatformMfaUserState> {
    const state = await this.mfa.lockUser(tx, userId);
    if (!state) throw platformAuthError.sessionInvalid();
    return state;
  }
}
