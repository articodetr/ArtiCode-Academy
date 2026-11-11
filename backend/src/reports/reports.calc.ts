// Pure arithmetic shared by the MOD-13 reports (roadmap §4k.8; D-R70/D-R72).
import { Prisma } from '../generated/prisma/client.js';
import { ROW_CAP } from './reports.policy.js';

const D = Prisma.Decimal;
type DecimalLike = number | string | Prisma.Decimal;

export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
}

/** 100 × part ÷ whole, half-up to two places as in the gradebook; null when the whole is zero. */
export function percentOf(part: DecimalLike, whole: DecimalLike): number | null {
  const total = new D(whole);
  if (total.isZero()) return null;
  return new D(part).mul(100).div(total).toDecimalPlaces(2, D.ROUND_HALF_UP).toNumber();
}

/** D-R70: attended = present + late, over present + late + absent; an excused absence counts in neither. */
export function attendanceRate(counts: AttendanceCounts): number | null {
  return percentOf(counts.present + counts.late, counts.present + counts.late + counts.absent);
}

/** D-R70: absent over present + late + absent (excused left out). */
export function absenceRate(counts: AttendanceCounts): number | null {
  return percentOf(counts.absent, counts.present + counts.late + counts.absent);
}

/** D-R72: the first `cap` rows of a read of up to `cap + 1`, and whether more existed. */
export function capRows<T>(rows: readonly T[], cap: number = ROW_CAP): { rows: T[]; truncated: boolean } {
  return rows.length > cap ? { rows: rows.slice(0, cap), truncated: true } : { rows: [...rows], truncated: false };
}
