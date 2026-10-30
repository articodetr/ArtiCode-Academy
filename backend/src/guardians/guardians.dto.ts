import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { GuardianRelationship } from '../generated/prisma/client.js';
import { UserListItemDto } from '../users/users.dto.js';

const RELATIONSHIPS = Object.values(GuardianRelationship);

/**
 * Body booleans must be JSON booleans. Reads the raw value so the implicit
 * conversion of the ValidationPipe (`Boolean('yes') === true`, `Boolean(1)`)
 * cannot turn a string or a number into `true`; @IsBoolean then rejects it.
 */
function rawBoolean({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class LinkGuardianDto {
  @ApiProperty({ format: 'uuid', description: 'The guardian to link; must hold the `guardian` role and differ from the student' })
  @IsUUID()
  guardianId: string;

  @ApiProperty({ enum: RELATIONSHIPS, example: 'mother' })
  @IsEnum(GuardianRelationship)
  relationship: GuardianRelationship;

  @ApiPropertyOptional({ default: false, description: 'Make this guardian the student’s primary guardian; demotes the current one' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isPrimary?: boolean;
}

/** PATCH semantics: an absent field is left alone; `{}` is refused (`nothing_to_update`). */
export class UpdateGuardianLinkDto {
  @ApiPropertyOptional({ enum: RELATIONSHIPS })
  @IsOptional()
  @IsEnum(GuardianRelationship)
  relationship?: GuardianRelationship;

  @ApiPropertyOptional({ description: '`true` makes this guardian primary (demoting the current one); `false` leaves the student without a primary guardian' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isPrimary?: boolean;
}

/** One link seen from either side: the other party in the caller’s projection plus the link itself. */
export class GuardianLinkItemDto {
  @ApiProperty({
    type: UserListItemDto,
    description: 'The linked user (the guardian under `/guardians`, the student under `/students`) in the caller’s projection — contact fields need `users.read_contact`',
  })
  user: UserListItemDto;

  @ApiProperty({ enum: RELATIONSHIPS })
  relationship: GuardianRelationship;

  @ApiProperty({ description: 'Whether this guardian is the student’s primary guardian (at most one per student)' })
  isPrimary: boolean;

  @ApiProperty({ description: 'ISO 8601 — when the link was created' })
  createdAt: string;
}

export class GuardianLinkListDto {
  @ApiProperty({ type: [GuardianLinkItemDto], description: 'Guardians: primary first, then by link creation; students: by link creation' })
  items: GuardianLinkItemDto[];
}
