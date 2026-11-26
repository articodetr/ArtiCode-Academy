// A course code the server generates when POST /api/courses comes without one
// (the simplified create form sends none): `CRS-` + a running number from the
// shared `number_sequences` counter (key `course`, no period), zero-padded to
// five digits and longer once it grows. A code typed by hand earlier may hold
// the next number, so the generator keeps taking numbers until one is free.
// No framework imports: the service passes the counter and the lookup in.
import { COURSE_CODE_PATTERN } from './courses.validation.js';

/** The `number_sequences` key of generated course codes. */
export const COURSE_CODE_SEQUENCE_KEY = 'course';
/** Course codes never restart with the year: the counter has one row, period `''`. */
export const COURSE_CODE_SEQUENCE_PERIOD = '';
export const COURSE_CODE_PREFIX = 'CRS';
const COURSE_CODE_DIGITS = 5;

/** `CRS-00001` … `CRS-99999`, then `CRS-100000`; always matches COURSE_CODE_PATTERN. */
export function formatCourseCode(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`course code number must be a positive integer, got ${value}`);
  return `${COURSE_CODE_PREFIX}-${String(value).padStart(COURSE_CODE_DIGITS, '0')}`;
}

/**
 * Takes numbers from `reserve` until `isTaken` says the code is free. Both run
 * inside the caller's transaction: the counter row stays locked until the
 * commit, so two generated codes never meet, and a skipped number is used up.
 */
export async function generateCourseCode(reserve: () => Promise<number>, isTaken: (code: string) => Promise<boolean>): Promise<string> {
  for (;;) {
    const code = formatCourseCode(await reserve());
    // The pattern allows 32 characters: a counter that ever passes it is a bug, not a code.
    if (!COURSE_CODE_PATTERN.test(code)) throw new RangeError(`generated course code ${code} does not match the code pattern`);
    if (!(await isTaken(code))) return code;
  }
}
