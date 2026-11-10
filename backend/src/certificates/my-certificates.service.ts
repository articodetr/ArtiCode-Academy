import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { relationOf, seesChildren } from '../enrollments/my-classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { myCertificatesAccess } from './certificates.policy.js';
import { CERTIFICATE_SELECT, toCertificateDto } from './certificates.service.js';
import type { ListMyCertificatesQueryDto, MyCertificateItemDto, MyCertificateListDto } from './my-certificates.dto.js';

/**
 * MOD-10-T04 — «my certificates» (`GET /api/me/certificates`, API-135; owner
 * decision D-R57, the pattern of «my grades» — D-R48). The caller's own
 * certificates with `certificates.read_own` (`self`), and — while the caller
 * holds the `guardian` role — those of their linked, not soft-deleted children
 * with `certificates.read_linked` (`child`); the controller refuses a caller
 * with neither key. Issued and revoked certificates, newest first, with the
 * serial, the verification code and the snapshot to print — never the issuer,
 * the revoker or the reason. No pagination (a student holds few). Read-only.
 */
@Injectable()
export class MyCertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyCertificatesQueryDto, caller: AuthPrincipal): Promise<MyCertificateListDto> {
    const access = myCertificatesAccess(caller.permissions);
    const owned: Prisma.CertificateWhereInput[] = [];
    if (access.self) owned.push({ studentUserId: caller.id });
    if (access.child && seesChildren(caller.roles)) owned.push({ student: { deletedAt: null, guardians: { some: { guardianUserId: caller.id } } } });
    if (owned.length === 0) return { items: [] };
    const where: Prisma.CertificateWhereInput = { OR: owned };
    if (query.classId) where.classId = query.classId;
    if (query.studentId) where.studentUserId = query.studentId;
    const rows = await this.prisma.db.certificate.findMany({ where, orderBy: { id: 'desc' }, select: CERTIFICATE_SELECT });
    return {
      items: rows.map((row): MyCertificateItemDto => {
        const full = toCertificateDto(row);
        return {
          id: full.id,
          serial: full.serial,
          verificationCode: full.verificationCode,
          status: full.status,
          enrollmentId: full.enrollmentId,
          class: full.class,
          course: full.course,
          student: full.student,
          grade: full.grade,
          snapshot: full.snapshot,
          issuedAt: full.issuedAt,
          revokedAt: full.revokedAt,
          relation: relationOf(row.student.id, caller.id),
        };
      }),
    };
  }
}
