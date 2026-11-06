// Pure planning of a weekly schedule replacement (MOD-07-T03), unit-tested in
// schedule.changes.spec.ts. `PUT /api/classes/:id/schedule` sends the whole
// list of slots: slots with an `id` keep their row (updated when a value
// differs), slots without one are created, rows that are not listed are
// deleted. A list identical to the stored schedule writes nothing and records
// nothing. The same file finds the conflicts inside one request (two slots of
// the request booking the same room or teacher at overlapping times — the
// EXCLUDE constraints would refuse the second row with 23P01 anyway, but a
// request-level check names the pair) and the slots outside the academy's
// working days (D-R28).
import { clockRangesOverlap, dateRangesOverlap } from './schedule.time.js';

export interface SlotValues {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** `HH:MM` local wall-clock time. */
  startTime: string;
  endTime: string;
  roomId: string | null;
  teacherUserId: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  effectiveFrom: string;
  /** `YYYY-MM-DD`, inclusive; null = open-ended. */
  effectiveTo: string | null;
}

export const SLOT_FIELDS = ['weekday', 'startTime', 'endTime', 'roomId', 'teacherUserId', 'effectiveFrom', 'effectiveTo'] as const;
export type SlotField = (typeof SLOT_FIELDS)[number];

export interface ExistingSlot extends SlotValues {
  id: string;
}

export interface RequestedSlot extends SlotValues {
  id?: string;
}

export interface SlotUpdate extends Partial<SlotValues> {
  id: string;
}

export interface ScheduleCounts {
  added: number;
  updated: number;
  removed: number;
}

export type SchedulePlan =
  | {
      ok: true;
      /** False when nothing differs (no write, no event). */
      changed: boolean;
      create: SlotValues[];
      update: SlotUpdate[];
      remove: string[];
      counts: ScheduleCounts;
    }
  | { ok: false; unknown: string[]; duplicates: string[] };

export function planScheduleReplacement(existing: readonly ExistingSlot[], requested: readonly RequestedSlot[]): SchedulePlan {
  const byId = new Map(existing.map((slot) => [slot.id, slot]));
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicates = new Set<string>();
  for (const slot of requested) {
    if (slot.id === undefined) continue;
    if (seen.has(slot.id)) duplicates.add(slot.id);
    seen.add(slot.id);
    if (!byId.has(slot.id)) unknown.push(slot.id);
  }
  if (unknown.length > 0 || duplicates.size > 0) return { ok: false, unknown: [...new Set(unknown)], duplicates: [...duplicates] };

  const create: SlotValues[] = [];
  const update: SlotUpdate[] = [];
  for (const slot of requested) {
    const values = valuesOf(slot);
    if (slot.id === undefined) {
      create.push(values);
      continue;
    }
    const current = byId.get(slot.id)!;
    const change: SlotUpdate = { id: slot.id };
    for (const field of SLOT_FIELDS) {
      if (current[field] !== values[field]) (change as unknown as Record<string, unknown>)[field] = values[field];
    }
    if (Object.keys(change).length > 1) update.push(change);
  }
  const remove = existing.filter((slot) => !seen.has(slot.id)).map((slot) => slot.id);
  const changed = create.length > 0 || update.length > 0 || remove.length > 0;
  return { ok: true, changed, create, update, remove, counts: { added: create.length, updated: update.length, removed: remove.length } };
}

export function valuesOf(slot: SlotValues): SlotValues {
  return {
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    roomId: slot.roomId,
    teacherUserId: slot.teacherUserId,
    effectiveFrom: slot.effectiveFrom,
    effectiveTo: slot.effectiveTo,
  };
}

export type ConflictKind = 'room' | 'teacher';

export interface RequestConflict {
  kind: ConflictKind;
  /** Indexes in the request of the two slots that overlap (first < second). */
  first: number;
  second: number;
}

/** Two slots overlap when they share the weekday, their times overlap (half-open) and their effective ranges overlap (inclusive). */
export function slotsOverlap(a: SlotValues, b: SlotValues): boolean {
  return (
    a.weekday === b.weekday &&
    clockRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime) &&
    dateRangesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)
  );
}

/**
 * The first pair of slots of one request that book the same room, or the same
 * teacher, at overlapping times — what the EXCLUDE constraints refuse between
 * rows (§4e.8 (1)), found before any write so the answer can name both slots.
 * Slots without a room (or teacher) never conflict on that resource.
 */
export function findRequestConflict(requested: readonly SlotValues[]): RequestConflict | null {
  for (let second = 1; second < requested.length; second += 1) {
    for (let first = 0; first < second; first += 1) {
      const a = requested[first]!;
      const b = requested[second]!;
      if (!slotsOverlap(a, b)) continue;
      if (a.roomId !== null && a.roomId === b.roomId) return { kind: 'room', first, second };
      if (a.teacherUserId !== null && a.teacherUserId === b.teacherUserId) return { kind: 'teacher', first, second };
    }
  }
  return null;
}

/** The first slot whose weekday is outside the academy's working days (D-R28); `null` working days = no restriction. */
export function findNonWorkingDay(requested: readonly SlotValues[], workingDays: readonly number[] | null): { index: number; weekday: number } | null {
  if (workingDays === null) return null;
  const allowed = new Set(workingDays);
  const index = requested.findIndex((slot) => !allowed.has(slot.weekday));
  return index === -1 ? null : { index, weekday: requested[index]!.weekday };
}

/** Ids referenced by the slots the plan writes (created, or kept with that field changed): only those are checked against the room and teacher rules. */
export function referencedIds(plan: Extract<SchedulePlan, { ok: true }>, field: 'roomId' | 'teacherUserId'): string[] {
  const ids = new Set<string>();
  for (const slot of plan.create) if (slot[field] !== null) ids.add(slot[field]!);
  for (const change of plan.update) if (change[field] !== undefined && change[field] !== null) ids.add(change[field]!);
  return [...ids];
}
