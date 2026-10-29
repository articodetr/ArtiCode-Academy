import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// src/config/ when running from sources (vitest), dist/config/ after `nest build`:
// both sit two levels below backend/, so the same hops reach it either way.
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Env files read by ConfigModule. All are optional and git-ignored; for each
 * variable the first file that defines it wins, and real process variables beat
 * every file. The repository root .env is the file compose.yaml reads, so the
 * database settings (POSTGRES_*, DB_APP_*) are declared once (ADR-019).
 */
export const ENV_FILE_PATHS: readonly string[] = [
  resolve(backendDir, '.env.local'),
  resolve(backendDir, '.env'),
  resolve(backendDir, '..', '.env'),
];
