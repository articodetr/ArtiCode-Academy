// Permission keys of MOD-02/MOD-14 as the backend catalog names them. Reading
// the academy through the API needs no key (D-R09); the settings screen is
// shown to holders of either key (navigation.ts) and saving needs `manage`.
export const READ_ACADEMY_SETTINGS_PERMISSION = 'academy.settings.read'
export const MANAGE_ACADEMY_SETTINGS_PERMISSION = 'academy.settings.manage'
export const ACADEMY_SETTINGS_PERMISSIONS: readonly string[] = [READ_ACADEMY_SETTINGS_PERMISSION, MANAGE_ACADEMY_SETTINGS_PERMISSION]
