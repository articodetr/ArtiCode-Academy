import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { isEmptyAcademyPatch, planAcademyUpdate } from './academy.changes.js';
import type { AcademyPatch, AcademyUpdateData, CurrentAcademyRow } from './academy.changes.js';
import type { AcademyDto, UpdateAcademyDto } from './academy.dto.js';
import { academyError } from './academy.errors.js';
import { readSettings } from './academy.settings.js';

export const ACADEMY_AUDIT_ACTIONS = {
  updated: 'academy.updated',
} as const;

/** Audit `entity_type` of the academy row. */
export const ACADEMY_ENTITY_TYPE = 'academy';

// Explicit projection (D-R09): never `singleton` or `platformAcademyId`; `settings` is
// read through its zod schema (MOD-02-T03) and never returned raw.
const ACADEMY_SELECT = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  defaultLocale: true,
  timezone: true,
  currency: true,
  contactEmail: true,
  contactPhone: true,
  settings: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AcademySelect;

type AcademyRow = Prisma.AcademyGetPayload<{ select: typeof ACADEMY_SELECT }>;

/** The jsonb name as `{ ar, en?, tr? }`; the CHECK guarantees `ar`, the slug is a last resort. */
function asLocalizedText(value: Prisma.JsonValue, fallback: string): LocalizedText {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['ar'] === 'string') {
    return value as LocalizedText;
  }
  return { ar: fallback };
}

function toAcademyDto(row: AcademyRow): AcademyDto {
  return {
    id: row.id,
    slug: row.slug,
    name: asLocalizedText(row.name, row.slug),
    logoUrl: row.logoUrl,
    defaultLocale: row.defaultLocale,
    timezone: row.timezone,
    currency: row.currency,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    settings: readSettings(row.settings),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function currentRowOf(row: AcademyRow): CurrentAcademyRow {
  return {
    name: asLocalizedText(row.name, row.slug),
    logoUrl: row.logoUrl,
    defaultLocale: row.defaultLocale as LocaleCode,
    timezone: row.timezone,
    currency: row.currency,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    settings: row.settings,
  };
}

/** DTO → plain patch (the localized name reduced to strings only). */
function patchOf(input: UpdateAcademyDto): AcademyPatch {
  const { name, ...scalars } = input;
  const patch: AcademyPatch = { ...scalars };
  if (name !== undefined) patch.name = toLocalizedText(name);
  return patch;
}

/** Planner output → Prisma update input (`name` needs the JSON input type). */
function toUpdateInput(data: AcademyUpdateData): Prisma.AcademyUpdateInput {
  const { name, settings, ...scalars } = data;
  const input: Prisma.AcademyUpdateInput = { ...scalars };
  if (name !== undefined) input.name = name as Prisma.InputJsonValue;
  if (settings !== undefined) input.settings = settings as Prisma.InputJsonValue;
  return input;
}

/**
 * MOD-02/MOD-14 minimum (ADR-044): read and update the single `academy` row.
 * The global guards authenticate every call; `academy.settings.manage` is
 * enforced on PATCH by the controller. Every write is one transaction with
 * exactly one audit event (`academy.updated { fields }` — names only); a PATCH
 * without a difference writes nothing and records nothing. A write locks the
 * row (`FOR NO KEY UPDATE`) and plans again on the fresh row: two concurrent
 * PATCHes of different settings keys both survive (the jsonb is rewritten as a
 * whole) and never record two events for one change.
 */
@Injectable()
export class AcademyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<AcademyDto> {
    return toAcademyDto(await this.load());
  }

  async update(input: UpdateAcademyDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AcademyDto> {
    if (isEmptyAcademyPatch(input)) throw academyError.nothingToUpdate();
    const patch = patchOf(input);
    const current = await this.load();
    // Fast path: nothing differs from the current row — no transaction, no lock.
    if (planAcademyUpdate(currentRowOf(current), patch).fields.length === 0) return toAcademyDto(current);

    const updated = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academy WHERE id = ${current.id}::uuid FOR NO KEY UPDATE`;
      const fresh = await tx.academy.findUnique({ where: { id: current.id }, select: ACADEMY_SELECT });
      if (!fresh) throw academyError.notConfigured();
      const plan = planAcademyUpdate(currentRowOf(fresh), patch);
      if (plan.fields.length === 0) return fresh;
      const row = await tx.academy.update({ where: { id: current.id }, data: toUpdateInput(plan.data), select: ACADEMY_SELECT });
      // Field names only — never the old or new values.
      await this.audit.record(
        {
          action: ACADEMY_AUDIT_ACTIONS.updated,
          actorUserId: caller.id,
          entityType: ACADEMY_ENTITY_TYPE,
          entityId: current.id,
          metadata: { fields: plan.fields },
          ...ctx,
        },
        tx,
      );
      return row;
    });
    return toAcademyDto(updated);
  }

  /** The single row, or 503 `academy_not_configured` when the database was never seeded. */
  private async load(): Promise<AcademyRow> {
    const row = await this.prisma.db.academy.findFirst({ select: ACADEMY_SELECT });
    if (!row) throw academyError.notConfigured();
    return row;
  }
}
