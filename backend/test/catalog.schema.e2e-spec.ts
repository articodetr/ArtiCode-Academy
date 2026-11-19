// TEST-240 — the fourteenth migration `20261119094146_mod19_catalog_enrollment_requests`
// (MOD-19, roadmap §4p, D-R121..D-R129): the hand-written CHECKs reject what
// they must and accept the rest, the fee plan a course points to cannot be
// deleted (NO ACTION), a class is closed to self-service by default, the new
// notification category exists and the one-time grant reached the `student`
// system role. Writes go through Prisma as the app role; every row carries a
// unique prefix and is deleted at the end. Skipped when no database is reachable.
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `KS${RUN}`;

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

/** The constraint a failed write names, from the driver error Prisma wraps. */
function constraintOf(error: unknown): string {
  return JSON.stringify(error, Object.getOwnPropertyNames(error as object)).match(/(ck_[a-z_]+|[a-z_]+_fkey)/)?.[1] ?? String(error);
}

describe.skipIf(!available)('MOD-19 schema (e2e, TEST-240)', () => {
  let prisma: PrismaClient;
  let studentId: string;
  let courseId: string;
  let classId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    studentId = (await prisma.user.create({ data: { email: `ks-${RUN.toLowerCase()}@example.test`, fullName: 'Schema student', status: 'active' }, select: { id: true } })).id;
    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة المخطط' }, status: 'published' }, select: { id: true } })).id;
    classId = (await prisma.class.create({ data: { courseId, code: `${PREFIX}-A`, name: { ar: 'فصل المخطط' }, capacity: 3, status: 'open' }, select: { id: true, selfEnrollment: true } })).id;
  });

  afterAll(async () => {
    try {
      await prisma.enrollment.deleteMany({ where: { classId } });
      await prisma.course.updateMany({ where: { code: { startsWith: PREFIX } }, data: { enrollmentFeePlanId: null } });
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.feePlan.deleteMany({ where: { name: { path: ['ar'], string_starts_with: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.user.deleteMany({ where: { id: studentId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('closes a class to self-service by default and adds the seventh notification category', async () => {
    expect((await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { selfEnrollment: true } })).selfEnrollment).toBe(false);
    const values = await prisma.$queryRaw<{ value: string }[]>`SELECT unnest(enum_range(NULL::notification_category))::text AS value`;
    expect(values.map((row) => row.value)).toEqual(['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements', 'enrollments']);
  });

  it('accepts an http(s) cover URL and refuses anything else', async () => {
    await prisma.course.update({ where: { id: courseId }, data: { coverImageUrl: 'https://cdn.example.org/a.jpg' } });
    for (const bad of ['javascript:alert(1)', 'https://cdn.example.org/a b.jpg', 'cdn.example.org/a.jpg', `https://x.org/${'a'.repeat(2048)}`]) {
      const error = await prisma.course.update({ where: { id: courseId }, data: { coverImageUrl: bad } }).catch((caught: unknown) => caught);
      expect(constraintOf(error), bad.slice(0, 30)).toBe('ck_courses_cover_image_url');
    }
  });

  it('keeps a pending enrollment a dated request and a rejection a cancelled request with its reason', async () => {
    const at = new Date();
    const pending = await prisma.enrollment.create({ data: { classId, studentUserId: studentId, status: 'pending', requestedAt: at }, select: { id: true } }).catch((caught: unknown) => caught);
    expect(pending).toHaveProperty('id');
    const id = (pending as { id: string }).id;
    const refused = async (data: object) => constraintOf(await prisma.enrollment.update({ where: { id }, data }).catch((caught: unknown) => caught));
    expect(await refused({ requestedAt: null })).toBe('ck_enrollments_pending_requested');
    // A rejection only on a cancelled row, always with a reason of 1..500 characters.
    expect(await refused({ rejectedAt: at, rejectionReason: 'x' })).toBe('ck_enrollments_rejected_cancelled');
    expect(await refused({ status: 'cancelled', rejectedAt: at })).toBe('ck_enrollments_rejection_reason');
    expect(await refused({ status: 'cancelled', rejectionReason: 'orphan reason' })).toBe('ck_enrollments_rejection_reason');
    expect(await refused({ status: 'cancelled', rejectedAt: at, rejectionReason: '   ' })).toBe('ck_enrollments_rejection_reason_text');
    expect(await refused({ status: 'cancelled', rejectedAt: at, rejectionReason: 'y'.repeat(501) })).toBe('ck_enrollments_rejection_reason_text');
    await prisma.enrollment.update({ where: { id }, data: { status: 'cancelled', rejectedAt: at, rejectionReason: 'Not this term' } });
    // A rejection of a row that was never requested is refused too.
    expect(await refused({ requestedAt: null })).toBe('ck_enrollments_rejected_cancelled');
  });

  it('keeps the fee plan a course points to (NO ACTION)', async () => {
    const plan = await prisma.feePlan.create({
      data: { name: { ar: `${PREFIX} خطة` }, lines: [{ description: { ar: 'رسوم' }, amount: 10 }], installments: [{ percent: 100, dueOffsetDays: 0 }] },
      select: { id: true },
    });
    await prisma.course.update({ where: { id: courseId }, data: { enrollmentFeePlanId: plan.id } });
    const error = await prisma.feePlan.delete({ where: { id: plan.id } }).catch((caught: unknown) => caught);
    expect(constraintOf(error)).toBe('courses_enrollment_fee_plan_id_fkey');
  });

  it('gave the student system role enrollments.self_enroll once', async () => {
    const grants = await prisma.rolePermission.findMany({ where: { permissionKey: 'enrollments.self_enroll', role: { key: 'student', isSystem: true } }, select: { roleId: true } });
    expect(grants).toHaveLength(1);
  });
});
