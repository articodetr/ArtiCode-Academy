// Local mirrors of the format rules of PATCH /api/academy
// (backend/src/academy/academy.validation.ts): a value the server would reject
// never leaves the browser. The time zone list comes from the browser's own
// `Intl.supportedValuesOf('timeZone')` plus `UTC` — the same source the server
// uses, so the two agree on everything but ICU version differences.
export const CURRENCY_PATTERN = /^[A-Z]{3}$/
export const UTC_TIME_ZONE = 'UTC'
export const TIME_ZONE_MAX_LENGTH = 64

let cachedTimeZones: string[] | null = null

/** Canonical IANA zone names the browser knows plus `UTC`, sorted; resolved once. */
export function supportedTimeZones(): string[] {
  if (!cachedTimeZones) {
    const zones = new Set<string>([UTC_TIME_ZONE])
    try {
      for (const zone of Intl.supportedValuesOf('timeZone')) zones.add(zone)
    } catch {
      // An old browser without supportedValuesOf: only UTC is offered; the server still validates.
    }
    cachedTimeZones = [...zones].sort()
  }
  return cachedTimeZones
}

export function isIanaTimeZone(value: string): boolean {
  return supportedTimeZones().includes(value)
}

/** Trimmed and upper-cased, as the server normalises it before the ISO 4217 pattern. */
export function normaliseCurrency(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_PATTERN.test(value)
}

/** Absolute http(s) URL — what `IsUrl({ protocols: ['http', 'https'], require_protocol: true })` accepts. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

/** Zones whose name contains the typed text (case-insensitive), capped for the dropdown. */
export function matchTimeZones(input: string, limit = 20): string[] {
  const needle = input.trim().toLowerCase()
  const zones = supportedTimeZones()
  const matches = needle ? zones.filter((zone) => zone.toLowerCase().includes(needle)) : zones
  return matches.slice(0, limit)
}
