// Pure presentation helpers of the audit log page (MOD-03-T15). No React.

/** Tag colours of the event families (first segment of the event name). */
const FAMILY_COLORS: Readonly<Record<string, string>> = {
  auth: 'purple',
  users: 'blue',
  roles: 'geekblue',
  guardians: 'cyan',
}

/** First segment of a dotted event name (`users.status.changed` → `users`). */
export function actionFamily(action: string): string {
  return action.split('.')[0] ?? action
}

export function familyColor(action: string): string {
  return FAMILY_COLORS[actionFamily(action)] ?? 'default'
}

/** A UUID shortened to its first block for tables (`0192f0a0…`); other identifiers are kept whole up to 12 characters. */
export function shortId(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return `${id.slice(0, 8)}…`
  return id.length > 12 ? `${id.slice(0, 12)}…` : id
}

/** Pretty-printed metadata for the expanded row; null when the event carries none. */
export function metadataText(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) return null
  if (typeof metadata === 'object' && Object.keys(metadata as object).length === 0) return null
  return JSON.stringify(metadata, null, 2)
}

/**
 * One-line summary of the metadata for the table (`action: suspend · from: active · to: suspended`),
 * scalars only, in the server's key order; null when there is nothing to show.
 */
export function metadataSummary(metadata: unknown, maxEntries = 4): string | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null
  const entries = Object.entries(metadata as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => `${key}: ${String(value)}`)
  if (entries.length === 0) return null
  const shown = entries.slice(0, maxEntries)
  return entries.length > maxEntries ? `${shown.join(' · ')} · …` : shown.join(' · ')
}
