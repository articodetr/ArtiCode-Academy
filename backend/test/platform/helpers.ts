// Shared helpers of the PLATFORM e2e suites (MOD-18; TEST-207 and the suites of
// T03 auth, T04 registry, T05 fleet). Import from `./platform/helpers.js`
// (a suite in test/) — this file is not a test itself.
//
//   loadDotenv is done here on import (the env files of src/config/env-files.ts),
//   so `process.env` holds the PLATFORM_DB_* variables before a suite decides to skip.
//
//   platformDatabaseUrl(): string | undefined
//     PLATFORM_DATABASE_URL, else derived from PLATFORM_DB_APP_* (+ DB_HOST,
//     POSTGRES_PORT, PLATFORM_DB_NAME) — the platform APPLICATION role, never an
//     academy URL.
//   platformDbReachable(): Promise<boolean>
//     `SELECT 1` on that URL (3 s timeout). Use it to skip:
//       const available = await platformDbReachable();
//       describe.skipIf(!available)('…', () => { … });
//   createPlatformTestApp(options?): Promise<NestExpressApplication>
//     PlatformAppModule (+ options.imports / options.controllers / options.providers —
//     e.g. a probe controller or a feature module before it joins the root module),
//     created with APP_CREATE_OPTIONS and configureApp(app, PLATFORM_APP_SETUP)
//     like main.ts (the OpenAPI document `ArtiCode Platform API`, KI-081), then init().
//     options.configure(builder) may override providers before compile, e.g.
//       configure: (b) => b.overrideProvider(PLATFORM_MIGRATIONS_DIR).useValue(dir)
//     Close it with `await app.close()`.
//   platformTestDb(): PrismaClient (generated platform client)
//     One lazily created client on platformDatabaseUrl() for fixtures and
//     assertions (e.g. reading platform_audit_logs). closePlatformTestDb() in afterAll.
//   PLATFORM_TEST_RUN: string
//     A lower-case run id (letters and digits, 12 characters) for unique fixture
//     names — e-mails here, academy slugs / plan keys in T04 (`${PLATFORM_TEST_RUN}-x`).
//   createPlatformUserFixture({ role, status?, password?, fullName?, lockedUntil?,
//     passwordChangedAt?, failedLoginCount? }): Promise<PlatformUserFixture>
//     Inserts a platform_users row with an Argon2id hash of `password` (default: a
//     random 32-character one) and a unique `<run>-<n>@example.test` e-mail; returns
//     `{ id, email, fullName, role, status, password }` (the plain password, for
//     login tests). status defaults to `active`.
//   deletePlatformUserFixtures(ids): Promise<void>
//     Deletes those users (their refresh tokens cascade; the actor of their
//     append-only audit rows is set to NULL — the only UPDATE the trigger allows).
//     Audit rows themselves can never be deleted: write as few as a test needs.
//   platformAccessTokenFor(app, user, ttlSeconds?): Promise<string>
//     A Bearer token minted by the app's OWN PlatformTokenService (its secret may
//     be ephemeral when PLATFORM_JWT_SECRET is unset, so never mint with another
//     instance). `user` needs `{ id, role }`.
//   PLATFORM_TEST_ORIGIN = 'http://localhost:5174'
//     The default PLATFORM_CORS_ORIGIN — send it as `Origin` to look like the
//     Super Admin frontend (a request without Origin passes OriginGuard too).
import { randomBytes } from 'node:crypto';
import type { ModuleMetadata, Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { APP_CREATE_OPTIONS, configureApp } from '../../src/app.setup.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { platformPostgresUrlFromEnv } from '../../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../../src/config/env-files.js';
import { PrismaClient } from '../../src/generated/platform/client.js';
import type { PlatformRole, PlatformUserStatus } from '../../src/generated/platform/client.js';
import { PlatformTokenService } from '../../src/platform/auth/platform-token.service.js';
import { PLATFORM_APP_SETUP, PlatformAppModule } from '../../src/platform/platform-app.module.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

/** The default PLATFORM_CORS_ORIGIN (platform.env.schema.ts). */
export const PLATFORM_TEST_ORIGIN = 'http://localhost:5174';

/** Lower-case letters and digits, unique per process: `p` + time in base 36 + random. */
export const PLATFORM_TEST_RUN = `p${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.slice(0, 12);

export function platformDatabaseUrl(): string | undefined {
  return process.env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(process.env, 'app');
}

export async function platformDbReachable(): Promise<boolean> {
  const url = platformDatabaseUrl();
  if (!url) return false;
  const probe = new Pool({ connectionString: url, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

export interface PlatformTestAppOptions {
  /** Extra controllers registered only in the test module (probe routes). */
  controllers?: Type<unknown>[];
  /** Extra modules (e.g. a feature module under test). */
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
  /** Overrides applied to the builder before compile(). */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createPlatformTestApp(options: PlatformTestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [PlatformAppModule, ...(options.imports ?? [])],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  });
  if (options.configure) builder = options.configure(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
  configureApp(app, PLATFORM_APP_SETUP);
  await app.init();
  return app;
}

let testDb: PrismaClient | undefined;

/** The fixtures' own platform client (the app under test keeps its PlatformPrismaService). */
export function platformTestDb(): PrismaClient {
  if (!testDb) {
    const url = platformDatabaseUrl();
    if (!url) throw new Error('No platform database URL (PLATFORM_DATABASE_URL or PLATFORM_DB_APP_PASSWORD)');
    testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) });
  }
  return testDb;
}

export async function closePlatformTestDb(): Promise<void> {
  await testDb?.$disconnect();
  testDb = undefined;
}

export interface PlatformUserFixtureInput {
  role: PlatformRole;
  status?: PlatformUserStatus;
  /** Plain password (default: random, 32 characters). */
  password?: string;
  fullName?: string;
  lockedUntil?: Date | null;
  passwordChangedAt?: Date | null;
  failedLoginCount?: number;
}

export interface PlatformUserFixture {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  status: PlatformUserStatus;
  /** The plain password of the fixture (never stored). */
  password: string;
}

let fixtureCount = 0;
const passwords = new PasswordService();

export async function createPlatformUserFixture(input: PlatformUserFixtureInput): Promise<PlatformUserFixture> {
  fixtureCount += 1;
  const email = `${PLATFORM_TEST_RUN}-${input.role.replace('_', '-')}-${fixtureCount}@example.test`;
  const password = input.password ?? randomBytes(24).toString('base64url');
  const fullName = input.fullName ?? `Platform fixture ${fixtureCount}`;
  const user = await platformTestDb().platformUser.create({
    data: {
      email,
      fullName,
      role: input.role,
      status: input.status ?? 'active',
      passwordHash: await passwords.hash(password),
      lockedUntil: input.lockedUntil ?? null,
      passwordChangedAt: input.passwordChangedAt ?? null,
      failedLoginCount: input.failedLoginCount ?? 0,
    },
    select: { id: true, email: true, fullName: true, role: true, status: true },
  });
  return { ...user, password };
}

export async function deletePlatformUserFixtures(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await platformTestDb().platformUser.deleteMany({ where: { id: { in: [...ids] } } });
}

export async function platformAccessTokenFor(
  app: NestExpressApplication,
  user: { id: string; role: PlatformRole },
  ttlSeconds?: number,
): Promise<string> {
  const signed = await app.get(PlatformTokenService).signAccessToken({ userId: user.id, role: user.role }, ttlSeconds);
  return signed.token;
}
