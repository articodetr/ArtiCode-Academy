// TEST-178 — MOD-12-T05 (announcements): the pure audience rules (owner
// decision D-R85) — every `audience_invalid` problem, the normalised form an
// audience is stored and audited in, who of the group members becomes a
// recipient (each once, never the sender), the 5,000 limit and who reads
// which announcement. No database.
import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_ROLE_KEYS,
  AUDIENCE_PROBLEMS,
  academyAudienceMissing,
  announcementData,
  checkAudience,
  exceedsRecipientLimit,
  mergeRecipients,
  readAudience,
  visibleAnnouncementsWhere,
} from './announcements.audience.js';
import type { AudienceInput, AudienceProblem } from './announcements.audience.js';
import { ANNOUNCEMENT_MAX_RECIPIENTS } from './notifications.errors.js';

const CLASS_ID = '019a0000-0000-7000-8000-00000000c1a5';
const problemsOf = (input: AudienceInput) => checkAudience(input).problems;

describe('the audience of an announcement (D-R85, TEST-178)', () => {
  it('normalises a class audience: the id in lower case and the three groups spelled out', () => {
    expect(checkAudience({ kind: 'class', classId: CLASS_ID, students: true })).toEqual({
      audience: { kind: 'class', classId: CLASS_ID, students: true, guardians: false, teachers: false },
      problems: [],
    });
    expect(checkAudience({ kind: 'class', classId: CLASS_ID.toUpperCase(), students: false, guardians: true, teachers: true }).audience).toEqual({
      kind: 'class',
      classId: CLASS_ID,
      students: false,
      guardians: true,
      teachers: true,
    });
    // `null` is "absent", as in every DTO: a client may send the fields of the other kind empty.
    expect(checkAudience({ kind: 'class', classId: CLASS_ID, students: null, guardians: null, teachers: true, roleKeys: null }).audience).toEqual({
      kind: 'class',
      classId: CLASS_ID,
      students: false,
      guardians: false,
      teachers: true,
    });
    // Exactly the five keys — nothing of the request rides along into the stored audience.
    const { audience } = checkAudience({ kind: 'class', classId: CLASS_ID, students: true, extra: 'x' } as AudienceInput);
    expect(Object.keys(audience!)).toEqual(['kind', 'classId', 'students', 'guardians', 'teachers']);
  });

  it('normalises an academy audience: the role keys in the fixed order, whatever order they came in', () => {
    expect(checkAudience({ kind: 'academy', roleKeys: ['staff', 'student'] })).toEqual({ audience: { kind: 'academy', roleKeys: ['student', 'staff'] }, problems: [] });
    expect(checkAudience({ kind: 'academy', roleKeys: ['teacher', 'staff', 'guardian', 'student'] }).audience).toEqual({ kind: 'academy', roleKeys: [...ANNOUNCEMENT_ROLE_KEYS] });
    expect(checkAudience({ kind: 'academy', roleKeys: ['guardian'], classId: null, students: null, guardians: null, teachers: null }).audience).toEqual({ kind: 'academy', roleKeys: ['guardian'] });
    for (const key of ANNOUNCEMENT_ROLE_KEYS) expect(checkAudience({ kind: 'academy', roleKeys: [key] }).audience).toEqual({ kind: 'academy', roleKeys: [key] });
  });

  it('refuses an unknown kind — and names nothing else, there being no shape to judge the fields against', () => {
    for (const kind of ['everyone', 'Class', 'ACADEMY', ' class', '', undefined, null, 7, true, ['class'], { kind: 'class' }]) {
      expect(checkAudience({ kind, classId: CLASS_ID, students: true, roleKeys: ['student'] }), String(kind)).toEqual({ audience: null, problems: ['kind_unknown'] });
    }
    expect(problemsOf({})).toEqual(['kind_unknown']);
  });

  it('refuses a class audience without a class, without a group, or with role keys', () => {
    expect(problemsOf({ kind: 'class', students: true })).toEqual(['class_id_required']);
    expect(problemsOf({ kind: 'class', classId: '', students: true })).toEqual(['class_id_required']);
    expect(problemsOf({ kind: 'class', classId: null, students: true })).toEqual(['class_id_required']);
    // No group: none given, all false — and only a JSON `true` switches a group on.
    expect(problemsOf({ kind: 'class', classId: CLASS_ID })).toEqual(['recipient_group_required']);
    expect(problemsOf({ kind: 'class', classId: CLASS_ID, students: false, guardians: false, teachers: false })).toEqual(['recipient_group_required']);
    expect(problemsOf({ kind: 'class', classId: CLASS_ID, students: 'true', guardians: 1, teachers: 'yes' })).toEqual(['recipient_group_required']);
    // Role keys belong to the other kind — even an empty list, even valid keys.
    expect(problemsOf({ kind: 'class', classId: CLASS_ID, students: true, roleKeys: ['student'] })).toEqual(['role_keys_not_allowed']);
    expect(problemsOf({ kind: 'class', classId: CLASS_ID, teachers: true, roleKeys: [] })).toEqual(['role_keys_not_allowed']);
    // Every problem at once, in a fixed order.
    expect(problemsOf({ kind: 'class', roleKeys: ['staff'] })).toEqual(['class_id_required', 'recipient_group_required', 'role_keys_not_allowed']);
  });

  it('refuses an academy audience with a class or a group, without a role key, with an unknown key or with the same key twice', () => {
    expect(problemsOf({ kind: 'academy', roleKeys: ['student'], classId: CLASS_ID })).toEqual(['class_fields_not_allowed']);
    // A group counts as carried even when it says `false`.
    for (const field of ['students', 'guardians', 'teachers'] as const) {
      expect(problemsOf({ kind: 'academy', roleKeys: ['student'], [field]: true }), field).toEqual(['class_fields_not_allowed']);
      expect(problemsOf({ kind: 'academy', roleKeys: ['student'], [field]: false }), field).toEqual(['class_fields_not_allowed']);
    }
    expect(problemsOf({ kind: 'academy' })).toEqual(['role_keys_required']);
    expect(problemsOf({ kind: 'academy', roleKeys: [] })).toEqual(['role_keys_required']);
    expect(problemsOf({ kind: 'academy', roleKeys: null })).toEqual(['role_keys_required']);
    expect(problemsOf({ kind: 'academy', roleKeys: 'student' })).toEqual(['role_keys_required']);
    // Only the four learner and employee roles: not the admin, not a custom role, not another spelling.
    for (const key of ['academy_admin', 'librarian', 'Student', 'student ', '', 7, null, ['student']]) {
      expect(problemsOf({ kind: 'academy', roleKeys: ['student', key] }), String(key)).toEqual(['role_keys_unknown']);
    }
    expect(problemsOf({ kind: 'academy', roleKeys: ['student', 'guardian', 'student'] })).toEqual(['role_keys_duplicate']);
    // More than four keys always repeat one or name an unknown one.
    expect(problemsOf({ kind: 'academy', roleKeys: ['student', 'guardian', 'teacher', 'staff', 'staff'] })).toEqual(['role_keys_duplicate']);
    expect(problemsOf({ kind: 'academy', roleKeys: ['x', 'x'], teachers: true })).toEqual(['class_fields_not_allowed', 'role_keys_unknown', 'role_keys_duplicate']);
  });

  it('names only problems of the documented list, and never returns an audience together with a problem', () => {
    const inputs: AudienceInput[] = [
      {},
      { kind: 'class' },
      { kind: 'class', classId: CLASS_ID, roleKeys: ['student'] },
      { kind: 'academy', classId: CLASS_ID, roleKeys: ['student', 'student', 'x'] },
      { kind: 'academy', roleKeys: ['student'] },
      { kind: 'class', classId: CLASS_ID, guardians: true },
    ];
    const seen = new Set<AudienceProblem>();
    for (const input of inputs) {
      const checked = checkAudience(input);
      expect(checked.audience === null).toBe(checked.problems.length > 0);
      for (const problem of checked.problems) {
        expect(AUDIENCE_PROBLEMS).toContain(problem);
        seen.add(problem);
      }
    }
    // Together with the cases above, each of the eight problems is produced by some request.
    expect([...seen].sort()).toEqual(['class_fields_not_allowed', 'class_id_required', 'kind_unknown', 'recipient_group_required', 'role_keys_duplicate', 'role_keys_not_allowed', 'role_keys_unknown'].sort());
    expect(problemsOf({ kind: 'academy' })).toEqual(['role_keys_required']);
    expect(AUDIENCE_PROBLEMS).toHaveLength(8);
  });

  it('reads a stored audience back in the same form, and nothing from a value it never wrote', () => {
    const klass = { kind: 'class', classId: CLASS_ID, students: true, guardians: true, teachers: false };
    const academy = { kind: 'academy', roleKeys: ['student', 'guardian'] };
    expect(readAudience(klass)).toEqual(klass);
    expect(readAudience(academy)).toEqual(academy);
    // A round trip through JSON, as the database does.
    expect(readAudience(JSON.parse(JSON.stringify(checkAudience({ kind: 'class', classId: CLASS_ID, teachers: true }).audience)))).toEqual({ kind: 'class', classId: CLASS_ID, students: false, guardians: false, teachers: true });
    for (const value of [null, undefined, 'class', 7, [], [klass], {}, { kind: 'everyone' }, { kind: 'class' }, { kind: 'academy', roleKeys: [] }]) expect(readAudience(value)).toBeNull();
  });
});

