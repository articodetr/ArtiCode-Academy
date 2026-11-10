// The final-grade formula of MOD-09 (decision D17, settled as D-R43; storage
// D-R44; finalization D-R45) as pure functions, unit-tested in
// gradebook.calc.spec.ts. Decimal arithmetic (`Prisma.Decimal`, decimal.js),
// never JS floats; the percentage is rounded half up to two places.
//
//   components  the class's assignments and exams that are not drafts; only
//               those with a weight > 0 count (a null or zero weight is
//               informational). Points instead of weights = give every
//               component its maximum score as weight.
//   assignment  the score of the student's latest GRADED attempt (D-R36 —
//               `lastGradedScore` of API-108); when that attempt is late and the
//               assignment has a late penalty p: score × (1 − p/100); no graded
//               attempt = missing
//   exam        `scored` → the score; `absent` → 0; `excused` → left out of both
//               sums; no result = missing
//   percent     100 × Σ(w × effective ÷ max) ÷ Σw over the counted components;
//               `current` leaves the missing ones out, `final` counts them as 0
//               (D-R45); null when nothing counts
import { Prisma } from '../generated/prisma/client.js';
import type { AssignmentStatus, ExamStatus } from '../generated/prisma/client.js';

const D = Prisma.Decimal;
type Decimal = InstanceType<typeof Prisma.Decimal>;

export type ComponentKind = 'assignment' | 'exam';

export interface GradeComponent {
  kind: ComponentKind;
  id: string;
  /** numeric text or null (informational). */
  weight: string | null;
  /** numeric text, > 0. */
  maxScore: string;
  /** Assignments only: numeric text or null. */
  latePenaltyPercent: string | null;
  status: AssignmentStatus | ExamStatus;
}

/** What a student has for one component. */
export type CellInput =
  | { kind: 'assignment'; lastGradedScore: string | null; lastGradedLate: boolean; latestStatus: 'submitted' | 'graded' | 'returned' | null }
  | { kind: 'exam'; status: 'scored' | 'absent' | 'excused' | null; score: string | null };

export type CellStatus = 'graded' | 'awaiting_review' | 'returned' | 'scored' | 'absent' | 'excused' | 'missing';

export interface CellOutcome {
  status: CellStatus;
  /** The raw score (numeric text) or null. */
  score: string | null;
  /** The score after the late penalty, two decimals as text (display); null when missing or excused. */
  effectiveScore: string | null;
  /** The same, unrounded (exact decimal text) — what the formula uses. */
  exact: string | null;
  /** The counted attempt was late (assignments). */
  late: boolean;
  /** How the formula treats it: a value, left out (excused), or missing. */
  counts: 'value' | 'excluded' | 'missing';
}

export function isWeighted(component: Pick<GradeComponent, 'weight'>): boolean {
  return component.weight !== null && new D(component.weight).gt(0);
}

function effectiveAssignmentScore(score: string, late: boolean, latePenaltyPercent: string | null): Decimal {
  const raw = new D(score);
  if (!late || latePenaltyPercent === null) return raw;
  return raw.mul(new D(100).minus(latePenaltyPercent)).div(100);
}

/** The outcome of one cell (the student × component). */
export function cellOutcome(component: GradeComponent, cell: CellInput): CellOutcome {
  if (cell.kind === 'assignment') {
    const late = cell.lastGradedScore !== null && cell.lastGradedLate;
    const status: CellStatus = cell.latestStatus === 'submitted' ? 'awaiting_review' : cell.lastGradedScore !== null ? 'graded' : cell.latestStatus === 'returned' ? 'returned' : 'missing';
    if (cell.lastGradedScore === null) return { status, score: null, effectiveScore: null, exact: null, late: false, counts: 'missing' };
    const effective = effectiveAssignmentScore(cell.lastGradedScore, late, component.latePenaltyPercent);
    return { status, score: cell.lastGradedScore, effectiveScore: effective.toFixed(2), exact: effective.toString(), late, counts: 'value' };
  }
  if (cell.status === 'excused') return { status: 'excused', score: null, effectiveScore: null, exact: null, late: false, counts: 'excluded' };
  if (cell.status === 'absent') return { status: 'absent', score: null, effectiveScore: '0.00', exact: '0', late: false, counts: 'value' };
  if (cell.status === 'scored' && cell.score !== null) return { status: 'scored', score: cell.score, effectiveScore: new D(cell.score).toFixed(2), exact: new D(cell.score).toString(), late: false, counts: 'value' };
  return { status: 'missing', score: null, effectiveScore: null, exact: null, late: false, counts: 'missing' };
}

export type PercentMode = 'current' | 'final';

/**
 * The weighted percentage (two decimals as text) over the weighted components,
 * or null when nothing counts. `outcomes` is aligned with `components`.
 */
export function weightedPercent(components: readonly GradeComponent[], outcomes: readonly CellOutcome[], mode: PercentMode): string | null {
  let numerator = new D(0);
  let denominator = new D(0);
  components.forEach((component, index) => {
    if (!isWeighted(component)) return;
    const outcome = outcomes[index]!;
    if (outcome.counts === 'excluded') return;
    if (outcome.counts === 'missing' && mode === 'current') return;
    const weight = new D(component.weight!);
    // The unrounded effective score — never the two-decimal display text.
    const value = outcome.counts === 'missing' ? new D(0) : new D(outcome.exact!);
    numerator = numerator.plus(weight.mul(value).div(component.maxScore));
    denominator = denominator.plus(weight);
  });
  if (denominator.isZero()) return null;
  return numerator.mul(100).div(denominator).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}

export interface Readiness {
  /** Weighted assignments still open (submissions may still come). */
  openAssignments: number;
  /** Weighted (assignment × student) whose latest attempt waits for review. */
  awaitingReview: number;
  /** Weighted exams whose results are not published. */
  unpublishedExams: number;
  /** Components with a weight > 0. */
  weightedComponents: number;
}

/** What still keeps the class from being finalized (D-R45). */
export function readinessOf(components: readonly GradeComponent[], outcomesByStudent: readonly (readonly CellOutcome[])[]): Readiness {
  const readiness: Readiness = { openAssignments: 0, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 0 };
  components.forEach((component, index) => {
    if (!isWeighted(component)) return;
    readiness.weightedComponents += 1;
    if (component.kind === 'assignment' && component.status === 'open') readiness.openAssignments += 1;
    if (component.kind === 'exam' && component.status !== 'published') readiness.unpublishedExams += 1;
    if (component.kind === 'assignment') {
      for (const outcomes of outcomesByStudent) if (outcomes[index]!.status === 'awaiting_review') readiness.awaitingReview += 1;
    }
  });
  return readiness;
}

/** True when nothing blocks the finalization (the caller also needs a weighted component). */
export function isReady(readiness: Readiness): boolean {
  return readiness.openAssignments === 0 && readiness.awaitingReview === 0 && readiness.unpublishedExams === 0;
}

/** Key-sorted JSON (jsonb reorders keys), so a stored snapshot compares equal to a rebuilt one. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
