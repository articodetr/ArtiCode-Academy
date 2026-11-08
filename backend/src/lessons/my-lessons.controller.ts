import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListMyLessonsQueryDto, MyLessonListDto } from './my-lessons.dto.js';
import { MyLessonsService } from './my-lessons.service.js';

/**
 * MOD-06-T04 — the caller's lessons (roadmap §4f.4 API-101). No
 * `@RequirePermissions`: every signed-in user may call it and sees only the
 * lessons of their own classes and their linked children's (ownership —
 * D-R32), with their own attendance status.
 */
@ApiTags('lessons')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyLessonsController {
  constructor(private readonly myLessons: MyLessonsService) {}

  @Get('lessons')
  @ApiOperation({
    summary: 'List my lessons',
    description:
      'The lessons of the classes the caller is enrolled in, now or finished (`relation: self`), and of the classes the students linked to the caller as guardian are enrolled in — while the caller holds the `guardian` role (`relation: child`). ' +
      'One item per lesson and student (a guardian with two children in one class sees its lessons twice), by start time then id (`order` asc by default), keyset-paginated (`limit` counts lessons, `cursor`), ' +
      'with filters `classId`, `studentId`, `status`, `from` and `to` (instants). Each item carries the lesson (title, description, times, status, meeting link, room, syllabus item, teacher by name), the class and course, ' +
      'the student (identity only) and that student’s attendance status and lateness — never the teacher’s note, who recorded it, the cancellation reason or anyone else’s record. ' +
      'No permission key is needed (ownership); a user without an owned enrollment gets an empty list.',
  })
  @ApiOkResponse({ type: MyLessonListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListMyLessonsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyLessonListDto> {
    return this.myLessons.list(query, caller);
  }
}
