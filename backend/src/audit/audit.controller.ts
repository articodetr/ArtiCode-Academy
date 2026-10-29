import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogListDto, AuditLogQueryDto } from './audit.dto.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({
    summary: 'List audit events (newest first)',
    description: 'Requires the `audit.read` permission (academy admin by default). Cursor pagination with `before`.',
  })
  @ApiOkResponse({ type: AuditLogListDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller lacks `audit.read`' })
  async list(@Query() query: AuditLogQueryDto): Promise<AuditLogListDto> {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.db.auditLog.findMany({
      where: query.before ? { createdAt: { lt: new Date(query.before) } } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorUserId: row.actorUserId,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: row.metadata ?? null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    }));
    const last = items.at(-1);
    return { items, nextBefore: items.length === limit && last ? last.createdAt : null };
  }
}
