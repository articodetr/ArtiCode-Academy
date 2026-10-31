// Permission keys of MOD-02/MOD-14 as seeded in permission-catalog.ts. Reading
// the academy row needs no key (D-R09: every signed-in user sees the name,
// logo, locale, time zone and currency); writing needs `academy.settings.manage`.
// `academy.settings.read` gates the settings screen in the frontend only.
export const READ_ACADEMY_SETTINGS_PERMISSION = 'academy.settings.read';
export const MANAGE_ACADEMY_SETTINGS_PERMISSION = 'academy.settings.manage';
