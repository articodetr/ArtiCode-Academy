import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExamGradingService } from './exam-grading.service.js';

/** How often the sweeper looks for attempts whose time is over. */
export const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * MOD-09 phase 2 — the server's own clock for the attempts at online exams
 * (decision D-R154, ADR-081). An attempt's deadline is fixed by the server at
 * its start and no write is accepted after it; this timer makes sure an
 * attempt nobody comes back to is still closed and graded with what was saved:
 * once at boot (what a stopped process left open) and then every minute.
 *
 * In the process, like the notification dispatcher (ADR-071): no job runner
 * and no queue. One process per academy (ADR-045); a second one would do no
 * harm — the sweep takes its rows `FOR UPDATE SKIP LOCKED` and an attempt is
 * graded once under its row lock. The timer never keeps the process alive
 * (`unref`), a failed sweep is logged and tried again at the next tick, and a
 * tick that finds the previous one still running does nothing.
 *
 * Off when `NODE_ENV=test`: the test runs share one database, so there the
 * suites call `ExamGradingService.sweep()` themselves, narrowed to their own
 * exams. Log lines carry counts only.
 */
@Injectable()
export class ExamAttemptsSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExamAttemptsSweeper.name);
  private readonly automatic: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: ExamGradingService,
    config: ConfigService<Env, true>,
  ) {
    this.automatic = config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.automatic || !this.prisma.isConfigured) return;
    setImmediate(() => void this.tick());
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: closes the attempts whose time is over. Never throws. */
  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const closed = await this.grading.sweep(now);
      if (closed > 0) this.logger.log(`closed ${closed} online exam attempt(s) whose time was over`);
      return closed;
    } catch (error: unknown) {
      this.logger.error('sweep of overdue online exam attempts failed', error instanceof Error ? error.stack : String(error));
      return 0;
    } finally {
      this.running = false;
    }
  }
}
