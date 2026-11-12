// TEST-175 — MOD-12-T02: who receives a notification (D-R81) and whether its
// e-mail copy is due (D-R84). Pure, no database.
import { describe, expect, it } from 'vitest';
import { emailStatusFor, nameOf, planClassRecipients, planStudentRecipients, receives } from './notifications.recipients.js';
import type { EventStudent, GuardianLink, RecipientUser } from './notifications.recipients.js';

const VERIFIED = new Date('2026-11-01T09:00:00Z');

function person(id: string, fullName: string, displayName: string | null = null): RecipientUser {
  return { id, fullName, displayName, locale: null, email: `${id}@example.test`, emailVerifiedAt: VERIFIED };
}
function student(id: string, fullName: string, status: EventStudent['status'] = 'active'): EventStudent {
  return { ...person(id, fullName), status };
}
const link = (guardianUserId: string, studentUserId: string): GuardianLink => ({ guardianUserId, studentUserId });
const summary = (planned: ReturnType<typeof planClassRecipients>) =>
  planned.map((recipient) => ({ to: recipient.user.id, self: recipient.self, children: recipient.children.map((child) => child.name), studentId: recipient.studentId }));

describe('notification recipients (D-R81, TEST-175)', () => {
  it('a student event reaches the student and each guardian, one notification each, all about that student', () => {
    const ahmad = student('ahmad', 'Ahmad Ali', 'active');
    const planned = planStudentRecipients(ahmad, [person('father', 'Ali'), person('mother', 'Mona')]);
    expect(summary(planned)).toEqual([
      { to: 'ahmad', self: true, children: [], studentId: 'ahmad' },
      { to: 'father', self: false, children: ['Ahmad Ali'], studentId: 'ahmad' },
      { to: 'mother', self: false, children: ['Ahmad Ali'], studentId: 'ahmad' },
    ]);
  });

  it('only an active account receives its own copy; the guardians of an invited or suspended student still do', () => {
    expect(['invited', 'pending', 'active', 'suspended', 'archived'].map((status) => receives(status as EventStudent['status']))).toEqual([false, false, true, false, false]);
    for (const status of ['invited', 'pending', 'suspended', 'archived'] as const) {
      expect(summary(planStudentRecipients(student('sara', 'Sara', status), [person('mother', 'Mona')]))).toEqual([{ to: 'mother', self: false, children: ['Sara'], studentId: 'sara' }]);
      expect(planStudentRecipients(student('sara', 'Sara', status), [])).toEqual([]);
    }
    // A user is never their own guardian (the database refuses the link; the rule holds anyway).
    expect(summary(planStudentRecipients(student('sara', 'Sara'), [person('sara', 'Sara')]))).toEqual([{ to: 'sara', self: true, children: [], studentId: 'sara' }]);
  });

  it('a class event yields one notification per recipient: a guardian with two children in the class gets one naming both', () => {
    const students = [student('ahmad', 'Ahmad Ali'), student('sara', 'Sara Ali', 'active'), student('omar', 'Omar', 'invited')];
    const guardians = new Map([person('father', 'Ali'), person('aunt', 'Huda')].map((guardian) => [guardian.id, guardian]));
    const planned = planClassRecipients(students, [link('father', 'ahmad'), link('father', 'sara'), link('aunt', 'omar'), link('father', 'sara')], guardians);
    expect(summary(planned)).toEqual([
      { to: 'ahmad', self: true, children: [], studentId: 'ahmad' },
      { to: 'sara', self: true, children: [], studentId: 'sara' },
      // Several children: no single student on the row — the body and `data.studentIds` name them.
      { to: 'father', self: false, children: ['Ahmad Ali', 'Sara Ali'], studentId: null },
      // The invited student gets nothing himself; his guardian gets the copy about him.
      { to: 'aunt', self: false, children: ['Omar'], studentId: 'omar' },
    ]);
  });

  it('a class event ignores links to students outside it and guardians who are not eligible, and merges a student who is also a guardian', () => {
    const students = [student('ahmad', 'Ahmad'), student('lina', 'Lina', 'active')];
    // `lina` is a classmate and the guardian of `ahmad`; `ghost` is not among the eligible guardians; `zaid` is not in the class.
    const guardians = new Map([person('lina', 'Lina'), person('father', 'Ali')].map((guardian) => [guardian.id, guardian]));
    const planned = planClassRecipients(students, [link('lina', 'ahmad'), link('ghost', 'ahmad'), link('father', 'zaid'), link('ahmad', 'ahmad')], guardians);
    expect(summary(planned)).toEqual([
      { to: 'ahmad', self: true, children: [], studentId: 'ahmad' },
      // One notification, her own, that also names the child she is the guardian of.
      { to: 'lina', self: true, children: ['Ahmad'], studentId: 'lina' },
    ]);
    expect(planClassRecipients([], [link('father', 'ahmad')], guardians)).toEqual([]);
  });

  it('addresses and mentions a person by the display name when there is one', () => {
    expect(nameOf({ fullName: 'Ahmad Ali Hasan', displayName: null })).toBe('Ahmad Ali Hasan');
    expect(nameOf({ fullName: 'Ahmad Ali Hasan', displayName: 'Ahmad' })).toBe('Ahmad');
    const planned = planStudentRecipients({ ...student('ahmad', 'Ahmad Ali Hasan'), displayName: 'Ahmad' }, [person('father', 'Ali')]);
    expect(planned[1]!.children).toEqual([{ id: 'ahmad', name: 'Ahmad' }]);
  });
});

describe('the e-mail copy of a notification (D-R82/D-R84, TEST-175)', () => {
  const due = { email: 'a@example.test', emailVerifiedAt: VERIFIED, categoryEnabled: true, transport: 'resend' };

  it('is queued only for a confirmed address with the category on; without a transport it is skipped', () => {
    expect(emailStatusFor(due)).toBe('queued');
    expect(emailStatusFor({ ...due, transport: 'log' })).toBe('queued');
    expect(emailStatusFor({ ...due, transport: 'none' })).toBe('skipped');
    expect(emailStatusFor({ ...due, wanted: true })).toBe('queued');
  });

  it('is not due at all — `none` — without an address, a confirmation, the category switch or the sender asking for it', () => {
    expect(emailStatusFor({ ...due, email: null })).toBe('none');
    expect(emailStatusFor({ ...due, emailVerifiedAt: null })).toBe('none');
    expect(emailStatusFor({ ...due, categoryEnabled: false })).toBe('none');
    expect(emailStatusFor({ ...due, wanted: false })).toBe('none');
    // "Not due" wins over "no transport": nothing was skipped because nothing was owed.
    expect(emailStatusFor({ ...due, emailVerifiedAt: null, transport: 'none' })).toBe('none');
    expect(emailStatusFor({ ...due, categoryEnabled: false, transport: 'none' })).toBe('none');
  });
});
