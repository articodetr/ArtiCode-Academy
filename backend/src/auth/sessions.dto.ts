// MOD-01-H06 — the caller's active sessions (API-201/202). A session is one
// refresh-token family: it starts at sign-in and keeps its `family_id` through
// every rotation (refresh-family.ts). The response never carries a token, a
// hash or the rotation chain (`replaced_by_id`).
import { ApiProperty } from '@nestjs/swagger';

export class SessionItemDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: '019a7c2e-5b1d-7f3a-9c4e-2d8b6a1f0e37',
    description: 'The session id: the refresh-token family id, a UUIDv7 that carries the sign-in time. Pass it to `DELETE /api/auth/sessions/{id}`.',
  })
  id: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-15T08:12:40.000Z', description: 'Sign-in time, read from the family id' })
  startedAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T10:47:03.512Z',
    description: 'When the newest refresh token of the session was issued: the sign-in, or the last refresh of the access token',
  })
  lastActiveAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-22T10:47:03.512Z',
    description: 'When the session ends unless it is refreshed again: the expiry of its live refresh token, never past the family’s absolute deadline (MOD-01-H03)',
  })
  expiresAt: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
    description: 'User-Agent header of the request that issued the newest refresh token (at most 512 characters); null when none was sent',
  })
  userAgent: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '203.0.113.7',
    description: 'Client IP address of the request that issued the newest refresh token (behind a proxy only with `TRUST_PROXY`); null when unknown',
  })
  ipAddress: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'True for the session of the refresh cookie this request carries (this device); false for every item when no cookie of the caller was sent',
  })
  current: boolean;
}

export class SessionListDto {
  @ApiProperty({ type: [SessionItemDto], description: 'The caller’s sessions that still have a live refresh token, newest activity first' })
  items: SessionItemDto[];
}
