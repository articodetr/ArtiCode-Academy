import { Injectable } from '@nestjs/common';
import { MANAGE_ACADEMY_SETTINGS_PERMISSION } from '../academy/academy.policy.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { checkBands, percentText, planGradeSchemeUpdate, sortBands } from './grade-schemes.changes.js';
import type { CurrentScheme, SchemeBand, SchemePatch } from './grade-schemes.changes.js';
import type { CreateGradeSchemeDto, GradeSchemeBandInputDto, GradeSchemeDto, GradeSchemeListDto, UpdateGradeSchemeDto } from './grade-schemes.dto.js';
import { gradesError } from './grades.errors.js';

export const GRADE_SCHEMES_AUDIT_ACTIONS = {
  created: 'grade_schemes.created',
  updated: 'grade_schemes.updated',
  deleted: 'grade_schemes.deleted',
} as const;

/** Audit `entity_type` of the grade scheme events. */
export const GRADE_SCHEMES_ENTITY_TYPE = 'grade_schemes';

const SCHEME_SELECT = {
  id: true,
  name: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  bands: { orderBy: { minPercent: 'asc' }, select: { minPercent: true, label: true, letter: true, isPass: true } },
} satisfies Prisma.GradeSchemeSelect;

type SchemeRow = Prisma.GradeSchemeGetPayload<{ select: typeof SCHEME_SELECT }>;
type Tx = Prisma.TransactionClient;

function canManage(caller: Pick<AuthPrincipal, 'permissions'>): boolean {
  return caller.permissions.includes(MANAGE_ACADEMY_SETTINGS_PERMISSION);
}

function bandsOf(row: SchemeRow): SchemeBand[] {
  return row.bands.map((band) => ({
    minPercent: percentText(band.minPercent.toString()),
    label: readLocalizedText(band.label) ?? { ar: '' },
    letter: band.letter,
    isPass: band.isPass,
  }));
}

