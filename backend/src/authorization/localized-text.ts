// Localized text stored in jsonb columns (D1): `ar` is the reference language
// and is required; other locales are optional. Mirrors the shape the frontend
// uses for LocalizedText. No framework imports (used by the Prisma seed).

export const LOCALES = ['ar', 'en', 'tr'] as const;
export type LocaleCode = (typeof LOCALES)[number];

export type LocalizedText = { ar: string } & Partial<Record<LocaleCode, string>>;

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Localized texts are equal when every locale matches (an absent locale equals
 * a missing one); two nulls are equal, null and a text are not. Shared by the
 * PATCH planners (academy, roles, levels, courses).
 */
export function sameLocalizedText(a: LocalizedText | null, b: LocalizedText | null): boolean {
  if (a === null || b === null) return a === b;
  return a.ar === b.ar && (a.en ?? null) === (b.en ?? null) && (a.tr ?? null) === (b.tr ?? null);
}

/**
 * Reads a jsonb column as `{ ar, en?, tr? }`: only string locales are kept;
 * anything without a string `ar` (the CHECKs make that impossible) is null.
 */
export function readLocalizedText(value: unknown): LocalizedText | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record['ar'] !== 'string') return null;
  const text: LocalizedText = { ar: record['ar'] };
  for (const locale of LOCALES) {
    const entry = record[locale];
    if (locale !== 'ar' && typeof entry === 'string') text[locale] = entry;
  }
  return text;
}

/**
 * Picks the text for `locale`, then the academy default, then `ar`, then the
 * first value present (fallback order approved in D1).
 */
export function pickLocalized(
  text: LocalizedText,
  locale: LocaleCode,
  defaultLocale: LocaleCode = 'ar',
): string {
  return (
    text[locale] ??
    text[defaultLocale] ??
    text.ar ??
    Object.values(text).find((value) => typeof value === 'string' && value.length > 0) ??
    ''
  );
}
