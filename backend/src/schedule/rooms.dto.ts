import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { codeParam, LEVEL_CODE_PATTERN, rawBoolean, rawNumber } from '../courses/courses.validation.js';
import { RoomKind } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { trimParam } from '../users/users.validation.js';

/** Room codes: 1–16 characters, upper-case letters, digits, `.`, `_`, `-` — the level alphabet (CHECK `ck_rooms_code_trimmed`, `varchar(16)`). */
export const ROOM_CODE_PATTERN = LEVEL_CODE_PATTERN;
/** `capacity` is a smallint (> 0 by CHECK `ck_rooms_capacity_positive`). */
export const ROOM_CAPACITY_MAX = 32767;
export const ROOM_KINDS = Object.values(RoomKind) as RoomKind[];
/** `branchId=none` lists the rooms of the academy's own site (no branch). */
export const NO_BRANCH_FILTER = 'none';

const CODE_MESSAGE = 'code must be 1–16 characters: letters, digits, ".", "_" or "-" (stored upper-case)';
const BRANCH_FILTER_MESSAGE = `branchId must be a uuid or "${NO_BRANCH_FILTER}"`;

export class ListRoomsQueryDto {
  @ApiPropertyOptional({ description: `A branch id, or \`${NO_BRANCH_FILTER}\` for the rooms without a branch (the academy's own site); absent = every room` })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @ValidateIf((dto: ListRoomsQueryDto) => dto.branchId !== NO_BRANCH_FILTER)
  @IsUUID('all', { message: BRANCH_FILTER_MESSAGE })
  branchId?: string;

  @ApiPropertyOptional({ enum: ROOM_KINDS })
  @IsOptional()
  @IsIn(ROOM_KINDS)
  kind?: RoomKind;
}

export class CreateRoomDto {
  @ApiProperty({ maxLength: 16, example: 'LAB-1', description: 'Trimmed and upper-cased; unique inside the branch (rooms without a branch share one namespace)' })
  @Transform(codeParam)
  @IsString()
  @Matches(ROOM_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required when given' })
  @IsOptional()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: ROOM_CAPACITY_MAX, example: 24, description: 'Seats; a JSON integer. Not checked against class capacity (§4e.1)' })
  @IsOptional()
  @Transform(rawNumber)
  @IsInt()
  @Min(1)
  @Max(ROOM_CAPACITY_MAX)
  capacity?: number;

  @ApiPropertyOptional({ enum: ROOM_KINDS, default: RoomKind.classroom })
  @IsOptional()
  @IsIn(ROOM_KINDS)
  kind?: RoomKind;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'An existing, active branch; absent = the academy’s own site' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean, default: true, description: 'Inactive rooms are visible to holders of `schedule.manage` only and accept no new slots' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/**
 * PATCH semantics (as API-018): an absent field is left alone, `null` clears
 * `name` and `capacity` and moves the room to the academy's own site
 * (`branchId`), a value replaces. `name` is replaced as a whole object
 * (ADR-044). `code`, `kind` and `isActive` refuse `null`.
 */
export class UpdateRoomDto {
  @ApiPropertyOptional({ maxLength: 16, example: 'LAB-2', description: 'Trimmed and upper-cased; unique inside the (new) branch' })
  @ValidateIf((dto: UpdateRoomDto) => dto.code !== undefined)
  @Transform(codeParam)
  @IsString()
  @Matches(ROOM_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Replaces the whole localized name; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'name must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: ROOM_CAPACITY_MAX, description: 'A JSON integer; null clears it' })
  @ValidateIf((dto: UpdateRoomDto) => dto.capacity !== undefined && dto.capacity !== null)
  @Transform(rawNumber)
  @IsInt()
  @Min(1)
  @Max(ROOM_CAPACITY_MAX)
  capacity?: number | null;

  @ApiPropertyOptional({ enum: ROOM_KINDS })
  @ValidateIf((dto: UpdateRoomDto) => dto.kind !== undefined)
  @IsIn(ROOM_KINDS)
  kind?: RoomKind;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Moves the room to an existing, active branch; null moves it to the academy’s own site' })
  @ValidateIf((dto: UpdateRoomDto) => dto.branchId !== undefined && dto.branchId !== null)
  @IsUUID('all')
  branchId?: string | null;

  @ApiPropertyOptional({ type: Boolean, description: 'false deactivates the room: existing slots stay, new slots are refused (`room_inactive`)' })
  @ValidateIf((dto: UpdateRoomDto) => dto.isActive !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/** The branch a room belongs to, by id, code and name (no address or phone — see API-080). */
export class RoomBranchDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'MAIN' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'الفرع الرئيسي' } })
  name: LocalizedText;
}

export class RoomDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LAB-1' })
  code: string;

  @ApiProperty({ type: Object, nullable: true, description: 'Localized name `{ ar, en?, tr? }`; null = the code alone', example: { ar: 'مختبر 1' } })
  name: LocalizedText | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Seats, when known' })
  capacity: number | null;

  @ApiProperty({ enum: ROOM_KINDS })
  kind: RoomKind;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null = the academy’s own site' })
  branchId: string | null;

  @ApiProperty({ type: RoomBranchDto, nullable: true })
  branch: RoomBranchDto | null;

  @ApiProperty({
    example: 'Asia/Riyadh',
    description:
      'IANA zone the room’s times are shown in: its branch’s `timezone`, else the academy’s (UTC without the academy row) — the rule of `timeZone` in API-090/091 and `LessonDto` (D-R41), so a form types a new lesson’s times in the zone of the room it picks',
  })
  timeZone: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class RoomListDto {
  @ApiProperty({ type: [RoomDto], description: 'The academy’s own site first, then by branch code, then by room code' })
  items: RoomDto[];
}
