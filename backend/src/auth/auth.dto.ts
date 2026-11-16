import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.service.js';

export class LoginDto {
  @ApiProperty({
    description: 'E-mail address or username (case-insensitive)',
    example: 'admin@example.com',
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

export class ChangePasswordDto {
  @ApiProperty({ maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'admin@example.com' })
  email: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'student1' })
  username: string | null;

  @ApiProperty({ example: 'سارة أحمد' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true, enum: ['ar', 'en', 'tr'] })
  locale: string | null;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ description: 'True when the user must set a new password before working' })
  mustChangePassword: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-12T09:30:00.000Z',
    description:
      'When the user confirmed their current e-mail address (API-166, LR-01-T02); null while it is unconfirmed or there is none — an e-mail change clears it. The caller’s own value, whatever their permissions (CH-0226)',
  })
  emailVerifiedAt: string | null;

  @ApiProperty({ type: [String], example: ['academy_admin'] })
  roles: string[];

  @ApiProperty({ type: [String], example: ['users.read', 'audit.read'] })
  permissions: string[];
}

export class SessionResponseDto {
  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'Short-lived JWT; send as `Authorization: Bearer <token>`' })
  accessToken: string;

  @ApiProperty({ description: 'Seconds until the access token expires', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

/**
 * MFA-T03 (D-R109): what API-005 (a correct password) and API-020 (a confirmed
 * reset) answer for an account with two-step verification, instead of a
 * session. No cookie goes with it; the client finishes with API-211.
 */
export class MfaChallengeResponseDto {
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

/** MFA-T03 — body of `POST /api/auth/login/mfa` (API-211): the challenge plus EXACTLY one factor. */
export class MfaLoginDto {
  @ApiProperty({ type: String, maxLength: 128, description: 'The `challenge` from POST /api/auth/login (or a confirmed password reset)' })
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

export class AuthErrorDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({ example: 'invalid_credentials', description: 'Stable machine-readable code' })
  code: string;

  @ApiProperty({ example: 'Invalid identifier or password' })
  message: string;

  @ApiPropertyOptional({ description: 'Seconds to wait (account_locked)' })
  retryAfterSeconds?: number;

  @ApiPropertyOptional({ type: [String], description: 'Missing permission keys (permission_denied)' })
  missing?: string[];
}
