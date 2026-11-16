// Turns two-step verification ON for a platform account (PMFA, roadmap §4o) —
// the platform has no frontend, so API-214/API-215 would need hand-written HTTP
// calls. Run ON THE SERVER, in an interactive terminal, by the person who holds
// the account. From backend/:
//
//   npm run platform:enable-mfa -- --email ops@example.com
//
// Argument: --email <address> (required). The command then
//   1. asks for the account's CURRENT password without echo (the proof that you
//      hold the account; a wrong one changes nothing — it is not counted as a
//      failed sign-in and no event is recorded);
//   2. prints the key to add to an authenticator app BY KEY, in groups of four,
//      and the same key as an `otpauth://` link (no QR code — the backend has
//      no QR dependency);
//   3. asks for the 6-digit code the app shows (three tries);
//   4. only then turns MFA on in one transaction — the sealed secret, ten
//      recovery codes (keyed hashes), every session of the account signed out,
//      one `platform.auth.mfa.enabled { revokedSessions, via: 'cli' }` without
//      an actor — and prints the ten recovery codes ONCE.
// Nothing is written before the code is confirmed: Ctrl+C leaves no trace.
//
// THIS IS THE ONE COMMAND THAT PRINTS SECRETS (the key, the recovery codes) —
// to the holder's own terminal and nowhere else: it refuses to run unless both
// stdin and stdout are terminals, so they can never land in a pipe or a log
// file, and it writes none of them to a log. The password and
// PLATFORM_MFA_ENCRYPTION_KEY are never printed.
//
// Needs PLATFORM_MFA_ENCRYPTION_KEY — the very key the platform API runs with,
// or the API cannot open the secret — and the platform database through
// PLATFORM_DATABASE_URL or the PLATFORM_DB_APP_* variables. Read from the
// environment and from backend/.env.local, backend/.env, ../.env (first
// definition wins).
//
// Exit codes: 0 enabled; 2 refused, nothing changed (no platform account has
// this e-mail, wrong password, suspended account, MFA already on — reset it
// first with `npm run platform:reset-mfa` —, no matching code in three tries,
// or the password changed while the command waited); 1 error, nothing changed
// (bad arguments, the key missing, invalid or shared with the academy, no
// database URL, not an interactive terminal, an interrupted prompt).
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordService } from '../src/auth/password.service.js';
import { platformPostgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/platform/client.js';
import {
  PLATFORM_MFA_ENROLL_CODE_ATTEMPTS,
  enrollPlatformUserMfa,
  groupTotpSecret,
  platformMfaEnrollInputProblems,
  resolvePlatformMfaKey,
} from '../src/platform/auth/mfa/platform-mfa-enroll.js';
import type {
  PlatformMfaEnrollRefusal,
  PlatformMfaEnrollSetup,
  PlatformMfaKeyProblem,
} from '../src/platform/auth/mfa/platform-mfa-enroll.js';
import { normalizePlatformEmail } from '../src/platform/auth/platform-session.rules.js';
import { promptHidden } from './hidden-prompt.js';

const USAGE = 'Usage: npm run platform:enable-mfa -- --email <address>';

/** The terminal the command talks to; the tests hand in a scripted one. */
export interface EnableMfaTerminal {
  /** True when stdin and stdout are both terminals — the only place a password is read and secrets are printed. */
  interactive: boolean;
  /** A line typed without echo (the password). */
  readHidden(question: string): Promise<string>;
  /** A line typed with echo (the code). Rejects with PromptAborted when the input ends first (Ctrl+C, Ctrl+D). */
  readLine(question: string): Promise<string>;
  /** A line for the holder (stdout). */
  out(text: string): void;
  /** A refusal or an error (stderr) — never a secret. */
  err(text: string): void;
}

/** A prompt that ended without an answer. */
export class PromptAborted extends Error {
  constructor() {
    super('The prompt was interrupted');
    this.name = 'PromptAborted';
  }
}

const KEY_PROBLEMS: Record<PlatformMfaKeyProblem, string> = {
  key_missing:
    'PLATFORM_MFA_ENCRYPTION_KEY is not set: two-step verification needs the key the platform API runs with ' +
    '(backend/.env.local, backend/.env or the environment).',
  key_invalid:
    'PLATFORM_MFA_ENCRYPTION_KEY is not a valid key: it must be 32 random bytes encoded as base64 or base64url — ' +
    'use the very key the platform API runs with.',
  key_shared_with_academy:
    'PLATFORM_MFA_ENCRYPTION_KEY must differ from AUTH_MFA_ENCRYPTION_KEY: the platform API refuses to start with a shared key.',
};

const REFUSALS: Record<PlatformMfaEnrollRefusal, string> = {
  user_not_found: 'Refused: no platform account has this e-mail.',
  password_invalid: 'Refused: that is not the current password of this account. Nothing was changed.',
  account_suspended: 'Refused: this platform account is suspended. Nothing was changed.',
  mfa_already_enabled:
    'Refused: two-step verification is already on for this account. To replace it, reset it first ' +
    '(npm run platform:reset-mfa -- --email <address>) and run this command again.',
  code_invalid:
    `Refused: no code matched in ${PLATFORM_MFA_ENROLL_CODE_ATTEMPTS} tries. Nothing was changed. Check that the phone's clock is set ` +
    'automatically, remove the entry from the app and run the command again (every run issues a new key).',
  account_changed: "Refused: the account's password changed while this command was waiting. Nothing was changed; run it again.",
};

function setupLines(setup: PlatformMfaEnrollSetup): string[] {
  return [
    '',
    `Two-step verification for platform account ${setup.email}`,
    '',
    'Add the account to your authenticator app BY KEY (this command shows no QR code):',
    '',
    `  Account : ${setup.issuer} (${setup.account})`,
    `  Key     : ${groupTotpSecret(setup.secret)}`,
    '  Type    : time-based (TOTP), SHA-1, 6 digits, 30 seconds',
    '',
    'Or, if your app takes a setup link, give it this one:',
    '',
    `  ${setup.otpauthUri}`,
    '',
    'This key is shown only now and nothing is saved until a code is confirmed.',
    '',
  ];
}

function recoveryLines(userId: string, recoveryCodes: readonly string[], revokedSessions: number): string[] {
  const rows: string[] = [];
  for (let index = 0; index < recoveryCodes.length; index += 2) rows.push(`  ${recoveryCodes.slice(index, index + 2).join('   ')}`);
  return [
    '',
    `Two-step verification is ON for platform user ${userId}; ${revokedSessions} session(s) of the account were signed out.`,
    '',
    'Recovery codes — each one signs you in once when the authenticator app is unavailable:',
    '',
    ...rows,
    '',
    'Store them now in a safe place: they are not shown again and cannot be read back from the server.',
    'Sign in with the NEXT code your app shows — the one you just typed is spent.',
  ];
}

/**
 * The whole command with its input handed in: the arguments after `--`, the
 * environment (already merged with the env files) and a terminal. Returns the
 * exit code. Checks in order: arguments → the MFA key → the database URL → an
 * interactive terminal → the password prompt → enrollPlatformUserMfa().
 */
export async function runPlatformEnableMfa(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  terminal: EnableMfaTerminal,
): Promise<number> {
  let args: { email?: string };
  try {
    ({ values: args } = parseArgs({
      args: [...argv],
      options: { email: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    terminal.err(error instanceof Error ? error.message : String(error));
    terminal.err(USAGE);
    return 1;
  }
  const problems = platformMfaEnrollInputProblems({ email: args.email ?? '' });
  if (problems.length > 0) {
    terminal.err(`Cannot enable two-step verification: ${problems.join('; ')}`);
    terminal.err(USAGE);
    return 1;
  }
  const email = normalizePlatformEmail(args.email ?? '');

  // The key first: without it nothing below can succeed, and no password should be asked for nothing.
  const resolved = resolvePlatformMfaKey(env);
  if (resolved.key === null) {
    terminal.err(KEY_PROBLEMS[resolved.problem]);
    return 1;
  }

  const url = env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(env, 'app');
  if (!url) {
    terminal.err('No platform database URL: set PLATFORM_DATABASE_URL or PLATFORM_DB_APP_PASSWORD (repository root .env).');
    return 1;
  }

  if (!terminal.interactive) {
    terminal.err(
      'This command reads a password and prints one-time secrets: run it in an interactive terminal, ' +
        'with neither its input nor its output piped or redirected.',
    );
    return 1;
  }

  let db: PrismaClient | undefined;
  try {
    const password = await terminal.readHidden(`Current password of ${email} (not echoed): `);
    // Created after the prompt: an interrupted password prompt leaves nothing open behind it.
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const result = await enrollPlatformUserMfa(
      db,
      {
        email,
        password,
        onSetup: (setup) => {
          for (const line of setupLines(setup)) terminal.out(line);
        },
        readCode: (attempt) => {
          if (attempt > 1) {
            const left = PLATFORM_MFA_ENROLL_CODE_ATTEMPTS - attempt + 1;
            terminal.err(`That code does not match. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
          }
          return terminal.readLine(`6-digit code from the app (try ${attempt} of ${PLATFORM_MFA_ENROLL_CODE_ATTEMPTS}): `);
        },
      },
      { key: resolved.key, passwords: new PasswordService() },
    );
    if (result.outcome === 'refused') {
      terminal.err(REFUSALS[result.reason]);
      return 2;
    }
    for (const line of recoveryLines(result.userId, result.recoveryCodes, result.revokedSessions)) terminal.out(line);
    return 0;
  } catch (error) {
    // Only a prompt can be interrupted, and every prompt comes before the one write.
    if (error instanceof PromptAborted) {
      terminal.err('Interrupted. Nothing was changed.');
      return 1;
    }
    throw error;
  } finally {
    await db?.$disconnect();
  }
}

/** A visible prompt; an input that ends before an answer (Ctrl+C closes readline, Ctrl+D ends it) rejects with PromptAborted. */
function promptVisible(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => {
      if (answered) return;
      process.stdout.write('\n');
      reject(new PromptAborted());
    });
  });
}

function processTerminal(): EnableMfaTerminal {
  return {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    readHidden: promptHidden,
    readLine: promptVisible,
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  };
}

/** True when this file is the program being run (`tsx scripts/platform-enable-mfa.ts`), false when a test imports it. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    const [started, self] = [realpathSync(entry), realpathSync(fileURLToPath(import.meta.url))];
    // Windows paths differ by the case of the drive letter depending on the shell that started the process.
    return process.platform === 'win32' ? started.toLowerCase() === self.toLowerCase() : started === self;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // Ctrl+C at the hidden password prompt closes readline without an answer (hidden-prompt.ts) and the
  // process simply drains. Until the command has run to its end the exit code says "error", never
  // "enabled" — and a drain before that end can only be such a prompt, which comes before the one write.
  let finished = false;
  process.exitCode = 1;
  process.once('beforeExit', () => {
    if (!finished) console.error('\nInterrupted. Nothing was changed.');
  });
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
  runPlatformEnableMfa(process.argv.slice(2), process.env, processTerminal())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => {
      finished = true;
    });
}
