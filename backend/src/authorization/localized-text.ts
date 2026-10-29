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
