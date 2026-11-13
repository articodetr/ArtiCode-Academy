// MOD-18-T04 — the academies of the platform registry (API-183..187). Reading
// is open to every signed-in platform user; the controller lets only
// `super_admin` write. Every effective write is one transaction that locks the
// academy row first (lockAcademy) and records exactly one platform audit event;
// a refusal or a PATCH without a difference writes and records nothing.
import { Injectable } from '@nestjs/common';
import { readLocalizedText } from '../../authorization/localized-text.js';
import type { RequestContext } from '../../auth/principal.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../common/keyset-cursor.js';
import type { Prisma } from '../../generated/platform/client.js';
import { escapeLikePattern } from '../../users/users.validation.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import { ACADEMIES_PAGE_DEFAULT } from './academies.dto.js';
import type { AcademyDetailDto, AcademyListDto, ChangeAcademyStatusDto, CreateAcademyDto, ListAcademiesQueryDto, UpdateAcademyDto } from './academies.dto.js';
import {
  ACADEMY_ITEM_SELECT,
  REGISTRY_AUDIT_ACTIONS,
  REGISTRY_ENTITY_TYPES,
  isUniqueViolation,
  loadAcademyDetail,
  lockAcademy,
  toAcademyItems,
} from './academies.read.js';
import { actionNeedsOrigin, allowedAcademyActions, archivedAtAfter, isReadOnly, nextAcademyStatus } from './academy-status.js';
import { ACADEMY_PATCH_FIELDS, isEmptyPatch, planAcademyUpdate } from './registry.changes.js';
import type { AcademyPatch } from './registry.changes.js';
import { toPlatformLocalizedText } from './registry.dto.js';
import { registryError } from './registry.errors.js';

/** The list's only order: newest first on the UUIDv7 primary key (creation order). */
const LIST_SORT = 'createdAt';
const LIST_ORDER = 'desc';

function patchOf(input: UpdateAcademyDto): AcademyPatch {
  const patch: AcademyPatch = {};
  if (input.name !== undefined) patch.name = toPlatformLocalizedText(input.name);
  if (input.origin !== undefined) patch.origin = input.origin;
  if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail;
  if (input.notes !== undefined) patch.notes = input.notes;
  return patch;
}

