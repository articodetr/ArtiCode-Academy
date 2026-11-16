// MOD-18-T03 — request and response bodies of the platform session routes
// (API-178..182; since PMFA-T03 the challenge answer of API-178 and the body of
// API-218, the second sign-in step). Same shapes as the academy MOD-01
// (src/auth/auth.dto.ts) where they overlap; the user is a platform account
// (`platform_users`).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/password.service.js';
import { PlatformRole, PlatformUserStatus } from '../../generated/platform/enums.js';
import { PLATFORM_PASSWORD_MIN_LENGTH } from './platform-session.rules.js';

export class PlatformLoginDto {
  @ApiProperty({
    description: 'E-mail address of the platform account (case-insensitive, trimmed)',
    example: 'ops@example.com',
    maxLength: 320,
  })
  @IsString()
  @Length(1, 320)
  identifier: string;

  @ApiProperty({ example: 'correct horse battery staple', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

export class PlatformChangePasswordDto {
  @ApiProperty({ maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    minLength: PLATFORM_PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: `At least ${PLATFORM_PASSWORD_MIN_LENGTH} characters, not only whitespace, different from the current one — else 400 password_weak { problems }`,
  })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class PlatformUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ops@example.com' })
  email: string;

  @ApiProperty({ example: 'Platform Operator' })
  fullName: string;

  @ApiProperty({ enum: PlatformRole, enumName: 'PlatformRole', example: 'super_admin' })
  role: PlatformRole;

  @ApiProperty({ enum: PlatformUserStatus, enumName: 'PlatformUserStatus', example: 'active' })
  status: PlatformUserStatus;
}

export class PlatformSessionResponseDto {
  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'Short-lived platform JWT; send as `Authorization: Bearer <token>`' })
  accessToken: string;

  @ApiProperty({ description: 'Seconds until the access token expires', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: PlatformUserDto })
  user: PlatformUserDto;
}

/**
 * PMFA-T03 — what API-178 answers for a platform account with two-step
 * verification: no session and no cookie yet, only the challenge of the second
 * step (API-218). The academy MfaChallengeResponseDto.
 */
export class PlatformMfaChallengeResponseDto {
  @ApiProperty({ type: Boolean, example: true, description: 'Always true: no session yet — send the challenge with a code to POST /api/auth/login/mfa' })
  mfaRequired: true;

  @ApiProperty({
    type: String,
    example: 'Qm9vay1vZi1yYW5kb20tYnl0ZXMtMzItbG9uZy0tLQ',
    description: 'One-time sign-in challenge (43 base64url characters) — only its SHA-256 is stored; valid 5 minutes and for 5 wrong codes',
  })
  challenge: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-16T09:35:00.000Z', description: 'When the challenge expires (5 minutes after issue)' })
  expiresAt: string;
}

/** PMFA-T03 — body of `POST /api/auth/login/mfa` (API-218): the challenge plus EXACTLY one factor. */
export class PlatformMfaLoginDto {
  @ApiProperty({ type: String, maxLength: 128, description: 'The `challenge` from POST /api/auth/login' })
  @IsString()
  @MaxLength(128)
  challenge: string;

  @ApiPropertyOptional({ type: String, maxLength: 32, example: '123456', description: 'The current 6-digit code of the authenticator app (spaces ignored). Send this OR `recoveryCode`' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 64,
    example: 'ABCDE-FGHJK',
    description: 'One unused recovery code (dashes, spaces and case ignored); it is used up. Send this OR `code`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

export class PlatformAuthErrorDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({ example: 'invalid_credentials', description: 'Stable machine-readable code' })
  code: string;

  @ApiProperty({ example: 'Invalid e-mail or password' })
  message: string;

  @ApiPropertyOptional({ description: 'Seconds to wait (account_locked)' })
  retryAfterSeconds?: number;

  @ApiPropertyOptional({ type: [String], description: 'Policy violations of the new password (password_weak)' })
  problems?: string[];
}
