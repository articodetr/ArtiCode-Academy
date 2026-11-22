// Local mirrors of the field rules of CreateQuestionDto / UpdateQuestionDto
// (backend/src/questions/questions.dto.ts) — MOD-09 phase 2, OEX-T07; the limits
// themselves are the constants of api/questionBanks.ts. The editor words every
// refusal itself; the server stays the boundary. The rules of a question as a
// whole (its options and its key, by type and status) are questions.rules.ts.
// Pure; unit-tested in questions.validation.test.ts.
import { QUESTION_POINTS_LIMIT, QUESTION_POINTS_MIN, QUESTION_TAGS_MAX, QUESTION_TAG_MAX_LENGTH } from '../api/questionBanks'
import { isTwoDecimalNumber } from '../assignments/assignments.validation'

/** `points`: a JSON number 0.01..9999.99 with at most two decimals (`IsDecimalNumber(2)` + `Min` + `Max`). */
export function isQuestionPointsValid(value: unknown): boolean {
  return isTwoDecimalNumber(value) && value >= QUESTION_POINTS_MIN && value <= QUESTION_POINTS_LIMIT
}

/** What a tag list breaks: more than ten tags (`ArrayMaxSize`), or a tag longer than 40 characters (`Length`). */
export type TagsProblem = 'tagsMax' | 'tagMax'

export function tagsProblemOf(tags: readonly string[] | undefined): TagsProblem | null {
  const list = tags ?? []
  if (list.length > QUESTION_TAGS_MAX) return 'tagsMax'
  if (list.some((tag) => tag.length > QUESTION_TAG_MAX_LENGTH)) return 'tagMax'
  return null
}
