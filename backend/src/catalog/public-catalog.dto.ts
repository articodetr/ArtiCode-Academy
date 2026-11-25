// MOD-20 (roadmap §4q, D-R138) — the public catalog: the published courses
// a visitor who is not signed in may browse when the academy opened its
// catalog to visitors (`settings.catalog.publicBrowsing`). API-236 (list) and
// API-237 (one course). Nothing about a caller, no teacher name, no class
// code or schedule, no lesson id or content.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { COURSE_PRICINGS } from '../courses/courses.dto.js';
import type { CoursePricing } from '../courses/courses.dto.js';
import type { LearningItemKind } from '../generated/prisma/client.js';
import { LEARNING_ITEM_KINDS } from '../learning/learning.content.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { textParam } from '../users/users.validation.js';

export const PUBLIC_CATALOG_PAGE_DEFAULT = 24;
export const PUBLIC_CATALOG_PAGE_MAX = 48;

export class ListPublicCatalogQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Literal, case-insensitive: the course code, or its Arabic or English name' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'PORTAL-04: the courses of this school subject (an unknown id matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  subjectId?: string;

  @ApiPropertyOptional({ default: PUBLIC_CATALOG_PAGE_DEFAULT, minimum: 1, maximum: PUBLIC_CATALOG_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PUBLIC_CATALOG_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same `q` and `subjectId`' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class PublicCatalogLevelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

/** PORTAL-04: the school subject of a course — its id and localized name only (never its code or state). */
export class PublicCatalogSubjectDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

export class PublicCatalogPriceDto {
  @ApiProperty({ type: Number, example: 1200, description: 'The total of the course plan (D-R122)' })
  amount: number;

  @ApiProperty({ example: 'SAR', description: 'The academy currency (D15)' })
  currency: string;
}

export class PublicCatalogCourseDto {
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

  @ApiProperty({ type: PublicCatalogLevelDto, nullable: true, description: 'The catalog level of the course (not a curriculum level)' })
  level: PublicCatalogLevelDto | null;

  @ApiProperty({ type: PublicCatalogSubjectDto, nullable: true, description: 'PORTAL-04: the school subject the course teaches; null = not set' })
  subject: PublicCatalogSubjectDto | null;

  @ApiProperty({ type: Number, nullable: true })
  durationHours: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: 'The course’s number of sessions' })
  sessionsCount: number | null;

  @ApiProperty({ enum: COURSE_PRICINGS, description: 'free = no course plan; paid = a course plan is set (its price may still be unavailable — `price` null)' })
  pricing: CoursePricing;

  @ApiProperty({ type: PublicCatalogPriceDto, nullable: true, description: 'The course price (D-R122); null for a free course, or a paid one whose plan cannot price a request now' })
  price: PublicCatalogPriceDto | null;

  @ApiProperty({ type: 'integer', description: 'Classes open to self-service now (counts only — never a code or a schedule)' })
  openClasses: number;

  @ApiProperty({ description: 'At least one of those classes has a free seat (and a usable price for a paid course)' })
  hasFreeSeat: boolean;

  @ApiProperty({ type: 'integer', description: 'Published lessons of the curriculum' })
  lessonCount: number;

  @ApiProperty({ type: 'integer', description: 'Curriculum levels a learner sees (levels holding a published lesson, plus the trailing group of lessons outside every level) — the length of `outline`' })
  levelCount: number;
}

export class PublicCatalogListDto {
  @ApiProperty({ type: [PublicCatalogCourseDto], description: 'Published courses by code' })
  items: PublicCatalogCourseDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}

export class PublicOutlineLessonDto {
  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ enum: LEARNING_ITEM_KINDS })
  kind: LearningItemKind;

  @ApiProperty({ type: 'integer', nullable: true, description: 'The media duration, else the estimated minutes × 60; null when unknown' })
  durationSeconds: number | null;
}

export class PublicOutlineLevelDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '1-based number of the level in the learning order («المستوى الأول» = 1)' })
  number: number;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true, description: 'The level’s title; null without one, and for the group of lessons outside every level' })
  title: LocalizedText | null;

  @ApiProperty({ type: [PublicOutlineLessonDto], description: 'Its published lessons, in order — titles only' })
  lessons: PublicOutlineLessonDto[];
}

export class PublicCatalogCourseDetailDto extends PublicCatalogCourseDto {
  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: 'integer', nullable: true })
  minAge: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  maxAge: number | null;

  @ApiProperty({ type: [PublicOutlineLevelDto], description: 'The curriculum a learner sees: levels with a published lesson, then the lessons outside every level — no ids, no content' })
  outline: PublicOutlineLevelDto[];
}
