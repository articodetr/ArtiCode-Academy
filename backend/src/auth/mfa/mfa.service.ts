// MOD-01-H06 MFA-T02 — the caller's own two-step verification (API-206..API-210,
// roadmap §4n, D-R107..D-R112): status, setup, enabling, disabling and new
// recovery codes. Every write runs in one transaction after `MfaCore.lockUser()`
// and records exactly one audit event; a refusal writes and records nothing.
// A wrong password or code here never counts towards the sign-in lockout —
// the "login" throttler of the controller limits the guessing.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { authError } from '../auth.errors.js';
import { PasswordService } from '../password.service.js';
import type { AuthPrincipal, RequestContext } from '../principal.js';
import type { MfaDisabledDto, MfaEnabledDto, MfaRecoveryCodesDto, MfaSetupDto, MfaStatusDto } from './mfa.dto.js';
import { MFA_SETUP_TTL_MS, MFA_USER_SELECT, MfaCore } from './mfa-core.service.js';
import type { MfaUserState } from './mfa-core.service.js';
import { factorOf, mfaAccountLabel, mfaIssuer } from './mfa.rules.js';
import { generateTotpSecret, otpauthUri } from './totp.js';

export const MFA_AUDIT_ACTIONS = {
  enabled: 'auth.mfa.enabled',
  disabled: 'auth.mfa.disabled',
  recoveryCodesRegenerated: 'auth.mfa.recovery_codes.regenerated',
} as const;

type Tx = Prisma.TransactionClient;

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaCore,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ API-206

  /** The caller's MFA state. Reads only the database, so it answers without the key too (`available: false`). */
  async status(userId: string): Promise<MfaStatusDto> {
    const db = this.prisma.db;
    const state = await db.user.findUnique({ where: { id: userId }, select: MFA_USER_SELECT });
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

  // ------------------------------------------------------------ API-207

  /**
   * Starts a setup: a new secret, sealed into `mfa_pending_secret` (an older
   * pending setup is replaced). The plain secret leaves the server in this
   * answer only. No audit event — the account's security has not changed yet.
   */
  async setup(caller: AuthPrincipal, password: string): Promise<MfaSetupDto> {
    this.mfa.assertAvailable();
    await this.verifyPassword(caller.id, password);
    const issuer = mfaIssuer((await this.prisma.db.academy.findFirst({ select: { name: true } }))?.name);
    const secret = generateTotpSecret();
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, caller.id);
      if (state.mfaSecret !== null) throw authError.mfaAlreadyEnabled();
      await tx.user.update({
        where: { id: caller.id },
        data: { mfaPendingSecret: this.mfa.seal(caller.id, secret), mfaPendingAt: now },
      });
    });
    return {
      secret,
      otpauthUri: otpauthUri({ issuer, account: mfaAccountLabel(caller), secret }),
      expiresAt: new Date(now.getTime() + MFA_SETUP_TTL_MS).toISOString(),
    };
  }

  // ------------------------------------------------------------ API-208

  /**
   * Confirms the pending setup with a code of its secret: MFA on, ten new
   * recovery codes (shown once), every other session of the caller signed out
   * (D-R111). One `auth.mfa.enabled` event.
   */
  async enable(callerId: string, code: string, refreshToken: string | undefined, ctx: RequestContext): Promise<MfaEnabledDto> {
    this.mfa.assertAvailable();
    const keepFamilyId = await this.mfa.familyOf(callerId, refreshToken);
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, callerId);
      if (state.mfaSecret !== null) throw authError.mfaAlreadyEnabled();
      if (!this.mfa.setupIsFresh(state, now)) throw authError.mfaSetupRequired();
      const step = this.mfa.matchPending(state, code, now.getTime());
      if (step === null) throw authError.mfaCodeInvalid();

      await tx.user.update({
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
      await this.audit.record(
        { action: MFA_AUDIT_ACTIONS.enabled, actorUserId: callerId, entityType: 'users', entityId: callerId, metadata: { revokedSessions }, ...ctx },
        tx,
      );
      return { enabledAt: now.toISOString(), recoveryCodes, revokedSessions };
    });
  }

  // ------------------------------------------------------------ API-209

  /**
   * Turns MFA off with the password and one second factor (a TOTP code or an
   * unused recovery code); the secret, the recovery codes and any open sign-in
   * challenge go, and every other session is signed out (D-R111). One
   * `auth.mfa.disabled` event.
   */
  async disable(
    callerId: string,
    body: { password: string; code?: string | null; recoveryCode?: string | null },
    refreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<MfaDisabledDto> {
    this.mfa.assertAvailable();
    const factor = factorOf(body);
    if (!factor) throw authError.mfaFactorRequired();
    await this.verifyPassword(callerId, body.password);
    const keepFamilyId = await this.mfa.familyOf(callerId, refreshToken);
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, callerId);
      if (state.mfaSecret === null) throw authError.mfaNotEnabled();
      // A wrong factor throws here and the transaction writes nothing.
      const accepted =
        factor.kind === 'code'
          ? await this.mfa.acceptCode(tx, state, factor.value, now.getTime())
          : (await this.mfa.consumeRecoveryCode(tx, callerId, factor.value)) !== null;
      if (!accepted) throw authError.mfaCodeInvalid();

      await this.mfa.clear(tx, callerId, now);
      const revokedSessions = await this.mfa.revokeSessions(tx, callerId, keepFamilyId, now);
      await this.audit.record(
        {
          action: MFA_AUDIT_ACTIONS.disabled,
          actorUserId: callerId,
          entityType: 'users',
          entityId: callerId,
          metadata: { via: factor.kind, revokedSessions },
          ...ctx,
        },
        tx,
      );
      return { revokedSessions };
    });
  }

  // ------------------------------------------------------------ API-210

  /** Replaces the recovery codes after the password and a current TOTP code; the old ones stop working. One event. */
  async regenerateRecoveryCodes(callerId: string, password: string, code: string, ctx: RequestContext): Promise<MfaRecoveryCodesDto> {
    this.mfa.assertAvailable();
    await this.verifyPassword(callerId, password);
    const now = new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockedState(tx, callerId);
      if (state.mfaSecret === null) throw authError.mfaNotEnabled();
      if (!(await this.mfa.acceptCode(tx, state, code, now.getTime()))) throw authError.mfaCodeInvalid();

      const recoveryCodes = await this.mfa.replaceRecoveryCodes(tx, callerId);
      await this.audit.record(
        {
          action: MFA_AUDIT_ACTIONS.recoveryCodesRegenerated,
          actorUserId: callerId,
          entityType: 'users',
          entityId: callerId,
          metadata: { count: recoveryCodes.length },
          ...ctx,
        },
        tx,
      );
      return { recoveryCodes };
    });
  }

  // ------------------------------------------------------------ helpers

  /** `400 password_invalid` unless `password` is the caller's current one (same timing without a hash). Never counts towards the lockout. */
  private async verifyPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) {
      await this.passwords.verifyDummy(password);
      throw authError.passwordInvalid();
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) throw authError.passwordInvalid();
  }

  /** The caller's MFA columns under the row lock; a row gone since the AuthGuard read it ends the session. */
  private async lockedState(tx: Tx, userId: string): Promise<MfaUserState> {
    const state = await this.mfa.lockUser(tx, userId);
    if (!state) throw authError.sessionInvalid();
    return state;
  }
}
