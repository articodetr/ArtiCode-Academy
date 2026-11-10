import { Injectable } from '@nestjs/common';
import { readSettings, DEFAULT_CERTIFICATE_SERIAL_PREFIX } from '../academy/academy.settings.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus } from '../generated/prisma/client.js';
import { GradebookService } from '../grades/gradebook.service.js';
import type { FinalGradeState } from '../grades/gradebook.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { CERTIFICATES_PAGE_DEFAULT } from './certificates.dto.js';
import type {
  CertificateDto,
  CertificateListDto,
  CertificateVerificationDto,
  ClassCertificatesDto,
  IssueCertificatesDto,
  IssueCertificatesResultDto,
  ListCertificatesQueryDto,
  RevokeCertificateDto,
  SkippedEnrollmentDto,
} from './certificates.dto.js';
import { certificatesError } from './certificates.errors.js';
import { CERTIFICATE_SEQUENCE_KEY, formatSerial, ineligibilityOf, newVerificationCode, normalizeVerificationCode, yearIn } from './certificates.policy.js';
import type { IneligibleReason } from './certificates.policy.js';

export const CERTIFICATES_AUDIT_ACTIONS = {
  issued: 'certificates.issued',
  revoked: 'certificates.revoked',
} as const;

/** The issuing event is recorded on the class (as `grades.finalized`); the revocation on the certificate. */
export const CERTIFICATES_CLASS_ENTITY_TYPE = 'classes';
export const CERTIFICATES_ENTITY_TYPE = 'certificates';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

/** Every column a CertificateDto needs. */
export const CERTIFICATE_SELECT = {
  id: true,
  serial: true,
  verificationCode: true,
  status: true,
  enrollmentId: true,
  percent: true,
  bandLabel: true,
  bandLetter: true,
  snapshot: true,
  issuedAt: true,
  revokedAt: true,
  revokeReason: true,
  class: { select: { id: true, code: true, name: true } },
  course: { select: { id: true, code: true, name: true } },
  student: { select: { id: true, fullName: true, fullNameLatin: true, displayName: true } },
  issuedBy: { select: { fullName: true } },
  revokedBy: { select: { fullName: true } },
} as const satisfies Prisma.CertificateSelect;

export type CertificateRow = Prisma.CertificateGetPayload<{ select: typeof CERTIFICATE_SELECT }>;

function localized(value: Prisma.JsonValue, fallback: string): LocalizedText {
  return readLocalizedText(value) ?? { ar: fallback };
}

export function toCertificateDto(row: CertificateRow): CertificateDto {
  return {
    id: row.id,
    serial: row.serial,
    verificationCode: row.verificationCode,
    status: row.status,
    enrollmentId: row.enrollmentId,
    class: { id: row.class.id, code: row.class.code, name: localized(row.class.name, row.class.code) },
    course: { id: row.course.id, code: row.course.code, name: localized(row.course.name, row.course.code) },
    student: row.student,
    grade: { percent: Number(row.percent), label: localized(row.bandLabel, ''), letter: row.bandLetter },
    snapshot: row.snapshot as unknown as CertificateDto['snapshot'],
    issuedAt: row.issuedAt.toISOString(),
    issuedBy: row.issuedBy ? { fullName: row.issuedBy.fullName } : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedBy: row.revokedBy ? { fullName: row.revokedBy.fullName } : null,
    revokeReason: row.revokeReason,
  };
}

interface ClassRow {
  id: string;
  code: string;
  status: ClassStatus;
}

