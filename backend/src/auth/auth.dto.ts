import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
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

  @ApiProperty({ nullable: true, example: 'admin@example.com' })
  email: string | null;

  @ApiProperty({ nullable: true, example: 'student1' })
  username: string | null;

  @ApiProperty({ example: 'سارة أحمد' })
  fullName: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true, enum: ['ar', 'en', 'tr'] })
  locale: string | null;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ description: 'True when the user must set a new password before working' })
  mustChangePassword: boolean;

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
