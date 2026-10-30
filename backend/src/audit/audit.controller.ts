import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import { AuditLogListDto, AuditLogQueryDto } from './audit.dto.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({
    summary: 'List audit events (newest first)',
    description:
      'Requires the `audit.read` permission (academy admin by default). Filters (`action` prefix, `actorUserId`, `entityType` + `entityId`, `before`) are ANDed; keyset pagination with `cursor` = `nextCursor` of the previous page.',
  })
  @ApiOkResponse({ type: AuditLogListDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameter (unknown field, malformed id or cursor, `entityId` without `entityType`)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller lacks `audit.read`' })
  list(@Query() query: AuditLogQueryDto): Promise<AuditLogListDto> {
    return this.audit.list(query);
  }
}
