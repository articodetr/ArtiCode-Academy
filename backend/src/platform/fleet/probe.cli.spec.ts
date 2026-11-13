// TEST-210 (unit part) — MOD-18-T05: the command line of the periodic fleet
// probe (arguments, the narrow environment, the output lines, the loop).
import { describe, expect, it, vi } from 'vitest';
import type { ProbeRoundSummary } from './fleet.service.js';
import { parseProbeArgs, probeErrorLine, readProbeEnv, roundLine, runProbeLoop, secretsOf } from './probe.cli.js';

const ROUND: ProbeRoundSummary = { probed: 3, ready: 1, notReady: 1, unreachable: 1, invalid: 0, behind: 1, failed: 0 };

describe('fleet probe command line (TEST-210)', () => {
  it('takes --once and --help only', () => {
    expect(parseProbeArgs([])).toEqual({ help: false, once: false });
    expect(parseProbeArgs(['--once'])).toEqual({ help: false, once: true });
    expect(parseProbeArgs(['--help'])).toEqual({ help: true });
    expect(() => parseProbeArgs(['--all'])).toThrow(/unknown argument "--all"/);
  });

  it('reads only what it needs: production runs without PLATFORM_JWT_SECRET', () => {
    const env = readProbeEnv({
      NODE_ENV: 'production',
      PLATFORM_DATABASE_URL: 'postgresql://platform_app:pw@db:5432/articode_platform',
    });
    expect(env).toEqual({
      NODE_ENV: 'production',
      PLATFORM_DATABASE_URL: 'postgresql://platform_app:pw@db:5432/articode_platform',
      PLATFORM_PROBE_TIMEOUT_MS: 5000,
      PLATFORM_PROBE_INTERVAL_SECONDS: 300,
    });
  });

  it('derives the platform URL from PLATFORM_DB_APP_* and refuses values the platform API refuses', () => {
    const env = readProbeEnv({
      PLATFORM_DB_APP_PASSWORD: 'p@ss',
      DB_HOST: 'pg',
      POSTGRES_PORT: '5433',
      PLATFORM_PROBE_INTERVAL_SECONDS: '60',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PLATFORM_DATABASE_URL).toBe('postgresql://platform_app:p%40ss@pg:5433/articode_platform');
    expect(env.PLATFORM_PROBE_INTERVAL_SECONDS).toBe(60);

    expect(() => readProbeEnv({})).toThrow(/no platform database/);
    expect(() => readProbeEnv({ PLATFORM_DATABASE_URL: 'mysql://x', PLATFORM_PROBE_TIMEOUT_MS: '100' })).toThrow(
      /PLATFORM_DATABASE_URL.*PLATFORM_PROBE_TIMEOUT_MS|PLATFORM_PROBE_TIMEOUT_MS.*PLATFORM_DATABASE_URL/,
    );
  });

  it('prints one JSON line per round and masks secrets in error lines', () => {
    expect(JSON.parse(roundLine(ROUND, 1234.4))).toEqual({
      event: 'platform.probe.round',
      probed: 3,
      ready: 1,
      notReady: 1,
      unreachable: 1,
      invalid: 0,
      behind: 1,
      failed: 0,
      durationMs: 1234,
    });
    const url = 'postgresql://platform_app:pw%21x@db:5432/articode_platform';
    const secrets = secretsOf({ PLATFORM_DATABASE_URL: url });
    const line = probeErrorLine(new Error(`cannot reach ${url}\n(password pw!x)`), secrets);
    expect(line).toBe('platform probe failed: cannot reach *** (password ***)');
    expect(probeErrorLine(new Error('at postgres://u:v@h/d'))).toBe('platform probe failed: at postgresql://***');
  });

  it('--once: one round, exit 0; a failed round or an unrecorded snapshot: one stderr line, exit 1', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const base = { once: true, intervalMs: 1000, write: (l: string) => out.push(l), writeError: (l: string) => err.push(l) };

    expect(await runProbeLoop({ ...base, round: async () => ROUND })).toBe(0);
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(0);

    expect(await runProbeLoop({ ...base, round: async () => Promise.reject(new Error('database down')) })).toBe(1);
    expect(err).toEqual(['platform probe failed: database down']);

    expect(
      await runProbeLoop({ ...base, round: async () => ({ ...ROUND, failed: 1, firstError: 'insert refused' }) }),
    ).toBe(1);
    expect(out).toHaveLength(2);
    expect(err[1]).toBe('platform probe failed: 1 of 3 snapshots were not recorded: insert refused');
  });

  it('the loop sleeps the interval between rounds, survives a failed round and stops on its signal', async () => {
    const stop = new AbortController();
    const out: string[] = [];
    const err: string[] = [];
    let calls = 0;
    const round = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('transient');
      if (calls === 3) stop.abort();
      return ROUND;
    });
    const sleep = vi.fn(async () => undefined);

    const code = await runProbeLoop({
      once: false,
      intervalMs: 300_000,
      round,
      write: (l) => out.push(l),
      writeError: (l) => err.push(l),
      signal: stop.signal,
      sleep,
    });
    expect(code).toBe(0);
    expect(round).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(2);
    expect(err).toEqual(['platform probe failed: transient']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(300_000, stop.signal);
  });
});
