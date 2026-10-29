import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.service.js';

export class MailDeliveryDto {
  @ApiProperty({ example: 'none', description: 'Transport that handled the message: `none` (nothing sent — D-R08), `log` (development), or a provider name later' })
  transport: string;

  @ApiProperty({
    enum: ['skipped', 'logged', 'sent', 'failed'],
    example: 'skipped',
    description: '`skipped` also when the account has no e-mail address; a failure never fails the request — the link below stays valid',
  })
  status: string;
}

export class IssueInvitationResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The invited user' })
  userId: string;

  @ApiProperty({
    description:
      'The raw one-time invitation token — returned ONCE to the authorized caller and never stored (only its SHA-256 is). Hand the link over to the person (D-R01).',
    example: 'Qm9vay1vZi1yYW5kb20tYnl0ZXMtMzItbG9uZy0tLQ',
  })
  token: string;

  @ApiProperty({
    description: 'Link the person opens: `<APP_PUBLIC_URL>/invite/<token>`, or the root-relative path `/invite/<token>` when APP_PUBLIC_URL is not set',
    example: 'https://academy.example/invite/Qm9vay1vZi1yYW5kb20tYnl0ZXMtMzItbG9uZy0tLQ',
  })
  link: string;

  @ApiProperty({ description: 'ISO 8601; `AUTH_INVITATION_TTL_HOURS` after issue (48 h by default — D-R02)' })
  expiresAt: string;

  @ApiProperty({ type: MailDeliveryDto, description: 'What happened to the e-mail copy of the invitation' })
  delivery: MailDeliveryDto;
}

/** What the public invitation page shows before the password is chosen. */
export class InvitationPreviewDto {
  @ApiProperty({ example: 'سارة أحمد' })
  fullName: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true, enum: ['ar', 'en', 'tr'], description: 'Preferred locale of the invitee; null = academy default' })
  locale: string | null;

  @ApiProperty({ nullable: true, example: 's***@example.test', description: 'Masked e-mail address, or null for a username-only account' })
  email: string | null;

  @ApiProperty({ nullable: true, example: 'sa***', description: 'Masked username, or null' })
  username: string | null;

  @ApiProperty({ type: [String], example: ['teacher'], description: 'Role keys the account holds, sorted' })
  roles: string[];

  @ApiProperty({ description: 'ISO 8601' })
  expiresAt: string;
}

export class AcceptInvitationDto {
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'The password the person chooses (MOD-01 policy: 10–128 characters, not only whitespace)',
  })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;
}
