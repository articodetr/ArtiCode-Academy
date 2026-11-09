// Pure labels of the submissions screens (J-F41): a score against the max
// score, and the answer's link as the DTO allows it. No React, no i18next
// instance; unit-tested in submissions.format.test.ts.

/** `https://` and no whitespace — LINK_URL_PATTERN of backend/src/assignments/submissions.dto.ts (the CHECK is the backstop). */
const LINK_URL_PATTERN = /^https:\/\/\S+$/

/** `17.5 / 20` — shown inside a `dir="ltr"` element so an RTL line keeps the order. */
export function scoreText(score: number, maxScore: number): string {
  return `${score} / ${maxScore}`
}

/** True for a link the panel may open: an `https://` URL as the server accepts it (anything else is shown as no link). */
export function isHttpsLink(value: string | null | undefined): value is string {
  return typeof value === 'string' && LINK_URL_PATTERN.test(value)
}