@Injectable()
export class AcademiesService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * API-183 — keyset pages, newest first. Without `status`, archived
   * academies are left out unless `includeArchived`; `q` matches the slug or
   * the Arabic/English name literally and case-insensitively.
   */
  async list(query: ListAcademiesQueryDto): Promise<AcademyListDto> {
    const db = this.prisma.db;
    const limit = query.limit ?? ACADEMIES_PAGE_DEFAULT;
    const filters: Prisma.AcademyWhereInput[] = [];
    if (query.status) filters.push({ status: query.status });
    else if (query.includeArchived !== true) filters.push({ status: { not: 'archived' } });
    if (query.q) {
      const pattern = escapeLikePattern(query.q);
      filters.push({ OR: [{ slug: { contains: pattern, mode: 'insensitive' } }, { id: { in: await this.idsByName(pattern) } }] });
    }
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, LIST_SORT, LIST_ORDER, false, () => registryError.cursorInvalid());
      filters.push({ id: { lt: cursor.id } });
    }
    const rows = await db.academy.findMany({ where: { AND: filters }, orderBy: [{ id: 'desc' }], take: limit + 1, select: ACADEMY_ITEM_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: LIST_SORT, order: LIST_ORDER, key: null, id: last.id }) : null;
    return { items: await toAcademyItems(db, page), nextCursor };
  }

  /**
   * Ids of the academies whose Arabic or English name contains `pattern`
   * (already escaped), case-insensitively. Prisma's JSON `string_contains`
   * builds a case-sensitive LIKE with the value unescaped (the academy KI-048),
   * so a parameterised ILIKE with `\` as ESCAPE matches `%`/`_` literally.
   */
  private async idsByName(pattern: string): Promise<string[]> {
    const like = `%${pattern}%`;
    const rows = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM academies
      WHERE name ->> 'ar' ILIKE ${like} ESCAPE '\\' OR name ->> 'en' ILIKE ${like} ESCAPE '\\'`;
    return rows.map((row) => row.id);
  }

  /** API-185 */
  get(id: string): Promise<AcademyDetailDto> {
    return loadAcademyDetail(this.prisma.db, id);
  }

  /** API-184 — a `provisioning` academy registered by the caller; `409 academy_slug_taken` on a duplicate. */
  async create(input: CreateAcademyDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<AcademyDetailDto> {
    const db = this.prisma.db;
    const clash = await db.academy.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (clash) throw registryError.academySlugTaken(input.slug);
    let academyId: string;
    try {
      academyId = await db.$transaction(async (tx) => {
        const academy = await tx.academy.create({
          data: {
            slug: input.slug,
            name: toPlatformLocalizedText(input.name) as Prisma.InputJsonValue,
            origin: input.origin ?? null,
            contactEmail: input.contactEmail ?? null,
            notes: input.notes ?? null,
            createdById: caller.id,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId: caller.id,
          action: REGISTRY_AUDIT_ACTIONS.academyCreated,
          entityType: REGISTRY_ENTITY_TYPES.academies,
          entityId: academy.id,
          metadata: { slug: input.slug },
          ctx,
        });
        return academy.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw registryError.academySlugTaken(input.slug);
      throw error;
    }
    return loadAcademyDetail(db, academyId);
  }

  /**
   * API-186 — smallest diff; `{}` is `400 nothing_to_update`; an archived
   * academy is read-only (`409 academy_archived`); clearing the origin of an
   * active academy is `422 origin_required`.
   */
  async update(id: string, input: UpdateAcademyDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<AcademyDetailDto> {
    if (isEmptyPatch(input, ACADEMY_PATCH_FIELDS)) throw registryError.nothingToUpdate();
    const patch = patchOf(input);
    const db = this.prisma.db;
    await db.$transaction(async (tx) => {
      const locked = await lockAcademy(tx, id);
      if (!locked) throw registryError.academyNotFound(id);
      if (isReadOnly(locked.status)) throw registryError.academyArchived(id);
      const row = await tx.academy.findUniqueOrThrow({
        where: { id },
        select: { status: true, name: true, origin: true, contactEmail: true, notes: true },
      });
      const plan = planAcademyUpdate({ ...row, name: readLocalizedText(row.name) ?? { ar: locked.slug } }, patch);
      if (plan.fields.length === 0) return;
      if (plan.clearsActiveOrigin) throw registryError.originRequired(id, 'clear_origin');
      const data: Prisma.AcademyUpdateInput = {};
      if (plan.data.name !== undefined) data.name = plan.data.name as Prisma.InputJsonValue;
      if (plan.data.origin !== undefined) data.origin = plan.data.origin;
      if (plan.data.contactEmail !== undefined) data.contactEmail = plan.data.contactEmail;
      if (plan.data.notes !== undefined) data.notes = plan.data.notes;
      await tx.academy.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(tx, {
        actorId: caller.id,
        action: REGISTRY_AUDIT_ACTIONS.academyUpdated,
        entityType: REGISTRY_ENTITY_TYPES.academies,
        entityId: id,
        metadata: { slug: locked.slug, fields: plan.fields },
        ctx,
      });
    });
    return loadAcademyDetail(db, id);
  }

  /** API-187 — the state machine of academy-status.ts under the academy-row lock. */
  async changeStatus(id: string, input: ChangeAcademyStatusDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<AcademyDetailDto> {
    const db = this.prisma.db;
    const reason = input.reason ?? null;
    await db.$transaction(async (tx) => {
      const locked = await lockAcademy(tx, id);
      if (!locked) throw registryError.academyNotFound(id);
      const from = locked.status;
      const to = nextAcademyStatus(input.action, from);
      if (!to) throw registryError.academyTransition(from, input.action, allowedAcademyActions(from));
      const row = await tx.academy.findUniqueOrThrow({ where: { id }, select: { origin: true, archivedAt: true } });
      if (actionNeedsOrigin(input.action) && row.origin === null) throw registryError.originRequired(id, 'activate');
      await tx.academy.update({
        where: { id },
        data: { status: to, archivedAt: archivedAtAfter(to, row.archivedAt, new Date()) },
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorId: caller.id,
        action: REGISTRY_AUDIT_ACTIONS.academyStatusChanged,
        entityType: REGISTRY_ENTITY_TYPES.academies,
        entityId: id,
        metadata: { slug: locked.slug, action: input.action, from, to, ...(reason !== null ? { reason } : {}) },
        ctx,
      });
    });
    return loadAcademyDetail(db, id);
  }
}
