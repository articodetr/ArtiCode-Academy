// MOD-09 acceptance journey (roadmap 4h.9) — run by the owner through accept-mod09.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student, guardian? }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
// Evidence rows: a class coded `ACC-MOD09-yyMMddHHmm` (and a course `ACC-MOD09-CRS-…` only when no course is
// published), its exam and result, its assignment and the student's attempt, the student's final grade (on the
// academy's DEFAULT grade scheme — no scheme is created) and the audit events.
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
/** The weighted average of D-R43 rounded half-up to two places, as the server computes it. */
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
/** The band of a percentage: the highest lower bound at or below it (D-R46). */
const bandOf = (scheme, percent) => [...(scheme?.bands ?? [])].sort((a, b) => b.minPercent - a.minPercent).find((band) => band.minPercent <= percent) ?? null;
const bandText = (band) => (band ? `${band.label?.ar ?? '?'}${band.letter ? ` (${band.letter})` : ''} ${band.isPass ? 'pass' : 'fail'}` : 'none');
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD09 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

// Dev-only tooling: the journey writes rows (a class, an exam, an assignment, a final grade) and signs in with real
// passwords, so it only ever targets a loopback server unless the launcher passes allowRemote (an explicit owner decision).
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

  // The academy's default grade scheme (D-R46 — the seed creates one when the academy has none); the finalization uses it.
  const schemes = await call('GET', '/api/grade-schemes', tokens.teacher);
  const scheme = (schemes.body?.items ?? []).find((item) => item.isDefault) ?? null;
  if (schemes.status !== 200 || !scheme) {
    record('0 default grade scheme', false, `GET /api/grade-schemes -> ${got(schemes, 200)}; ${scheme ? '' : 'no default scheme — run "npm run prisma:seed" in backend/ once (it creates the default when the academy has none), then rerun'}`);
    throw new Stop();
  }
  record('0 default grade scheme', true, `"${scheme.name?.ar}" (${scheme.id}) — ${scheme.bands.map((band) => `${band.minPercent}% ${band.label?.ar}${band.letter ? ` ${band.letter}` : ''}${band.isPass ? '' : ' (fail)'}`).join(' | ')}`);

  // yyMMddHHmm — the evidence suffix of the class (and of the course when one has to be created).
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');

  // 1. The admin prepares the class: a published course (first one, or a new acceptance course), the class, the lead teacher, open, the enrollment.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD09-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-09', en: 'MOD-09 acceptance course' } });
    const published = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (published.status !== 200) {
      record('1 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${published.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  const classCode = `ACC-MOD09-${stampCode}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: { ar: 'فصل قبول MOD-09', en: 'MOD-09 acceptance class' }, capacity: 5 });
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

  // ── WF-07 — an exam with recorded results ──
  // 2. The teacher creates a draft midterm for tomorrow (max 50, pass 25, weight 60); a draft takes no result and the student does not see it.
  const scheduledAt = new Date(Date.now() + 24 * HOUR).toISOString();
  const draft = await call('POST', `/api/classes/${classId}/exams`, tokens.teacher, {
    title: { ar: 'اختبار قبول MOD-09', en: 'MOD-09 acceptance exam' },
    type: 'midterm',
    scheduledAt,
    durationMinutes: 90,
    maxScore: 50,
    passScore: 25,
    weight: 60,
  });
  if (draft.status !== 201) {
    record('2 exam draft', false, `POST /api/classes/:id/exams -> HTTP ${draft.status} ${why(draft)}`);
    throw new Stop();
  }
  const examId = draft.body.id;
  const earlyResults = await call('PUT', `/api/exams/${examId}/results`, tokens.teacher, { results: [{ studentId, status: 'scored', score: 40 }] });
  const hiddenDraft = await call('GET', `/api/me/exams?classId=${classId}`, tokens.student);
  record(
    '2 exam draft',
    draft.body.status === 'draft' && draft.body.activeStudents === 1 && earlyResults.status === 409 && earlyResults.body?.reason === 'not_scheduled' && hiddenDraft.status === 200 && hiddenDraft.body?.items?.length === 0,
    `create 201 status=${draft.body.status} type=${draft.body.type} weight=${draft.body.weight} activeStudents=${draft.body.activeStudents} timeZone=${draft.body.timeZone}; results on a draft ${earlyResults.status} ${earlyResults.body?.code ?? ''} reason=${earlyResults.body?.reason ?? ''}; student "my exams" ${hiddenDraft.status} (${hiddenDraft.body?.items?.length ?? '?'} items)`,
  );

  // 3. The teacher schedules it: the student sees the exam, without a result.
  const scheduled = await call('POST', `/api/exams/${examId}/status`, tokens.teacher, { action: 'schedule' });
  const seen = await call('GET', `/api/me/exams?classId=${classId}`, tokens.student);
  record(
    '3 schedule',
    scheduled.status === 200 && scheduled.body?.status === 'scheduled' && seen.status === 200 && seen.body?.items?.length === 1 && seen.body.items[0].result === null,
    `HTTP ${got(scheduled, 200)} status=${scheduled.body?.status} scheduledAt=${scheduled.body?.scheduledAt ? stamp(scheduled.body.scheduledAt) : 'null'} (UTC+03:00); student "my exams" ${seen.status} (${seen.body?.items?.length ?? '?'} item, result=${JSON.stringify(seen.body?.items?.[0]?.result ?? null)})`,
  );
  if (scheduled.status !== 200) throw new Stop();

  // 4. The results sheet: a score above the maximum is refused; 42 with feedback is recorded; the student still sees no result before publishing.
  const outOfRange = await call('PUT', `/api/exams/${examId}/results`, tokens.teacher, { results: [{ studentId, status: 'scored', score: 55 }] });
  const sheet = await call('PUT', `/api/exams/${examId}/results`, tokens.teacher, { results: [{ studentId, status: 'scored', score: 42, feedback: 'Acceptance feedback - very good' }] });
  const row = (sheet.body?.items ?? []).find((item) => item.student?.id === studentId);
  const unpublished = await call('GET', `/api/me/exams?classId=${classId}`, tokens.student);
  record(
    '4 results sheet',
    outOfRange.status === 400 && outOfRange.body?.code === 'score_out_of_range' && sheet.status === 200 && row?.result?.score === 42 && sheet.body?.counts?.scored === 1 && unpublished.body?.items?.[0]?.result === null,
    `score 55 ${outOfRange.status} ${outOfRange.body?.code ?? ''} (maxScore ${outOfRange.body?.maxScore}); PUT ${got(sheet, 200)} counts=${JSON.stringify(sheet.body?.counts ?? null)} result=${row?.result ? `${row.result.status} ${row.result.score} by ${row.result.recordedBy?.fullName}` : 'missing'}; student before publishing result=${JSON.stringify(unpublished.body?.items?.[0]?.result ?? null)}`,
  );
  if (sheet.status !== 200) throw new Stop();

  // 5. The teacher publishes: the student sees the own result — never the weight or the recorder.
  const published = await call('POST', `/api/exams/${examId}/status`, tokens.teacher, { action: 'publish' });
  const mineExam = await call('GET', `/api/me/exams?classId=${classId}`, tokens.student);
  const examItem = mineExam.body?.items?.[0];
  const examLeak = ['weight', 'recordedBy'].filter((key) => JSON.stringify(mineExam.body ?? '').includes(key));
  record(
    '5 publish + "my exams"',
    published.status === 200 && published.body?.status === 'published' && examItem?.result?.status === 'scored' && examItem?.result?.score === 42 && examLeak.length === 0,
    `publish ${got(published, 200)} status=${published.body?.status} publishedAt=${published.body?.publishedAt ? stamp(published.body.publishedAt) : 'null'} (UTC+03:00); student result=${JSON.stringify(examItem?.result ?? null)}; hidden fields ${examLeak.length ? `VISIBLE: ${examLeak.join(', ')}` : 'hidden'}`,
  );
  if (published.status !== 200) throw new Stop();

  // ── WF-08 — computing the grades ──
  // 6. A weighted assignment (max 20, weight 40, late work with a 10 % penalty); the teacher moves the due date to an hour ago; the student submits late; the teacher grades 18.
  const assignment = await call('POST', `/api/classes/${classId}/assignments`, tokens.teacher, {
    title: { ar: 'واجب قبول MOD-09', en: 'MOD-09 acceptance assignment' },
    maxScore: 20,
    weight: 40,
    dueAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    allowLate: true,
    latePenaltyPercent: 10,
    maxAttempts: 1,
  });
  if (assignment.status !== 201) {
    record('6 weighted assignment', false, `POST /api/classes/:id/assignments -> HTTP ${assignment.status} ${why(assignment)}`);
    throw new Stop();
  }
  const assignmentId = assignment.body.id;
  const assignmentPublished = await call('POST', `/api/assignments/${assignmentId}/status`, tokens.teacher, { action: 'publish' });
  const moved = await call('PATCH', `/api/assignments/${assignmentId}`, tokens.teacher, { dueAt: new Date(Date.now() - HOUR).toISOString() });
  const submitted = await call('POST', `/api/assignments/${assignmentId}/submissions`, tokens.student, { textAnswer: 'Acceptance answer - MOD-09' });
  const graded = submitted.status === 201 ? await call('POST', `/api/submissions/${submitted.body.id}/review`, tokens.teacher, { action: 'grade', score: 18 }) : { status: 0 };
  record(
    '6 weighted assignment',
    assignmentPublished.status === 200 && moved.status === 200 && submitted.status === 201 && submitted.body?.isLate === true && graded.status === 200 && graded.body?.score === 18,
    `create 201 weight=${assignment.body.weight} latePenaltyPercent=${assignment.body.latePenaltyPercent}; publish ${got(assignmentPublished, 200)}; due date moved ${got(moved, 200)}; submit ${got(submitted, 201)} isLate=${submitted.body?.isLate}; grade ${got(graded, 200)} score=${graded.body?.score}`,
  );
  if (graded.status !== 200) throw new Stop();

  // 7. The gradebook (D-R43/D-R44): 18 late → 16.2; 100 × (40 × 16.2/20 + 60 × 42/50) ÷ 100 = 82.8; not ready while the assignment is open; the student sees no average.
  const expectedFirst = round2((100 * (40 * ((18 * 0.9) / 20) + 60 * (42 / 50))) / 100);
  const book = await call('GET', `/api/classes/${classId}/gradebook`, tokens.teacher);
  const entry = (book.body?.students ?? []).find((item) => item.student?.id === studentId);
  const earlyGrades = await call('GET', `/api/me/grades?classId=${classId}`, tokens.student);
  record(
    '7 gradebook',
    book.status === 200 && entry?.cells?.[0]?.effectiveScore === 16.2 && entry?.cells?.[0]?.late === true && entry?.current === expectedFirst && entry?.final === null && book.body?.readiness?.openAssignments === 1 && book.body?.readiness?.ready === false && earlyGrades.status === 200 && earlyGrades.body?.items?.[0]?.final === null,
    `GET ${got(book, 200)} cells=${JSON.stringify((entry?.cells ?? []).map((cell) => [cell.status, cell.score, cell.effectiveScore, cell.late]))} current=${entry?.current} (expected ${expectedFirst}) final=${JSON.stringify(entry?.final ?? null)} readiness=${JSON.stringify(book.body?.readiness ?? null)}; student "my grades" final=${JSON.stringify(earlyGrades.body?.items?.[0]?.final ?? null)}`,
  );

  // 8. Finalization (D-R45) is refused while the class is open, then while the assignment is open.
  const notGradable = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const started = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'start' });
  const notReady = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  record(
    '8 finalization refused',
    notGradable.status === 409 && notGradable.body?.code === 'class_not_gradable' && started.status === 200 && notReady.status === 409 && notReady.body?.code === 'grades_not_ready' && notReady.body?.openAssignments === 1,
    `open class ${notGradable.status} ${notGradable.body?.code ?? ''}; start ${got(started, 200)}; running class with an open assignment ${notReady.status} ${notReady.body?.code ?? ''} openAssignments=${notReady.body?.openAssignments}`,
  );

  // 9. The teacher closes the assignment and finalizes with the academy's default scheme: the final grade carries its band.
  const closed = await call('POST', `/api/assignments/${assignmentId}/status`, tokens.teacher, { action: 'close' });
  const fixed = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const fixedFinal = (fixed.body?.students ?? []).find((item) => item.student?.id === studentId)?.final ?? null;
  const expectedBand = bandOf(scheme, expectedFirst);
  record(
    '9 finalize',
    closed.status === 200 && fixed.status === 200 && fixedFinal?.percent === expectedFirst && fixedFinal?.letter === (expectedBand?.letter ?? null) && fixedFinal?.isPass === expectedBand?.isPass && fixedFinal?.schemeId === scheme.id && fixedFinal?.stale === false,
    `close ${got(closed, 200)}; POST final-grades ${got(fixed, 200)} percent=${fixedFinal?.percent} band=${fixedFinal ? bandText({ label: fixedFinal.label, letter: fixedFinal.letter, isPass: fixedFinal.isPass }) : 'none'} (expected ${bandText(expectedBand)}) stale=${fixedFinal?.stale}`,
  );
  if (fixed.status !== 200) throw new Stop();

  // 10. "My grades" (D-R48): the student sees the components with the penalty and the final grade — no breakdown, reviewer or recorder; a teacher holds neither key.
  const mineGrades = await call('GET', `/api/me/grades?classId=${classId}`, tokens.student);
  const gradeItem = mineGrades.body?.items?.[0];
  const gradeLeak = ['breakdown', 'gradedBy', 'recordedBy', 'finalizedBy', 'current', 'projected'].filter((key) => JSON.stringify(mineGrades.body ?? '').includes(key));
  const teacherGrades = await call('GET', '/api/me/grades', tokens.teacher);
  record(
    '10 "my grades"',
    mineGrades.status === 200 && gradeItem?.relation === 'self' && gradeItem?.components?.length === 2 && gradeItem?.final?.percent === expectedFirst && gradeLeak.length === 0 && teacherGrades.status === 403,
    `student ${got(mineGrades, 200)} relation=${gradeItem?.relation} components=${JSON.stringify((gradeItem?.components ?? []).map((c) => [c.kind, c.weight, c.score, c.effectiveScore, c.late]))} final=${gradeItem?.final ? `${gradeItem.final.percent} ${gradeItem.final.label?.ar}${gradeItem.final.letter ? ` ${gradeItem.final.letter}` : ''}` : 'null'}; hidden fields ${gradeLeak.length ? `VISIBLE: ${gradeLeak.join(', ')}` : 'hidden'}; teacher ${teacherGrades.status} ${teacherGrades.body?.code ?? ''}`,
  );

  // 11. The guardian (optional): the child's exam result and final grade.
  if (tokens.guardian) {
    const childExams = await call('GET', `/api/me/exams?studentId=${studentId}&classId=${classId}`, tokens.guardian);
    const childGrades = await call('GET', `/api/me/grades?studentId=${studentId}&classId=${classId}`, tokens.guardian);
    const childItem = childGrades.body?.items?.[0];
    record(
      '11 guardian',
      childExams.status === 200 && childExams.body?.items?.[0]?.result?.score === 42 && childGrades.status === 200 && childItem?.relation === 'child' && childItem?.final?.percent === expectedFirst,
      `"my exams" ${childExams.status} result=${childExams.body?.items?.[0]?.result?.score ?? 'missing'}; "my grades" ${childGrades.status} ${childItem ? `relation=${childItem.relation} final=${childItem.final?.percent}` : 'missing — link the guardian to the student (POST /api/users/:studentId/guardians) and rerun'}`,
    );
  } else {
    record('11 guardian', null, 'skipped — no guardian account given (create one, link it to the student, rerun with its password)');
  }

  // 12. A later grade (the closed assignment keeps its review open — D-R39) marks the final grade stale; finalizing again updates it: 20 late → 18; 36 + 50.4 = 86.4.
  const expectedSecond = round2((100 * (40 * ((20 * 0.9) / 20) + 60 * (42 / 50))) / 100);
  const regraded = await call('POST', `/api/submissions/${submitted.body.id}/review`, tokens.teacher, { action: 'grade', score: 20 });
  const staleBook = await call('GET', `/api/classes/${classId}/gradebook`, tokens.teacher);
  const staleFinal = (staleBook.body?.students ?? []).find((item) => item.student?.id === studentId)?.final ?? null;
  const refixed = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const refixedFinal = (refixed.body?.students ?? []).find((item) => item.student?.id === studentId)?.final ?? null;
  record(
    '12 stale + finalize again',
    regraded.status === 200 && staleFinal?.stale === true && staleFinal?.percent === expectedFirst && refixed.status === 200 && refixedFinal?.percent === expectedSecond && refixedFinal?.stale === false,
    `regrade ${got(regraded, 200)} score=${regraded.body?.score}; gradebook final=${staleFinal?.percent} stale=${staleFinal?.stale}; finalize ${got(refixed, 200)} percent=${refixedFinal?.percent} (expected ${expectedSecond}) band=${refixedFinal ? bandText({ label: refixedFinal.label, letter: refixedFinal.letter, isPass: refixedFinal.isPass }) : 'none'} stale=${refixedFinal?.stale}`,
  );

  // 13. Withdrawing removes the final grade (the student sees none); finalizing again restores it — the evidence row stays.
  const withdrawn = await call('DELETE', `/api/classes/${classId}/final-grades`, tokens.teacher);
  const afterWithdraw = await call('GET', `/api/me/grades?classId=${classId}`, tokens.student);
  const again = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const againFinal = (again.body?.students ?? []).find((item) => item.student?.id === studentId)?.final ?? null;
  record(
    '13 withdraw + finalize again',
    withdrawn.status === 200 && afterWithdraw.status === 200 && afterWithdraw.body?.items?.[0]?.final === null && again.status === 200 && againFinal?.percent === expectedSecond,
    `DELETE ${got(withdrawn, 200)}; student final after withdrawal=${JSON.stringify(afterWithdraw.body?.items?.[0]?.final ?? null)}; finalize ${got(again, 200)} percent=${againFinal?.percent}`,
  );

  // 14. The audit log: the teacher's journey events (nothing for the refused requests) and the student's submission, newest first.
  const teacherLog = await call('GET', `/api/audit-logs?actorUserId=${teacherId}&limit=40`, tokens.admin);
  const teacherEvents = (teacherLog.body?.items ?? []).filter((i) => !i.action.startsWith('auth.')).slice(0, 14);
  const expectedTeacher = [
    'grades.finalized',
    'grades.withdrawn',
    'grades.finalized',
    'assignments.graded',
    'grades.finalized',
    'assignments.status.changed',
    'assignments.graded',
    'assignments.updated',
    'assignments.status.changed',
    'assignments.created',
    'exams.status.changed',
    'exams.results.recorded',
    'exams.status.changed',
    'exams.created',
  ];
  const studentLog = await call('GET', `/api/audit-logs?actorUserId=${studentId}&limit=20`, tokens.admin);
  const studentEvents = (studentLog.body?.items ?? []).filter((i) => !i.action.startsWith('auth.')).slice(0, 1);
  record(
    '14 audit log',
    teacherLog.status === 200 && teacherEvents.map((e) => e.action).join(',') === expectedTeacher.join(',') && studentLog.status === 200 && studentEvents[0]?.action === 'assignments.submitted',
    `teacher ${teacherLog.status}: ${teacherEvents.map((e) => `${e.action} @ ${stamp(e.createdAt)}`).join(' <- ') || 'no events'}; student ${studentLog.status}: ${studentEvents.map((e) => `${e.action} (late=${e.metadata?.isLate})`).join(' <- ') || 'no events'} (UTC+03:00)`,
  );

  record('15 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${classCode} (${classId}); exam ${examId}; assignment ${assignmentId}; submission ${submitted.body.id}; final grade ${againFinal?.percent ?? '?'} on scheme ${scheme.id}; course ${course.code}. The rows stay in the dev database on purpose.`);
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
