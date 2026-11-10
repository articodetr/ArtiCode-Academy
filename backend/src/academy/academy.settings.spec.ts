// TEST-068 (unit part) — MOD-02-T03 settings schema (D3, D-R20): the zod rules of
// the two scheduling keys, the lenient read (corrupt values read as null), the
// flattening of a PATCH and the merge that keeps unknown keys — pure functions.
import {
  applySettingsChanges,
  readSettings,
  sameSettingValue,
  SETTINGS_FIELDS,
  settingsPatchEntries,
  weekStartsOnSchema,
  workingDaysSchema,
} from './academy.settings.js';

describe('academy settings (TEST-068)', () => {
  it('knows exactly the two scheduling keys, in a fixed order', () => {
    expect(SETTINGS_FIELDS.map((entry) => entry.field)).toEqual(['settings.scheduling.weekStartsOn', 'settings.scheduling.workingDays', 'settings.certificates.serialPrefix']);
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
    expect(readSettings({})).toEqual({ scheduling: { weekStartsOn: null, workingDays: null }, certificates: { serialPrefix: null } });
    expect(readSettings({ scheduling: { weekStartsOn: 6, workingDays: [4, 0] } })).toEqual({ scheduling: { weekStartsOn: 6, workingDays: [0, 4] }, certificates: { serialPrefix: null } });
    expect(readSettings({ scheduling: { weekStartsOn: 'sat', workingDays: [] } })).toEqual({ scheduling: { weekStartsOn: null, workingDays: null }, certificates: { serialPrefix: null } });
    for (const stored of [null, 'text', 42, [], { scheduling: 'x' }, { scheduling: [1] }]) {
      expect(readSettings(stored), JSON.stringify(stored)).toEqual({ scheduling: { weekStartsOn: null, workingDays: null }, certificates: { serialPrefix: null } });
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

  it('compares values by content', () => {
    expect(sameSettingValue([0, 1], [0, 1])).toBe(true);
    expect(sameSettingValue([0, 1], [0, 2])).toBe(false);
    expect(sameSettingValue([0, 1], [0, 1, 2])).toBe(false);
    expect(sameSettingValue(6, 6)).toBe(true);
    expect(sameSettingValue(null, 0)).toBe(false);
    expect(sameSettingValue(null, null)).toBe(true);
  });
});
