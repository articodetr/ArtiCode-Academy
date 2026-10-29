// TEST-022 — MOD-03-T04 update planning (diff against the current row,
// null clears, e-mail change drops the verification, profile mismatch,
// identifier rule) — pure functions, no database.
import type { CurrentUserRow, UserPatch } from './users.changes.js';
import { isEmptyPatch, planUserUpdate } from './users.changes.js';

function row(overrides: Partial<CurrentUserRow> = {}): CurrentUserRow {
  return {
    email: 'sara@example.test',
    username: null,
    phone: '+905550000001',
    fullName: 'Sara Ahmed',
    fullNameLatin: null,
    displayName: null,
    avatarUrl: null,
    locale: 'ar',
    emailVerifiedAt: null,
    studentProfile: null,
    employeeProfile: null,
    ...overrides,
  };
}

function ok(plan: ReturnType<typeof planUserUpdate>) {
  if (plan.kind !== 'ok') throw new Error(`expected an ok plan, got ${plan.kind}`);
  return plan;
}

describe('users update planning', () => {
  it('detects an empty body, including nested objects without fields', () => {
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ fullName: undefined })).toBe(true);
    expect(isEmptyPatch({ studentProfile: {} })).toBe(true);
    expect(isEmptyPatch({ employeeProfile: { jobTitle: undefined } })).toBe(true);
    expect(isEmptyPatch({ phone: null })).toBe(false);
    expect(isEmptyPatch({ studentProfile: { notes: null } })).toBe(false);
  });

  it('writes only the fields whose value changes, in a fixed order', () => {
    const plan = ok(
      planUserUpdate(row(), {
        email: 'sara@example.test', // unchanged
        phone: '+905550000002',
        fullName: 'Sara Ahmed', // unchanged
        displayName: 'Sara',
        locale: 'en',
      }),
    );
    expect(plan.user).toEqual({ phone: '+905550000002', displayName: 'Sara', locale: 'en' });
    expect(plan.fields).toEqual(['phone', 'displayName', 'locale']);
    expect(plan.identifierChanged).toBe(false);
    expect(plan.studentProfile).toBeNull();
    expect(plan.employeeProfile).toBeNull();
  });

  it('yields no fields for an idempotent PATCH', () => {
    const plan = ok(planUserUpdate(row({ displayName: 'Sara' }), { displayName: 'Sara', phone: '+905550000001', locale: 'ar' }));
    expect(plan.fields).toEqual([]);
    expect(plan.user).toEqual({});
  });

  it('clears optional values with null and keeps a null that is already null out of the diff', () => {
    const plan = ok(planUserUpdate(row({ displayName: 'Sara' }), { displayName: null, fullNameLatin: null, phone: null }));
    expect(plan.user).toEqual({ displayName: null, phone: null });
    expect(plan.fields).toEqual(['phone', 'displayName']);
  });

  it('drops the e-mail verification when a verified address changes or is removed', () => {
    const verified = row({ emailVerifiedAt: new Date('2026-10-01T00:00:00Z'), username: 'sara' });
    const changed = ok(planUserUpdate(verified, { email: 'new@example.test' }));
    expect(changed.user).toEqual({ email: 'new@example.test', emailVerifiedAt: null });
    expect(changed.fields).toEqual(['email', 'emailVerifiedAt']);
    expect(changed.identifierChanged).toBe(true);

    const removed = ok(planUserUpdate(verified, { email: null }));
    expect(removed.user).toEqual({ email: null, emailVerifiedAt: null });

    // Nothing to drop when the address was never verified, or does not change.
    const unverified = ok(planUserUpdate(row(), { email: 'new@example.test' }));
    expect(unverified.user).toEqual({ email: 'new@example.test' });
    expect(unverified.fields).toEqual(['email']);
    const same = ok(planUserUpdate(verified, { email: 'sara@example.test' }));
    expect(same.fields).toEqual([]);
  });

  it('flags a username change as an identifier change', () => {
    const plan = ok(planUserUpdate(row({ username: 'sara' }), { username: 'sara.ahmed' }));
    expect(plan.identifierChanged).toBe(true);
    expect(plan.user).toEqual({ username: 'sara.ahmed' });
  });

  it('refuses to leave the account without any login identifier', () => {
    expect(planUserUpdate(row(), { email: null })).toEqual({ kind: 'identifier_required' });
    expect(planUserUpdate(row({ username: 'sara' }), { email: null, username: null })).toEqual({ kind: 'identifier_required' });
    // Swapping one identifier for the other in the same request is fine.
    expect(ok(planUserUpdate(row(), { email: null, username: 'sara' })).fields).toEqual(['email', 'username']);
    expect(ok(planUserUpdate(row({ username: 'sara' }), { email: null })).user).toEqual({ email: null });
  });

  it('refuses a profile object for a profile the user does not have', () => {
    expect(planUserUpdate(row(), { studentProfile: { notes: 'x' } })).toEqual({ kind: 'profile_mismatch', profile: 'student' });
    expect(planUserUpdate(row(), { employeeProfile: { jobTitle: 'x' } })).toEqual({ kind: 'profile_mismatch', profile: 'employee' });
    const student = row({ studentProfile: { studentNumber: null, dateOfBirth: null, enrolledOn: null, notes: null } });
    expect(planUserUpdate(student, { employeeProfile: {} })).toEqual({ kind: 'profile_mismatch', profile: 'employee' });
    // The profile check comes before the identifier check.
    expect(planUserUpdate(row(), { email: null, studentProfile: {} })).toEqual({ kind: 'profile_mismatch', profile: 'student' });
  });

  it('compares dates by calendar day and converts the changed ones', () => {
    const student = row({
      studentProfile: { studentNumber: 'S-1', dateOfBirth: new Date('2012-05-01T00:00:00Z'), enrolledOn: null, notes: null },
    });
    const same = ok(planUserUpdate(student, { studentProfile: { dateOfBirth: '2012-05-01', studentNumber: 'S-1' } }));
    expect(same.fields).toEqual([]);
    expect(same.studentProfile).toBeNull();

    const changed = ok(planUserUpdate(student, { studentProfile: { dateOfBirth: '2012-05-02', enrolledOn: '2026-09-01', notes: 'n' } }));
    expect(changed.studentProfile).toEqual({
      dateOfBirth: new Date('2012-05-02T00:00:00Z'),
      enrolledOn: new Date('2026-09-01T00:00:00Z'),
      notes: 'n',
    });
    expect(changed.fields).toEqual(['studentProfile.dateOfBirth', 'studentProfile.enrolledOn', 'studentProfile.notes']);

    const cleared = ok(planUserUpdate(student, { studentProfile: { dateOfBirth: null } }));
    expect(cleared.studentProfile).toEqual({ dateOfBirth: null });
  });

  it('plans employee profile changes alongside user fields', () => {
    const teacher = row({
      email: null,
      username: 'teacher',
      employeeProfile: { employeeNumber: 'E-1', jobTitle: 'Math', specialization: null, hiredOn: new Date('2025-02-10T00:00:00Z') },
    });
    const plan = ok(planUserUpdate(teacher, { fullName: 'T. Teacher', employeeProfile: { jobTitle: 'Mathematics', hiredOn: '2025-02-10', employeeNumber: null } }));
    expect(plan.user).toEqual({ fullName: 'T. Teacher' });
    expect(plan.employeeProfile).toEqual({ employeeNumber: null, jobTitle: 'Mathematics' });
    expect(plan.fields).toEqual(['fullName', 'employeeProfile.employeeNumber', 'employeeProfile.jobTitle']);
  });

  it('never puts a value into the field list', () => {
    const patch: UserPatch = { email: 'secret@example.test', phone: '+905559999999', studentProfile: { notes: 'private' } };
    const plan = ok(planUserUpdate(row({ studentProfile: { studentNumber: null, dateOfBirth: null, enrolledOn: null, notes: null } }), patch));
    expect(plan.fields.join(' ')).not.toMatch(/secret|9999|private/);
  });
});
