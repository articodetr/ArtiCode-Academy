// TEST-174 — MOD-12-T01 schema (migration 20261112083749_mod12_notifications):
// the `notifications`, `notification_preferences` and `announcements` tables,
// their two enums, the hand-written CHECKs (event key, title and body, `data`
// object, the announcement link, the three e-mail state rules, the audience
// kind and class scope, announcement lengths, recipient count), the two
// partial indexes (unread counter, queued e-mails), the preference key and the
// referential actions. Runs against the local development database as the
// APPLICATION role and is skipped when no database is reachable (like
// TEST-160). Every data test runs inside a transaction that is rolled back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261112083749_mod12_notifications';
const PREVIOUS_MIGRATION = '20261110212431_mod11_finance';
const TABLES = ['notifications', 'notification_preferences', 'announcements'] as const;

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const INVALID_ENUM_VALUE = '22P02';

async function canConnect(url: string): Promise<boolean> {
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

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('database schema — MOD-12 notifications (e2e, TEST-174)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  async function inRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async function expectSqlError(client: PoolClient, sql: string, params: unknown[], code: string, constraint?: string): Promise<void> {
    await client.query('SAVEPOINT expect_error');
    let caught: { code?: string; constraint?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string; constraint?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql} ${JSON.stringify(params)}`).toBeDefined();
    expect(caught?.code).toBe(code);
    if (constraint) expect(caught?.constraint).toBe(constraint);
  }

  const tag = `N${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const NOTIFICATION_SQL = `INSERT INTO notifications (recipient_user_id, event_key, category, title, body, data, student_user_id, announcement_id, email_status, email_sent_at, email_message_id, email_failure)
                            VALUES ($1, $2, $3::notification_category, $4, $5, $6::jsonb, $7, $8, $9::notification_email_status, $10, $11, $12) RETURNING id`;
  const ANNOUNCEMENT_SQL = `INSERT INTO announcements (sender_user_id, audience, class_id, title, body, send_email, recipient_count)
                            VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7) RETURNING id`;
  const PREFERENCE_SQL = `INSERT INTO notification_preferences (user_id, category, email_enabled) VALUES ($1, $2::notification_category, $3)`;
  const ACADEMY_AUDIENCE = '{"kind":"academy","roleKeys":["student","guardian"]}';
  const SENT_AT = '2026-11-12T09:00:00Z';

  interface NotificationOver {
    eventKey: string;
    category: string;
    title: string;
    body: string;
    data: string;
    studentId: string | null;
    announcementId: string | null;
    emailStatus: string;
    sentAt: string | null;
    messageId: string | null;
    failure: string | null;
  }
  /** An in-app notification about a published assignment with no e-mail due, unless overridden. */
  function notificationParams(recipientId: string, over: Partial<NotificationOver> = {}): unknown[] {
    const n: NotificationOver = {
      eventKey: 'assignment.published',
      category: 'assignments',
      title: 'واجب جديد',
      body: 'نُشر واجب جديد في فصلك',
      data: '{"link":"/my-assignments"}',
      studentId: null,
      announcementId: null,
      emailStatus: 'none',
      sentAt: null,
      messageId: null,
      failure: null,
      ...over,
    };
    return [recipientId, n.eventKey, n.category, n.title, n.body, n.data, n.studentId, n.announcementId, n.emailStatus, n.sentAt, n.messageId, n.failure];
  }
  async function notification(client: PoolClient, recipientId: string, over: Partial<NotificationOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(NOTIFICATION_SQL, notificationParams(recipientId, over))).rows[0]!.id;
  }

  interface AnnouncementOver {
    senderId: string | null;
    audience: string;
    classId: string | null;
    title: string;
    body: string;
    sendEmail: boolean;
    recipients: number;
  }
  /** An academy-wide announcement to three recipients without e-mail, unless overridden. */
  function announcementParams(over: Partial<AnnouncementOver> = {}): unknown[] {
    const a: AnnouncementOver = { senderId: null, audience: ACADEMY_AUDIENCE, classId: null, title: 'إعلان', body: 'نص الإعلان', sendEmail: false, recipients: 3, ...over };
    return [a.senderId, a.audience, a.classId, a.title, a.body, a.sendEmail, a.recipients];
  }
  async function announcement(client: PoolClient, over: Partial<AnnouncementOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(ANNOUNCEMENT_SQL, announcementParams(over))).rows[0]!.id;
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [name, `${tag.toLowerCase()}-${name}@example.com`]);
    return rows[0]!.id;
  }
  async function klass(client: PoolClient, suffix: string): Promise<string> {
    const courseId = (await client.query<{ id: string }>(`INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`, [`${tag}-${suffix}`])).rows[0]!.id;
    return (await client.query<{ id: string }>(`INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`, [courseId, `${tag}-${suffix}`])).rows[0]!.id;
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the MOD-11 migration, with the two enums and the defaults', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);
    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('notification_category')).toEqual(['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements']);
    expect(await enums('notification_email_status')).toEqual(['none', 'queued', 'sent', 'failed', 'skipped']);

    await inRollback(async (client) => {
      const recipient = await user(client, 'd');
      const row = await client.query<Record<string, unknown>>(
        `INSERT INTO notifications (recipient_user_id, event_key, category, title, body) VALUES ($1, 'lesson.cancelled', 'lessons', 'أُلغي الدرس', 'أُلغي درس الغد')
         RETURNING data, student_user_id, announcement_id, read_at, email_status, email_sent_at, email_message_id, email_failure, created_at IS NOT NULL AS stamped`,
        [recipient],
      );
      expect(row.rows[0]).toEqual({ data: {}, student_user_id: null, announcement_id: null, read_at: null, email_status: 'none', email_sent_at: null, email_message_id: null, email_failure: null, stamped: true });
      const sent = await client.query<Record<string, unknown>>(
        `INSERT INTO announcements (audience, title, body, recipient_count) VALUES ($1::jsonb, 'إعلان', 'نص', 0) RETURNING sender_user_id, class_id, send_email, created_at IS NOT NULL AS stamped`,
        [ACADEMY_AUDIENCE],
      );
      expect(sent.rows[0]).toEqual({ sender_user_id: null, class_id: null, send_email: false, stamped: true });
      // A preference always states its switch: no default hides a forgotten value.
      await expectSqlError(client, `INSERT INTO notification_preferences (user_id, category) VALUES ($1, 'finance')`, [recipient], NOT_NULL_VIOLATION);
      // Neither the category nor the e-mail state of a notification is guessed for an unknown value.
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(recipient, { category: 'sms' }), INVALID_ENUM_VALUE);
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(recipient, { emailStatus: 'delivered' }), INVALID_ENUM_VALUE);
    });
  });

  it('gives the application role DML without TRUNCATE on the three tables, and adds no extension', async () => {
    for (const table of TABLES) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml, has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
    const extensions = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    expect(extensions.rows.map((row) => row.extname)).toEqual(['btree_gist']);
  });

  it('enforces the notification CHECKs (event key, title and body, data object, announcement link) — AC2', async () => {
    await inRollback(async (client) => {
      const r = await user(client, 'n');
      for (const eventKey of ['', 'Assignment.published', ' assignment.published', 'assignment.published ', 'assignment..published', 'assignment.', '.published', 'assignment published', '9lives']) {
        await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { eventKey }), CHECK_VIOLATION, 'ck_notifications_event_key_format');
      }
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { title: '   ' }), CHECK_VIOLATION, 'ck_notifications_title_not_blank');
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { body: '' }), CHECK_VIOLATION, 'ck_notifications_body_not_blank');
      for (const data of ['[]', '"/my-assignments"', 'null', '7']) {
        await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { data }), CHECK_VIOLATION, 'ck_notifications_data_object');
      }
      // The link to an announcement exists exactly for the `announcements` category.
      const announcementId = await announcement(client);
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { eventKey: 'announcement', category: 'announcements' }), CHECK_VIOLATION, 'ck_notifications_announcement_link');
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { announcementId }), CHECK_VIOLATION, 'ck_notifications_announcement_link');
      // Valid: a one-segment key, a key with an underscore, an announcement's notification, the same event twice.
      await notification(client, r, { eventKey: 'announcement', category: 'announcements', announcementId });
      await notification(client, r, { eventKey: 'exam.results_published', category: 'exams' });
      await notification(client, r);
      await notification(client, r);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1`, [r])).toBe(4);
    });
  });

  it('enforces the e-mail state CHECKs (sending instant, message id, failure code) through insert and update — AC2', async () => {
    await inRollback(async (client) => {
      const r = await user(client, 'e');
      // The sending instant exists exactly for `sent`.
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'sent' }), CHECK_VIOLATION, 'ck_notifications_email_sent_at');
      for (const emailStatus of ['none', 'queued', 'skipped']) {
        await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus, sentAt: SENT_AT }), CHECK_VIOLATION, 'ck_notifications_email_sent_at');
      }
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'failed', sentAt: SENT_AT, failure: 'http' }), CHECK_VIOLATION, 'ck_notifications_email_sent_at');
      // A provider message id only for `sent`, and never blank.
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'queued', messageId: 'msg-1' }), CHECK_VIOLATION, 'ck_notifications_email_message_id_only_sent');
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'sent', sentAt: SENT_AT, messageId: '  ' }), CHECK_VIOLATION, 'ck_notifications_email_message_id_only_sent');
      // A failure code always for `failed`, optionally for `skipped`, never otherwise — trimmed and not empty.
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'failed' }), CHECK_VIOLATION, 'ck_notifications_email_failure');
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'failed', failure: '' }), CHECK_VIOLATION, 'ck_notifications_email_failure');
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'failed', failure: ' http' }), CHECK_VIOLATION, 'ck_notifications_email_failure');
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'skipped', failure: 'no transport ' }), CHECK_VIOLATION, 'ck_notifications_email_failure');
      for (const emailStatus of ['none', 'queued']) {
        await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus, failure: 'http' }), CHECK_VIOLATION, 'ck_notifications_email_failure');
      }
      await expectSqlError(client, NOTIFICATION_SQL, notificationParams(r, { emailStatus: 'sent', sentAt: SENT_AT, failure: 'http' }), CHECK_VIOLATION, 'ck_notifications_email_failure');

      // Valid states.
      await notification(client, r);
      await notification(client, r, { emailStatus: 'skipped' });
      await notification(client, r, { emailStatus: 'skipped', failure: 'no_transport' });
      await notification(client, r, { emailStatus: 'failed', failure: 'timeout' });
      await notification(client, r, { emailStatus: 'sent', sentAt: SENT_AT });
      await notification(client, r, { emailStatus: 'sent', sentAt: SENT_AT, messageId: 'provider-id-1' });

      // The dispatcher's moves: queued → sent and queued → failed in one statement each; a half-written move is refused.
      const first = await notification(client, r, { emailStatus: 'queued' });
      const second = await notification(client, r, { emailStatus: 'queued' });
      await expectSqlError(client, `UPDATE notifications SET email_status = 'sent' WHERE id = $1`, [first], CHECK_VIOLATION, 'ck_notifications_email_sent_at');
      await expectSqlError(client, `UPDATE notifications SET email_status = 'failed' WHERE id = $1`, [second], CHECK_VIOLATION, 'ck_notifications_email_failure');
      const moved = await client.query(
        `UPDATE notifications SET email_status = 'sent', email_sent_at = now(), email_message_id = 'provider-id-2' WHERE id = $1 AND email_status = 'queued'`,
        [first],
      );
      expect(moved.rowCount).toBe(1);
      // The same conditional move a second time touches nothing: a notification is never mailed twice.
      const again = await client.query(`UPDATE notifications SET email_status = 'sent', email_sent_at = now() WHERE id = $1 AND email_status = 'queued'`, [first]);
      expect(again.rowCount).toBe(0);
      await client.query(`UPDATE notifications SET email_status = 'failed', email_failure = 'stale' WHERE id = $1 AND email_status = 'queued'`, [second]);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND email_status = 'queued'`, [r])).toBe(0);
      // Reading a notification is independent of its e-mail.
      await client.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [second]);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL`, [r])).toBe(7);
    });
  });

  it('keeps one preference per user and category — AC2', async () => {
    await inRollback(async (client) => {
      const u = await user(client, 'p');
      const other = await user(client, 'q');
      await client.query(PREFERENCE_SQL, [u, 'finance', false]);
      await client.query(PREFERENCE_SQL, [u, 'lessons', true]);
      await client.query(PREFERENCE_SQL, [other, 'finance', true]);
      await expectSqlError(client, PREFERENCE_SQL, [u, 'finance', true], UNIQUE_VIOLATION, 'notification_preferences_pkey');
      await expectSqlError(client, PREFERENCE_SQL, [u, 'sms', true], INVALID_ENUM_VALUE);
      // The write of API-172: replace the switch of a named category, leave the others.
      await client.query(
        `INSERT INTO notification_preferences (user_id, category, email_enabled) VALUES ($1, 'finance', true)
         ON CONFLICT (user_id, category) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = now()`,
        [u],
      );
      // Ordered by the enum column (its declared order), not by the text alias.
      const rows = await client.query<{ category: string; email_enabled: boolean }>(
        `SELECT p.category::text AS category, p.email_enabled FROM notification_preferences p WHERE p.user_id = $1 ORDER BY p.category`,
        [u],
      );
      expect(rows.rows).toEqual([
        { category: 'lessons', email_enabled: true },
        { category: 'finance', email_enabled: true },
      ]);
    });
  });

  it('enforces the announcement CHECKs (audience kind, class scope, title and body lengths, recipient count) — AC2', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'A');
      const classAudience = JSON.stringify({ kind: 'class', classId, students: true, guardians: true });
      // The audience is an object with a known kind; a missing or null kind is refused, not let through as NULL.
      for (const audience of ['[]', '"class"', 'null', '{}', '{"kind":null}', '{"kind":"everyone"}', '{"kind":"Class"}', '{"kind":["class"]}']) {
        await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ audience }), CHECK_VIOLATION, 'ck_announcements_audience_kind');
      }
      await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ classId }), CHECK_VIOLATION, 'ck_announcements_class_scope');
      // Lengths count characters, not bytes: 200 Arabic letters fit, 201 do not.
      await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ title: '  ' }), CHECK_VIOLATION, 'ck_announcements_title_length');
      await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ title: 'ع'.repeat(201) }), CHECK_VIOLATION, 'ck_announcements_title_length');
      await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ body: '' }), CHECK_VIOLATION, 'ck_announcements_body_length');
      await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ body: 'ع'.repeat(4001) }), CHECK_VIOLATION, 'ck_announcements_body_length');
      await expectSqlError(client, ANNOUNCEMENT_SQL, announcementParams({ recipients: -1 }), CHECK_VIOLATION, 'ck_announcements_recipient_count_non_negative');
      // Valid: the longest texts, an academy announcement, a class announcement with and without its class link.
      await announcement(client, { title: 'ع'.repeat(200), body: 'ع'.repeat(4000), recipients: 0 });
      await announcement(client, { sendEmail: true, recipients: 5000 });
      await announcement(client, { audience: classAudience, classId });
      await announcement(client, { audience: classAudience });
    });
  });

  it('deletes notifications and preferences with their recipient and the notifications of an announcement with it; clears the student, sender and class links — AC3', async () => {
    await inRollback(async (client) => {
      const recipient = await user(client, 'fkr');
      const student = await user(client, 'fks');
      const sender = await user(client, 'fkt');
      const classId = await klass(client, 'FK');
      const audience = JSON.stringify({ kind: 'class', classId, students: true });
      const sent = await announcement(client, { senderId: sender, audience, classId });
      const about = await notification(client, recipient, { studentId: student });
      const announced = await notification(client, recipient, { eventKey: 'announcement', category: 'announcements', announcementId: sent });
      const own = await notification(client, student, { studentId: student });
      await client.query(PREFERENCE_SQL, [recipient, 'finance', false]);
      await client.query(PREFERENCE_SQL, [student, 'finance', false]);

      // The class and the sender go: the announcement stays, without the two links, and keeps its audience.
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [sender]);
      const kept = await client.query<{ sender_user_id: string | null; class_id: string | null; audience_class: string }>(
        `SELECT sender_user_id, class_id, audience ->> 'classId' AS audience_class FROM announcements WHERE id = $1`,
        [sent],
      );
      expect(kept.rows[0]).toEqual({ sender_user_id: null, class_id: null, audience_class: classId });

      // The student goes: their own notifications and preferences go, a guardian's copy only loses the link.
      await client.query(`DELETE FROM users WHERE id = $1`, [student]);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE id = $1`, [own])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM notification_preferences WHERE user_id = $1`, [student])).toBe(0);
      expect((await client.query(`SELECT student_user_id FROM notifications WHERE id = $1`, [about])).rows[0]).toEqual({ student_user_id: null });

      // The announcement goes: its notifications go with it, the others stay.
      await client.query(`DELETE FROM announcements WHERE id = $1`, [sent]);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE id = $1`, [announced])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1`, [recipient])).toBe(1);

      // The recipient goes: nothing of theirs is left.
      await client.query(`DELETE FROM users WHERE id = $1`, [recipient]);
      expect(await count(client, `SELECT count(*)::int AS n FROM notifications WHERE id = $1`, [about])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM notification_preferences WHERE user_id = $1`, [recipient])).toBe(0);
    });
  });

  it('names the CHECKs and the indexes as the migration does, with the two partial indexes', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype = 'c'
        ORDER BY conrelid::regclass::text COLLATE "C", conname::text COLLATE "C"`,
      [[...TABLES]],
    );
    expect(constraints.rows.map((row) => `${row.table_name}.${row.conname}`)).toEqual([
      'announcements.ck_announcements_audience_kind',
      'announcements.ck_announcements_body_length',
      'announcements.ck_announcements_class_scope',
      'announcements.ck_announcements_recipient_count_non_negative',
      'announcements.ck_announcements_title_length',
      'notifications.ck_notifications_announcement_link',
      'notifications.ck_notifications_body_not_blank',
      'notifications.ck_notifications_data_object',
      'notifications.ck_notifications_email_failure',
      'notifications.ck_notifications_email_message_id_only_sent',
      'notifications.ck_notifications_email_sent_at',
      'notifications.ck_notifications_event_key_format',
      'notifications.ck_notifications_title_not_blank',
    ]);

    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname::text AS indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY indexname::text COLLATE "C"`,
      [[...TABLES]],
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'announcements_class_id_idx',
      'announcements_pkey',
      'announcements_sender_user_id_id_idx',
      'ix_notifications_email_queued',
      'ix_notifications_recipient_unread',
      'notification_preferences_pkey',
      'notifications_announcement_id_idx',
      'notifications_pkey',
      'notifications_recipient_user_id_id_idx',
      'notifications_student_user_id_idx',
    ]);
    const definition = (name: string) => indexes.rows.find((row) => row.indexname === name)!.indexdef;
    // The inbox and the sender's list read newest first by the UUIDv7 id.
    expect(definition('notifications_recipient_user_id_id_idx')).toMatch(/\(recipient_user_id, id DESC\)$/);
    expect(definition('announcements_sender_user_id_id_idx')).toMatch(/\(sender_user_id, id DESC\)$/);
    // The unread counter and the boot pickup index only the rows they read.
    expect(definition('ix_notifications_recipient_unread')).toMatch(/\(recipient_user_id\) WHERE \(read_at IS NULL\)$/);
    expect(definition('ix_notifications_email_queued')).toMatch(/\(created_at\) WHERE \(email_status = 'queued'::notification_email_status\)$/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const sender = await tx.user.create({ data: { fullName: 'Prisma sender', email: `${tag.toLowerCase()}-prisma-sender@example.com` } });
        const recipient = await tx.user.create({ data: { fullName: 'Prisma recipient', email: `${tag.toLowerCase()}-prisma-recipient@example.com` } });
        const sent = await tx.announcement.create({
          data: {
            senderUserId: sender.id,
            audience: { kind: 'academy', roleKeys: ['student'] },
            title: 'إعلان',
            body: 'نص الإعلان',
            recipientCount: 1,
            notifications: {
              create: [{ recipientUserId: recipient.id, eventKey: 'announcement', category: 'announcements', title: 'إعلان', body: 'نص الإعلان', data: { link: '/notifications' } }],
            },
          },
          include: { notifications: true },
        });
        expect(sent).toMatchObject({ sendEmail: false, classId: null, recipientCount: 1, audience: { kind: 'academy', roleKeys: ['student'] } });
        expect(sent.notifications).toHaveLength(1);
        expect(sent.notifications[0]).toMatchObject({ announcementId: sent.id, emailStatus: 'none', readAt: null, studentUserId: null, data: { link: '/notifications' } });

        const queued = await tx.notification.create({
          data: { recipientUserId: recipient.id, eventKey: 'payment.recorded', category: 'finance', title: 'دفعة جديدة', body: 'سُجّلت دفعة', studentUserId: recipient.id, emailStatus: 'queued' },
        });
        const moved = await tx.notification.updateMany({ where: { id: queued.id, emailStatus: 'queued' }, data: { emailStatus: 'sent', emailSentAt: new Date(), emailMessageId: 'provider-id' } });
        expect(moved.count).toBe(1);
        expect(await tx.notification.count({ where: { recipientUserId: recipient.id, readAt: null } })).toBe(2);
        const inbox = await tx.notification.findMany({ where: { recipientUserId: recipient.id }, orderBy: { id: 'desc' }, select: { id: true } });
        expect(inbox.map((row) => row.id)).toEqual([queued.id, sent.notifications[0]!.id]);

        await tx.notificationPreference.create({ data: { userId: recipient.id, category: 'finance', emailEnabled: false } });
        const preference = await tx.notificationPreference.findUnique({ where: { userId_category: { userId: recipient.id, category: 'finance' } } });
        expect(preference).toMatchObject({ emailEnabled: false });
        throw marker;
      }),
    ).rejects.toBe(marker);
  });
});
