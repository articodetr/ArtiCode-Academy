// PMFA-T02 (roadmap §4o, D-R113..D-R120) — bodies and answers of the platform
// user's own two-step verification routes (API-213..API-217), the academy's
// MFA-T02 shapes (src/auth/mfa/mfa.dto.ts, API-206..API-210) under their own
// names in the platform OpenAPI document. The TOTP secret and the recovery
// codes appear in plain text in exactly one answer each (setup, enable /
// regenerate) and are never stored or logged that way.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../../auth/password.service.js';

/** A TOTP code as typed: six digits, spaces allowed ("123 456") — the academy's limit. */
export const PLATFORM_MFA_CODE_MAX_LENGTH = 16;
/** A recovery code as typed: 'XXXXX-XXXXX', spaces and dashes allowed, any case — the academy's limit. */
export const PLATFORM_MFA_RECOVERY_CODE_MAX_LENGTH = 32;

// ---------------------------------------------------------------- bodies

export class PlatformMfaSetupRequestDto {
  @ApiProperty({ description: 'The caller’s current platform password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

export class PlatformMfaEnableRequestDto {
  @ApiProperty({
    example: '492039',
    maxLength: PLATFORM_MFA_CODE_MAX_LENGTH,
    description: 'The 6-digit code the authenticator app shows for the secret of `POST /api/auth/mfa/setup`',
  })
  @IsString()
  @Length(1, PLATFORM_MFA_CODE_MAX_LENGTH)
  code: string;
}

export class PlatformMfaDisableRequestDto {
  @ApiProperty({ description: 'The caller’s current platform password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;

  @ApiPropertyOptional({
    example: '492039',
    maxLength: PLATFORM_MFA_CODE_MAX_LENGTH,
    description: 'A current 6-digit code of the authenticator app. Send exactly one of `code` and `recoveryCode`.',
  })
  @IsOptional()
  @IsString()
  @Length(1, PLATFORM_MFA_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({
    example: 'K7QX4-M9TRB',
    maxLength: PLATFORM_MFA_RECOVERY_CODE_MAX_LENGTH,
    description: 'An unused recovery code (case, spaces and dashes do not matter). Send exactly one of `code` and `recoveryCode`.',
  })
  @IsOptional()
  @IsString()
  @Length(1, PLATFORM_MFA_RECOVERY_CODE_MAX_LENGTH)
  recoveryCode?: string;
}

export class PlatformMfaRegenerateRequestDto {
  @ApiProperty({ description: 'The caller’s current platform password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;

  @ApiProperty({ example: '492039', maxLength: PLATFORM_MFA_CODE_MAX_LENGTH, description: 'A current 6-digit code of the authenticator app' })
  @IsString()
  @Length(1, PLATFORM_MFA_CODE_MAX_LENGTH)
  code: string;
}

// --------------------------------------------------------------- answers

export class PlatformMfaStatusDto {
  @ApiProperty({
    type: Boolean,
    description:
      'False when the platform server has no `PLATFORM_MFA_ENCRYPTION_KEY`: every MFA write answers `503 mfa_unavailable` and an account with MFA on cannot finish signing in',
  })
  available: boolean;

  @ApiProperty({ type: Boolean, description: 'True while two-step verification is on for the caller' })
  enabled: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-16T09:30:00.000Z',
    description: 'When it was turned on; null while it is off',
  })
  enabledAt: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: 10,
    example: 10,
    description: 'Unused recovery codes; null while it is off',
  })
  recoveryCodesLeft: number | null;

  @ApiProperty({
    type: Boolean,
    description:
      'True while a setup started less than 10 minutes ago awaits its confirmation (`POST /api/auth/mfa/enable`); always false while it is on',
  })
  pendingSetup: boolean;
}

export class PlatformMfaSetupDto {
  @ApiProperty({
    type: String,
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    description:
      'The new shared secret, Base32 (RFC 4648, no padding), to type into the authenticator app. Shown in this answer only — it is stored sealed and never shown again.',
  })
  secret: string;

  @ApiProperty({
    type: String,
    example:
      'otpauth://totp/ArtiCode%20Platform:ops%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=ArtiCode%20Platform&algorithm=SHA1&digits=6&period=30',
    description:
      'The same secret as an `otpauth://` URI (Key URI Format) to draw as a QR code: issuer `ArtiCode Platform`, account = the caller’s e-mail',
  })
  otpauthUri: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-16T09:40:00.000Z',
    description: 'Confirm with a code before this instant (10 minutes)',
  })
  expiresAt: string;
}

export class PlatformMfaEnabledDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-16T09:31:12.000Z' })
  enabledAt: string;

  @ApiProperty({
    type: [String],
    example: ['K7QX4-M9TRB', 'P3ZWN-8HDCA'],
    description: 'Ten one-time recovery codes, shown in this answer only (stored as hashes)',
  })
  recoveryCodes: string[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 1,
    description: 'Other platform sessions of the caller that were signed out; the session of this request’s `pla_refresh` cookie stays',
  })
  revokedSessions: number;
}

export class PlatformMfaDisabledDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 1,
    description: 'Other platform sessions of the caller that were signed out; the session of this request’s `pla_refresh` cookie stays',
  })
  revokedSessions: number;
}

export class PlatformMfaRecoveryCodesDto {
  @ApiProperty({
    type: [String],
    example: ['K7QX4-M9TRB', 'P3ZWN-8HDCA'],
    description: 'Ten new one-time recovery codes, shown in this answer only; every earlier code stops working',
  })
  recoveryCodes: string[];
}
