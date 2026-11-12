// MOD-12 acceptance journey (roadmap 4j.9) — run by the owner through accept-mod12.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student, guardian? }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
//
// WF-15 "a notification from a real event": a published assignment, a graded submission, an issued invoice, a
// recorded payment and a class announcement each put ONE notification into the student's inbox — and into the inbox
// of every guardian linked to the student; then the inbox itself, the unread counter, ownership, marking as read,
// the e-mail preferences and the audit trail.
//
// The accounts already hold notifications: every check counts only what is newer than the newest notification the
// script saw at its start (ids are UUIDv7, time-ordered) and compares the unread counter with its value then.
//
// The script e-mails nobody. Without a mail transport (`emailAvailable: false`) the server marks a due e-mail copy
// `skipped`, so the announcement asks for e-mail and the script checks that nothing was queued, sent or failed. With
// a transport the announcement goes out without e-mail, the e-mail switches of the journey's categories are turned
// off for the signed-in recipients who confirmed an address and put back in step 12 (or at the end of a run that
// stopped early) — and the journey refuses to start, before any write, when another guardian of the student has a
// confirmed address: the script cannot reach that guardian's switches.
//
// Evidence rows: a class coded `ACC-MOD12-yyMMddHHmm` (and a course `ACC-MOD12-CRS-…` only when no course is
// published) with the lead teacher and the student's enrollment, one graded assignment, one issued invoice with one
// payment (their numbers stay taken), one announcement, the notifications of the student and of the linked guardians,
// and the audit events. Side effects on the accounts: EVERY notification of the student ends up read (step 11 uses
// "mark all as read"), the student's e-mail switches are as they were (a `notification_preferences` row may exist
// where none did — it says "on", which is what a missing row means), and a GUARDIAN account that was not linked to
// the student yet is linked (relationship `other`); the link stays.
class Stop extends Error {}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const input = JSON.parse(raw);
const baseUrl = (input.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const INBOX = '/api/me/notifications';
const PREFERENCES = '/api/me/notification-preferences';
const CATEGORIES = ['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'];
/** The categories of the journey's automatic events: their e-mail is switched off for the journey when a mail transport is configured. */
const QUIET_CATEGORIES = ['assignments', 'finance'];
/** The switch step 12 flips and puts back; the journey raises no event in this category. */
const SWITCH_CATEGORY = 'lessons';
/** The journey's five notifications as an inbox lists them: newest first. */
const EXPECTED_KEYS = ['announcement', 'payment.recorded', 'invoice.issued', 'submission.graded', 'assignment.published'];
const CLASS_NAME = { ar: 'فصل قبول MOD-12', en: 'MOD-12 acceptance class' };
const ASSIGNMENT_TITLE = { ar: 'واجب قبول MOD-12', en: 'MOD-12 acceptance assignment' };
/** What the teacher and the office type for themselves — none of it may reach a notification. */
const FEEDBACK = 'ACC-MOD12 teacher feedback';
const OFFICE_NOTE = 'ACC-MOD12 internal office note';
const SCORE = 17.5;
const MAX_SCORE = 20;
const INVOICE_TOTAL = 450;
const PAYMENT_AMOUNT = 150;

const results = [];
/** The server's reason for a refusal: the stable `code` and the validation message(s), for FAIL lines. */
const why = (r) => [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
/** `HTTP <status>` plus the server's reason when the status is not the expected one. */
const got = (r, expected) => `${r.status}${r.status === expected ? '' : ` (${why(r)})`}`;
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}
/** A step passes when every named check holds; its FAIL line names the checks that do not. */
function verdict(step, checks, evidence) {
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  record(step, failed.length === 0, failed.length === 0 ? evidence : `${evidence} — NOT as expected: ${failed.join('; ')}`);
  return failed.length === 0;
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD12 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function login(label, account) {
  const r = await call('POST', '/api/auth/login', null, { identifier: account.identifier, password: account.password });
  if (r.status !== 200 || !r.body?.accessToken) {
    record(`login ${label}`, false, `HTTP ${r.status} ${r.body?.code ?? ''} — stopping (an account locks after 5 failed attempts in 15 minutes)`);
    throw new Stop();
  }
  return r.body.accessToken;
}

/** The account as the admin's user list shows it (id, names, roles), found by its e-mail or username. */
async function userOf(adminToken, account, label) {
  const r = await call('GET', `/api/users?q=${encodeURIComponent(account.identifier)}&limit=20`, adminToken);
  const hit = (r.body?.items ?? []).find((u) => u.email === account.identifier.toLowerCase() || u.username === account.identifier.toLowerCase());
  if (!hit) {
    record(`resolve ${label}`, false, `account not found through GET /api/users?q= (HTTP ${r.status})`);
    throw new Stop();
  }
  return hit;
}

/** True for a notification written after the mark; a null mark means the inbox was empty at the start. */
const newer = (mark) => (item) => mark === null || item.id > mark;

/** The caller's notifications newer than the mark, newest first — pages of 100 until the mark is reached. */
async function newerThan(token, mark) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < 50; page += 1) {
    const r = await call('GET', `${INBOX}?limit=100${cursor}`, token);
    if (r.status !== 200 || !Array.isArray(r.body?.items)) return { status: r.status, items };
    const fresh = r.body.items.filter(newer(mark));
    items.push(...fresh);
    if (fresh.length < r.body.items.length || !r.body.nextCursor) break;
    cursor = `&cursor=${r.body.nextCursor}`;
  }
  return { status: 200, items };
}

const unreadOf = async (token) => (await call('GET', `${INBOX}/unread-count`, token)).body?.unread;
const keysOf = (items) => items.map((item) => item.eventKey).join(', ') || 'none';
const idsOf = (items) => items.map((item) => item.id).join(',');
/** One of the texts of a stored `{ ar, en }` name — a notification is worded in its reader's language. */
const namesIn = (text, localized) => Object.values(localized).some((name) => String(text).includes(name));
/** The six e-mail switches of a preferences answer as { category: boolean }. */
const switchesOf = (prefs) => Object.fromEntries((prefs?.categories ?? []).map((entry) => [entry.category, entry.emailEnabled]));
const sameSwitches = (a, b) => CATEGORIES.every((category) => typeof a[category] === 'boolean' && a[category] === b[category]);
const showSwitches = (switches) => CATEGORIES.map((category) => `${category}=${switches[category] === true ? 'on' : switches[category] === false ? 'off' : '?'}`).join(' ');
/** A linked guardian the engine notifies: the `guardian` role and an active account (a soft-deleted one is not listed at all). */
const receives = (link) => link.user?.status === 'active' && (link.user?.roles ?? []).includes('guardian');
/** A class audience of students and guardians as the server normalises it. */
const isClassAudience = (audience, classId) =>
  audience?.kind === 'class' && audience.classId === classId && audience.students === true && audience.guardians === true && audience.teachers === false && Object.keys(audience).length === 5;

