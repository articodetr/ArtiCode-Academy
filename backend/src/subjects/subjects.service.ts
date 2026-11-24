import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { coursesError } from '../courses/courses.errors.js';
import { canManageCourses } from '../courses/courses.policy.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { checkSubjectOrder, isEmptySubjectPatch, planSubjectUpdate } from './subjects.changes.js';
import type { CurrentSubject, SubjectPatch } from './subjects.changes.js';
import type { CreateSubjectDto, ReorderSubjectsDto, SubjectDto, SubjectListDto, UpdateSubjectDto } from './subjects.dto.js';

export const SUBJECTS_AUDIT_ACTIONS = {
  created: 'subjects.created',
  updated: 'subjects.updated',
  deleted: 'subjects.deleted',
  reordered: 'subjects.reordered',
} as const;

/** Audit `entity_type` of subject events. */
export const SUBJECTS_ENTITY_TYPE = 'subjects';

const SUBJECT_SELECT = {
  id: true,
  code: true,
  name: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { courses: true } },
} satisfies Prisma.SubjectSelect;

type SubjectRow = Prisma.SubjectGetPayload<{ select: typeof SUBJECT_SELECT }>;
type Tx = Prisma.TransactionClient;

function toSubjectDto(row: SubjectRow, manager: boolean): SubjectDto {
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    courseCount: manager ? row._count.courses : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentOf(row: SubjectRow): CurrentSubject {
  return {
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    isActive: row.isActive,
  };
}

/**
 * Every write that assigns or moves sort orders runs under one transaction-
 * scoped advisory lock of its own (not the levels' one), so two creations
 * cannot pick the same `max + 1` and a reorder never interleaves with a
 * creation (the deferred unique would only fail at COMMIT).
 */
async function lockSubjectOrder(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('articode.subjects.order'))`;
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate code (P2002),
 * a deletion that lost the race with a course assignment (P2003 — the FK on
 * courses.subject_id is Restrict) or a row deleted meanwhile (P2025).
 */
function translateKnownError(error: unknown, subjectId: string | null, code: string | null): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002' && code !== null) return coursesError.subjectCodeTaken(code);
  if (error.code === 'P2003') return coursesError.subjectInUse(1);
  if (error.code === 'P2025' && subjectId !== null) return coursesError.subjectNotFound(subjectId);
  return error;
}

/**
 * PORTAL-04 — the school subjects a course teaches (المادة), managed like the
 * MOD-04 levels (a mirror of levels.service.ts). `courses.read` lists the
 * active subjects; `courses.manage` sees inactive ones with their course
 * counts and writes. Every write is one transaction with exactly one audit
 * event (`subjects.*`); metadata holds codes, ids and field names only. A
 * PATCH or reorder without a difference writes nothing and records nothing.
 */
@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(caller: AuthPrincipal): Promise<SubjectListDto> {
    const manager = canManageCourses(caller.permissions);
    const rows = await this.prisma.db.subject.findMany({
      where: manager ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: SUBJECT_SELECT,
    });
    return { items: rows.map((row) => toSubjectDto(row, manager)) };
  }

  async create(input: CreateSubjectDto, caller: AuthPrincipal, ctx: RequestContext): Promise<SubjectDto> {
    const clash = await this.prisma.db.subject.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw coursesError.subjectCodeTaken(input.code);

    const name = toLocalizedText(input.name);
    let subjectId: string;
    try {
      subjectId = await this.prisma.db.$transaction(async (tx) => {
        await lockSubjectOrder(tx);
        const max = await tx.subject.aggregate({ _max: { sortOrder: true } });
        const sortOrder = (max._max.sortOrder ?? -1) + 1;
        const subject = await tx.subject.create({
          data: { code: input.code, name: name as Prisma.InputJsonValue, isActive: input.isActive ?? true, sortOrder },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: SUBJECTS_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: SUBJECTS_ENTITY_TYPE,
            entityId: subject.id,
            metadata: { code: input.code, sortOrder },
            ...ctx,
          },
          tx,
        );
        return subject.id;
      });
    } catch (error) {
      throw translateKnownError(error, null, input.code);
    }
    return this.getById(subjectId);
  }

  async update(id: string, input: UpdateSubjectDto, caller: AuthPrincipal, ctx: RequestContext): Promise<SubjectDto> {
    if (isEmptySubjectPatch(input)) throw coursesError.nothingToUpdate();
    const row = await this.prisma.db.subject.findUnique({ where: { id }, select: SUBJECT_SELECT });
    if (!row) throw coursesError.subjectNotFound(id);

    const patch: SubjectPatch = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.name !== undefined) patch.name = toLocalizedText(input.name);
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    const plan = planSubjectUpdate(currentOf(row), patch);
    if (plan.fields.length === 0) return toSubjectDto(row, true);

    if (plan.data.code !== undefined) {
      const clash = await this.prisma.db.subject.findUnique({ where: { code: plan.data.code }, select: { id: true } });
      if (clash && clash.id !== id) throw coursesError.subjectCodeTaken(plan.data.code);
    }

    const data: Prisma.SubjectUpdateInput = {};
    if (plan.data.code !== undefined) data.code = plan.data.code;
    if (plan.data.name !== undefined) data.name = plan.data.name as Prisma.InputJsonValue;
    if (plan.data.isActive !== undefined) data.isActive = plan.data.isActive;
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.subject.update({ where: { id }, data, select: { id: true } });
        await this.audit.record(
          {
            action: SUBJECTS_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: SUBJECTS_ENTITY_TYPE,
            entityId: id,
            metadata: { code: plan.data.code ?? row.code, fields: plan.fields },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, plan.data.code ?? null);
    }
    return this.getById(id);
  }

  /** Deletes a subject no course uses (`409 subject_in_use` otherwise); the remaining orders keep their gaps. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.db.subject.findUnique({ where: { id }, select: SUBJECT_SELECT });
    if (!row) throw coursesError.subjectNotFound(id);
    if (row._count.courses > 0) throw coursesError.subjectInUse(row._count.courses);
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockSubjectOrder(tx);
        // The FK on courses.subject_id (Restrict) rejects the delete if a course
        // took the subject meanwhile (P2003 → 409) and rolls the event back too.
        await tx.subject.delete({ where: { id }, select: { id: true } });
        await this.audit.record(
          {
            action: SUBJECTS_AUDIT_ACTIONS.deleted,
            actorUserId: caller.id,
            entityType: SUBJECTS_ENTITY_TYPE,
            entityId: id,
            metadata: { code: row.code },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, null);
    }
  }

  /**
   * Full reorder: `subjectIds` must list every subject exactly once (`400
   * subject_order_invalid` otherwise); positions become 0..n-1. The swap is
   * legal inside the transaction because `uq_subjects_sort_order` is deferred
   * (ADR-046, as for the levels).
   */
  async reorder(input: ReorderSubjectsDto, caller: AuthPrincipal, ctx: RequestContext): Promise<SubjectListDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await lockSubjectOrder(tx);
      const rows = await tx.subject.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, sortOrder: true },
      });
      const check = checkSubjectOrder(
        rows.map((row) => row.id),
        input.subjectIds,
      );
      if (!check.ok) throw coursesError.subjectOrderInvalid(check.problems);
      if (!check.changed) return;
      const position = new Map(rows.map((row) => [row.id, row.sortOrder]));
      for (const [index, subjectId] of input.subjectIds.entries()) {
        if (position.get(subjectId) === index) continue;
        await tx.subject.update({ where: { id: subjectId }, data: { sortOrder: index }, select: { id: true } });
      }
      await this.audit.record(
        {
          action: SUBJECTS_AUDIT_ACTIONS.reordered,
          actorUserId: caller.id,
          entityType: SUBJECTS_ENTITY_TYPE,
          entityId: null,
          metadata: { subjectIds: input.subjectIds },
          ...ctx,
        },
        tx,
      );
    });
    return this.list(caller);
  }

  /** Manager view of one subject (create/update responses). */
  private async getById(id: string): Promise<SubjectDto> {
    const row = await this.prisma.db.subject.findUnique({ where: { id }, select: SUBJECT_SELECT });
    if (!row) throw coursesError.subjectNotFound(id);
    return toSubjectDto(row, true);
  }
}
