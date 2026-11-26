// Pure rules of «طلابي» (CH-0370): which enrollments a filter means, and the
// attendance rate — the same formula as the reports (MOD-13, D-R72):
// (present + late) ÷ (present + late + absent); excused is left out.
import type { EnrollmentStatus } from '../generated/prisma/client.js';

export const TEACHING_STUDENT_FILTERS = ['active', 'completed', 'withdrawn', 'all'] as const;
export type TeachingStudentFilter = (typeof TEACHING_STUDENT_FILTERS)[number];

/** A teacher's list never shows pending requests or cancelled enrollments. */
export const SHOWN_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed', 'withdrawn'];

/** The most students one list answers (a teacher's own students are far fewer). */
export const TEACHING_STUDENTS_CAP = 1000;

export function enrollmentStatusesOf(filter: TeachingStudentFilter | undefined): EnrollmentStatus[] {
  if (filter === undefined) return ['active'];
  if (filter === 'all') return [...SHOWN_ENROLLMENT_STATUSES];
  return [filter];
}

export interface AttendanceTally {
  present: number;
  late: number;
  absent: number;
  excused: number;
}

export function emptyTally(): AttendanceTally {
  return { present: 0, late: 0, absent: 0, excused: 0 };
}

/** Whole percent, or null before any present, late or absent record. */
export function attendanceRate(tally: AttendanceTally): number | null {
  const counted = tally.present + tally.late + tally.absent;
  return counted === 0 ? null : Math.round((100 * (tally.present + tally.late)) / counted);
}