/** E-mail switches the script turned off for the journey and has not put back yet: [{ who, token, categories }]. */
const silenced = [];

// Dev-only tooling: the journey writes rows (a class, an assignment, an invoice, an announcement, notifications) and
// signs in with real passwords, so it only ever targets a loopback server unless the launcher passes allowRemote
// (an explicit owner decision).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const targetHost = new URL(baseUrl).hostname;
if (!LOOPBACK_HOSTS.has(targetHost) && input.allowRemote !== true) {
  console.log(`FAIL  target: ${baseUrl} is not a local server — this script runs against the development API only (pass -AllowRemote to the launcher to override on purpose)`);
  process.exitCode = 2;
} else {
try {
  let ready;
  try {
    ready = await call('GET', '/api/health/ready', null);
  } catch (error) {
    record('readiness', false, `cannot reach ${baseUrl} (${error?.cause?.code ?? error?.message ?? 'network error'}) — start the API first: in backend/ run "npm run start:dev", wait until it listens on :3000, then run this script again`);
    throw new Stop();
  }
  if (ready.status !== 200) {
    record('readiness', false, `GET /api/health/ready -> HTTP ${ready.status}`);
    throw new Stop();
  }
  record('readiness', true, `GET /api/health/ready -> 200 (${baseUrl})`);

  const tokens = {
    admin: await login('ADMIN', input.admin),
    teacher: await login('TEACHER', input.teacher),
    student: await login('STUDENT', input.student),
    guardian: input.guardian ? await login('GUARDIAN', input.guardian) : null,
  };
  const teacher = await userOf(tokens.admin, input.teacher, 'TEACHER');
  const student = await userOf(tokens.admin, input.student, 'STUDENT');
  const guardian = input.guardian ? await userOf(tokens.admin, input.guardian, 'GUARDIAN') : null;
  record('logins', true, `${tokens.guardian ? 'four' : 'three'} accounts signed in${tokens.guardian ? '' : ' (guardian skipped)'}; user ids resolved`);

  // 0. E-mail: the script must never cause a real e-mail. Reads only — a refusal here leaves nothing behind.
  const studentPrefs = await call('GET', PREFERENCES, tokens.student);
  const linksBefore = await call('GET', `/api/users/${student.id}/guardians`, tokens.admin);
  if (studentPrefs.status !== 200 || typeof studentPrefs.body?.emailAvailable !== 'boolean' || linksBefore.status !== 200 || !Array.isArray(linksBefore.body?.items)) {
    record('0 e-mail safety', false, `GET ${PREFERENCES} ${got(studentPrefs, 200)}; GET /api/users/:studentId/guardians ${got(linksBefore, 200)}`);
    throw new Stop();
  }
  const emailAvailable = studentPrefs.body.emailAvailable;
  // Guardians of the student the script holds no token of: with a transport, their copies would be e-mailed to a confirmed address.
  const strangers = linksBefore.body.items.filter((link) => receives(link) && link.user.id !== guardian?.id && link.user.emailVerifiedAt);
  if (emailAvailable && strangers.length > 0) {
    record(
      '0 e-mail safety',
      false,
      `a mail transport is configured and ${strangers.length} other guardian(s) of the student confirmed an e-mail address: the journey's notifications would be e-mailed to them and the script cannot switch their e-mail off — restart the API with MAIL_TRANSPORT=none in backend/.env (or give that guardian as the GUARDIAN account) and run this script again; nothing was written`,
    );
    throw new Stop();
  }
  record(
    '0 e-mail safety',
    true,
    emailAvailable
      ? `a mail transport is configured (emailAvailable=true) — the script e-mails nobody: the announcement goes out without e-mail, and the e-mail of "${QUIET_CATEGORIES.join('" and "')}" is switched off during the journey for the signed-in recipients who confirmed an address (put back in step 12)`
      : 'no mail transport (emailAvailable=false): an e-mail copy that is due is "skipped" by the server — nothing can be sent',
  );

  // yyMMddHHmm — the evidence suffix of the class (and of the course when one has to be created).
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');

  // 1. The admin prepares the journey. First the guardian's link, when a guardian account is given (a refusal there leaves no class behind);
  //    then a published course (the first one, or a new acceptance course), the class, the lead teacher, open, the enrollment.
  let linkNote = 'no guardian account given';
  if (guardian) {
    if (linksBefore.body.items.some((link) => link.user?.id === guardian.id)) {
      linkNote = 'the guardian was already linked to the student';
    } else {
      const link = await call('POST', `/api/users/${student.id}/guardians`, tokens.admin, { guardianId: guardian.id, relationship: 'other' });
      if (link.status !== 201 && link.body?.code !== 'already_linked') {
        record('1 preparation', false, `POST /api/users/:studentId/guardians -> HTTP ${link.status} ${why(link)} — the GUARDIAN account must hold the guardian role and the STUDENT account the student role; nothing else was written`);
        throw new Stop();
      }
      linkNote = `guardian linked to the student ${got(link, 201)}`;
    }
  }
  const links = await call('GET', `/api/users/${student.id}/guardians`, tokens.admin);
  const linkedGuardians = (links.body?.items ?? []).filter(receives);
  if (links.status !== 200 || (guardian && !linkedGuardians.some((link) => link.user.id === guardian.id))) {
    record(
      '1 preparation',
      false,
      links.status !== 200
        ? `GET /api/users/:studentId/guardians -> HTTP ${links.status} ${why(links)}`
        : `${linkNote}, but the GUARDIAN account receives no notification: it must hold the guardian role and be active — no class was created`,
    );
    throw new Stop();
  }
  // Whom a class announcement to students and guardians must reach: the student and every linked guardian who receives — never its sender.
  const announcementRecipients = new Set([student.id, ...linkedGuardians.map((link) => link.user.id)]);
  announcementRecipients.delete(teacher.id);

  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD12-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-12', en: 'MOD-12 acceptance course' } });
    const coursePublished = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (coursePublished.status !== 200) {
      record('1 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${coursePublished.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  let classCode = `ACC-MOD12-${stampCode}`;
  let klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: CLASS_NAME, capacity: 5 });
  // A second run within the same minute: the first one took the code.
  for (let attempt = 2; klass.status === 409 && klass.body?.code === 'class_code_taken' && attempt <= 9; attempt += 1) {
    classCode = `ACC-MOD12-${stampCode}-${attempt}`;
    klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: CLASS_NAME, capacity: 5 });
  }
  if (klass.status !== 201) {
    record('1 preparation', false, `POST /api/classes -> HTTP ${klass.status} ${why(klass)}`);
    throw new Stop();
  }
  const classId = klass.body.id;
  const teachers = await call('PUT', `/api/classes/${classId}/teachers`, tokens.admin, { teachers: [{ userId: teacher.id, role: 'lead' }] });
  const opened = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'open' });
  const enrolled = await call('POST', `/api/classes/${classId}/enrollments`, tokens.admin, { studentId: student.id });
  const prepOk = verdict(
    '1 preparation',
    {
      'the teacher is the lead': teachers.status === 200,
      'the class is open': opened.status === 200,
      'the student is enrolled': enrolled.status === 201,
    },
    `class ${classCode} (${classId}) on course ${course.code}: create 201, teachers ${got(teachers, 200)}, open ${got(opened, 200)}, enroll ${got(enrolled, 201)}; ${linkNote}; the student has ${linkedGuardians.length} linked guardian(s) who receive notifications`,
  );
  if (!prepOk) throw new Stop();

  // 2. Before any event: what the inboxes hold now. Every later check counts only what is newer.
  const before = {};
  for (const [who, token] of [['student', tokens.student], ['guardian', tokens.guardian]]) {
    if (!token) continue;
    const newest = await call('GET', `${INBOX}?limit=1`, token);
    const unread = await call('GET', `${INBOX}/unread-count`, token);
    const prefs = await call('GET', PREFERENCES, token);
    before[who] = {
      ok:
        newest.status === 200 &&
        Array.isArray(newest.body?.items) &&
        unread.status === 200 &&
        Number.isInteger(unread.body?.unread) &&
        prefs.status === 200 &&
        (prefs.body?.categories ?? []).map((entry) => entry.category).join() === CATEGORIES.join() &&
        typeof prefs.body?.emailVerified === 'boolean',
      mark: newest.body?.items?.[0]?.id ?? null,
      unread: unread.body?.unread,
      emailVerified: prefs.body?.emailVerified,
      switches: switchesOf(prefs.body),
    };
  }
  const auditNewest = await call('GET', '/api/audit-logs?limit=1', tokens.admin);
  const auditMark = auditNewest.body?.items?.[0]?.id ?? null;
  const readsOk = before.student.ok && (before.guardian?.ok ?? true) && auditNewest.status === 200 && auditMark !== null;
  // With a mail transport: no e-mail copy of the journey's automatic events for the recipients the script can speak for.
  let quietOk = true;
  const quietNotes = [];
  if (emailAvailable && readsOk) {
    for (const [who, token] of [['student', tokens.student], ['guardian', tokens.guardian]]) {
      if (!token || before[who].emailVerified !== true) continue;
      const categories = QUIET_CATEGORIES.filter((category) => before[who].switches[category] === true);
      if (categories.length === 0) continue;
      const off = await call('PUT', PREFERENCES, token, { categories: categories.map((category) => ({ category, emailEnabled: false })) });
      if (off.status === 200) silenced.push({ who, token, categories });
      quietOk = quietOk && off.status === 200 && categories.every((category) => switchesOf(off.body)[category] === false);
      quietNotes.push(`${who} ${categories.join('+')} ${got(off, 200)}`);
    }
  }
  const beforeOk = verdict(
    '2 before',
    {
      'the inboxes, the counters and the preferences are readable': readsOk,
      'the e-mail switches of the journey are off': quietOk,
    },
    `student: unread ${before.student.unread}, newest notification ${before.student.mark ?? 'none'}, e-mail address confirmed: ${before.student.emailVerified ? 'yes' : 'no'}, e-mail switches ${showSwitches(before.student.switches)}${before.guardian ? `; guardian: unread ${before.guardian.unread}, newest notification ${before.guardian.mark ?? 'none'}, e-mail address confirmed: ${before.guardian.emailVerified ? 'yes' : 'no'}` : ''}; audit watermark ${auditMark ?? 'none'}${emailAvailable ? `; e-mail switched off for the journey: ${quietNotes.join(', ') || 'nothing to switch off (no confirmed address, or already off)'}` : ''}`,
  );
  if (!beforeOk) throw new Stop();
  const mark = before.student.mark;

  // 3. The teacher writes an assignment (a draft tells nobody) and publishes it: ONE notification for the student.
  const draft = await call('POST', `/api/classes/${classId}/assignments`, tokens.teacher, { title: ASSIGNMENT_TITLE, maxScore: MAX_SCORE });
  if (draft.status !== 201) {
    record('3 assignment published', false, `POST /api/classes/:id/assignments -> HTTP ${draft.status} ${why(draft)}`);
    throw new Stop();
  }
  const assignmentId = draft.body.id;
  const afterDraft = await newerThan(tokens.student, mark);
  const published = await call('POST', `/api/assignments/${assignmentId}/status`, tokens.teacher, { action: 'publish' });
  const afterPublish = await newerThan(tokens.student, mark);
  const publishedNote = afterPublish.items.find((item) => item.eventKey === 'assignment.published' && item.data?.assignmentId === assignmentId) ?? null;
  verdict(
    '3 assignment published',
    {
      'a draft notifies nobody': afterDraft.status === 200 && afterDraft.items.length === 0,
      'published': published.status === 200 && published.body?.status === 'open',
      'exactly one new notification': afterPublish.items.length === 1,
      'assignment.published in the category assignments, unread, about the student': publishedNote?.category === 'assignments' && publishedNote.readAt === null && publishedNote.announcementId === null && publishedNote.student?.id === student.id,
      'data = the link /my-assignments and the ids': publishedNote?.data?.link === '/my-assignments' && publishedNote.data.classId === classId,
      'the title names the assignment, the body the class': publishedNote !== null && namesIn(publishedNote.title, ASSIGNMENT_TITLE) && namesIn(publishedNote.body, CLASS_NAME),
    },
    `draft 201 -> ${afterDraft.items.length} new notification(s); publish ${got(published, 200)} -> ${afterPublish.items.length} new: ${publishedNote ? `${publishedNote.eventKey} [${publishedNote.category}] "${publishedNote.title}" link=${publishedNote.data?.link} unread=${publishedNote.readAt === null}` : `no assignment.published (${keysOf(afterPublish.items)})`}`,
  );
  if (published.status !== 200 || !publishedNote) throw new Stop();

  // 4. The student submits (that tells nobody), the teacher grades with feedback: ONE notification — the score in the body, never in the title, the feedback nowhere.
  const submitted = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { textAnswer: 'ACC-MOD12 acceptance answer', attemptNo: 1 });
  const afterSubmit = await newerThan(tokens.student, mark);
  const graded = submitted.status === 201 ? await call('POST', `/api/submissions/${submitted.body.id}/review`, tokens.teacher, { action: 'grade', score: SCORE, feedback: FEEDBACK, expectedGradedAt: null }) : { status: 0 };
  const afterGrade = await newerThan(tokens.student, mark);
  const gradedNote = afterGrade.items.find((item) => item.eventKey === 'submission.graded' && item.data?.submissionId === submitted.body?.id) ?? null;
  verdict(
    '4 submission graded',
    {
      'submitted': submitted.status === 201,
      'a submission notifies nobody': afterSubmit.items.length === 1,
      'graded': graded.status === 200 && graded.body?.score === SCORE,
      'exactly one more notification': afterGrade.items.length === 2,
      'submission.graded in the category assignments, unread, about the student': gradedNote?.category === 'assignments' && gradedNote.readAt === null && gradedNote.student?.id === student.id,
      'data = the link /my-assignments and the ids': gradedNote?.data?.link === '/my-assignments' && gradedNote.data.assignmentId === assignmentId && gradedNote.data.classId === classId,
      'the title names the assignment and carries no score': gradedNote !== null && namesIn(gradedNote.title, ASSIGNMENT_TITLE) && !gradedNote.title.includes(String(SCORE)),
      'the body carries the score': gradedNote !== null && gradedNote.body.includes(String(SCORE)) && gradedNote.body.includes(String(MAX_SCORE)),
      'the feedback is nowhere in the notification': gradedNote !== null && !JSON.stringify(gradedNote).includes(FEEDBACK),
    },
    `submit ${got(submitted, 201)} -> ${afterSubmit.items.length} new in all; grade ${SCORE}/${MAX_SCORE} ${got(graded, 200)} -> ${afterGrade.items.length} new in all: ${gradedNote ? `${gradedNote.eventKey} [${gradedNote.category}] "${gradedNote.title}" — score in the title: ${gradedNote.title.includes(String(SCORE)) ? 'YES!' : 'no'}, in the body: ${gradedNote.body.includes(String(SCORE)) ? 'yes' : 'NO!'}; teacher's feedback ${JSON.stringify(gradedNote).includes(FEEDBACK) ? 'VISIBLE!' : 'absent'}` : `no submission.graded (${keysOf(afterGrade.items)})`}`,
  );
  if (graded.status !== 200 || !gradedNote) throw new Stop();

  // 5. The admin writes an invoice for the student (a draft tells nobody), issues it and records a payment: TWO notifications — the amounts in the body, never in the title, the office note nowhere.
  const dueOn = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const invoiceDraft = await call('POST', '/api/invoices', tokens.admin, {
    studentId: student.id,
    enrollmentId: enrolled.body.id,
    lines: [{ description: { ar: 'رسوم قبول MOD-12', en: 'MOD-12 acceptance fee' }, amount: INVOICE_TOTAL }],
    installments: [{ amount: INVOICE_TOTAL, dueOn }],
    notes: OFFICE_NOTE,
  });
  const afterInvoiceDraft = await newerThan(tokens.student, mark);
  const issued = invoiceDraft.status === 201 ? await call('POST', `/api/invoices/${invoiceDraft.body.id}/status`, tokens.admin, { action: 'issue' }) : { status: 0 };
  const paid = issued.status === 200 ? await call('POST', `/api/invoices/${invoiceDraft.body.id}/payments`, tokens.admin, { amount: PAYMENT_AMOUNT, method: 'cash', notes: OFFICE_NOTE }) : { status: 0 };
  const afterFinance = await newerThan(tokens.student, mark);
  const invoiceNote = afterFinance.items.find((item) => item.eventKey === 'invoice.issued' && item.data?.invoiceId === invoiceDraft.body?.id) ?? null;
  const paymentNote = afterFinance.items.find((item) => item.eventKey === 'payment.recorded' && item.data?.paymentId === paid.body?.id) ?? null;
  const currency = issued.body?.currency ?? '';
  const invoiceNumber = issued.body?.number ?? '';
  const receiptNumber = paid.body?.number ?? '';
  /** An amount in a text: a number with two decimals, or the currency code. */
  const amountIn = (text) => /\d[.,]\d{2}/.test(text) || (currency !== '' && text.includes(currency));
  const financeNotes = [invoiceNote, paymentNote];
  verdict(
    '5 invoice and payment',
    {
      'a draft invoice notifies nobody': invoiceDraft.status === 201 && invoiceDraft.body?.number === null && afterInvoiceDraft.items.length === 2,
      'issued with a number INV-YYYY-NNNNN': issued.status === 200 && /^INV-\d{4}-\d{5,}$/.test(invoiceNumber),
      'payment recorded with a receipt RCPT-YYYY-NNNNN': paid.status === 201 && /^RCPT-\d{4}-\d{5,}$/.test(receiptNumber),
      'exactly two more notifications': afterFinance.items.length === 4,
      'invoice.issued and payment.recorded in the category finance, unread, about the student': financeNotes.every((note) => note?.category === 'finance' && note.readAt === null && note.student?.id === student.id),
      'data = the link /my-invoices and the ids': financeNotes.every((note) => note?.data?.link === '/my-invoices') && paymentNote?.data?.invoiceId === invoiceDraft.body?.id,
      'the titles carry the document number and no amount': invoiceNote !== null && paymentNote !== null && invoiceNote.title.includes(invoiceNumber) && paymentNote.title.includes(receiptNumber) && !amountIn(invoiceNote.title) && !amountIn(paymentNote.title),
      'the bodies carry the amounts in the invoice currency': invoiceNote !== null && paymentNote !== null && invoiceNote.body.includes(`${INVOICE_TOTAL}.00 ${currency}`) && paymentNote.body.includes(`${PAYMENT_AMOUNT}.00 ${currency}`) && paymentNote.body.includes(invoiceNumber),
      'the office note is nowhere in the notifications': financeNotes.every((note) => note !== null && !JSON.stringify(note).includes(OFFICE_NOTE)),
    },
    `draft ${got(invoiceDraft, 201)} -> ${afterInvoiceDraft.items.length} new in all; issue ${got(issued, 200)} ${invoiceNumber || 'no number'} ${issued.body?.total ?? ''} ${currency}; payment ${PAYMENT_AMOUNT} ${got(paid, 201)} receipt ${receiptNumber || 'none'} -> ${afterFinance.items.length} new in all: ${invoiceNote ? `invoice.issued "${invoiceNote.title}"` : 'no invoice.issued'}, ${paymentNote ? `payment.recorded "${paymentNote.title}"` : 'no payment.recorded'} [finance]; amount in a title: ${financeNotes.some((note) => note !== null && amountIn(note.title)) ? 'YES!' : 'no'}; office note ${financeNotes.some((note) => note !== null && JSON.stringify(note).includes(OFFICE_NOTE)) ? 'VISIBLE!' : 'absent'}`,
  );
  if (issued.status !== 200 || paid.status !== 201 || !invoiceNote || !paymentNote) throw new Stop();

  // 6. The teacher announces to the students of the class and their guardians: the words as typed, one notification per recipient.
  const announcementTitle = `إعلان رحلة القبول MOD-12 — ${classCode}`;
  const announcementBody = `هذا إعلان تجريبي من رحلة قبول الإشعارات إلى طلاب الفصل ${classCode} وأولياء أمورهم.\nThis is a test announcement of the MOD-12 acceptance journey.`;
  // An e-mail copy is asked for only where none can leave: without a mail transport.
  const wantsEmail = !emailAvailable;
  const announced = await call('POST', '/api/announcements', tokens.teacher, { audience: { kind: 'class', classId, students: true, guardians: true }, title: announcementTitle, body: announcementBody, sendEmail: wantsEmail });
  if (announced.status !== 201) {
    record('6 announcement', false, `POST /api/announcements -> HTTP ${announced.status} ${why(announced)}`);
    throw new Stop();
  }
  const announcementId = announced.body.id;
  const afterAnnouncement = await newerThan(tokens.student, mark);
  const announcementNote = afterAnnouncement.items.find((item) => item.announcementId === announcementId) ?? null;
  const detail = await call('GET', `/api/announcements/${announcementId}`, tokens.teacher);
  verdict(
    '6 announcement',
    {
      'answered with the words as typed and the normalised audience': announced.body.title === announcementTitle && announced.body.body === announcementBody && announced.body.sendEmail === wantsEmail && isClassAudience(announced.body.audience, classId) && announced.body.class?.id === classId,
      'recipientCount = the student and the linked guardians who receive': announced.body.recipientCount >= 1 && announced.body.recipientCount === announcementRecipients.size,
      'exactly one more notification': afterAnnouncement.items.length === 5,
      'an announcement in the category announcements, unread, about nobody, with exactly those words': announcementNote?.eventKey === 'announcement' && announcementNote.category === 'announcements' && announcementNote.readAt === null && announcementNote.student === null && announcementNote.title === announcementTitle && announcementNote.body === announcementBody,
      'data = the link /notifications and the ids': announcementNote?.data?.link === '/notifications' && announcementNote.data.announcementId === announcementId && announcementNote.data.classId === classId,
      'the sender reads it: nobody has read it yet': detail.status === 200 && detail.body?.readCount === 0 && detail.body?.recipientCount === announced.body.recipientCount,
    },
    `POST /api/announcements 201 ${announcementId}: recipientCount=${announced.body.recipientCount} (expected ${announcementRecipients.size}), sendEmail=${announced.body.sendEmail} -> ${afterAnnouncement.items.length} new in all: ${announcementNote ? `${announcementNote.eventKey} [${announcementNote.category}] words as typed: ${announcementNote.title === announcementTitle && announcementNote.body === announcementBody ? 'yes' : 'NO!'}` : 'no announcement in the inbox'}; GET /api/announcements/:id ${got(detail, 200)} readCount=${detail.body?.readCount}`,
  );
  if (!announcementNote || detail.status !== 200) throw new Stop();

  // 7. Its e-mail copies. Without a transport `sendEmail` leaves nothing to send; with one the script asked for no e-mail.
  const mail = detail.body.email ?? {};
  const mailLeaving = (mail.queued ?? 0) + (mail.sent ?? 0) + (mail.failed ?? 0);
  const mailCounts = `none=${mail.none} skipped=${mail.skipped} queued=${mail.queued} sent=${mail.sent} failed=${mail.failed}`;
  // A copy is due for a recipient who confirmed an address and left the e-mail of `announcements` on. The script knows that of the accounts
  // it signed in; of the student's other guardians it knows the address only — their switches are theirs to read — hence a range.
  const dueKnown = [before.student, before.guardian].filter((account) => account?.emailVerified === true && account.switches.announcements === true).length;
  const dueMaybe = linkedGuardians.filter((link) => link.user.id !== guardian?.id && link.user.id !== teacher.id && link.user.emailVerifiedAt).length;
  if (wantsEmail) {
    verdict(
      '7 announcement e-mail',
      {
        'the announcement asked for e-mail': detail.body.sendEmail === true,
        'nothing queued, sent or failed': mailLeaving === 0,
        'every copy is skipped or none': (mail.none ?? 0) + (mail.skipped ?? 0) === announced.body.recipientCount,
        'skipped = the recipients with a confirmed address who left the category on': mail.skipped >= dueKnown && mail.skipped <= dueKnown + dueMaybe,
      },
      `sendEmail=true without a mail transport: ${mailCounts} — skipped (a confirmed address and the category on) expected ${dueKnown}${dueMaybe > 0 ? `..${dueKnown + dueMaybe}` : ''}; none = no confirmed address, or the category switched off`,
    );
  } else if (mailLeaving === 0 && mail.none === announced.body.recipientCount) {
    record('7 announcement e-mail', null, `a mail transport is configured — the script e-mails nobody (the announcement was sent with sendEmail=false: ${mailCounts})`);
  } else {
    record('7 announcement e-mail', false, `the announcement was sent with sendEmail=false, yet its e-mail copies are ${mailCounts}`);
  }

  // 8. The guardian (optional): a copy of each of the five, the four events about their child.
  let guardianNew = null;
  if (tokens.guardian) {
    const theirs = await newerThan(tokens.guardian, before.guardian.mark);
    const theirUnread = await unreadOf(tokens.guardian);
    const childName = student.displayName ?? student.fullName;
    const copies = theirs.items.filter((item) => item.eventKey !== 'announcement');
    const theirAnnouncement = theirs.items.find((item) => item.announcementId === announcementId) ?? null;
    guardianNew = theirs.items.length;
    verdict(
      '8 guardian',
      {
        'a copy of each of the five, newest first': keysOf(theirs.items) === EXPECTED_KEYS.join(', '),
        'the four events are about the student and name them': copies.length === 4 && copies.every((item) => item.student?.id === student.id && item.body.includes(childName)),
        'their titles carry no score and no amount': copies.every((item) => !item.title.includes(String(SCORE)) && !amountIn(item.title)),
        'the announcement with the same words, about nobody': theirAnnouncement !== null && theirAnnouncement.title === announcementTitle && theirAnnouncement.body === announcementBody && theirAnnouncement.student === null,
        'the unread counter grew by five': theirUnread === before.guardian.unread + 5,
      },
      `${theirs.items.length} new notification(s): ${keysOf(theirs.items)}; about the child: ${copies.filter((item) => item.student?.id === student.id).length} of ${copies.length}; unread ${before.guardian.unread} -> ${theirUnread}`,
    );
  } else {
    record('8 guardian', null, 'skipped — no guardian account given');
  }

  // 9. The student's inbox as a whole: newest first, keyset pages, the category filter, the unread filter, the counter.
  const whole = await call('GET', `${INBOX}?limit=100`, tokens.student);
  const listed = whole.body?.items ?? [];
  const fresh = listed.filter(newer(mark));
  const pageOne = await call('GET', `${INBOX}?limit=2`, tokens.student);
  const pageTwo = pageOne.body?.nextCursor ? await call('GET', `${INBOX}?limit=2&cursor=${pageOne.body.nextCursor}`, tokens.student) : { status: 0 };
  const financeOnly = await call('GET', `${INBOX}?category=finance&limit=100`, tokens.student);
  const unreadOnly = await call('GET', `${INBOX}?unread=true&limit=100`, tokens.student);
  const unknownCategory = await call('GET', `${INBOX}?category=everything`, tokens.student);
  const unreadAfterEvents = await unreadOf(tokens.student);
  verdict(
    '9 inbox',
    {
      'the five new notifications, newest first': whole.status === 200 && keysOf(fresh) === EXPECTED_KEYS.join(', '),
      'data carries the link and ids only': fresh.every((item) => Object.entries(item.data ?? {}).every(([key, value]) => (key === 'link' || key.endsWith('Id')) && typeof value === 'string')),
      'an item carries neither the state of its e-mail copy nor an address': fresh.every((item) => !Object.keys(item).some((key) => /mail|recipient/i.test(key))),
      'they lead the list and the ids descend': listed.slice(0, fresh.length).every(newer(mark)) && listed.every((item, index) => index === 0 || listed[index - 1].id > item.id),
      'pages of two follow each other through nextCursor': pageOne.status === 200 && pageOne.body?.nextCursor === pageOne.body?.items?.[1]?.id && pageTwo.status === 200 && idsOf([...pageOne.body.items, ...pageTwo.body.items]) === idsOf(fresh.slice(0, 4)),
      'category=finance lists finance only: the payment and the invoice': financeOnly.status === 200 && financeOnly.body.items.every((item) => item.category === 'finance') && keysOf(financeOnly.body.items.filter(newer(mark))) === 'payment.recorded, invoice.issued',
      'unread=true lists unread only, the five among them': unreadOnly.status === 200 && unreadOnly.body.items.every((item) => item.readAt === null) && unreadOnly.body.items.filter(newer(mark)).length === 5,
      'an unknown category is 400': unknownCategory.status === 400,
      'the unread counter grew by exactly five': unreadAfterEvents === before.student.unread + 5,
    },
    `GET ${INBOX} ${got(whole, 200)}: ${fresh.length} new, newest first: ${keysOf(fresh)}; limit=2 then cursor: ${keysOf([...(pageOne.body?.items ?? []), ...(pageTwo.body?.items ?? [])])}; category=finance: ${keysOf((financeOnly.body?.items ?? []).filter(newer(mark)))}; unread=true: ${(unreadOnly.body?.items ?? []).length} listed, all unread; category=everything ${unknownCategory.status}; unread ${before.student.unread} -> ${unreadAfterEvents}`,
  );

  // 10. Ownership: nobody marks another user's notification; a student neither announces nor reads an announcement's record.
  const foreign = await call('POST', `${INBOX}/${gradedNote.id}/read`, tokens.teacher);
  const unreadAfterForeign = await unreadOf(tokens.student);
  const studentAnnounces = await call('POST', '/api/announcements', tokens.student, { audience: { kind: 'class', classId, students: true }, title: 'ACC-MOD12 — a student may not announce', body: 'This announcement must be refused.' });
  const studentReadsRecord = await call('GET', `/api/announcements/${announcementId}`, tokens.student);
  const classAnnouncements = await call('GET', `/api/announcements?classId=${classId}`, tokens.teacher);
  verdict(
    '10 ownership',
    {
      'the teacher cannot mark the student\'s notification: 404 notification_not_found': foreign.status === 404 && foreign.body?.code === 'notification_not_found',
      'the student\'s counter did not move': unreadAfterForeign === unreadAfterEvents,
      'a student cannot announce: 403 permission_denied': studentAnnounces.status === 403 && studentAnnounces.body?.code === 'permission_denied',
      'a recipient cannot read the announcement\'s record: 403': studentReadsRecord.status === 403,
      'the class has the one announcement of the teacher': classAnnouncements.status === 200 && idsOf(classAnnouncements.body?.items ?? []) === announcementId,
    },
    `teacher POST ${INBOX}/:id/read on the student's notification -> ${foreign.status} ${foreign.body?.code ?? ''}; student's unread still ${unreadAfterForeign}; student POST /api/announcements -> ${studentAnnounces.status} ${studentAnnounces.body?.code ?? ''} missing=${(studentAnnounces.body?.missing ?? []).join(',')}; student GET /api/announcements/:id -> ${studentReadsRecord.status}; GET /api/announcements?classId= ${got(classAnnouncements, 200)} ${(classAnnouncements.body?.items ?? []).length} item(s)`,
  );

  // 11. Marking as read: one, again (nothing changes), one category, then all the rest — the sender sees that one recipient read the announcement.
  const unreadBeforeMarking = await unreadOf(tokens.student);
  const one = await call('POST', `${INBOX}/${publishedNote.id}/read`, tokens.student);
  const unreadAfterOne = await unreadOf(tokens.student);
  const again = await call('POST', `${INBOX}/${publishedNote.id}/read`, tokens.student);
  const unreadAfterAgain = await unreadOf(tokens.student);
  const financeAll = await call('POST', `${INBOX}/read-all`, tokens.student, { category: 'finance' });
  const unreadAfterFinance = await unreadOf(tokens.student);
  const financeLeft = await call('GET', `${INBOX}?unread=true&category=finance&limit=1`, tokens.student);
  const detailMid = await call('GET', `/api/announcements/${announcementId}`, tokens.teacher);
  const rest = await call('POST', `${INBOX}/read-all`, tokens.student, {});
  const unreadAtEnd = await unreadOf(tokens.student);
  const detailEnd = await call('GET', `/api/announcements/${announcementId}`, tokens.teacher);
  const kept = await newerThan(tokens.student, mark);
  verdict(
    '11 marking',
    {
      'one notification read: the counter drops by one': one.status === 200 && one.body?.id === publishedNote.id && typeof one.body?.readAt === 'string' && unreadAfterOne === unreadBeforeMarking - 1,
      'the same call again changes nothing': again.status === 200 && again.body?.readAt === one.body?.readAt && unreadAfterAgain === unreadAfterOne,
      'read-all for finance marks at least the two new ones and the counter drops by what it marked': financeAll.status === 200 && financeAll.body?.updated >= 2 && unreadAfterFinance === unreadAfterOne - financeAll.body.updated,
      'no unread finance notification is left': financeLeft.status === 200 && financeLeft.body?.items?.length === 0,
      'the announcement is still unread by everybody': detailMid.status === 200 && detailMid.body?.readCount === 0,
      'read-all marks the rest and the counter is zero': rest.status === 200 && rest.body?.updated === unreadAfterFinance && unreadAtEnd === 0,
      'the announcement was read by one recipient': detailEnd.status === 200 && detailEnd.body?.readCount === 1,
      'the five notifications are still there, all read': kept.items.length === 5 && kept.items.every((item) => typeof item.readAt === 'string'),
    },
    `read one ${got(one, 200)}: unread ${unreadBeforeMarking} -> ${unreadAfterOne}; again ${got(again, 200)}: ${unreadAfterAgain}; read-all finance ${got(financeAll, 200)} updated=${financeAll.body?.updated}: ${unreadAfterFinance}; announcement readCount=${detailMid.body?.readCount}; read-all ${got(rest, 200)} updated=${rest.body?.updated}: ${unreadAtEnd}; announcement readCount=${detailEnd.body?.readCount}${before.student.unread > 0 ? ` (the ${before.student.unread} notification(s) the student had not read before the journey are read now too)` : ''}`,
  );

  // 12. The e-mail preferences: one switch flipped and put back — the script leaves the six switches exactly as it found them.
  const found = before.student.switches;
  const mine = silenced.find((entry) => entry.who === 'student') ?? null;
  const journeyOff = mine?.categories ?? [];
  const flipped = await call('PUT', PREFERENCES, tokens.student, { categories: [{ category: SWITCH_CATEGORY, emailEnabled: !found[SWITCH_CATEGORY] }] });
  const reread = await call('GET', PREFERENCES, tokens.student);
  const nothing = await call('PUT', PREFERENCES, tokens.student, {});
  // Back: the flipped switch and, with it, the switches turned off for the journey.
  const back = await call('PUT', PREFERENCES, tokens.student, { categories: [SWITCH_CATEGORY, ...journeyOff].map((category) => ({ category, emailEnabled: found[category] })) });
  if (back.status === 200 && mine) silenced.splice(silenced.indexOf(mine), 1);
  const restored = await call('GET', PREFERENCES, tokens.student);
  let guardianRestored = true;
  let guardianNote = '';
  const theirSwitches = silenced.find((entry) => entry.who === 'guardian') ?? null;
  if (theirSwitches) {
    const put = await call('PUT', PREFERENCES, tokens.guardian, { categories: theirSwitches.categories.map((category) => ({ category, emailEnabled: true })) });
    if (put.status === 200) silenced.splice(silenced.indexOf(theirSwitches), 1);
    const check = await call('GET', PREFERENCES, tokens.guardian);
    guardianRestored = put.status === 200 && check.status === 200 && sameSwitches(switchesOf(check.body), before.guardian.switches);
    guardianNote = `; guardian's switches put back ${got(put, 200)}: ${showSwitches(switchesOf(check.body))}`;
  }
  const flippedSwitches = switchesOf(flipped.body);
  verdict(
    '12 preferences',
    {
      'the switch is flipped and no other switch moves': flipped.status === 200 && flippedSwitches[SWITCH_CATEGORY] === !found[SWITCH_CATEGORY] && CATEGORIES.every((category) => category === SWITCH_CATEGORY || flippedSwitches[category] === (journeyOff.includes(category) ? false : found[category])),
      'a new read shows the same': reread.status === 200 && sameSwitches(switchesOf(reread.body), flippedSwitches),
      'a body that names no category is 400 nothing_to_update': nothing.status === 400 && nothing.body?.code === 'nothing_to_update',
      'put back: the six switches are exactly as found': back.status === 200 && restored.status === 200 && sameSwitches(switchesOf(restored.body), found) && restored.body?.emailVerified === before.student.emailVerified,
      'the guardian\'s switches are as found': guardianRestored,
    },
    `found ${showSwitches(found)}; PUT ${SWITCH_CATEGORY}=${found[SWITCH_CATEGORY] ? 'off' : 'on'} ${got(flipped, 200)} -> ${showSwitches(flippedSwitches)}; PUT {} -> ${nothing.status} ${nothing.body?.code ?? ''}; put back ${got(back, 200)} -> ${showSwitches(switchesOf(restored.body))}${guardianNote}`,
  );

  // 13. The audit trail: one event for the announcement — ids and a count, never its words — and none for reading, marking or preferences.
  const announcementEvents = await call('GET', `/api/audit-logs?entityType=announcements&entityId=${announcementId}&limit=50`, tokens.admin);
  const sent = announcementEvents.body?.items?.[0] ?? null;
  const sentText = JSON.stringify(sent ?? '');
  const wordsRecorded = [announcementTitle, ...announcementBody.split('\n')].some((words) => sentText.includes(words));
  /** What a user did since step 2, newest first, sign-ins and sign-outs apart. */
  const trailOf = async (userId) => {
    const r = await call('GET', `/api/audit-logs?actorUserId=${userId}&limit=200`, tokens.admin);
    return { status: r.status, events: (r.body?.items ?? []).filter((event) => event.id > auditMark && !event.action.startsWith('auth.')) };
  };
  const studentTrail = await trailOf(student.id);
  const teacherTrail = await trailOf(teacher.id);
  const guardianTrail = guardian ? await trailOf(guardian.id) : null;
  const actionsOf = (trail) => trail.events.map((event) => event.action).join(' <- ') || 'no event';
  verdict(
    '13 audit trail',
    {
      'exactly one event on the announcement: notifications.announcement.sent by the teacher': announcementEvents.status === 200 && announcementEvents.body.items.length === 1 && sent?.action === 'notifications.announcement.sent' && sent.entityType === 'announcements' && sent.entityId === announcementId && sent.actorUserId === teacher.id,
      'its metadata is the audience and the count': sent !== null && Object.keys(sent.metadata ?? {}).sort().join() === 'audience,recipients' && isClassAudience(sent.metadata.audience, classId) && sent.metadata.recipients === announced.body.recipientCount,
      'neither the title nor the body is recorded': sent !== null && !wordsRecorded,
      'the student\'s only event is the submission — reading, marking and preferences record nothing': studentTrail.status === 200 && studentTrail.events.length === 1 && studentTrail.events[0].action === 'assignments.submitted' && studentTrail.events[0].entityId === submitted.body.id,
      'the teacher\'s events are the four writes — the refused marking and the reads record nothing': teacherTrail.status === 200 && teacherTrail.events.map((event) => event.action).join() === 'notifications.announcement.sent,assignments.graded,assignments.status.changed,assignments.created',
      'the guardian recorded nothing': guardianTrail === null || (guardianTrail.status === 200 && guardianTrail.events.length === 0),
    },
    `announcement ${got(announcementEvents, 200)}: ${(announcementEvents.body?.items ?? []).length} event(s) ${sent?.action ?? ''} recipients=${sent?.metadata?.recipients} audience=${sent?.metadata?.audience?.kind}; its words recorded: ${wordsRecorded ? 'YES!' : 'no'}; student since step 2: ${actionsOf(studentTrail)}; teacher: ${actionsOf(teacherTrail)}${guardianTrail ? `; guardian: ${actionsOf(guardianTrail)}` : ''}`,
  );

  record('14 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(
    `\nEVIDENCE: class ${classCode} (${classId}) on course ${course.code}; assignment ${assignmentId}; submission ${submitted.body.id} (${SCORE} of ${MAX_SCORE}); invoice ${invoiceNumber} (${PAYMENT_AMOUNT} of ${INVOICE_TOTAL} ${currency} paid, receipt ${receiptNumber}); announcement ${announcementId} (${announced.body.recipientCount} recipient(s), sendEmail=${wantsEmail}); new notifications: student ${fresh.length}${guardianNew === null ? '' : `, guardian ${guardianNew}`}. The rows stay in the dev database on purpose; every notification of the student is marked as read.`,
  );
} catch (error) {
  if (!(error instanceof Stop)) {
    console.error('Unexpected error:', error instanceof Error ? error.message : error);
    results.push({ step: 'run', ok: false, evidence: 'unexpected error' });
  }
}

// A run that stopped early must not leave the e-mail switches it turned off: put them back now.
for (const entry of silenced.splice(0)) {
  let put;
  try {
    put = await call('PUT', PREFERENCES, entry.token, { categories: entry.categories.map((category) => ({ category, emailEnabled: true })) });
  } catch {
    put = { status: 0, body: null };
  }
  record(
    `restore e-mail switches (${entry.who})`,
    put.status === 200,
    put.status === 200
      ? `the run stopped early: ${entry.categories.join('+')} switched on again`
      : `could NOT switch ${entry.categories.join('+')} on again (HTTP ${put.status}) — sign in as the ${entry.who} and switch them on: PUT ${PREFERENCES}`,
  );
}

const failed = results.filter((r) => r.ok === false).length;
const passed = results.filter((r) => r.ok === true).length;
console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL / ${results.length - passed - failed} SKIP-or-manual`);
process.exitCode = failed > 0 ? 1 : 0;
}
