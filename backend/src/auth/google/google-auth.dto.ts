import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';
import { RETURN_TO_MAX_LENGTH } from './google-state.js';

/** Body of `POST /api/auth/google/start`. */
export class GoogleStartDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: RETURN_TO_MAX_LENGTH,
    example: '/catalog/0194f6d2-8a4b-7c1e-9f00-123456789abc?intent=enroll',
    description:
      'Where the frontend continues after the sign-in: a same-origin path of at most 512 characters that starts with exactly one `/` ' +
      '(not `//` or `/\\`), without backslashes, control characters or white space, and not under `/api/`. Anything else — a full URL included — becomes `/`; it is never refused.',
  })
  // Any value is accepted and reduced by the safe rule (google-state.ts safeReturnTo()), never echoed unchecked.
  @Allow()
  returnTo?: string;
}

/** Answer of `POST /api/auth/google/start`. */
export class GoogleStartResponseDto {
  @ApiProperty({
    type: String,
    example:
      'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=…&redirect_uri=…&scope=openid+email+profile&state=…&nonce=…&code_challenge=…&code_challenge_method=S256&prompt=select_account',
    description: 'The Google authorization URL; the frontend navigates there with `window.location.assign(url)`',
  })
  url: string;
}
