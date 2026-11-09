// ICU-independent text assertions (J-F26, TEST-143). Intl output changes its space
// characters from one ICU version to the next: a range reads `29 November – 5 December`
// with ASCII spaces or with THIN SPACEs (U+2009) around the dash, a time may carry a
// NARROW NO-BREAK SPACE (U+202F) and a date a NO-BREAK SPACE (U+00A0). jest-dom's
// toHaveTextContent and Testing Library's *ByText / *ByLabelText collapse those spaces in
// the RECEIVED text only, so an expected value that keeps them — typed by hand on one
// machine, or built with the very helper the screen uses — passes on one ICU and fails on
// another. Build the expected value with the screen's own helper and pass it, or the raw
// value under test, through normalizeSpaces() so both sides compare with ASCII spaces.
// *ByRole's `name` compares the accessible name as it is, so a `name` built with the
// screen's own helper already matches on every ICU and needs nothing.

/** Every run of Unicode spaces (U+00A0, U+2009, U+202F and the rest of `\s`) as one ASCII space, trimmed. */
export function normalizeSpaces(text: string): string {
  return text.replace(/[\s   ]+/g, ' ').trim()
}
