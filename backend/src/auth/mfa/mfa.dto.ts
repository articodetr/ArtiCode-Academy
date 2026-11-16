// MOD-01-H06 MFA-T02 — bodies and answers of the caller's own two-step
// verification routes (API-206..API-210, roadmap §4n, D-R110). The TOTP secret
// and the recovery codes appear in plain text in exactly one answer each
// (setup, enable / regenerate) and are never stored or logged that way.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password.service.js';

/** A TOTP code as typed: six digits, spaces allowed ("123 456"). */
export const MFA_CODE_MAX_LENGTH = 16;
/** A recovery code as typed: 'XXXXX-XXXXX', spaces and dashes allowed, any case. */
export const MFA_RECOVERY_CODE_MAX_LENGTH = 32;

// ---------------------------------------------------------------- bodies

export class MfaSetupRequestDto {
  @ApiProperty({ description: 'The caller’s current password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

export class MfaEnableRequestDto {
  @ApiProperty({
    example: '492039',
    maxLength: MFA_CODE_MAX_LENGTH,
    description: 'The 6-digit code the authenticator app shows for the secret of `POST /api/auth/mfa/setup`',
  })
  @IsString()
  @Length(1, MFA_CODE_MAX_LENGTH)
  code: string;
}

export class MfaDisableRequestDto {
  @ApiProperty({ description: 'The caller’s current password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;

  @ApiPropertyOptional({
    example: '492039',
    maxLength: MFA_CODE_MAX_LENGTH,
    description: 'A current 6-digit code of the authenticator app. Send exactly one of `code` and `recoveryCode`.',
  })
  @IsOptional()
  @IsString()
  @Length(1, MFA_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({
    example: 'K7QX4-M9TRB',
    maxLength: MFA_RECOVERY_CODE_MAX_LENGTH,
    description: 'An unused recovery code (case, spaces and dashes do not matter). Send exactly one of `code` and `recoveryCode`.',
  })
  @IsOptional()
  @IsString()
  @Length(1, MFA_RECOVERY_CODE_MAX_LENGTH)
  recoveryCode?: string;
}

export class MfaRegenerateRequestDto {
  @ApiProperty({ description: 'The caller’s current password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;

  @ApiProperty({ example: '492039', maxLength: MFA_CODE_MAX_LENGTH, description: 'A current 6-digit code of the authenticator app' })
  @IsString()
  @Length(1, MFA_CODE_MAX_LENGTH)
  code: string;
}

// --------------------------------------------------------------- answers

export class MfaStatusDto {
  @ApiProperty({
    type: Boolean,
    description: 'False when the server has no `AUTH_MFA_ENCRYPTION_KEY`: every MFA write answers `503 mfa_unavailable` and an account with MFA on cannot finish signing in',
  })
  available: boolean;

  @ApiProperty({ type: Boolean, description: 'True while two-step verification is on for the caller' })
  enabled: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-16T09:30:00.000Z', description: 'When it was turned on; null while it is off' })
  enabledAt: string | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: 10, example: 10, description: 'Unused recovery codes; null while it is off' })
  recoveryCodesLeft: number | null;

  @ApiProperty({
    type: Boolean,
    description: 'True while a setup started less than 10 minutes ago awaits its confirmation (`POST /api/auth/mfa/enable`); always false while it is on',
  })
  pendingSetup: boolean;
}

export class MfaSetupDto {
  @ApiProperty({
    type: String,
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    description: 'The new shared secret, Base32 (RFC 4648, no padding), to type into the authenticator app. Shown in this answer only — it is stored sealed and never shown again.',
  })
  secret: string;

  @ApiProperty({
    type: String,
    example: 'otpauth://totp/Arti%20Academy:sara%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Arti%20Academy&algorithm=SHA1&digits=6&period=30',
    description: 'The same secret as an `otpauth://` URI (Key URI Format) to draw as a QR code: issuer = the academy name, account = the caller’s e-mail, else username, else id',
  })
  otpauthUri: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-16T09:40:00.000Z', description: 'Confirm with a code before this instant (10 minutes)' })
  expiresAt: string;
}

export class MfaEnabledDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-16T09:31:12.000Z' })
  enabledAt: string;

  @ApiProperty({
    type: [String],
    example: ['K7QX4-M9TRB', 'P3ZWN-8HDCA'],
    description: 'Ten one-time recovery codes, shown in this answer only (stored as hashes)',
  })
  recoveryCodes: string[];

  @ApiProperty({ type: 'integer', minimum: 0, example: 1, description: 'Other sessions of the caller that were signed out; the session of this request’s refresh cookie stays' })
  revokedSessions: number;
}

export class MfaDisabledDto {
  @ApiProperty({ type: 'integer', minimum: 0, example: 1, description: 'Other sessions of the caller that were signed out; the session of this request’s refresh cookie stays' })
  revokedSessions: number;
}

export class MfaRecoveryCodesDto {
  @ApiProperty({
    type: [String],
    example: ['K7QX4-M9TRB', 'P3ZWN-8HDCA'],
    description: 'Ten new one-time recovery codes, shown in this answer only; every earlier code stops working',
  })
  recoveryCodes: string[];
}
