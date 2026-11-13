import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { HealthResponseDto, ReadinessResponseDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness check',
    description:
      'Returns service identity, version, environment and uptime. Public; no authentication.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return this.healthService.check();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness check',
    description:
      'Runs a database round trip, then compares the newest migration shipped with this build (`prisma/migrations`) with the newest finished, not rolled-back row of `_prisma_migrations` (`checks.schema`). 200 when the database answers and the schema is `current`, `ahead` (an older build during an upgrade) or `unchecked` (no shipped migration found); 503 `not_ready` with a `reason`: `database_unavailable` (down or not configured), `schema_outdated` (the shipped migration is not applied — run `prisma migrate deploy`) or `schema_unverified` (`_prisma_migrations` could not be read). Public.',
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessResponseDto> {
    const report = await this.healthService.readiness();
    res.status(
      report.status === 'ready'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return report;
  }
}
