// MOD-08 acceptance journey (roadmap 4g.9) — run by the owner through accept-mod08.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student, guardian? }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
// Evidence rows: a class coded `ACC-MOD08-yyMMddHHmm` (and a course `ACC-MOD08-CRS-…` only when no course is
// published), its assignment, the student's two attempts and the audit events.
class Stop extends Error {}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const input = JSON.parse(raw);
const baseUrl = (input.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const HOUR = 3_600_000;
const results = [];
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Etc/GMT-3', hour12: false });
/** The server's reason for a refusal: the stable `code` and the validation message(s), for FAIL lines. */
const why = (r) => [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
/** `HTTP <status>` plus the server's reason when the status is not the expected one. */
const got = (r, expected) => `${r.status}${r.status === expected ? '' : ` (${why(r)})`}`;
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD08 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

async function userIdOf(adminToken, account, label) {
  const r = await call('GET', `/api/users?q=${encodeURIComponent(account.identifier)}&limit=20`, adminToken);
  const hit = (r.body?.items ?? []).find((u) => u.email === account.identifier.toLowerCase() || u.username === account.identifier.toLowerCase());
  if (!hit) {
    record(`resolve ${label}`, false, `account not found through GET /api/users?q= (HTTP ${r.status})`);
    throw new Stop();
  }
  return hit.id;
}

// Dev-only tooling: the journey writes rows (a class, an assignment, submissions) and signs in with real passwords,
// so it only ever targets a loopback server unless the launcher passes allowRemote (an explicit owner decision).
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
  const teacherId = await userIdOf(tokens.admin, input.teacher, 'TEACHER');
  const studentId = await userIdOf(tokens.admin, input.student, 'STUDENT');
  record('logins', true, `${tokens.guardian ? 'four' : 'three'} accounts signed in${tokens.guardian ? '' : ' (guardian skipped)'}; user ids resolved`);

  // yyMMddHHmm — the evidence suffix of the class (and of the course when one has to be created).
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');

  // 1. The admin prepares the class: a published course (first one, or a new acceptance course), the class, the lead teacher, open, the enrollment.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD08-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-08', en: 'MOD-08 acceptance course' } });
    const published = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (published.status !== 200) {
      record('1 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${published.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  const classCode = `ACC-MOD08-${stampCode}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: { ar: 'فصل قبول MOD-08', en: 'MOD-08 acceptance class' }, capacity: 5 });
  if (klass.status !== 201) {
    record('1 preparation', false, `POST /api/classes -> HTTP ${klass.status} ${why(klass)}`);
    throw new Stop();
  }
  const classId = klass.body.id;
  const teachers = await call('PUT', `/api/classes/${classId}/teachers`, tokens.admin, { teachers: [{ userId: teacherId, role: 'lead' }] });
  const opened = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'open' });
  const enrolled = await call('POST', `/api/classes/${classId}/enrollments`, tokens.admin, { studentId });
  const prepOk = teachers.status === 200 && opened.status === 200 && enrolled.status === 201;
  record('1 preparation', prepOk, `class ${classCode} (${classId}) on course ${course.code}: create 201, teachers ${got(teachers, 200)}, open ${got(opened, 200)}, enroll ${got(enrolled, 201)}`);
  if (!prepOk) throw new Stop();

  // 2. The teacher creates a draft due in two days (late allowed with a 10 % penalty, one attempt); the student neither sees it nor submits to it.
  const dueOnTime = new Date(Date.now() + 48 * HOUR).toISOString();
  const draft = await call('POST', `/api/classes/${classId}/assignments`, tokens.teacher, {
    title: { ar: 'واجب قبول MOD-08', en: 'MOD-08 acceptance assignment' },
    instructions: { ar: 'حلّ التمارين من 1 إلى 5', en: 'Solve exercises 1 to 5' },
    maxScore: 20,
    weight: 10,
    dueAt: dueOnTime,
    allowLate: true,
    latePenaltyPercent: 10,
    maxAttempts: 1,
  });
  if (draft.status !== 201) {
    record('2 draft', false, `POST /api/classes/:id/assignments -> HTTP ${draft.status} ${why(draft)}`);
    throw new Stop();
  }
  const assignmentId = draft.body.id;
  const hiddenDraft = await call('GET', `/api/me/assignments?classId=${classId}`, tokens.student);
  const earlySubmit = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { textAnswer: 'early' });
  record(
    '2 draft',
    draft.body.status === 'draft' && draft.body.activeStudents === 1 && hiddenDraft.status === 200 && hiddenDraft.body?.items?.length === 0 && earlySubmit.status === 409 && earlySubmit.body?.reason === 'not_published',
    `create 201 status=${draft.body.status} activeStudents=${draft.body.activeStudents} timeZone=${draft.body.timeZone}; student "my assignments" ${hiddenDraft.status} (${hiddenDraft.body?.items?.length ?? '?'} items); student submit ${earlySubmit.status} ${earlySubmit.body?.code ?? ''} reason=${earlySubmit.body?.reason ?? ''}`,
  );

  // 3. The teacher publishes it.
  const published = await call('POST', `/api/assignments/${assignmentId}/status`, tokens.teacher, { action: 'publish' });
  record('3 publish', published.status === 200 && published.body?.status === 'open' && typeof published.body?.publishedAt === 'string', `HTTP ${got(published, 200)} status=${published.body?.status} publishedAt=${published.body?.publishedAt ? stamp(published.body.publishedAt) : 'null'} (UTC+03:00)`);
  if (published.status !== 200) throw new Stop();

  // 4. The student submits a text answer before the due date.
  const first = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { textAnswer: 'Acceptance answer - exercises 1 to 4' });
  record('4 on-time submission', first.status === 201 && first.body?.attemptNo === 1 && first.body?.isLate === false && first.body?.status === 'submitted', `HTTP ${got(first, 201)} attemptNo=${first.body?.attemptNo} isLate=${first.body?.isLate} status=${first.body?.status} attempts=${first.body?.attempts}/${first.body?.attemptsAllowed}`);
  if (first.status !== 201) throw new Stop();

  // 5. The grading rules are locked after the first submission; the due date is not — the teacher moves it to an hour ago.
  const locked = await call('PATCH', `/api/assignments/${assignmentId}`, tokens.teacher, { maxScore: 25 });
  const duePast = new Date(Date.now() - HOUR).toISOString();
  const moved = await call('PATCH', `/api/assignments/${assignmentId}`, tokens.teacher, { dueAt: duePast });
  record(
    '5 locked rules / due date moved',
    locked.status === 409 && locked.body?.code === 'assignment_locked' && JSON.stringify(locked.body?.fields) === '["maxScore"]' && moved.status === 200 && moved.body?.dueAt === duePast,
    `PATCH maxScore ${locked.status} ${locked.body?.code ?? ''} fields=${JSON.stringify(locked.body?.fields ?? null)} submissionCount=${locked.body?.submissionCount}; PATCH dueAt ${got(moved, 200)} dueAt=${moved.body?.dueAt ? stamp(moved.body.dueAt) : 'null'} (UTC+03:00)`,
  );

  // 6. The roster has no answer text; the teacher returns the attempt with feedback and the student gains one attempt.
  const roster = await call('GET', `/api/assignments/${assignmentId}/submissions`, tokens.teacher);
  const row = (roster.body?.items ?? []).find((item) => item.student?.id === studentId);
  const returned = await call('POST', `/api/submissions/${first.body.id}/review`, tokens.teacher, { action: 'return', feedback: 'Acceptance feedback - complete exercise 5' });
  record(
    '6 roster + return',
    roster.status === 200 && row?.latest?.id === first.body.id && !JSON.stringify(roster.body).includes('Acceptance answer') && returned.status === 200 && returned.body?.status === 'returned' && returned.body?.attemptsAllowed === 2,
    `roster ${got(roster, 200)} student=${row ? 'listed' : 'missing'} latest=${row?.latest?.status ?? 'null'} answer text=${JSON.stringify(roster.body ?? '').includes('Acceptance answer') ? 'VISIBLE!' : 'hidden'}; return ${got(returned, 200)} status=${returned.body?.status} attemptsAllowed=${returned.body?.attemptsAllowed}`,
  );

  // 7. The second attempt (a link) comes after the due date — accepted and late; a third is refused.
  const second = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { linkUrl: 'https://docs.example.com/acceptance-mod08' });
  const third = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { textAnswer: 'third' });
  record(
    '7 late second attempt / third refused',
    second.status === 201 && second.body?.attemptNo === 2 && second.body?.isLate === true && third.status === 409 && third.body?.code === 'attempts_exhausted',
    `second ${got(second, 201)} attemptNo=${second.body?.attemptNo} isLate=${second.body?.isLate}; third ${third.status} ${third.body?.code ?? ''} maxAttempts=${third.body?.maxAttempts} attempts=${third.body?.attempts}`,
  );
  if (second.status !== 201) throw new Stop();

  // 8. Grading: out of range refused, then 17.5 with feedback.
  const outOfRange = await call('POST', `/api/submissions/${second.body.id}/review`, tokens.teacher, { action: 'grade', score: 25 });
  const graded = await call('POST', `/api/submissions/${second.body.id}/review`, tokens.teacher, { action: 'grade', score: 17.5, feedback: 'Acceptance feedback - well done' });
  record(
    '8 grade',
    outOfRange.status === 400 && outOfRange.body?.code === 'score_out_of_range' && graded.status === 200 && graded.body?.status === 'graded' && graded.body?.score === 17.5 && !('userId' in (graded.body?.gradedBy ?? {})),
    `score 25 ${outOfRange.status} ${outOfRange.body?.code ?? ''} (maxScore ${outOfRange.body?.maxScore}); grade ${got(graded, 200)} status=${graded.body?.status} score=${graded.body?.score} gradedBy=${graded.body?.gradedBy?.fullName ?? 'null'}`,
  );

  // 9. The student: "my assignments" with the latest attempt and its review (no weight, no reviewer, no answer); the submission itself; no access outside them.
  const mine = await call('GET', `/api/me/assignments?classId=${classId}`, tokens.student);
  const item = mine.body?.items?.[0];
  const ownRead = await call('GET', `/api/submissions/${second.body.id}`, tokens.student);
  const list = await call('GET', `/api/assignments?classId=${classId}`, tokens.student);
  const detail = await call('GET', `/api/assignments/${assignmentId}`, tokens.student);
  const serialized = JSON.stringify(mine.body ?? '');
  const mineOk =
    mine.status === 200 &&
    mine.body.items.length === 1 &&
    item?.relation === 'self' &&
    item?.attempts === 2 &&
    item?.latest?.attemptNo === 2 &&
    item?.latest?.isLate === true &&
    item?.latest?.status === 'graded' &&
    item?.latest?.score === 17.5 &&
    !['weight', 'gradedBy', 'textAnswer', 'linkUrl'].some((key) => serialized.includes(key));
  record(
    '9 student views',
    mineOk && ownRead.status === 200 && ownRead.body?.linkUrl === 'https://docs.example.com/acceptance-mod08' && list.status === 200 && list.body?.items?.length === 0 && detail.status === 404,
    `"my assignments" ${got(mine, 200)} ${mine.body?.items?.length ?? '?'} item(s): relation=${item?.relation} attempts=${item?.attempts}/${item?.attemptsAllowed} latest=${JSON.stringify(item?.latest ? { attemptNo: item.latest.attemptNo, isLate: item.latest.isLate, status: item.latest.status, score: item.latest.score } : null)}; hidden fields ${['weight', 'gradedBy', 'textAnswer', 'linkUrl'].some((key) => serialized.includes(key)) ? 'VISIBLE!' : 'hidden'}; own submission ${got(ownRead, 200)}; GET /api/assignments ${list.status} (${list.body?.items?.length ?? '?'} items); GET /api/assignments/:id ${detail.status} ${detail.body?.code ?? ''}`,
  );

  // 10. The guardian (optional): the child's item and submission.
  if (tokens.guardian) {
    const child = await call('GET', `/api/me/assignments?studentId=${studentId}`, tokens.guardian);
    const childItem = (child.body?.items ?? []).find((i) => i.id === assignmentId);
    const childRead = await call('GET', `/api/submissions/${second.body.id}`, tokens.guardian);
    record('10 guardian', child.status === 200 && childItem?.relation === 'child' && childItem?.latest?.score === 17.5 && childRead.status === 200, `HTTP ${child.status}; item ${childItem ? `relation=${childItem.relation} score=${childItem.latest?.score}` : 'missing — link the guardian to the student (POST /api/users/:studentId/guardians) and rerun'}; submission ${childRead.status} ${childRead.body?.code ?? ''}`);
  } else {
    record('10 guardian', null, 'skipped — no guardian account given (create one, link it to the student, rerun with its password)');
  }

  // 11. The teacher closes the assignment: no more submissions; the review stays open (D-R39) — a corrected score.
  const closed = await call('POST', `/api/assignments/${assignmentId}/status`, tokens.teacher, { action: 'close' });
  const afterClose = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { textAnswer: 'after close' });
  const regraded = await call('POST', `/api/submissions/${second.body.id}/review`, tokens.teacher, { action: 'grade', score: 18, feedback: 'Acceptance feedback - corrected after closing' });
  record(
    '11 close + review after closing',
    closed.status === 200 && closed.body?.status === 'closed' && afterClose.status === 409 && afterClose.body?.reason === 'closed' && regraded.status === 200 && regraded.body?.score === 18,
    `close ${got(closed, 200)} status=${closed.body?.status} counts=${JSON.stringify(closed.body?.submissions ?? null)}; submit ${afterClose.status} ${afterClose.body?.code ?? ''} reason=${afterClose.body?.reason ?? ''}; regrade ${got(regraded, 200)} score=${regraded.body?.score}`,
  );

  // 12. The audit log: the teacher's journey events and the student's two submissions, newest first.
  const teacherLog = await call('GET', `/api/audit-logs?actorUserId=${teacherId}&limit=20`, tokens.admin);
  const teacherEvents = (teacherLog.body?.items ?? []).filter((i) => !i.action.startsWith('auth.')).slice(0, 7);
  const expectedTeacher = ['assignments.graded', 'assignments.status.changed', 'assignments.graded', 'assignments.returned', 'assignments.updated', 'assignments.status.changed', 'assignments.created'];
  const studentLog = await call('GET', `/api/audit-logs?actorUserId=${studentId}&limit=20`, tokens.admin);
  const studentEvents = (studentLog.body?.items ?? []).filter((i) => !i.action.startsWith('auth.')).slice(0, 2);
  record(
    '12 audit log',
    teacherLog.status === 200 && teacherEvents.map((e) => e.action).join(',') === expectedTeacher.join(',') && studentLog.status === 200 && studentEvents.every((e) => e.action === 'assignments.submitted') && studentEvents.length === 2,
    `teacher ${teacherLog.status}: ${teacherEvents.map((e) => `${e.action} @ ${stamp(e.createdAt)}`).join(' <- ') || 'no events'}; student ${studentLog.status}: ${studentEvents.map((e) => `${e.action} (attempt ${e.metadata?.attemptNo}, late=${e.metadata?.isLate})`).join(' <- ') || 'no events'} (UTC+03:00)`,
  );

  record('13 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${classCode} (${classId}); assignment ${assignmentId}; submissions ${first.body.id} (attempt 1) / ${second.body.id} (attempt 2); course ${course.code}. The rows stay in the dev database on purpose.`);
} catch (error) {
  if (!(error instanceof Stop)) {
    console.error('Unexpected error:', error instanceof Error ? error.message : error);
    results.push({ step: 'run', ok: false, evidence: 'unexpected error' });
  }
}

const failed = results.filter((r) => r.ok === false).length;
const passed = results.filter((r) => r.ok === true).length;
console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL / ${results.length - passed - failed} SKIP-or-manual`);
process.exitCode = failed > 0 ? 1 : 0;
}
