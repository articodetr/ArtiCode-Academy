import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ListMyClassesQueryDto, MyClassListDto } from './my-classes.dto.js';
import { MyClassesService } from './my-classes.service.js';

/**
 * MOD-05-T05 — the caller's classes. No `@RequirePermissions`: every signed-in
 * user may call it and sees only their own enrollments and their linked
 * children's (ownership — D-R16).
 */
@ApiTags('enrollments')
@ApiBearerAuth()
@Controller('me')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class MyClassesController {
  constructor(private readonly myClasses: MyClassesService) {}

  @Get('classes')
  @ApiOperation({
    summary: 'List my classes',
    description:
      'The classes of the caller as a student (`relation: self`) and of the students linked to the caller as guardian (`relation: child`), newest enrollment first, ' +
      '`active` and `completed` enrollments unless `status` is given. Each item names the student (identity only), the class and its course, and the lead teacher by name. ' +
      'No permission key is needed (ownership); a user without enrollments or linked children gets an empty list.',
  })
  @ApiOkResponse({ type: MyClassListDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  list(@Query() query: ListMyClassesQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<MyClassListDto> {
    return this.myClasses.list(query, caller);
  }
}
