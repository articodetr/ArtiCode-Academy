// Lifecycle of an academy in the platform registry (MOD-18-T04, API-187) as
// pure functions, unit-tested in academy-status.spec.ts:
//
//   activate  provisioning | suspended → active     (needs an origin — `422 origin_required`)
//   suspend   active → suspended
//   archive   provisioning | active | suspended → archived   (sets archived_at)
//   restore   archived → suspended                            (clears archived_at; activate explicitly)
//
// An archived academy is read-only: no PATCH, no domain or subscription write
// (`409 academy_archived`) until it is restored. The CHECK
// `ck_academies_archived_at` keeps `archived_at` set exactly while archived.
import type { AcademyStatus } from '../../generated/platform/client.js';

export const ACADEMY_STATUS_ACTIONS = ['activate', 'suspend', 'archive', 'restore'] as const;
export type AcademyStatusAction = (typeof ACADEMY_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<AcademyStatusAction, Partial<Readonly<Record<AcademyStatus, AcademyStatus>>>>> = {
  activate: { provisioning: 'active', suspended: 'active' },
  suspend: { active: 'suspended' },
  archive: { provisioning: 'archived', active: 'archived', suspended: 'archived' },
  restore: { archived: 'suspended' },
};

/** The status `action` leads to from `from`, or null when the move is not allowed. */
export function nextAcademyStatus(action: AcademyStatusAction, from: AcademyStatus): AcademyStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedAcademyActions(from: AcademyStatus): AcademyStatusAction[] {
  return ACADEMY_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** `activate` needs an origin: the fleet probe asks `<origin>/api/health/ready` of every active academy. */
export function actionNeedsOrigin(action: AcademyStatusAction): boolean {
  return action === 'activate';
}

/** Archived academies refuse every write but a status action (`restore`). */
export function isReadOnly(status: AcademyStatus): boolean {
  return status === 'archived';
}

/** `archived_at` after the move: set when the academy becomes archived, cleared when it leaves that state. */
export function archivedAtAfter(to: AcademyStatus, current: Date | null, now: Date): Date | null {
  if (to === 'archived') return current ?? now;
  return null;
}
