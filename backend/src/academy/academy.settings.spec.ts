// TEST-068 (unit part) — MOD-02-T03 settings schema (D3, D-R20): the zod rules of
// the two scheduling keys, the lenient read (corrupt values read as null), the
// flattening of a PATCH and the merge that keeps unknown keys — pure functions.
// TEST-248 (unit part) — MOD-20 adds `learning.videoCompletionPercent` (D-R134)
// and `catalog.publicBrowsing` (D-R138).
// TEST-320 (unit part) — PORTAL-03 adds `selfRegistration.enabled`.
import {
  applySettingsChanges,
  hasStoredKey,
  isSelfRegistrationOpen,
  publicBrowsingSchema,
  readSettings,
  sameSettingValue,
  selfRegistrationEnabledSchema,
  SETTINGS_FIELDS,
  settingsPatchEntries,
  videoCompletionPercentSchema,
  weekStartsOnSchema,
  workingDaysSchema,
} from './academy.settings.js';

/** Every known key unset. */
const EMPTY = {
  scheduling: { weekStartsOn: null, workingDays: null },
  certificates: { serialPrefix: null },
  learning: { videoCompletionPercent: null },
  catalog: { publicBrowsing: null },
  selfRegistration: { enabled: null },
};

describe('academy settings (TEST-068)', () => {
  it('knows exactly the six keys, in a fixed order', () => {
    expect(SETTINGS_FIELDS.map((entry) => entry.field)).toEqual([
      'settings.scheduling.weekStartsOn',
      'settings.scheduling.workingDays',
      'settings.certificates.serialPrefix',
      'settings.learning.videoCompletionPercent',
      'settings.catalog.publicBrowsing',
      'settings.selfRegistration.enabled',
    ]);
  });

  it('accepts a weekday 0–6 as the first day of the week and nothing else', () => {
    for (const day of [0, 3, 6]) expect(weekStartsOnSchema.safeParse(day).success, String(day)).toBe(true);
    for (const value of [-1, 7, 1.5, '6', null, true, [6]]) expect(weekStartsOnSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it('accepts 1–7 distinct weekdays as working days and sorts them', () => {
    expect(workingDaysSchema.parse([4, 0, 2])).toEqual([0, 2, 4]);
    expect(workingDaysSchema.parse([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const value of [[], [1, 1], [7], [-1], [0.5], ['1'], 'mon', null, [0, 1, 2, 3, 4, 5, 6, 0]]) {
      expect(workingDaysSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('reads every known key, null when unset or unreadable, and never throws on a corrupt column', () => {
    expect(readSettings({})).toEqual(EMPTY);
    expect(Object.keys(readSettings({}))).toEqual(['scheduling', 'certificates', 'learning', 'catalog', 'selfRegistration']);
    expect(readSettings({ scheduling: { weekStartsOn: 6, workingDays: [4, 0] } })).toEqual({ ...EMPTY, scheduling: { weekStartsOn: 6, workingDays: [0, 4] } });
    expect(readSettings({ scheduling: { weekStartsOn: 'sat', workingDays: [] } })).toEqual(EMPTY);
    for (const stored of [null, 'text', 42, [], { scheduling: 'x' }, { scheduling: [1] }, { learning: 'x', catalog: [true] }]) {
      expect(readSettings(stored), JSON.stringify(stored)).toEqual(EMPTY);
    }
  });

  it('flattens a PATCH into dotted fields in schema order, normalised, skipping absent keys', () => {
    expect(settingsPatchEntries(undefined)).toEqual([]);
    expect(settingsPatchEntries({})).toEqual([]);
    expect(settingsPatchEntries({ scheduling: { workingDays: [2, 1], weekStartsOn: null } })).toEqual([
      ['settings.scheduling.weekStartsOn', null],
      ['settings.scheduling.workingDays', [1, 2]],
    ]);
  });

  it('merges changes into a copy, keeps unknown keys, removes cleared keys and emptied domains', () => {
    const stored = { scheduling: { weekStartsOn: 6, legacy: 'kept' }, other: { a: 1 } };
    const next = applySettingsChanges(stored, [
      ['settings.scheduling.weekStartsOn', null],
      ['settings.scheduling.workingDays', [0, 1]],
    ]);
    expect(next).toEqual({ scheduling: { legacy: 'kept', workingDays: [0, 1] }, other: { a: 1 } });
    expect(stored).toEqual({ scheduling: { weekStartsOn: 6, legacy: 'kept' }, other: { a: 1 } });
    expect(applySettingsChanges({ scheduling: { weekStartsOn: 6 } }, [['settings.scheduling.weekStartsOn', null]])).toEqual({});
    expect(applySettingsChanges(null, [['settings.scheduling.weekStartsOn', 0]])).toEqual({ scheduling: { weekStartsOn: 0 } });
  });

  it('MOD-20 (TEST-248) — accepts an integer 50–100 as the video completion share and nothing else', () => {
    for (const value of [50, 75, 90, 100]) expect(videoCompletionPercentSchema.safeParse(value).success, String(value)).toBe(true);
    for (const value of [49, 101, 0, -1, 90.5, '90', null, true, [90]]) expect(videoCompletionPercentSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it('MOD-20 (TEST-248) — accepts a JSON boolean as the public browsing switch and nothing else', () => {
    for (const value of [true, false]) expect(publicBrowsingSchema.safeParse(value).success, String(value)).toBe(true);
    for (const value of ['true', 'false', 1, 0, null, [], {}]) expect(publicBrowsingSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it('MOD-20 (TEST-248) — reads the two learning keys leniently: false stays false, an unreadable value reads as null', () => {
    expect(readSettings({ learning: { videoCompletionPercent: 80 }, catalog: { publicBrowsing: true } })).toEqual({
      ...EMPTY,
      learning: { videoCompletionPercent: 80 },
      catalog: { publicBrowsing: true },
    });
    expect(readSettings({ catalog: { publicBrowsing: false } }).catalog.publicBrowsing).toBe(false);
    expect(readSettings({ learning: { videoCompletionPercent: 30 }, catalog: { publicBrowsing: 'yes' } })).toEqual(EMPTY);
    expect(hasStoredKey({ catalog: { publicBrowsing: 'yes' } }, 'settings.catalog.publicBrowsing')).toBe(true);
    expect(hasStoredKey({ catalog: {} }, 'settings.catalog.publicBrowsing')).toBe(false);
  });

  it('MOD-20 (TEST-248) — flattens and merges the two learning keys like the others (null clears, false is a value)', () => {
    expect(settingsPatchEntries({ catalog: { publicBrowsing: false }, learning: { videoCompletionPercent: 75 }, certificates: { serialPrefix: null } })).toEqual([
      ['settings.certificates.serialPrefix', null],
      ['settings.learning.videoCompletionPercent', 75],
      ['settings.catalog.publicBrowsing', false],
    ]);
    const stored = { scheduling: { weekStartsOn: 6 }, catalog: { publicBrowsing: true } };
    expect(
      applySettingsChanges(stored, [
        ['settings.learning.videoCompletionPercent', 75],
        ['settings.catalog.publicBrowsing', null],
      ]),
    ).toEqual({ scheduling: { weekStartsOn: 6 }, learning: { videoCompletionPercent: 75 } });
    expect(applySettingsChanges({}, [['settings.catalog.publicBrowsing', false]])).toEqual({ catalog: { publicBrowsing: false } });
  });

  it('PORTAL-03 (TEST-320) — the switch is a JSON boolean, off unless stored, cleared by null, and alone decides — no mail transport needed (direct registration)', () => {
    for (const value of [true, false]) expect(selfRegistrationEnabledSchema.safeParse(value).success, String(value)).toBe(true);
    for (const value of ['true', 1, 0, null, [], {}]) expect(selfRegistrationEnabledSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    expect(readSettings({}).selfRegistration.enabled).toBeNull();
    expect(readSettings({ selfRegistration: { enabled: 'yes' } }).selfRegistration.enabled).toBeNull();
    expect(settingsPatchEntries({ selfRegistration: { enabled: true } })).toEqual([['settings.selfRegistration.enabled', true]]);
    expect(applySettingsChanges({ selfRegistration: { enabled: true } }, [['settings.selfRegistration.enabled', null]])).toEqual({});
    const on = readSettings({ selfRegistration: { enabled: true } });
    expect(isSelfRegistrationOpen(on)).toBe(true);
    expect(isSelfRegistrationOpen(readSettings({}))).toBe(false);
    expect(isSelfRegistrationOpen(readSettings({ selfRegistration: { enabled: false } }))).toBe(false);
    expect(isSelfRegistrationOpen(readSettings({ selfRegistration: { enabled: 'true' } }))).toBe(false);
  });

  it('compares values by content', () => {
    expect(sameSettingValue([0, 1], [0, 1])).toBe(true);
    expect(sameSettingValue([0, 1], [0, 2])).toBe(false);
    expect(sameSettingValue([0, 1], [0, 1, 2])).toBe(false);
    expect(sameSettingValue(6, 6)).toBe(true);
    expect(sameSettingValue(null, 0)).toBe(false);
    expect(sameSettingValue(null, null)).toBe(true);
    expect(sameSettingValue(true, true)).toBe(true);
    expect(sameSettingValue(false, true)).toBe(false);
    expect(sameSettingValue(false, null)).toBe(false);
    expect(sameSettingValue(90, 90)).toBe(true);
  });
});
