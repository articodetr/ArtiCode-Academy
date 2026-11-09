import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListMyAssignmentsQueryDto, MyAssignmentListDto } from './my-assignments.dto.js';
import { MyAssignmentsService } from './my-assignments.service.js';

/**
 * MOD-08-T04 — the caller's assignments (roadmap §4g.4 API-112). No
 * `@RequirePermissions`: every signed-in user may call it and sees only the
 * assignments of their own classes and their linked children's (ownership —
 * D-R40), with their own attempts.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyAssignmentsController {
  constructor(private readonly myAssignments: MyAssignmentsService) {}

  @Get('assignments')
  @ApiOperation({
    summary: 'List my assignments',
    description:
      'The open and closed assignments (never drafts) of the classes the caller is enrolled in, now or finished (`relation: self`), and of the classes the students linked to the caller as guardian are enrolled in — while the caller holds the `guardian` role (`relation: child`). ' +
      'One item per assignment and student (a guardian with two children in one class sees its assignments twice), by due date — undated last — then id (`order` asc by default), keyset-paginated (`limit` counts assignments, `cursor`), ' +
      'with filters `classId`, `studentId`, `status` (open|closed), `pending` (only the items of a student who has not submitted yet), `dueFrom` and `dueTo`. ' +
      'Each item carries the assignment, the class and course, the linked lesson, the student (identity only), that student’s attempts and the review of their latest attempt (status, score, feedback) — never the weight, the reviewer, the answer or anyone else’s attempt. ' +
      'No permission key is needed (ownership); a user without an owned enrollment gets an empty list.',
  })
  @ApiOkResponse({ type: MyAssignmentListDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `cursor_invalid`' })
  list(@Query() query: ListMyAssignmentsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyAssignmentListDto> {
    return this.myAssignments.list(query, caller);
  }
}
