// MOD-13 acceptance journey (roadmap 4k.9) — run by the owner through accept-mod13.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
// Evidence rows: a class coded `ACC-MOD13-yyMMddHHmm` (and a course `ACC-MOD13-CRS-…` only when no course is
// published) with the student's enrollment, one past lesson with its attendance, one graded assignment, one
// published exam with its result, the class's final grade, a fee plan, an issued invoice and one payment. The
// reports are read-only: they write nothing and record no audit event. The numbers the finance steps take stay taken.
class Stop extends Error {}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const input = JSON.parse(raw);
const baseUrl = (input.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const results = [];
/** The server's reason for a refusal: the stable `code` and the validation message(s), for FAIL lines. */
const why = (r) => [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
/** `HTTP <status>` plus the server's reason when the status is not the expected one. */
const got = (r, expected) => `${r.status}${r.status === expected ? '' : ` (${why(r)})`}`;
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD13 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

// Dev-only tooling: the journey writes rows and signs in with real passwords, so it only ever targets a
// loopback server unless the launcher passes allowRemote (an explicit owner decision).
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
  };
  const teacherId = await userIdOf(tokens.admin, input.teacher, 'TEACHER');
  const studentId = await userIdOf(tokens.admin, input.student, 'STUDENT');
  record('logins', true, 'three accounts signed in; user ids resolved');

  // yyMMddHHmm — the evidence suffix of the class (and of the course when one has to be created).
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');
  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

  // 1. The admin prepares a running class: the teacher as lead, the student enrolled.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD13-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-13', en: 'MOD-13 acceptance course' } });
    const published = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (published.status !== 200) {
      record('1 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${published.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  const classCode = `ACC-MOD13-${stampCode}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: { ar: 'فصل قبول MOD-13', en: 'MOD-13 acceptance class' }, capacity: 5 });
  if (klass.status !== 201) {
    record('1 preparation', false, `POST /api/classes -> HTTP ${klass.status} ${why(klass)}`);
    throw new Stop();
  }
  const classId = klass.body.id;
  const teachers = await call('PUT', `/api/classes/${classId}/teachers`, tokens.admin, { teachers: [{ userId: teacherId, role: 'lead' }] });
  const opened = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'open' });
  const enrolled = await call('POST', `/api/classes/${classId}/enrollments`, tokens.admin, { studentId });
  const started = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'start' });
  const prepOk = teachers.status === 200 && opened.status === 200 && enrolled.status === 201 && started.status === 200;
  record('1 preparation', prepOk, `class ${classCode} (${classId}) on course ${course.code}: create 201, teacher ${got(teachers, 200)}, open ${got(opened, 200)}, enroll ${got(enrolled, 201)}, start ${got(started, 200)}`);
  if (!prepOk) throw new Stop();

  // 2. The teacher gives a lesson that started two hours ago: the student present, the lesson completed.
  const lesson = await call('POST', `/api/classes/${classId}/lessons`, tokens.teacher, { title: { ar: 'درس قبول MOD-13', en: 'MOD-13 acceptance lesson' }, startsAt: ago(120), endsAt: ago(60) });
  const sheet = lesson.status === 201 ? await call('PUT', `/api/lessons/${lesson.body.id}/attendance`, tokens.teacher, { records: [{ studentId, status: 'present' }] }) : { status: 0 };
  const completed = lesson.status === 201 ? await call('POST', `/api/lessons/${lesson.body.id}/status`, tokens.teacher, { action: 'complete' }) : { status: 0 };
  record('2 lesson + attendance', lesson.status === 201 && sheet.status === 200 && completed.status === 200, `lesson ${got(lesson, 201)}, attendance ${got(sheet, 200)}, complete ${got(completed, 200)}`);

  // 3. An assignment: published, submitted by the student, graded 8/10, closed.
  const assignment = await call('POST', `/api/classes/${classId}/assignments`, tokens.teacher, { title: { ar: 'واجب قبول MOD-13', en: 'MOD-13 acceptance assignment' }, maxScore: 10, weight: 50 });
  const publishedA = assignment.status === 201 ? await call('POST', `/api/assignments/${assignment.body.id}/status`, tokens.teacher, { action: 'publish' }) : { status: 0 };
  const submitted = publishedA.status === 200 ? await call('POST', `/api/assignments/${assignment.body.id}/submissions`, tokens.student, { textAnswer: 'إجابة القبول', attemptNo: 1 }) : { status: 0 };
  const graded = submitted.status === 201 ? await call('POST', `/api/submissions/${submitted.body.id}/review`, tokens.teacher, { action: 'grade', score: 8, expectedGradedAt: null }) : { status: 0 };
  const closed = graded.status === 200 ? await call('POST', `/api/assignments/${assignment.body.id}/status`, tokens.teacher, { action: 'close' }) : { status: 0 };
  record('3 assignment', assignment.status === 201 && submitted.status === 201 && graded.status === 200 && closed.status === 200, `create ${got(assignment, 201)}, publish ${got(publishedA, 200)}, submit ${got(submitted, 201)}, grade 8/10 ${got(graded, 200)}, close ${got(closed, 200)}`);

  // 4. An exam: scheduled an hour ago, the student scored 16/20 (pass score 10), published.
  const exam = await call('POST', `/api/classes/${classId}/exams`, tokens.teacher, { title: { ar: 'اختبار قبول MOD-13', en: 'MOD-13 acceptance exam' }, type: 'quiz', maxScore: 20, passScore: 10, weight: 50, scheduledAt: ago(60) });
  const scheduled = exam.status === 201 ? await call('POST', `/api/exams/${exam.body.id}/status`, tokens.teacher, { action: 'schedule' }) : { status: 0 };
  const sheetE = scheduled.status === 200 ? await call('PUT', `/api/exams/${exam.body.id}/results`, tokens.teacher, { results: [{ studentId, status: 'scored', score: 16 }] }) : { status: 0 };
  const publishedE = sheetE.status === 200 ? await call('POST', `/api/exams/${exam.body.id}/status`, tokens.teacher, { action: 'publish' }) : { status: 0 };
  record('4 exam', exam.status === 201 && sheetE.status === 200 && publishedE.status === 200, `create ${got(exam, 201)}, schedule ${got(scheduled, 200)}, results 16/20 ${got(sheetE, 200)}, publish ${got(publishedE, 200)}`);

  // 5. The teacher finalizes the class on the academy's default grade scheme (8/10 and 16/20, equal weights = 80 %).
  const finalized = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const mine = finalized.body?.rows?.find?.((row) => row.student?.id === studentId) ?? finalized.body?.students?.find?.((row) => row.student?.id === studentId) ?? null;
  record(
    '5 final grade',
    finalized.status === 200,
    `POST /api/classes/:id/final-grades ${got(finalized, 200)}${finalized.body?.code === 'grade_scheme_missing' ? ' — the academy has no default grade scheme: run "npm run prisma:seed" once in backend/ and rerun' : ''}${mine ? ` (the student’s row found)` : ''}`,
  );

  // 6. Finance: a fee plan of 600 due today, the class invoiced and issued, 400 paid in cash.
  const plan = await call('POST', '/api/fee-plans', tokens.admin, { name: { ar: `خطة قبول MOD-13 ${stampCode}`, en: `MOD-13 acceptance plan ${stampCode}` }, classId, lines: [{ description: { ar: 'رسوم الدورة', en: 'Course fee' }, amount: 600 }], installments: [{ percent: 100, dueOffsetDays: 0 }] });
  const batch = plan.status === 201 ? await call('POST', `/api/classes/${classId}/invoices`, tokens.admin, { feePlanId: plan.body.id, issue: true }) : { status: 0 };
  const invoice = batch.body?.created?.[0] ?? null;
  const pay = invoice ? await call('POST', `/api/invoices/${invoice.id}/payments`, tokens.admin, { amount: 400, method: 'cash' }) : { status: 0 };
  record('6 finance', plan.status === 201 && invoice?.status === 'issued' && pay.status === 201, `plan ${got(plan, 201)}, invoice ${invoice?.number ?? 'none'} ${invoice?.total ?? ''} ${invoice?.currency ?? ''}, payment 400 ${got(pay, 201)} receipt=${pay.body?.number ?? 'none'}`);
  if (!invoice || pay.status !== 201) throw new Stop();

  // 7. Attendance reports (API-156/157) for the class, the default period (the last 30 days).
  const byClass = await call('GET', `/api/reports/attendance/classes?classId=${classId}`, tokens.admin);
  const classRow = byClass.body?.rows?.[0];
  const byStudent = await call('GET', `/api/reports/attendance/students?classId=${classId}`, tokens.admin);
  const studentRow = byStudent.body?.rows?.[0];
  record(
    '7 attendance reports',
    byClass.status === 200 && classRow?.lessons === 1 && classRow?.completedLessons === 1 && classRow?.records?.present === 1 && classRow?.attendanceRate === 100 && byStudent.status === 200 && studentRow?.student?.id === studentId && studentRow?.absenceRate === 0 && !('email' in (studentRow?.student ?? {})),
    `by class ${got(byClass, 200)} lessons=${classRow?.lessons} completed=${classRow?.completedLessons} present=${classRow?.records?.present} rate=${classRow?.attendanceRate} (period ${byClass.body?.period?.from}..${byClass.body?.period?.to} ${byClass.body?.timeZone}); by student ${got(byStudent, 200)} absenceRate=${studentRow?.absenceRate} contact fields ${'email' in (studentRow?.student ?? {}) ? 'VISIBLE!' : 'absent'}`,
  );

  // 8. Academic reports (API-158..160).
  const perf = await call('GET', `/api/reports/academic/classes?classId=${classId}`, tokens.admin);
  const perfRow = perf.body?.rows?.[0];
  const subs = await call('GET', `/api/reports/academic/assignments?classId=${classId}`, tokens.admin);
  const subRow = subs.body?.rows?.[0];
  const exams = await call('GET', `/api/reports/academic/exams?classId=${classId}`, tokens.admin);
  const examRow = exams.body?.rows?.[0];
  record(
    '8 academic reports',
    perf.status === 200 && perfRow?.finalGrades === 1 && perfRow?.averagePercent === 80 && subs.status === 200 && subRow?.submitted === 1 && subRow?.graded === 1 && subRow?.averagePercent === 80 && exams.status === 200 && examRow?.scored === 1 && examRow?.averagePercent === 80 && examRow?.passRate === 100,
    `performance ${got(perf, 200)} finalGrades=${perfRow?.finalGrades} average=${perfRow?.averagePercent} band=${perfRow?.bands?.[0]?.letter ?? perfRow?.bands?.[0]?.label?.en ?? '-'}; assignments ${got(subs, 200)} submitted=${subRow?.submitted} graded=${subRow?.graded} average=${subRow?.averagePercent}; exams ${got(exams, 200)} scored=${examRow?.scored} average=${examRow?.averagePercent} passRate=${examRow?.passRate}`,
  );

  // 9. Financial reports (API-161..163).
  const collections = await call('GET', `/api/reports/financial/collections?classId=${classId}`, tokens.admin);
  const cash = (collections.body?.rows ?? []).find((row) => row.method === 'cash');
  const receivables = await call('GET', `/api/reports/financial/receivables?classId=${classId}`, tokens.admin);
  const owed = (receivables.body?.rows ?? []).find((row) => row.student?.id === studentId);
  const revenue = await call('GET', `/api/reports/financial/revenue?courseId=${course.id}`, tokens.admin);
  const month = (revenue.body?.rows ?? []).find((row) => row.course?.id === course.id && row.currency === invoice.currency && row.month === new Date().toISOString().slice(0, 7));
  record(
    '9 financial reports',
    collections.status === 200 && cash?.amount === 400 && receivables.status === 200 && owed?.balance === 200 && revenue.status === 200 && (month?.invoiced ?? 0) >= 600 && (month?.collected ?? 0) >= 400,
    `collections ${got(collections, 200)} cash=${cash?.amount}; receivables ${got(receivables, 200)} balance=${owed?.balance} overdue=${owed?.overdue} (as of ${receivables.body?.asOf}); revenue ${got(revenue, 200)} this month on ${course.code}: invoiced=${month?.invoiced} collected=${month?.collected}`,
  );

  // 10. The dashboard overview: every section for the admin.
  const overview = await call('GET', '/api/reports/overview', tokens.admin);
  const o = overview.body ?? {};
  record(
    '10 overview',
    overview.status === 200 && o.general?.activeStudents >= 1 && o.attendance != null && o.academic != null && o.financial != null,
    `GET /api/reports/overview ${got(overview, 200)} activeStudents=${o.general?.activeStudents} runningClasses=${o.general?.runningClasses} attendanceRate=${o.attendance?.attendanceRate} finalGrades=${o.academic?.finalGrades} collected=${(o.financial?.collected ?? []).map((c) => `${c.amount} ${c.currency}`).join(', ') || '-'}`,
  );

  // 11. Who reads: the teacher and the student hold no report key.
  const teacherOverview = await call('GET', '/api/reports/overview', tokens.teacher);
  const teacherAttendance = await call('GET', '/api/reports/attendance/classes', tokens.teacher);
  const studentOverview = await call('GET', '/api/reports/overview', tokens.student);
  record(
    '11 permissions',
    teacherOverview.status === 403 && teacherOverview.body?.code === 'permission_denied' && teacherAttendance.status === 403 && studentOverview.status === 403,
    `teacher overview ${teacherOverview.status} missing=${(teacherOverview.body?.missing ?? []).join(',')}; teacher attendance report ${teacherAttendance.status}; student overview ${studentOverview.status}`,
  );

  // 12. Reading a report records no audit event (D-R73).
  const reportEvents = await call('GET', '/api/audit-logs?action=reports&limit=5', tokens.admin);
  record('12 no audit for reads', reportEvents.status === 200 && (reportEvents.body?.items ?? []).length === 0, `GET /api/audit-logs?action=reports ${got(reportEvents, 200)} events=${(reportEvents.body?.items ?? []).length}`);

  record('13 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${classCode} (${classId}) on course ${course.code}; lesson ${lesson.body?.id ?? '-'}; assignment ${assignment.body?.id ?? '-'}; exam ${exam.body?.id ?? '-'}; invoice ${invoice.number} (400 of ${invoice.total} paid, receipt ${pay.body.number}). The rows stay in the dev database on purpose.`);
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
