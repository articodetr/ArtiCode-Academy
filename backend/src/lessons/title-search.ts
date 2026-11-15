// The text search `q` of the three teaching lists — lessons (API-093),
// assignments (API-102) and exams (API-113): a substring of the Arabic or the
// English title (`title ->> 'ar'` / `title ->> 'en'`; `tr` is not searched),
// case-insensitive, with `%`, `_` and `\` matched literally. The condition is
// one more AND term of the list query, so the class visibility (D-R16), the
// other filters and the keyset cursor still apply to it. The «my …» lists have
// no search.
//
// Prisma 7 builds a JSON `string_contains` with `mode: 'insensitive'` as
// `LOWER(title #>> '{ar}') LIKE LOWER('%' || $1 || '%')` and passes the value
// unescaped (KI-048), so the value goes through escapeLikePattern() first: `\`
// is PostgreSQL's default LIKE escape character, so `\%`, `\_` and `\\` match
// themselves. The e2e suites of the three lists (TEST-214) hold this behaviour
// down; if a Prisma upgrade starts escaping the value itself they fail, and the
// lists move to the parameterised ILIKE id list of the courses search.
import { escapeLikePattern } from '../users/users.validation.js';

/** Upper bound of `q` after trimming (as the courses and classes searches). */
export const TITLE_QUERY_MAX_LENGTH = 100;

/** Swagger wording of `q`, shared by the three list DTOs. */
export const TITLE_QUERY_DESCRIPTION =
  'Substring of the Arabic or English title, case-insensitive; `%`, `_` and `\\` match literally. Trimmed; blank = absent; 1–100 characters';

const SEARCHED_LOCALES = ['ar', 'en'] as const;

/** The where term of `q` (already trimmed and non-empty), for a model whose `title` is a localized jsonb. */
export function titleSearchWhere(q: string) {
  const pattern = escapeLikePattern(q);
  return {
    OR: SEARCHED_LOCALES.map((locale) => ({ title: { path: [locale], string_contains: pattern, mode: 'insensitive' as const } })),
  };
}
