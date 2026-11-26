import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard.js';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { Public } from '../auth/decorators.js';
import { ListPublicCatalogQueryDto, PublicCatalogCourseDetailDto, PublicCatalogListDto } from './public-catalog.dto.js';
import { PublicCatalogService } from './public-catalog.service.js';

/** 60 reads per minute per IP (D-R138), like the public branding API-205. */
const PUBLIC_READ_LIMIT = { login: { limit: 60, ttl: 60 * 1000 } };

/**
 * MOD-20 (roadmap §4q, D-R138) — the public catalog for visitors who are not
 * signed in: API-236 and API-237. `@Public()` (no bearer scheme), rate
 * limited per IP, and 404 `catalog_not_public` while the academy keeps its
 * catalog to signed-in users (`settings.catalog.publicBrowsing` not true).
 * A visitor signs in to enroll (accounts come by invitation — there is no
 * self-registration); the signed-in catalog is API-219..221.
 */
@ApiTags('catalog')
@Controller('public/catalog')
@ApiTooManyRequestsResponse({ type: AuthErrorDto, description: 'rate_limited — 60 requests per minute per IP' })
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get('courses')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle(PUBLIC_READ_LIMIT)
  @ApiOperation({
    summary: 'Browse the published courses without signing in (API-236)',
    description:
      'Only while the academy opened its catalog to visitors (`settings.catalog.publicBrowsing` true — else 404 catalog_not_public). Published courses in the office’s order (PORTAL-04-COURSE-ORDER), ' +
      'keyset-paginated (`limit` 1–48, default 24; `cursor`), `q` on the code or the Arabic/English name (literal), `subjectId` (PORTAL-04: the courses of one school subject). ' +
      'Each card: cover, catalog level, the school subject (id and name), duration, sessions, ' +
      'the price (the course plan total in the academy currency — null for a free course or a price unavailable now), how many classes are open to self-service and ' +
      'whether one has a free seat, and the published lessons and curriculum levels a learner sees. Never a teacher name, a class code or schedule, or anything about ' +
      'the caller. No sign-in, 60 requests per minute per IP, no audit event.',
  })
  @ApiOkResponse({ type: PublicCatalogListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  @ApiNotFoundResponse({ description: 'catalog_not_public — the academy does not offer its catalog to visitors' })
  list(@Query() query: ListPublicCatalogQueryDto): Promise<PublicCatalogListDto> {
    return this.catalog.list(query);
  }

  @Get('courses/:id')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle(PUBLIC_READ_LIMIT)
  @ApiOperation({
    summary: 'Read one published course without signing in (API-237)',
    description:
      'The card of API-236 plus the description, the age range and the outline: the curriculum levels a learner sees with the titles, kinds and durations of their ' +
      'published lessons — no lesson id, no content, no material. 404 catalog_not_public first while the catalog is closed to visitors, then 404 course_not_found ' +
      'for an unknown or unpublished course. No sign-in, 60 requests per minute per IP, no audit event.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The course' })
  @ApiOkResponse({ type: PublicCatalogCourseDetailDto })
  @ApiBadRequestResponse({ description: 'Validation failed (the id is not a UUID)' })
  @ApiNotFoundResponse({ description: 'catalog_not_public | course_not_found — no published course with this id' })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<PublicCatalogCourseDetailDto> {
    return this.catalog.get(id);
  }
}
