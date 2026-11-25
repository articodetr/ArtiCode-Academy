// PORTAL-03/04 (#207, contract v3) — the shapes of the self-registration routes in the OpenAPI document. The two
// request bodies are DOCUMENTATION ONLY: the routes take the raw JSON body and check it with registration.rules.ts,
// so that every refusal — an unknown field included — is `400 registration_invalid { fields, unknown }` and never
// the global ValidationPipe's own 400. Do not add class-validator decorators here: they would never run. The
// completion answers the session body of every sign-in (`SessionResponseDto` of auth.dto.ts).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.service.js';
import { EMAIL_MAX_LENGTH, FULL_NAME_MAX_LENGTH, FULL_NAME_MIN_LENGTH, REGISTRATION_LOCALES, REGISTRATION_PROBLEMS } from './registration.rules.js';

/** Body of `POST /api/account/register`. Any other field (a role, a permission…) is refused. */
export class RegisterDto {
  @ApiProperty({
    minLength: FULL_NAME_MIN_LENGTH,
    maxLength: FULL_NAME_MAX_LENGTH,
    example: 'سارة أحمد',
    description: 'The visitor’s full name, trimmed; counted in characters (code points). Never put in an e-mail.',
  })
  fullName: string;

  @ApiProperty({ maxLength: EMAIL_MAX_LENGTH, example: 'sara@example.test', description: 'Trimmed and lower-cased before use' })
  email: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description:
      'The password the visitor chooses (MOD-01 policy, as for an invitation: 10–128 characters, not only whitespace). ' +
      'Longer than 128 → `registration_invalid` (`too_long`); otherwise outside the policy → `password_weak`. ' +
      'The account stays `pending` until the e-mailed link is opened and this same password typed there.',
  })
  password: string;

  @ApiPropertyOptional({ enum: REGISTRATION_LOCALES, description: 'The language of the e-mail and of the new account; absent = the academy default' })
  locale?: string;
}

/** Body of `POST /api/account/register/:token/complete`. Any other field is refused. */
export class CompleteRegistrationDto {
  @ApiProperty({
    minLength: 1,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'The password chosen at registration (`POST /api/account/register`); a wrong one → `registration_password_incorrect { attemptsLeft }`',
  })
  password: string;
}

/** `GET /api/account/register/:token`: what the page shows before the password is typed. */
export class RegistrationPreviewDto {
  @ApiProperty({ example: 'سارة أحمد', description: 'The name typed at registration' })
  fullName: string;

  @ApiProperty({ example: 's***@example.test', description: 'The masked address the link was sent to' })
  maskedEmail: string;

  @ApiProperty({ format: 'date-time', description: '`AUTH_EMAIL_VERIFICATION_TTL_HOURS` after the link was issued' })
  expiresAt: string;
}

/** `400 registration_password_incorrect`. */
export class RegistrationPasswordIncorrectErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 'registration_password_incorrect' })
  code: string;

  @ApiProperty({ example: 'This is not the password chosen at registration' })
  message: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 4,
    description: 'Wrong passwords this link still takes; at 0 the link is retired (the next try is `registration_link_invalid`)',
  })
  attemptsLeft: number;
}

/** `400 registration_invalid`. */
export class RegistrationInvalidErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 'registration_invalid' })
  code: string;

  @ApiProperty({ example: 'The registration request is not valid' })
  message: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string', enum: [...REGISTRATION_PROBLEMS] } },
    example: { email: ['invalid_format'] },
    description: 'The problems of each field that has one: required | too_short | too_long | invalid_format | blank',
  })
  fields: Record<string, string[]>;

  @ApiProperty({ type: [String], example: ['roleKeys'], description: 'Fields the route does not accept' })
  unknown: string[];
}
