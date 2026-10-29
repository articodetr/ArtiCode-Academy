// Idempotent seed for one academy database (docs 6.6.5 (و) step 8).
//
//   npx prisma db seed            (configured in prisma.config.ts, runs with tsx)
//
// What it does, in one transaction, as the APPLICATION role (DML only):
//   1. permissions   — upsert the code catalog; keys no longer in the catalog
//                      are marked deprecated_at (never deleted).
//   2. roles         — create missing system roles; refresh label/description
//                      of existing ones; never touch custom roles.
//   3. role_permissions — academy_admin always holds every active key; other
//                      system roles get their defaults when first created, plus
//                      the default grant of any key that is NEW to the catalog
//                      (so a key added later reaches the roles that should hold
//                      it, while an admin's earlier removals are never undone).
//   4. academy       — create the single row from SEED_ACADEMY_* when the table
//                      is empty; an existing row is left untouched.
// No user is created: the first academy admin arrives with MOD-01 (argon2id).
// Running the seed twice yields the same row counts.

import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { isLocaleCode, type LocaleCode } from '../src/authorization/localized-text.js';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { ACADEMY_ADMIN_ROLE_KEY, SYSTEM_ROLES } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

type Db = Prisma.TransactionClient;

export interface AcademySeed {
  slug: string;
  nameAr: string;
  nameEn?: string;
  timezone: string;
  currency: string;
  defaultLocale: LocaleCode;
}

export interface SeedSummary {
  permissions: { upserted: number; deprecated: number };
  roles: { created: string[]; existing: string[] };
  rolePermissions: { added: number };
  academy: 'created' | 'kept';
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Accepts every name the ICU time-zone database knows, including `UTC` and aliases. */
function isKnownTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the academy identity from the environment. Timezone and currency are
 * chosen per academy and have no default (owner decision, CH-0012).
 */
export function academySeedFromEnv(env: Record<string, string | undefined>): AcademySeed {
  const problems: string[] = [];
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };

  const slug = read('SEED_ACADEMY_SLUG');
  const nameAr = read('SEED_ACADEMY_NAME_AR');
  const nameEn = read('SEED_ACADEMY_NAME_EN');
  const timezone = read('SEED_ACADEMY_TIMEZONE');
  const currency = read('SEED_ACADEMY_CURRENCY');
  const locale = read('SEED_ACADEMY_LOCALE') ?? 'ar';

  if (!slug) problems.push('SEED_ACADEMY_SLUG is required');
  else if (!SLUG_PATTERN.test(slug)) problems.push('SEED_ACADEMY_SLUG must be lower-case letters, digits and dashes (2–63 chars)');
  if (!nameAr) problems.push('SEED_ACADEMY_NAME_AR is required (Arabic is the reference language)');
  if (!timezone) problems.push('SEED_ACADEMY_TIMEZONE is required (IANA name, e.g. Europe/Istanbul)');
  else if (!isKnownTimeZone(timezone)) problems.push(`SEED_ACADEMY_TIMEZONE "${timezone}" is not a known IANA time zone`);
  if (!currency) problems.push('SEED_ACADEMY_CURRENCY is required (ISO 4217 code, e.g. TRY)');
  else if (!CURRENCY_PATTERN.test(currency)) problems.push('SEED_ACADEMY_CURRENCY must be a 3-letter upper-case ISO 4217 code');
  if (!isLocaleCode(locale)) problems.push('SEED_ACADEMY_LOCALE must be one of ar, en, tr');

  if (problems.length > 0) {
    throw new Error(`Academy seed configuration is invalid: ${problems.join('; ')}`);
  }

  return {
    slug: slug!,
    nameAr: nameAr!,
    nameEn,
    timezone: timezone!,
    currency: currency!,
    defaultLocale: locale as LocaleCode,
  };
}

