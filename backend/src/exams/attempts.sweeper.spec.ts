// TEST-284 (unit part) — the in-process sweeper of overdue attempts (D-R154, ADR-081): when it runs, and that it never throws.
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ExamAttemptsSweeper, SWEEP_INTERVAL_MS } from './attempts.sweeper.js';
import type { ExamGradingService } from './exam-grading.service.js';

function build(nodeEnv: string, options: { configured?: boolean; sweep?: () => Promise<number> } = {}) {
  const sweep = vi.fn(options.sweep ?? (async () => 0));
  const grading = { sweep } as unknown as ExamGradingService;
  const prisma = { isConfigured: options.configured ?? true } as unknown as PrismaService;
  const config = { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
  return { sweeper: new ExamAttemptsSweeper(prisma, grading, config), sweep };
}

/** Lets the `setImmediate` of the boot and the promise of a tick settle under fake timers. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('ExamAttemptsSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The sweeper logs what it closed and any failed pass; the spec asserts on its answers, not on the console.
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sweeps once at boot and then every minute, and stops with the module', async () => {
    const { sweeper, sweep } = build('production');
    sweeper.onApplicationBootstrap();
    await settle();
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS - 1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(5);

    sweeper.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(5 * SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(5);
  });

  it('stays off under NODE_ENV=test (the test runs share a database) and without a database', async () => {
    for (const { sweeper, sweep } of [build('test'), build('development', { configured: false })]) {
      sweeper.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(3 * SWEEP_INTERVAL_MS);
      expect(sweep).not.toHaveBeenCalled();
      sweeper.onModuleDestroy();
    }
  });

  it('runs in development too', async () => {
    const { sweeper, sweep } = build('development');
    sweeper.onApplicationBootstrap();
    await settle();
    expect(sweep).toHaveBeenCalledTimes(1);
    sweeper.onModuleDestroy();
  });

  it('reports what a pass closed, and never throws: a failed sweep is tried again at the next tick', async () => {
    let calls = 0;
    const { sweeper, sweep } = build('test', {
      sweep: async () => {
        calls += 1;
        if (calls === 1) throw new Error('database gone');
        return 3;
      },
    });
    await expect(sweeper.tick()).resolves.toBe(0);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    await expect(sweeper.tick()).resolves.toBe(3);
    expect(sweep).toHaveBeenCalledTimes(2);
    // Counts only: a log line never names a student or an exam.
    expect(Logger.prototype.log).toHaveBeenCalledWith('closed 3 online exam attempt(s) whose time was over');
  });

  it('does nothing while the previous pass is still running', async () => {
    let release: (closed: number) => void = () => undefined;
    const { sweeper, sweep } = build('test', { sweep: () => new Promise<number>((resolve) => (release = resolve)) });
    const first = sweeper.tick();
    await expect(sweeper.tick()).resolves.toBe(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    release(2);
    await expect(first).resolves.toBe(2);
    // The next pass runs again.
    const next = sweeper.tick();
    release(1);
    await expect(next).resolves.toBe(1);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