function toSchemeDto(row: SchemeRow, finalGradeCount: number | null): GradeSchemeDto {
  return {
    id: row.id,
    name: readLocalizedText(row.name) ?? { ar: '' },
    isDefault: row.isDefault,
    isActive: row.isActive,
    bands: bandsOf(row).map((band) => ({ minPercent: Number(band.minPercent), label: band.label, letter: band.letter, isPass: band.isPass })),
    finalGradeCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentOf(row: SchemeRow): CurrentScheme {
  return { name: readLocalizedText(row.name) ?? { ar: '' }, isDefault: row.isDefault, isActive: row.isActive, bands: bandsOf(row) };
}

/** DTO bands → canonical bands (two-decimal minimums, empty locales dropped). */
function schemeBands(input: readonly GradeSchemeBandInputDto[]): SchemeBand[] {
  return input.map((band) => ({ minPercent: percentText(band.minPercent), label: toLocalizedText(band.label), letter: band.letter ?? null, isPass: band.isPass }));
}

/** `400 grade_scheme_invalid` before any write. */
function assertValidBands(bands: readonly SchemeBand[]): void {
  const { problems, duplicates } = checkBands(bands);
  if (problems.length > 0) throw gradesError.gradeSchemeInvalid(problems, duplicates);
}

function bandRows(bands: readonly SchemeBand[]): Prisma.GradeSchemeBandCreateWithoutSchemeInput[] {
  return sortBands(bands).map((band) => ({ minPercent: band.minPercent, label: band.label as Prisma.InputJsonValue, letter: band.letter, isPass: band.isPass }));
}

/**
 * Every write runs under one transaction-scoped advisory lock (the
 * `articode.branches.main` pattern): two promotions cannot both demote the
 * same default and leave two (the partial unique index
 * `uq_grade_schemes_default` would only fail with a 500), and the first scheme
 * of two simultaneous creations is the only one that becomes the default.
 */
async function lockSchemes(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('articode.grade_schemes.default'))`;
}

/** Makes the current default step down; returns its id (at most one). */
async function demoteDefault(tx: Tx, exceptId: string | null): Promise<string | null> {
  const current = await tx.gradeScheme.findFirst({ where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (!current) return null;
  await tx.gradeScheme.update({ where: { id: current.id }, data: { isDefault: false }, select: { id: true } });
  return current.id;
}

/**
 * MOD-09-T02 — grade schemes (roadmap §4h.4 API-122..API-125; owner decision
 * D-R46). Every signed-in user lists the active schemes (no sensitive data,
 * like GET /api/academy); `academy.settings.manage` also sees inactive ones
 * with their final-grade counts and writes. Once a scheme exists exactly one
 * is the default: the first scheme becomes it, a promotion makes the previous
 * default step down in the same transaction and event, and the default can
 * neither be deactivated nor deleted. Bands are replaced as a whole and
 * validated by `checkBands()`; final grades already fixed keep their snapshot.
 * Every write is one transaction with exactly one audit event; a PATCH without
 * a difference writes and records nothing.
 */
@Injectable()
export class GradeSchemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** API-122 — the default first, then by creation (UUIDv7 order). */
  async list(caller: AuthPrincipal): Promise<GradeSchemeListDto> {
    const manager = canManage(caller);
    const rows = await this.prisma.db.gradeScheme.findMany({
      where: manager ? {} : { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      select: SCHEME_SELECT,
    });
    const counts = manager ? await this.finalGradeCounts(rows.map((row) => row.id)) : null;
    return { items: rows.map((row) => toSchemeDto(row, counts ? (counts.get(row.id) ?? 0) : null)) };
  }

  /** API-123 */
  async create(input: CreateGradeSchemeDto, caller: AuthPrincipal, ctx: RequestContext): Promise<GradeSchemeDto> {
    const bands = schemeBands(input.bands);
    assertValidBands(bands);
    const id = await this.prisma.db.$transaction(async (tx) => {
      await lockSchemes(tx);
      const hasDefault = (await tx.gradeScheme.count({ where: { isDefault: true } })) > 0;
      // The first scheme of the academy is the default whatever the body says (exactly one default once a scheme exists).
      const isDefault = input.isDefault === true || !hasDefault;
      const demotedSchemeId = isDefault && hasDefault ? await demoteDefault(tx, null) : null;
      const created = await tx.gradeScheme.create({
        data: { name: toLocalizedText(input.name) as Prisma.InputJsonValue, isDefault, bands: { create: bandRows(bands) } },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: GRADE_SCHEMES_AUDIT_ACTIONS.created,
          actorUserId: caller.id,
          entityType: GRADE_SCHEMES_ENTITY_TYPE,
          entityId: created.id,
          metadata: { isDefault, bandCount: bands.length, ...(demotedSchemeId ? { demotedSchemeId } : {}) },
          ...ctx,
        },
        tx,
      );
      return created.id;
    });
    return this.getById(id, caller);
  }

  /** API-124 — the smallest change, planned again under the lock. */
  async update(id: string, input: UpdateGradeSchemeDto, caller: AuthPrincipal, ctx: RequestContext): Promise<GradeSchemeDto> {
    if (input.name === undefined && input.bands === undefined && input.isDefault === undefined && input.isActive === undefined) throw gradesError.nothingToUpdate();
    const patch: SchemePatch = {};
    if (input.name !== undefined) patch.name = toLocalizedText(input.name);
    if (input.bands !== undefined) {
      patch.bands = schemeBands(input.bands);
      assertValidBands(patch.bands);
    }
    if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    await this.prisma.db.$transaction(async (tx) => {
      await lockSchemes(tx);
      const row = await tx.gradeScheme.findUnique({ where: { id }, select: SCHEME_SELECT });
      if (!row) throw gradesError.gradeSchemeNotFound(id);
      const plan = planGradeSchemeUpdate(currentOf(row), patch);
      if (plan.refusal) throw gradesError.gradeSchemeIsDefault(id, plan.refusal);
      if (plan.fields.length === 0) return;
      const demotedSchemeId = plan.promotes ? await demoteDefault(tx, id) : null;
      const data: Prisma.GradeSchemeUpdateInput = {};
      if (plan.name !== undefined) data.name = plan.name as Prisma.InputJsonValue;
      if (plan.isActive !== undefined) data.isActive = plan.isActive;
      if (plan.promotes) data.isDefault = true;
      if (plan.bands !== undefined) data.bands = { deleteMany: {}, create: bandRows(plan.bands) };
      await tx.gradeScheme.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(
        {
          action: GRADE_SCHEMES_AUDIT_ACTIONS.updated,
          actorUserId: caller.id,
          entityType: GRADE_SCHEMES_ENTITY_TYPE,
          entityId: id,
          metadata: { fields: plan.fields, ...(demotedSchemeId ? { demotedSchemeId } : {}) },
          ...ctx,
        },
        tx,
      );
    });
    return this.getById(id, caller);
  }

  /** API-125 — a scheme that is neither the default nor used by a final grade. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    try {
      await this.prisma.db.$transaction(async (tx) => {
        await lockSchemes(tx);
        const row = await tx.gradeScheme.findUnique({ where: { id }, select: { isDefault: true } });
        if (!row) throw gradesError.gradeSchemeNotFound(id);
        if (row.isDefault) throw gradesError.gradeSchemeIsDefault(id, 'delete');
        const finalGradeCount = await tx.finalGrade.count({ where: { schemeId: id } });
        if (finalGradeCount > 0) throw gradesError.gradeSchemeInUse(finalGradeCount);
        await tx.gradeScheme.delete({ where: { id }, select: { id: true } });
        await this.audit.record({ action: GRADE_SCHEMES_AUDIT_ACTIONS.deleted, actorUserId: caller.id, entityType: GRADE_SCHEMES_ENTITY_TYPE, entityId: id, metadata: {}, ...ctx }, tx);
      });
    } catch (error) {
      // A final grade fixed after the count still blocks the delete (`final_grades.scheme_id` is Restrict).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw gradesError.gradeSchemeInUse(1);
      throw error;
    }
  }

  private async finalGradeCounts(schemeIds: readonly string[]): Promise<Map<string, number>> {
    if (schemeIds.length === 0) return new Map();
    const groups = await this.prisma.db.finalGrade.groupBy({ by: ['schemeId'], where: { schemeId: { in: [...schemeIds] } }, _count: { _all: true } });
    return new Map(groups.map((group) => [group.schemeId, group._count._all]));
  }

  private async getById(id: string, caller: AuthPrincipal): Promise<GradeSchemeDto> {
    const row = await this.prisma.db.gradeScheme.findUnique({ where: { id }, select: SCHEME_SELECT });
    if (!row) throw gradesError.gradeSchemeNotFound(id);
    const count = canManage(caller) ? ((await this.finalGradeCounts([id])).get(id) ?? 0) : null;
    return toSchemeDto(row, count);
  }
}
