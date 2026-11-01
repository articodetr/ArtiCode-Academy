import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { PERMISSION_KEYS } from '../authorization/permission-catalog.js';
import { authError } from '../auth/auth.errors.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { usersError } from '../users/users.errors.js';
import { exceedingPermissions } from '../users/users.policy.js';
import { toLocalizedText } from './roles.dto.js';
import type { CreateRoleDto, PermissionCatalogDto, PermissionGroupDto, RoleDto, RoleListDto, UpdateRoleDto } from './roles.dto.js';
import { rolesError } from './roles.errors.js';
import { diffPermissions, isReservedRoleKey, rolePatchImmutability, unknownPermissionKeys } from './roles.policy.js';

export const ROLES_AUDIT_ACTIONS = {
  created: 'roles.created',
  updated: 'roles.updated',
  permissionsChanged: 'roles.permissions.changed',
  deleted: 'roles.deleted',
} as const;

// Explicit projection: the role, its grants with the catalog status of each key,
// and the number of holders.
const ROLE_SELECT = {
  id: true,
  key: true,
  label: true,
  description: true,
  isSystem: true,
  isDefaultForSignup: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permissionKey: true, permission: { select: { deprecatedAt: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

const ROLE_ORDER: Prisma.RoleOrderByWithRelationInput[] = [{ isSystem: 'desc' }, { key: 'asc' }];

/** Catalog declaration index, so GET /api/permissions keeps related keys together. */
const CATALOG_INDEX = new Map(PERMISSION_KEYS.map((key, index) => [key, index] as const));

function asLocalizedText(value: Prisma.JsonValue | null, fallback: string): LocalizedText {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['ar'] === 'string') {
    return value as LocalizedText;
  }
  return { ar: fallback };
}

function asOptionalLocalizedText(value: Prisma.JsonValue | null): LocalizedText | null {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['ar'] === 'string') {
    return value as LocalizedText;
  }
  return null;
}

/** Active keys only: what PermissionsGuard counts and what GET /api/permissions offers. */
function activeKeys(row: RoleRow): string[] {
  return row.permissions
    .filter((grant) => grant.permission.deprecatedAt === null)
    .map((grant) => grant.permissionKey)
    .sort();
}

function toRoleDto(row: RoleRow): RoleDto {
  return {
    id: row.id,
    key: row.key,
    label: asLocalizedText(row.label, row.key),
    description: asOptionalLocalizedText(row.description),
    isSystem: row.isSystem,
    isDefaultForSignup: row.isDefaultForSignup,
    userCount: row._count.users,
    permissions: activeKeys(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `description: null` clears the column; Prisma needs the JSON null sentinel for that. */
function descriptionInput(value: LocalizedText | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}


/**
 * MOD-03-T08 — roles and permissions. The global guards enforce `users.read`
 * (list) and `roles.manage` (everything else); the service applies the policy
 * (roles.policy.ts): reserved keys, immutability of system roles, the active
 * catalog, and the no-exceeding rule on every key a caller grants. Every write
 * is one transaction with exactly one audit event; metadata holds keys and
 * field names only.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleListDto> {
    const rows = await this.prisma.db.role.findMany({ orderBy: ROLE_ORDER, select: ROLE_SELECT });
    return { items: rows.map(toRoleDto) };
  }

  /** The active catalog (deprecated keys excluded) grouped by module, keys in declaration order. */
  async listPermissions(): Promise<PermissionCatalogDto> {
    const rows = await this.prisma.db.permission.findMany({
      where: { deprecatedAt: null },
      orderBy: [{ module: 'asc' }, { key: 'asc' }],
      select: { key: true, module: true, description: true },
    });
    const byModule = new Map<string, PermissionGroupDto>();
    for (const row of rows) {
      let group = byModule.get(row.module);
      if (!group) {
        group = { module: row.module, permissions: [] };
        byModule.set(row.module, group);
      }
      group.permissions.push({ key: row.key, description: asOptionalLocalizedText(row.description) });
    }
    const groups = [...byModule.values()];
    for (const group of groups) {
      group.permissions.sort(
        (a, b) =>
          (CATALOG_INDEX.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (CATALOG_INDEX.get(b.key) ?? Number.MAX_SAFE_INTEGER) ||
          a.key.localeCompare(b.key),
      );
    }
    return { groups, total: rows.length };
  }

  // ------------------------------------------------------------- create

  async create(input: CreateRoleDto, caller: AuthPrincipal, ctx: RequestContext): Promise<RoleDto> {
    if (isReservedRoleKey(input.key)) throw rolesError.keyTaken(input.key);
    const permissions = [...new Set(input.permissions)].sort();
    await this.assertGrantable(permissions, caller);

    // Friendly 409 before the transaction; the unique index remains the source
    // of truth for concurrent requests (P2002 below).
    const clash = await this.prisma.db.role.findUnique({ where: { key: input.key }, select: { id: true } });
    if (clash) throw rolesError.keyTaken(input.key);

    const label = toLocalizedText(input.label);
    const description = input.description ? toLocalizedText(input.description) : null;
    let roleId: string;
    try {
      roleId = await this.prisma.db.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            key: input.key,
            label: label as Prisma.InputJsonValue,
            description: descriptionInput(description),
            isSystem: false,
            isDefaultForSignup: false,
            permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: ROLES_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: 'roles',
            entityId: role.id,
            metadata: { key: input.key, permissions },
            ...ctx,
          },
          tx,
        );
        return role.id;
      });
    } catch (error) {
      throw translateKnownError(error, input.key, permissions);
    }
    return this.getById(roleId);
  }

  // ------------------------------------------------------------- update

  /**
   * PATCH: label/description for custom roles, `permissions` as a full
   * replacement for every role but `academy_admin`. Only what differs is
   * written; an idempotent PATCH writes nothing and records nothing. One event
   * per request: `roles.permissions.changed` when the permission set changes
   * (its metadata also names any metadata field changed alongside), otherwise
   * `roles.updated`.
   */
  async update(id: string, input: UpdateRoleDto, caller: AuthPrincipal, ctx: RequestContext): Promise<RoleDto> {
    if (input.label === undefined && input.description === undefined && input.permissions === undefined) {
      throw usersError.nothingToUpdate();
    }
    const current = await this.prisma.db.role.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!current) throw rolesError.roleNotFound(id);

    const immutability = rolePatchImmutability(current, input);
    if (immutability?.kind === 'immutable') throw rolesError.roleImmutable(immutability.key);
    if (immutability?.kind === 'fields_immutable') throw rolesError.roleImmutable(immutability.key, immutability.fields);

    const fields: string[] = [];
    const data: Prisma.RoleUpdateInput = {};
    if (input.label !== undefined) {
      const label = toLocalizedText(input.label);
      if (!sameLocalizedText(asLocalizedText(current.label, current.key), label)) {
        data.label = label as Prisma.InputJsonValue;
        fields.push('label');
      }
    }
    if (input.description !== undefined) {
      const description = input.description === null ? null : toLocalizedText(input.description);
      if (!sameLocalizedText(asOptionalLocalizedText(current.description), description)) {
        data.description = descriptionInput(description);
        fields.push('description');
      }
    }

    let diff = { added: [] as string[], removed: [] as string[] };
    if (input.permissions !== undefined) {
      diff = diffPermissions(
        current.permissions.map((grant) => grant.permissionKey),
        input.permissions,
      );
      if (diff.added.length > 0) await this.assertGrantable(diff.added, caller);
    }
    const permissionsChanged = diff.added.length > 0 || diff.removed.length > 0;
    if (fields.length === 0 && !permissionsChanged) return toRoleDto(current);

    try {
      await this.prisma.db.$transaction(async (tx) => {
        // A permission-only change still bumps updated_at so the list reflects it.
        await tx.role.update({
          where: { id },
          data: fields.length > 0 ? data : { updatedAt: new Date() },
          select: { id: true },
        });
        if (diff.removed.length > 0) {
          await tx.rolePermission.deleteMany({ where: { roleId: id, permissionKey: { in: diff.removed } } });
        }
        if (diff.added.length > 0) {
          await tx.rolePermission.createMany({ data: diff.added.map((permissionKey) => ({ roleId: id, permissionKey })) });
        }
        await this.audit.record(
          {
            action: permissionsChanged ? ROLES_AUDIT_ACTIONS.permissionsChanged : ROLES_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: 'roles',
            entityId: id,
            metadata: permissionsChanged
              ? { key: current.key, added: diff.added, removed: diff.removed, fields }
              : { key: current.key, fields },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, current.key, diff.added);
    }
    return this.getById(id);
  }

  // ------------------------------------------------------------- delete

  /** Custom roles only, and only while no user holds them (user_roles is `Restrict`). */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    const current = await this.prisma.db.role.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!current) throw rolesError.roleNotFound(id);
    if (current.isSystem) throw rolesError.roleImmutable(current.key);
    if (current._count.users > 0) throw rolesError.roleGranted(current.key, current._count.users);

    const permissions = current.permissions.map((grant) => grant.permissionKey).sort();
    try {
      await this.prisma.db.$transaction(async (tx) => {
        // Cascade removes role_permissions; a grant made meanwhile makes the
        // delete fail (P2003 → 409 role_in_use) and rolls the event back too.
        await tx.role.delete({ where: { id }, select: { id: true } });
        await this.audit.record(
          {
            action: ROLES_AUDIT_ACTIONS.deleted,
            actorUserId: caller.id,
            entityType: 'roles',
            entityId: id,
            metadata: { key: current.key, permissions },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, current.key, []);
    }
  }

  // ------------------------------------------------------------- helpers

  private async getById(id: string): Promise<RoleDto> {
    const row = await this.prisma.db.role.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!row) throw rolesError.roleNotFound(id);
    return toRoleDto(row);
  }

  /**
   * Every key must exist in the active catalog (`400 permission_unknown`) and
   * be held by the caller apart from the learner baseline (`403
   * permission_denied` with the exceeding keys) — the same rule as user
   * creation, invitations and identifier changes (ADR-030, SEC-R-16).
   */
  private async assertGrantable(keys: readonly string[], caller: AuthPrincipal): Promise<void> {
    if (keys.length === 0) return;
    const active = await this.prisma.db.permission.findMany({
      where: { key: { in: [...keys] }, deprecatedAt: null },
      select: { key: true },
    });
    const unknown = unknownPermissionKeys(keys, new Set(active.map((row) => row.key)));
    if (unknown.length > 0) throw rolesError.permissionUnknown(unknown);
    const exceeding = exceedingPermissions(keys, caller.permissions);
    if (exceeding.length > 0) throw authError.permissionDenied(exceeding);
  }
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate key (P2002),
 * a grant to a key deprecated meanwhile or a deletion that lost the race with
 * a user_roles grant (P2003 — the FK on role_permissions.permission_key or
 * user_roles.role_id). Anything else is rethrown.
 */
function translateKnownError(error: unknown, key: string, grantedKeys: readonly string[]): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002') return rolesError.keyTaken(key);
  if (error.code === 'P2003') {
    return grantedKeys.length > 0 ? rolesError.permissionUnknown(grantedKeys) : rolesError.roleGranted(key, 1);
  }
  return error;
}
