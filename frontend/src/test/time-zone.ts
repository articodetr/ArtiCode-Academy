// Runs a synchronous check under another local time zone (J-F19 — the lesson
// form's next-day end on a night the clock changes). Node re-reads `TZ` when it
// is assigned, so `Date` and the default Intl zone follow it at once. The
// original zone is put back by its name: deleting `TZ` does not switch Node
// back. The check must stay synchronous, so no other test runs in the borrowed
// zone.

/** `process.env` without the Node types the app's tsconfig leaves out (tests run on Node). */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env

export function withTimeZone<T>(zone: string, check: () => T): T {
  const original = Intl.DateTimeFormat().resolvedOptions().timeZone
  env.TZ = zone
  try {
    return check()
  } finally {
    env.TZ = original
  }
}