describe('the recipients of an announcement (D-R85, TEST-178)', () => {
  const member = (id: string, group = '') => ({ id, group });

  it('counts each person once, in the order of their first appearance', () => {
    const students = [member('ahmad', 'students'), member('sara', 'students'), member('lina', 'students')];
    // `lina` is a classmate and the guardian of `ahmad`; `father` has two children in the class and appears once per query anyway.
    const guardians = [member('father', 'guardians'), member('lina', 'guardians')];
    const teachers = [member('teacher', 'teachers'), member('father', 'teachers')];
    const merged = mergeRecipients([students, guardians, teachers], 'somebody-else');
    expect(merged.map((recipient) => recipient.id)).toEqual(['ahmad', 'sara', 'lina', 'father', 'teacher']);
    // The first appearance wins: the very object of that group is kept.
    expect(merged.find((recipient) => recipient.id === 'lina')).toBe(students[2]);
    expect(merged.find((recipient) => recipient.id === 'father')).toBe(guardians[0]);
    // A repeat inside one group counts once too.
    expect(mergeRecipients([[member('a'), member('a'), member('b')]], 'x').map((recipient) => recipient.id)).toEqual(['a', 'b']);
  });

  it('never includes the sender, whatever group they belong to — which may leave nobody', () => {
    const students = [member('ahmad'), member('teacher')];
    const teachers = [member('teacher'), member('assistant')];
    expect(mergeRecipients([students, teachers], 'teacher').map((recipient) => recipient.id)).toEqual(['ahmad', 'assistant']);
    expect(mergeRecipients([[member('teacher')], [member('teacher')]], 'teacher')).toEqual([]);
    expect(mergeRecipients([], 'teacher')).toEqual([]);
    expect(mergeRecipients([[], []], 'teacher')).toEqual([]);
  });

  it('allows 5,000 recipients and refuses the 5,001st', () => {
    expect(ANNOUNCEMENT_MAX_RECIPIENTS).toBe(5000);
    expect([0, 1, 4999, 5000].map((count) => exceedsRecipientLimit(count))).toEqual([false, false, false, false]);
    expect([5001, 50_000].map((count) => exceedsRecipientLimit(count))).toEqual([true, true]);
    expect(exceedsRecipientLimit(3, 2)).toBe(true);
    expect(exceedsRecipientLimit(2, 2)).toBe(false);
  });

  it('gives a notification the notifications page and ids only', () => {
    expect(announcementData('announcement-id', 'class-id')).toEqual({ link: '/notifications', announcementId: 'announcement-id', classId: 'class-id' });
    // An academy announcement has no class.
    expect(announcementData('announcement-id', null)).toEqual({ link: '/notifications', announcementId: 'announcement-id' });
  });
});

describe('who may announce to the academy and who reads which announcement (D-R85, TEST-178)', () => {
  it('asks for `classes.manage` on top of `notifications.send` for an academy audience', () => {
    expect(academyAudienceMissing(['notifications.send'])).toEqual(['classes.manage']);
    expect(academyAudienceMissing(['notifications.send', 'classes.read'])).toEqual(['classes.manage']);
    expect(academyAudienceMissing([])).toEqual(['classes.manage']);
    expect(academyAudienceMissing(['notifications.send', 'classes.manage'])).toBeNull();
  });

  it('shows a sender their own announcements and a holder of `classes.manage` all of them', () => {
    expect(visibleAnnouncementsWhere({ id: 'teacher', permissions: ['notifications.send', 'classes.read'] })).toEqual({ senderUserId: 'teacher' });
    expect(visibleAnnouncementsWhere({ id: 'teacher', permissions: [] })).toEqual({ senderUserId: 'teacher' });
    expect(visibleAnnouncementsWhere({ id: 'manager', permissions: ['notifications.send', 'classes.manage'] })).toEqual({});
  });
});
