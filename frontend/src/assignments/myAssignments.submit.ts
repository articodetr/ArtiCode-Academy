// The attempt form of «my assignments» (J-F42): local mirrors of
// SubmitAssignmentDto (backend/src/assignments/submissions.dto.ts — keep them
// in sync): both fields are trimmed and a blank one is absent; the text holds
// up to 20,000 characters and the link up to 2,048, `https://` without
// whitespace; at least one of the two (`submission_invalid` otherwise — D-R35,
// no files before MOD-15). The browser counts UTF-16 units, never fewer than
// the server's characters, so a text the form accepts is never too long for
// the server. Pure; unit-tested in myAssignments.submit.test.ts.
import { SUBMIT_LINK_MAX_LENGTH, SUBMIT_LINK_PATTERN, SUBMIT_TEXT_MAX_LENGTH } from '../api/myAssignments'
import type { MySubmitInput } from '../api/myAssignments'

export interface SubmitFormValues {
  textAnswer?: string
  linkUrl?: string
}

/** The value as the server stores it: trimmed, a blank one absent (`textParam` / `nullableTextParam`). */
export function trimmedOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : undefined
}

/** The trimmed text fits `TEXT_ANSWER_MAX_LENGTH`. */
export function isTextAnswerWithinLimit(value: string | null | undefined): boolean {
  return (trimmedOrUndefined(value)?.length ?? 0) <= SUBMIT_TEXT_MAX_LENGTH
}

/** A typed link the server takes: `https://`, no whitespace, at most 2,048 characters once trimmed. */
export function isSubmitLinkValid(value: string | null | undefined): boolean {
  const link = trimmedOrUndefined(value)
  return link === undefined || (link.length <= SUBMIT_LINK_MAX_LENGTH && SUBMIT_LINK_PATTERN.test(link))
}

/** Why a typed link is refused, or null: the length message wins over the pattern for a long valid-looking link. */
export function linkProblemOf(value: string | null | undefined): 'max' | 'pattern' | null {
  const link = trimmedOrUndefined(value)
  if (link === undefined) return null
  if (link.length > SUBMIT_LINK_MAX_LENGTH) return 'max'
  return SUBMIT_LINK_PATTERN.test(link) ? null : 'pattern'
}

/** Text or link, at least one (the server's `submission_invalid` otherwise). */
export function hasAnswer(values: SubmitFormValues): boolean {
  return trimmedOrUndefined(values.textAnswer) !== undefined || trimmedOrUndefined(values.linkUrl) !== undefined
}

/** Body of API-109: only what was typed, trimmed; null when nothing was. */
export function buildSubmitInput(values: SubmitFormValues): MySubmitInput | null {
  const textAnswer = trimmedOrUndefined(values.textAnswer)
  const linkUrl = trimmedOrUndefined(values.linkUrl)
  if (textAnswer === undefined && linkUrl === undefined) return null
  const input: MySubmitInput = {}
  if (textAnswer !== undefined) input.textAnswer = textAnswer
  if (linkUrl !== undefined) input.linkUrl = linkUrl
  return input
}
