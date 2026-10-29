import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PACKAGE_VERSION, SERVICE_NAME } from '../common/package-info.js';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DatabaseCheckDto, HealthResponseDto, ReadinessResponseDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  check(): HealthResponseDto {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: PACKAGE_VERSION,
      environment: this.config.get('NODE_ENV', { infer: true }),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /** Readiness: dependencies answer. The controller maps `not_ready` to HTTP 503. */
  async readiness(): Promise<ReadinessResponseDto> {
    const ping = await this.prisma.ping();
    const database: DatabaseCheckDto = ping.ok
      ? { status: 'up', latencyMs: ping.latencyMs }
      : ping.configured
        ? { status: 'down', error: ping.error }
        : { status: 'not_configured' };

    return {
      status: database.status === 'up' ? 'ready' : 'not_ready',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }
}