/** Permissions + system roles + their default grants. Safe to run repeatedly. */
export async function seedCatalog(db: Db): Promise<Omit<SeedSummary, 'academy'>> {
  let upserted = 0;
  // Keys that did not exist before this run: their default grants apply once,
  // even to system roles created earlier (see rule 3 above).
  const newKeys = new Set<string>();
  for (const item of PERMISSION_CATALOG) {
    const known = await db.permission.findUnique({ where: { key: item.key }, select: { key: true } });
    if (!known) newKeys.add(item.key);
    await db.permission.upsert({
      where: { key: item.key },
      create: { key: item.key, module: item.module, description: item.description },
      update: { module: item.module, description: item.description, deprecatedAt: null },
    });
    upserted += 1;
  }
  const deprecated = await db.permission.updateMany({
    where: { key: { notIn: [...PERMISSION_KEYS] }, deprecatedAt: null },
    data: { deprecatedAt: new Date() },
  });

  const created: string[] = [];
  const existing: string[] = [];
  let added = 0;

  for (const definition of SYSTEM_ROLES) {
    const found = await db.role.findUnique({ where: { key: definition.key }, select: { id: true } });
    let roleId: string;
    let grantDefaults: boolean;

    if (found) {
      roleId = found.id;
      grantDefaults = definition.key === ACADEMY_ADMIN_ROLE_KEY;
      await db.role.update({
        where: { id: roleId },
        data: { label: definition.label, description: definition.description, isSystem: true },
      });
      existing.push(definition.key);
    } else {
      const role = await db.role.create({
        data: {
          key: definition.key,
          label: definition.label,
          description: definition.description,
          isSystem: true,
          isDefaultForSignup: definition.isDefaultForSignup,
        },
        select: { id: true },
      });
      roleId = role.id;
      grantDefaults = true;
      created.push(definition.key);
    }

    const grants = grantDefaults
      ? definition.permissions
      : definition.permissions.filter((permissionKey) => newKeys.has(permissionKey));
    if (grants.length > 0) {
      const result = await db.rolePermission.createMany({
        data: grants.map((permissionKey) => ({ roleId, permissionKey })),
        skipDuplicates: true,
      });
      added += result.count;
    }
  }

  return {
    permissions: { upserted, deprecated: deprecated.count },
    roles: { created, existing },
    rolePermissions: { added },
  };
}

/** Creates the single academy row when none exists; never overwrites one. */
export async function seedAcademy(db: Db, academy: AcademySeed): Promise<'created' | 'kept'> {
  const existing = await db.academy.findFirst({ select: { id: true } });
  if (existing) return 'kept';

  const name: Record<string, string> = { ar: academy.nameAr };
  if (academy.nameEn) name['en'] = academy.nameEn;

  await db.academy.create({
    data: {
      slug: academy.slug,
      name,
      defaultLocale: academy.defaultLocale,
      timezone: academy.timezone,
      currency: academy.currency,
      settings: {},
    },
  });
  return 'created';
}

export async function runSeed(client: PrismaClient, academy: AcademySeed): Promise<SeedSummary> {
  return client.$transaction(async (tx) => {
    const catalog = await seedCatalog(tx);
    const academyResult = await seedAcademy(tx, academy);
    return { ...catalog, academy: academyResult };
  });
}

/** Application-role connection from the same env files the backend reads. */
export function createSeedClient(env: Record<string, string | undefined> = process.env): PrismaClient {
  const url = env['DATABASE_URL'] || postgresUrlFromEnv(env, 'app');
  if (!url) {
    throw new Error('No database URL: set DATABASE_URL or DB_APP_PASSWORD (repository root .env)');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

async function main(): Promise<void> {
  loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
  const academy = academySeedFromEnv(process.env);
  const client = createSeedClient(process.env);
  try {
    const summary = await runSeed(client, academy);
    console.log(
      [
        `permissions: ${summary.permissions.upserted} upserted, ${summary.permissions.deprecated} deprecated`,
        `roles: created [${summary.roles.created.join(', ')}], existing [${summary.roles.existing.join(', ')}]`,
        `role_permissions: ${summary.rolePermissions.added} added`,
        `academy "${academy.slug}": ${summary.academy}`,
      ].join('\n'),
    );
  } finally {
    await client.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
