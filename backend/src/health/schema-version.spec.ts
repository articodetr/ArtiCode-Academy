// TEST-202 (unit part) — the schema-version decisions of the readiness check
// (MOD-17-T03, roadmap §4l.8).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  newestMigration,
  readNewestMigration,
  readinessReason,
  schemaCheck,
  schemaStatus,
} from './schema-version.js';

const OLD = '20261029150949_init_identity_academy';
const MID = '20261110212431_mod11_finance';
const NEW = '20261112083749_mod12_notifications';

describe('newestMigration', () => {
  it('returns the greatest well-formed name whatever the input order', () => {
    expect(newestMigration([MID, NEW, OLD])).toBe(NEW);
    expect(newestMigration([NEW])).toBe(NEW);
  });

  it('ignores names Prisma would not write and is null without any', () => {
    expect(
      newestMigration([
        OLD,
        'migration_lock.toml',
        '29991231235959_future.sql',
        '2999123123595_short_stamp',
        '29991231235959',
        '29991231235959_with-dash',
        '29991231235959_',
        'zz_not_a_migration',
      ]),
    ).toBe(OLD);
    expect(newestMigration([])).toBeNull();
    expect(newestMigration(['migration_lock.toml'])).toBeNull();
  });
});

describe('schemaStatus', () => {
  it('is current when the expected migration is the newest applied one', () => {
    expect(schemaStatus(NEW, [OLD, MID, NEW])).toBe('current');
  });

  it('is ahead when a newer migration is applied too (an older build during an upgrade)', () => {
    expect(schemaStatus(MID, [OLD, MID, NEW])).toBe('ahead');
  });

  it('is outdated while the expected migration is not applied — an empty list is a missing table', () => {
    expect(schemaStatus(NEW, [OLD, MID])).toBe('outdated');
    expect(schemaStatus(NEW, [])).toBe('outdated');
    // a newer applied migration does not make up for a missing one
    expect(schemaStatus(MID, [OLD, NEW])).toBe('outdated');
  });

  it('is unchecked without an expected migration', () => {
    expect(schemaStatus(null, [OLD, NEW])).toBe('unchecked');
    expect(schemaStatus(null, [])).toBe('unchecked');
  });
});

describe('schemaCheck', () => {
  it('reports the newest applied migration next to the expected one', () => {
    expect(schemaCheck(NEW, { ok: true, names: [NEW, OLD, MID] })).toEqual({
      status: 'current',
      expected: NEW,
      applied: NEW,
    });
    expect(schemaCheck(MID, { ok: true, names: [OLD, NEW, MID] })).toEqual({
      status: 'ahead',
      expected: MID,
      applied: NEW,
    });
    expect(schemaCheck(NEW, { ok: true, names: [OLD] })).toEqual({
      status: 'outdated',
      expected: NEW,
      applied: OLD,
    });
    expect(schemaCheck(NEW, { ok: true, names: [] })).toEqual({
      status: 'outdated',
      expected: NEW,
      applied: null,
    });
  });

  it('is unchecked when the database was not read, keeping the expected migration', () => {
    expect(schemaCheck(NEW, null)).toEqual({
      status: 'unchecked',
      expected: NEW,
      applied: null,
    });
    expect(schemaCheck(null, null)).toEqual({
      status: 'unchecked',
      expected: null,
      applied: null,
    });
  });

  it('is an error with the driver message when the table could not be read', () => {
    expect(
      schemaCheck(NEW, {
        ok: false,
        error: 'permission denied for table _prisma_migrations',
      }),
    ).toEqual({
      status: 'error',
      expected: NEW,
      applied: null,
      error: 'permission denied for table _prisma_migrations',
    });
  });
});

describe('readinessReason', () => {
  it('is null when ready: current, ahead and unchecked schemas', () => {
    expect(readinessReason(true, 'current')).toBeNull();
    expect(readinessReason(true, 'ahead')).toBeNull();
    expect(readinessReason(true, 'unchecked')).toBeNull();
  });

  it('names the database first, then the schema', () => {
    expect(readinessReason(false, 'unchecked')).toBe('database_unavailable');
    expect(readinessReason(false, 'outdated')).toBe('database_unavailable');
    expect(readinessReason(true, 'outdated')).toBe('schema_outdated');
    expect(readinessReason(true, 'error')).toBe('schema_unverified');
  });
});

describe('readNewestMigration', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'articode-migrations-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function folder(
    name: string,
    files: Record<string, string>,
  ): Promise<string> {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await mkdir(join(dir, file, '..'), { recursive: true });
      await writeFile(join(dir, file), content);
    }
    return dir;
  }

  it('picks the newest folder holding a migration.sql', async () => {
    const dir = await folder('real', {
      [`${OLD}/migration.sql`]: 'SELECT 1;',
      [`${NEW}/migration.sql`]: 'SELECT 1;',
      'migration_lock.toml': 'provider = "postgresql"',
    });
    expect(await readNewestMigration(dir)).toBe(NEW);
  });

  it('ignores stray files, folders without migration.sql and malformed names', async () => {
    const dir = await folder('noise', {
      [`${MID}/migration.sql`]: 'SELECT 1;',
      'migration_lock.toml': 'provider = "postgresql"',
      '29991231235959_stray_file': 'not a folder',
      '29991231235958_no_sql/README.md': 'no migration.sql here',
      '29991231235957_sql_is_a_folder/migration.sql/x':
        'a folder named migration.sql',
      '2999-12-31_malformed/migration.sql': 'SELECT 1;',
      'notes/migration.sql': 'SELECT 1;',
    });
    expect(await readNewestMigration(dir)).toBe(MID);
  });

  it('is null for a missing folder, an empty one, or one without any migration', async () => {
    expect(await readNewestMigration(join(root, 'does-not-exist'))).toBeNull();
    expect(await readNewestMigration(await folder('empty', {}))).toBeNull();
    expect(
      await readNewestMigration(
        await folder('lock-only', { 'migration_lock.toml': '' }),
      ),
    ).toBeNull();
    // a file where the folder should be
    expect(
      await readNewestMigration(join(root, 'lock-only', 'migration_lock.toml')),
    ).toBeNull();
  });
});
