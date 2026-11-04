// Class actions menu of the class drawer (J-F01): a manual mirror of the
// backend state machine (backend/src/classes/classes.status.ts) — keep the two
// in sync. The server stays the boundary (409 invalid_transition).
//
//   open      planned → open
//   start     open → running
//   complete  running → completed            (active enrollments → completed)
//   cancel    planned | open | running → cancelled   (active enrollments → cancelled)
//   restore   cancelled → planned            (enrollments stay as they are)
//   delete    a planned class without any enrollment (API-055)
import { CLASS_STATUS_ACTIONS } from '../api/classes'
import type { ClassStatus, ClassStatusAction } from '../api/classes'

export type ClassMenuAction = ClassStatusAction | 'delete'

const TRANSITIONS: Readonly<Record<ClassStatusAction, Partial<Readonly<Record<ClassStatus, ClassStatus>>>>> = {
  open: { planned: 'open' },
  start: { open: 'running' },
  complete: { running: 'completed' },
  cancel: { planned: 'cancelled', open: 'cancelled', running: 'cancelled' },
  restore: { cancelled: 'planned' },
}

export function nextClassStatus(action: ClassStatusAction, from: ClassStatus): ClassStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/**
 * What the menu offers: nothing without `classes.manage`; deletion only for a
 * planned class without active enrollments. A restored class may still hold
 * cancelled enrollments the list does not count — the server refuses it then
 * (`class_not_deletable`).
 */
export function availableClassActions(status: ClassStatus, enrolledCount: number, canManage: boolean): ClassMenuAction[] {
  if (!canManage) return []
  const actions: ClassMenuAction[] = CLASS_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][status] !== undefined)
  if (status === 'planned' && enrolledCount === 0) actions.push('delete')
  return actions
}

/** Actions shown in red and confirmed as dangerous. */
export function isDangerousClassAction(action: ClassMenuAction): boolean {
  return action === 'cancel' || action === 'delete'
}

/** Actions that move the class's active enrollments in the same transaction (complete → completed, cancel → cancelled). */
export function movesEnrollments(action: ClassMenuAction): boolean {
  return action === 'complete' || action === 'cancel'
}
