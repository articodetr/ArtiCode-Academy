// MOD-19 (roadmap §4p, D-R129) — the course catalog read by learners with
// `courses.read` (API-219/220) and the self-service enrollment (API-221).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { COURSE_PRICINGS } from '../courses/courses.dto.js';
import type { CoursePricing } from '../courses/courses.dto.js';
import { MyEnrollmentRequestDto, RequestTeacherDto } from '../enrollments/enrollment-requests.dto.js';
import { REQUEST_STATES } from '../enrollments/enrollment-requests.policy.js';
import type { RequestState } from '../enrollments/enrollment-requests.policy.js';
import { ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { textParam } from '../users/users.validation.js';
import { CATALOG_BLOCKERS, SELF_SERVICE_REASONS } from './catalog.policy.js';
import type { CatalogBlocker, SelfServiceReason } from './catalog.policy.js';

export const CATALOG_PAGE_DEFAULT = 24;
export const CATALOG_PAGE_MAX = 100;
/** At most this many lead teachers named on a course card. */
export const CARD_TEACHERS_MAX = 5;

const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];

/**
 * A query-string boolean read from the RAW value — the global implicit
 * conversion would turn "false" into true: exactly `true` or `false`,
 * anything else stays a string and fails @IsBoolean.
 */
function booleanParam({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const raw = obj[key];
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return raw;
}

export class ListCatalogQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Literal, case-insensitive: the course code, or its Arabic or English name' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  levelId?: string;

  @ApiPropertyOptional({ enum: COURSE_PRICINGS })
  @IsOptional()
  @IsIn(COURSE_PRICINGS)
  pricing?: CoursePricing;

  @ApiPropertyOptional({ type: Boolean, description: 'true = at least one class takes a self-service enrollment now (open to it, a free seat, a usable price); false = none' })
  @IsOptional()
  @Transform(booleanParam)
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ default: CATALOG_PAGE_DEFAULT, minimum: 1, maximum: CATALOG_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CATALOG_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CatalogLevelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

export class CatalogPriceDto {
  @ApiProperty({ type: Number, example: 1200, description: 'The total of the course plan (D-R122)' })
  amount: number;

  @ApiProperty({ example: 'SAR', description: 'The academy currency (D15)' })
  currency: string;

  @ApiProperty({ type: 'integer', description: 'Installments of the invoice a request gets' })
  installments: number;
}

export class CatalogMineDto {
  @ApiProperty({ description: 'The reader holds an active or completed enrollment in a class of the course' })
  enrolled: boolean;

  @ApiProperty({ description: 'The reader has a pending request in a class of the course' })
  pending: boolean;
}

export class CatalogCourseCardDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  summary: LocalizedText | null;

  @ApiProperty({ type: String, nullable: true })
  coverImageUrl: string | null;

  @ApiProperty({ type: CatalogLevelDto, nullable: true })
  level: CatalogLevelDto | null;

  @ApiProperty({ type: Number, nullable: true })
  durationHours: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: 'The course’s number of sessions' })
  sessionsCount: number | null;

  @ApiProperty({ type: 'integer' })
  syllabusCount: number;

  @ApiProperty({ enum: COURSE_PRICINGS })
  pricing: CoursePricing;

  @ApiProperty({ type: CatalogPriceDto, nullable: true, description: 'null for a free course, or a paid one whose plan cannot price a request now' })
  price: CatalogPriceDto | null;

  @ApiProperty({ type: 'integer', description: 'Classes open to self-service now (open or running, opened by the office)' })
  openClasses: number;

  @ApiProperty({ type: 'integer', description: 'Of those, the ones with a free seat (and a usable price for a paid course)' })
  availableClasses: number;

  @ApiProperty({ type: [RequestTeacherDto], description: `Lead teachers of the open classes, by name only (at most ${CARD_TEACHERS_MAX})` })
  teachers: RequestTeacherDto[];

  @ApiProperty({ type: CatalogMineDto })
  mine: CatalogMineDto;
}

export class CatalogListDto {
  @ApiProperty({ type: [CatalogCourseCardDto], description: 'Published courses by code' })
  items: CatalogCourseCardDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}

export class CatalogSlotDto {
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday' })
  weekday: number;

  @ApiProperty({ example: '17:00' })
  startTime: string;

  @ApiProperty({ example: '18:30' })
  endTime: string;

  @ApiProperty({ example: 'Asia/Riyadh', description: 'The room’s branch zone, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty({ example: '2026-11-01', description: 'YYYY-MM-DD' })
  effectiveFrom: string;

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD; null = open-ended' })
  effectiveTo: string | null;
}

export class CatalogMyEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  status: EnrollmentStatus;

  @ApiProperty({ enum: REQUEST_STATES })
  state: RequestState;
}

export class CatalogClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD' })
  startsOn: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD' })
  endsOn: string | null;

  @ApiProperty({ type: 'integer' })
  capacity: number;

  @ApiProperty({ type: 'integer', description: 'Active enrollments' })
  enrolledCount: number;

  @ApiProperty({ type: 'integer' })
  seatsLeft: number;

  @ApiProperty({ type: RequestTeacherDto, nullable: true, description: 'The lead teacher by name only' })
  leadTeacher: RequestTeacherDto | null;

  @ApiProperty({ type: [CatalogSlotDto], description: 'Weekly slots effective today or later (they are not confirmed lessons)' })
  schedule: CatalogSlotDto[];

  @ApiProperty({ description: 'The office opened the class to self-service' })
  selfEnrollment: boolean;

  @ApiProperty({ description: 'API-221 would accept the reader now' })
  enrollable: boolean;

  @ApiProperty({ enum: CATALOG_BLOCKERS, nullable: true, description: 'Why not, in the order API-221 refuses' })
  blocker: CatalogBlocker | null;

  @ApiProperty({ type: CatalogMyEnrollmentDto, nullable: true, description: 'The reader’s own enrollment or request in this class' })
  myEnrollment: CatalogMyEnrollmentDto | null;
}

export class CatalogSyllabusItemDto {
  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: 'integer', nullable: true })
  estimatedMinutes: number | null;
}

export class CatalogSelfServiceDto {
  @ApiProperty({ description: 'The reader may enroll themself (D-R124)' })
  allowed: boolean;

  @ApiProperty({ enum: SELF_SERVICE_REASONS, nullable: true })
  reason: SelfServiceReason | null;
}

export class CatalogCourseDetailDto extends CatalogCourseCardDto {
  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: 'integer', nullable: true })
  minAge: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  maxAge: number | null;

  @ApiProperty({ type: [CatalogSyllabusItemDto], description: 'Titles and estimates only — lessons, assignments and materials stay behind an active enrollment' })
  syllabus: CatalogSyllabusItemDto[];

  @ApiProperty({ type: [CatalogClassDto], description: 'Classes open to self-service now, and every class holding the reader’s own enrollment or pending request' })
  classes: CatalogClassDto[];

  @ApiProperty({ type: CatalogSelfServiceDto })
  selfService: CatalogSelfServiceDto;
}

export const ENROLL_OUTCOMES = ['enrolled', 'requested'] as const;
export type EnrollOutcome = (typeof ENROLL_OUTCOMES)[number];

export class CatalogEnrollResultDto {
  @ApiProperty({ enum: ENROLL_OUTCOMES, description: 'enrolled = a free course, active at once; requested = a paid course, pending with an invoice' })
  outcome: EnrollOutcome;

  @ApiProperty({ type: MyEnrollmentRequestDto, description: 'The enrollment in the request view' })
  enrollment: MyEnrollmentRequestDto;
}
