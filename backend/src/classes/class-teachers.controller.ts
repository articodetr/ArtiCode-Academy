import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { requestContext } from '../auth/cookies.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import type { AuthPrincipal } from '../auth/principal.js';
import { ReplaceClassTeachersDto } from './class-teachers.dto.js';
import { ClassTeachersService } from './class-teachers.service.js';
import { ClassDto } from './classes.dto.js';
import { ASSIGN_CLASS_TEACHERS_PERMISSION } from './classes.policy.js';

/**
 * MOD-05-T03 — the teachers of a class (roadmap §4d.4). Needs
 * `classes.teachers.assign` (academy_admin by seed). The global guards
 * (Origin → Auth → Permissions) run first.
 */
@ApiTags('classes')
@ApiBearerAuth()
@Controller('classes')
@RequirePermissions(ASSIGN_CLASS_TEACHERS_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `classes.teachers.assign`; origin_forbidden' })
export class ClassTeachersController {
  constructor(private readonly teachers: ClassTeachersService) {}

  @Put(':id/teachers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace the teachers of a class',
    description:
      'Full replacement `{ teachers: [{ userId, role }] }` (up to 20; `[]` removes everyone), applied as a diff: new users are added with the caller as `assigned_by`, missing ones removed, kept ones get their new role. ' +
      'At most one `lead`; every added or role-changed user must be invited or active and hold the `teacher` role. ' +
      'One audit event `classes.teachers.changed { added, removed, roleChanged }`; an identical list writes nothing. Requires `classes.teachers.assign`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClassDto })
  @ApiBadRequestResponse({ description: 'Validation failed or `teachers_invalid` — `{ duplicates, leadCount }`' })
  @ApiNotFoundResponse({ description: 'class_not_found | user_not_found — `{ userId }`' })
  @ApiUnprocessableEntityResponse({ description: 'not_a_teacher — `{ userId }` | user_not_eligible — `{ userId, status }`' })
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ReplaceClassTeachersDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<ClassDto> {
    return this.teachers.replace(id, body, caller, requestContext(req));
  }
}
