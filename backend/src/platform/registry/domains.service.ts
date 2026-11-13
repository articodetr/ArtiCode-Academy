// MOD-18-T04 — the hostnames of an academy (API-188..190, D-R102: recorded only,
// no ownership check, no edge proxy). At most one primary domain per academy
// (partial unique `uq_domains_academy_primary`): a promotion makes the current
// primary step down in the same transaction and event, under the academy-row
// lock, so two promotions never race into a 500. Every write answers with the
// academy's detail (its domains in their new order).
import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../auth/principal.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { PlatformPrincipal } from '../auth/platform-principal.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';
import type { AcademyDetailDto, AddDomainDto, UpdateDomainDto } from './academies.dto.js';
import { REGISTRY_AUDIT_ACTIONS, REGISTRY_ENTITY_TYPES, isUniqueViolation, loadAcademyDetail, lockAcademy } from './academies.read.js';
import type { LockedAcademy } from './academies.read.js';
import { isReadOnly } from './academy-status.js';
import { registryError } from './registry.errors.js';

/** Makes the academy's current primary domain (other than `exceptId`) step down; its id, or null when there was none. */
async function demotePrimary(tx: PlatformTransaction, academyId: string, exceptId: string | null): Promise<string | null> {
  const current = await tx.domain.findFirst({
    where: { academyId, isPrimary: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (!current) return null;
  await tx.domain.update({ where: { id: current.id }, data: { isPrimary: false }, select: { id: true } });
  return current.id;
}

/** The academy, locked and writable: `404 academy_not_found`, `409 academy_archived`. */
async function writableAcademy(tx: PlatformTransaction, academyId: string): Promise<LockedAcademy> {
  const locked = await lockAcademy(tx, academyId);
  if (!locked) throw registryError.academyNotFound(academyId);
  if (isReadOnly(locked.status)) throw registryError.academyArchived(academyId);
  return locked;
}

@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** API-188 — `409 domain_taken` when any academy holds the hostname. */
  async add(academyId: string, input: AddDomainDto, caller: PlatformPrincipal, ctx: RequestContext): Promise<AcademyDetailDto> {
    const db = this.prisma.db;
    const isPrimary = input.isPrimary ?? false;
    try {
      await db.$transaction(async (tx) => {
        await writableAcademy(tx, academyId);
        const clash = await tx.domain.findUnique({ where: { hostname: input.hostname }, select: { id: true } });
        if (clash) throw registryError.domainTaken(input.hostname);
        const demotedDomainId = isPrimary ? await demotePrimary(tx, academyId, null) : null;
        const domain = await tx.domain.create({
          data: { academyId, hostname: input.hostname, kind: input.kind, isPrimary },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId: caller.id,
          action: REGISTRY_AUDIT_ACTIONS.domainAdded,
          entityType: REGISTRY_ENTITY_TYPES.academies,
          entityId: academyId,
          metadata: {
            domainId: domain.id,
            hostname: input.hostname,
            kind: input.kind,
            isPrimary,
            ...(demotedDomainId ? { demotedDomainId } : {}),
          },
          ctx,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw registryError.domainTaken(input.hostname);
      throw error;
    }
    return loadAcademyDetail(db, academyId);
  }

  /**
   * API-190 — promotes a domain to primary (the current one steps down);
   * `isPrimary: false` is `400 domain_demote_forbidden`; an already primary
   * domain is a 200 without a write or an event.
   */
  async update(
    academyId: string,
    domainId: string,
    input: UpdateDomainDto,
    caller: PlatformPrincipal,
    ctx: RequestContext,
  ): Promise<AcademyDetailDto> {
    if (input.isPrimary !== true) throw registryError.domainDemoteForbidden(domainId);
    const db = this.prisma.db;
    await db.$transaction(async (tx) => {
      await writableAcademy(tx, academyId);
      const domain = await tx.domain.findFirst({ where: { id: domainId, academyId }, select: { id: true, hostname: true, isPrimary: true } });
      if (!domain) throw registryError.domainNotFound(domainId);
      if (domain.isPrimary) return;
      const demotedDomainId = await demotePrimary(tx, academyId, domainId);
      await tx.domain.update({ where: { id: domainId }, data: { isPrimary: true }, select: { id: true } });
      await this.audit.record(tx, {
        actorId: caller.id,
        action: REGISTRY_AUDIT_ACTIONS.domainUpdated,
        entityType: REGISTRY_ENTITY_TYPES.academies,
        entityId: academyId,
        metadata: { domainId, hostname: domain.hostname, isPrimary: true, ...(demotedDomainId ? { demotedDomainId } : {}) },
        ctx,
      });
    });
    return loadAcademyDetail(db, academyId);
  }

  /** API-189 — removes the domain (a primary one too: the academy is then left without a primary). */
  async remove(academyId: string, domainId: string, caller: PlatformPrincipal, ctx: RequestContext): Promise<AcademyDetailDto> {
    const db = this.prisma.db;
    await db.$transaction(async (tx) => {
      await writableAcademy(tx, academyId);
      const domain = await tx.domain.findFirst({
        where: { id: domainId, academyId },
        select: { id: true, hostname: true, kind: true, isPrimary: true },
      });
      if (!domain) throw registryError.domainNotFound(domainId);
      await tx.domain.delete({ where: { id: domainId }, select: { id: true } });
      await this.audit.record(tx, {
        actorId: caller.id,
        action: REGISTRY_AUDIT_ACTIONS.domainRemoved,
        entityType: REGISTRY_ENTITY_TYPES.academies,
        entityId: academyId,
        metadata: { domainId, hostname: domain.hostname, kind: domain.kind, isPrimary: domain.isPrimary },
        ctx,
      });
    });
    return loadAcademyDetail(db, academyId);
  }
}
