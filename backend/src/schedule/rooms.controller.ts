import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { CreateRoomDto, ListRoomsQueryDto, RoomDto, RoomListDto, UpdateRoomDto } from './rooms.dto.js';
import { RoomsService } from './rooms.service.js';
import { MANAGE_SCHEDULE_PERMISSION } from './schedule.policy.js';

/**
 * MOD-07-T02 (O9) — the rooms of the academy (roadmap §4e, API-084..API-087).
 * Reading needs no permission key (D-R27 — every signed-in user, the branches
 * pattern of D-R21); every write needs `schedule.manage`. The global guards
 * (Origin → Auth → Permissions) run first.
 */
@ApiTags('schedule')
@ApiBearerAuth()
@Controller('rooms')
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @ApiOperation({
    summary: 'List rooms',
    description:
      'The rooms of the academy’s own site first, then by branch code, then by room code. Every authenticated user sees the active rooms; ' +
      'holders of `schedule.manage` also see inactive ones. Filters: `branchId` (a branch id, or `none` for the rooms without a branch) and `kind`. No pagination (a short list).',
  })
  @ApiOkResponse({ type: RoomListDto })
  @ApiBadRequestResponse({ description: 'Validation failed (`branchId` neither a uuid nor `none`, unknown `kind`)' })
  list(@Query() query: ListRoomsQueryDto, @CurrentUser() caller: AuthPrincipal): Promise<RoomListDto> {
    return this.rooms.list(query, caller);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MANAGE_SCHEDULE_PERMISSION)
  @ApiOperation({
    summary: 'Create a room',
    description:
      'Creates a room with the audit event `rooms.created` in the same transaction. The code is trimmed and upper-cased and must be unique inside the branch ' +
      '(rooms without a branch share one namespace). A branch, when given, must exist and be active. Requires `schedule.manage`.',
  })
  @ApiCreatedResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'Validation failed (code format, name without `ar`, capacity not a positive integer, unknown kind, non-boolean flag, …)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `schedule.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'branch_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'branch_inactive' })
  @ApiConflictResponse({ description: 'room_code_taken — `{ roomCode, branchId }`' })
  create(@Body() body: CreateRoomDto, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<RoomDto> {
    return this.rooms.create(body, caller, requestContext(req));
  }

  @Patch(':id')
  @RequirePermissions(MANAGE_SCHEDULE_PERMISSION)
  @ApiOperation({
    summary: 'Update a room',
    description:
      'Partial update of `code`, `name` (whole localized object), `capacity`, `kind`, `branchId` and `isActive`; `null` clears the name and the capacity and moves the room to the academy’s own site. ' +
      'Only fields whose value changes are written, in one transaction with the audit event `rooms.updated` (field names, no values). ' +
      'Moving a room between branches is allowed; deactivating it keeps its existing slots (new slots are refused). Requires `schedule.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RoomDto, description: 'The room after the update (unchanged when nothing differed)' })
  @ApiBadRequestResponse({ description: 'Validation failed or `nothing_to_update` (no field in the body)' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `schedule.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'room_not_found | branch_not_found' })
  @ApiUnprocessableEntityResponse({ description: 'branch_inactive' })
  @ApiConflictResponse({ description: 'room_code_taken' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRoomDto,
    @CurrentUser() caller: AuthPrincipal,
    @Req() req: Request,
  ): Promise<RoomDto> {
    return this.rooms.update(id, body, caller, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE_SCHEDULE_PERMISSION)
  @ApiOperation({
    summary: 'Delete a room',
    description:
      'Deletes a room that no weekly slot uses, with the audit event `rooms.deleted` in the same transaction (deactivate a room in use instead). Requires `schedule.manage`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `schedule.manage`; origin_forbidden' })
  @ApiNotFoundResponse({ description: 'room_not_found' })
  @ApiConflictResponse({ description: 'room_in_use — `slotCount` weekly slots still use the room' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() caller: AuthPrincipal, @Req() req: Request): Promise<void> {
    return this.rooms.remove(id, caller, requestContext(req));
  }
}
