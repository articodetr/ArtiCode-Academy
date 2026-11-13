import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/decorators.js';
import { PlatformHealthResponseDto, PlatformReadinessResponseDto } from './platform-health.dto.js';
import { PlatformHealthService } from './platform-health.service.js';

@ApiTags('health')
@Controller('health')
@Public()
export class PlatformHealthController {
  constructor(private readonly health: PlatformHealthService) {}

  /** API-176 */
  @Get()
  @ApiOperation({
    summary: 'Liveness check of the platform API',
    description: 'Returns service identity (`articode-platform-api`), version, environment and uptime. Public.',
  })
  @ApiOkResponse({ type: PlatformHealthResponseDto })
  check(): PlatformHealthResponseDto {
    return this.health.check();
  }

  /** API-177 */
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness check of the platform API',
    description:
      'The rules of the academy API-004 on the PLATFORM database: a round trip, then the newest migration shipped under `prisma/platform/migrations` against the platform `_prisma_migrations` (`checks.schema`). 200 when the database answers and the schema is `current`, `ahead` or `unchecked`; 503 `not_ready` with `reason` `database_unavailable`, `schema_outdated` (run `npm run platform:deploy`) or `schema_unverified`. Public.',
  })
  @ApiOkResponse({ type: PlatformReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: PlatformReadinessResponseDto })
  async ready(@Res({ passthrough: true }) res: Response): Promise<PlatformReadinessResponseDto> {
    const report = await this.health.readiness();
    res.status(report.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
