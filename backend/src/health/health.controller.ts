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
      'Runs a database round trip. 200 when every dependency answers, 503 when one is down or not configured. Public.',
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
