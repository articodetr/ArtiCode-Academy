// MOD-18-T03 — request and response bodies of the platform session routes
// (API-178..182). Same shapes as the academy MOD-01 (src/auth/auth.dto.ts)
// where they overlap; the user is a platform account (`platform_users`).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
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