/**
 * MOD-10-T02 — issuing the certificates of a class and its preview (roadmap
 * §4h.10.4 API-132/API-136; owner decisions D-R50..D-R54). Issuing needs
 * `certificates.issue` for the whole academy (no class visibility — D-R52);
 * the preview opens with `certificates.read_all` or `certificates.issue`
 * (checked in the controller). Under the class-row lock (`FOR NO KEY UPDATE`,
 * the lock a finalization takes, so the two never race) a completed class
 * gets one certificate per enrollment that is completed, holds a passing final
 * grade that is not stale and has no issued certificate yet (D-R52 — the rest
 * are skipped with their reason). The serials `PREFIX-YYYY-NNNNN` are reserved
 * in one upsert of the `number_sequences` row inside the same transaction
 * (D-R53 — the year in the academy's time zone, the prefix from
 * `settings.certificates.serialPrefix`, else `CERT`); each certificate keeps a
 * snapshot of what is printed (D-R50). One `certificates.issued` event per
 * effective request; nothing eligible = 200 without write or event.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gradebook: GradebookService,
  ) {}

  /** API-136 */
  async classPreview(classId: string, caller: AuthPrincipal): Promise<ClassCertificatesDto> {
    const db = this.prisma.db;
    const klass = await db.class.findUnique({ where: { id: classId }, select: { id: true, code: true, name: true, status: true } });
    if (!klass) throw certificatesError.classNotFound(classId);
    const states = await this.gradebook.finalGradeStates(db, classId);
    const issued = await this.issuedOf(db, classId);
    const view = rosterProjectionOf(caller);
    const items = states.map((state) => {
      const certificate = issued.get(state.enrollmentId) ?? null;
      return {
        enrollmentId: state.enrollmentId,
        enrollmentStatus: state.enrollmentStatus,
        student: toRosterStudentDto(state.student, view),
        final: state.final
          ? { percent: Number(state.final.percent), label: state.final.bandLabel, letter: state.final.bandLetter, isPass: state.final.isPass, stale: state.final.stale }
          : null,
        certificate,
        reason: this.reasonOf(state, certificate !== null),
      };
    });
    return {
      class: { id: klass.id, code: klass.code, name: localized(klass.name, klass.code), status: klass.status },
      issuable: klass.status === 'completed' ? items.filter((item) => item.reason === null).length : 0,
      items,
    };
  }

  /** API-132 */
  async issue(classId: string, input: IssueCertificatesDto, caller: AuthPrincipal, ctx: RequestContext): Promise<IssueCertificatesResultDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const klass = await this.lockClass(tx, classId);
      const requested = await this.requestedEnrollments(tx, classId, input.enrollmentIds);
      if (klass.status !== 'completed') throw certificatesError.classNotCompleted(classId, klass.status);

      const states = await this.gradebook.finalGradeStates(tx, classId);
      const byEnrollment = new Map(states.map((state) => [state.enrollmentId, state]));
      const issued = await this.issuedOf(tx, classId);
      const skipped: SkippedEnrollmentDto[] = [];
      const eligible: FinalGradeState[] = [];
      const candidates = requested ?? states.map((state) => ({ id: state.enrollmentId, studentUserId: state.student.id }));
      for (const candidate of candidates) {
        const state = byEnrollment.get(candidate.id);
        const reason: IneligibleReason | null = state ? this.reasonOf(state, issued.has(candidate.id)) : issued.has(candidate.id) ? 'already_issued' : 'not_completed';
        if (reason === null && state) eligible.push(state);
        else skipped.push({ enrollmentId: candidate.id, studentId: candidate.studentUserId, reason: reason ?? 'not_completed' });
      }
      if (eligible.length === 0) return { issued: [], skipped };

      const now = new Date();
      const academy = await tx.academy.findFirst({ select: { name: true, timezone: true, settings: true } });
      const prefix = readSettings(academy?.settings).certificates.serialPrefix ?? DEFAULT_CERTIFICATE_SERIAL_PREFIX;
      const year = yearIn(academy?.timezone ?? 'UTC', now);
      const first = await this.reserveSerials(tx, year, eligible.length);
      const details = await tx.class.findUniqueOrThrow({
        where: { id: classId },
        select: {
          code: true,
          name: true,
          course: { select: { id: true, code: true, name: true } },
          enrollments: { where: { id: { in: eligible.map((state) => state.enrollmentId) } }, select: { id: true, completedAt: true } },
        },
      });
      const completedAt = new Map(details.enrollments.map((row) => [row.id, row.completedAt]));
      const academyName = academy ? localized(academy.name, '') : { ar: '' };

      const created: CertificateRow[] = [];
      for (const [index, state] of eligible.entries()) {
        const final = state.final!;
        const percent = Number(final.percent);
        const snapshot = {
          student: { fullName: state.student.fullName, fullNameLatin: state.student.fullNameLatin, displayName: state.student.displayName },
          course: { code: details.course.code, name: localized(details.course.name, details.course.code) },
          class: { code: details.code, name: localized(details.name, details.code) },
          academy: { name: academyName },
          grade: { percent, label: final.bandLabel, letter: final.bandLetter },
          completedAt: completedAt.get(state.enrollmentId)?.toISOString() ?? null,
          issuedAt: now.toISOString(),
        };
        created.push(
          await tx.certificate.create({
            data: {
              serial: formatSerial(prefix, year, first + index),
              verificationCode: newVerificationCode(),
              enrollmentId: state.enrollmentId,
              classId,
              courseId: details.course.id,
              studentUserId: state.student.id,
              percent: final.percent,
              bandLabel: final.bandLabel as unknown as Prisma.InputJsonValue,
              bandLetter: final.bandLetter,
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
              issuedAt: now,
              issuedById: caller.id,
            },
            select: CERTIFICATE_SELECT,
          }),
        );
      }
      await this.audit.record(
        {
          action: CERTIFICATES_AUDIT_ACTIONS.issued,
          actorUserId: caller.id,
          entityType: CERTIFICATES_CLASS_ENTITY_TYPE,
          entityId: classId,
          metadata: { code: klass.code, count: created.length, certificateIds: created.map((row) => row.id), ...(skipped.length > 0 ? { skipped: skipped.length } : {}) },
          ...ctx,
        },
        tx,
      );
      return { issued: created.map(toCertificateDto), skipped };
    });
  }

  /** API-130 — newest first by the UUIDv7 id (insertion order), keyset pages. */
  async list(query: ListCertificatesQueryDto): Promise<CertificateListDto> {
    const limit = query.limit ?? CERTIFICATES_PAGE_DEFAULT;
    const where: Prisma.CertificateWhereInput = {};
    if (query.classId) where.classId = query.classId;
    if (query.courseId) where.courseId = query.courseId;
    if (query.studentId) where.studentUserId = query.studentId;
    if (query.status) where.status = query.status;
    if (query.q) where.serial = { contains: escapeLikePattern(query.q), mode: 'insensitive' };
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, 'issued', 'desc', false, () => certificatesError.cursorInvalid());
      where.id = { lt: cursor.id };
    }
    const rows = await this.prisma.db.certificate.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1, select: CERTIFICATE_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toCertificateDto),
      nextCursor: rows.length > limit && last ? encodeKeysetCursor({ sort: 'issued', order: 'desc', key: null, id: last.id }) : null,
    };
  }

  /** API-131 */
  async detail(certificateId: string): Promise<CertificateDto> {
    const row = await this.prisma.db.certificate.findUnique({ where: { id: certificateId }, select: CERTIFICATE_SELECT });
    if (!row) throw certificatesError.certificateNotFound();
    return toCertificateDto(row);
  }

  /** API-133 — final (D-R55): issued → revoked under the certificate-row lock, one `certificates.revoked` event. */
  async revoke(certificateId: string, input: RevokeCertificateDto, caller: AuthPrincipal, ctx: RequestContext): Promise<CertificateDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; revoked_at: Date | null }[]>`SELECT status::text AS status, revoked_at FROM certificates WHERE id = ${certificateId}::uuid FOR NO KEY UPDATE`;
      const current = locked[0];
      if (!current) throw certificatesError.certificateNotFound();
      if (current.status === 'revoked') throw certificatesError.certificateRevoked(certificateId, current.revoked_at!.toISOString());
      const row = await tx.certificate.update({
        where: { id: certificateId },
        data: { status: 'revoked', revokedAt: new Date(), revokedById: caller.id, revokeReason: input.reason },
        select: { ...CERTIFICATE_SELECT, classId: true },
      });
      await this.audit.record(
        {
          action: CERTIFICATES_AUDIT_ACTIONS.revoked,
          actorUserId: caller.id,
          entityType: CERTIFICATES_ENTITY_TYPE,
          entityId: certificateId,
          metadata: { serial: row.serial, classId: row.classId, reason: input.reason },
          ...ctx,
        },
        tx,
      );
      return toCertificateDto(row);
    });
  }

  /** API-134 — the public verification (D-R56): a malformed or unknown code is the same 404. */
  async verify(rawCode: string): Promise<CertificateVerificationDto> {
    const code = normalizeVerificationCode(rawCode);
    const row = code
      ? await this.prisma.db.certificate.findUnique({
          where: { verificationCode: code },
          select: { serial: true, status: true, issuedAt: true, revokedAt: true, percent: true, bandLabel: true, bandLetter: true, snapshot: true },
        })
      : null;
    if (!row) throw certificatesError.certificateNotFound();
    const snapshot = row.snapshot as unknown as CertificateDto['snapshot'];
    return {
      serial: row.serial,
      status: row.status,
      issuedAt: row.issuedAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      student: { fullName: snapshot.student.fullName, fullNameLatin: snapshot.student.fullNameLatin ?? null },
      course: snapshot.course,
      grade: { percent: Number(row.percent), label: localized(row.bandLabel, ''), letter: row.bandLetter },
      academy: snapshot.academy,
    };
  }

  // ---------------------------------------------------------------------------

  private reasonOf(state: FinalGradeState, issued: boolean): IneligibleReason | null {
    return ineligibilityOf({ issued, enrollmentStatus: state.enrollmentStatus, final: state.final ? { isPass: state.final.isPass, stale: state.final.stale } : null });
  }

  /** The issued certificate of each enrollment of the class. */
  private async issuedOf(db: Db, classId: string): Promise<Map<string, { id: string; serial: string; issuedAt: string }>> {
    const rows = await db.certificate.findMany({ where: { classId, status: 'issued' }, select: { id: true, serial: true, issuedAt: true, enrollmentId: true } });
    return new Map(rows.map((row) => [row.enrollmentId, { id: row.id, serial: row.serial, issuedAt: row.issuedAt.toISOString() }]));
  }

  /** Locks the class row (the MOD-05 lock, as a finalization). */
  private async lockClass(tx: Tx, classId: string): Promise<ClassRow> {
    const rows = await tx.$queryRaw<ClassRow[]>`SELECT id, code, status FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
    if (!rows[0]) throw certificatesError.classNotFound(classId);
    return rows[0];
  }

  /** The named enrollments, each of this class and once (any status), else 400 before anything else; undefined = all. */
  private async requestedEnrollments(tx: Tx, classId: string, ids: string[] | undefined): Promise<{ id: string; studentUserId: string }[] | undefined> {
    if (!ids) return undefined;
    const seen = new Set<string>();
    const duplicates = [...new Set(ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false))))];
    const rows = await tx.enrollment.findMany({ where: { classId, id: { in: [...seen] } }, select: { id: true, studentUserId: true } });
    const found = new Map(rows.map((row) => [row.id, row]));
    const unknown = [...seen].filter((id) => !found.has(id));
    if (unknown.length > 0 || duplicates.length > 0) throw certificatesError.requestInvalid(unknown, duplicates);
    return [...seen].map((id) => found.get(id)!);
  }

  /** Reserves `count` consecutive numbers of the year (D-R53); returns the first. The row stays locked until commit. */
  private async reserveSerials(tx: Tx, year: string, count: number): Promise<number> {
    const rows = await tx.$queryRaw<{ last_value: bigint }[]>`
      INSERT INTO number_sequences (key, period, last_value, updated_at)
      VALUES (${CERTIFICATE_SEQUENCE_KEY}, ${year}, ${count}::bigint, now())
      ON CONFLICT (key, period) DO UPDATE SET last_value = number_sequences.last_value + EXCLUDED.last_value, updated_at = now()
      RETURNING last_value`;
    return Number(rows[0]!.last_value) - count + 1;
  }
}
