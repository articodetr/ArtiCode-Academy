// MOD-06 acceptance journey (roadmap 4f.9) — run by the owner through accept-mod06.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student, guardian? }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
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
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD06 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

// Dev-only tooling: the journey writes rows (classes, lessons, attendance) and signs in with real passwords,
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
    const why = error?.cause?.code ?? error?.message ?? 'network error';
    record('readiness', false, `cannot reach ${baseUrl} (${why}) — start the API first: in backend/ run "npm run start:dev", wait until it listens on :3000, then run this script again`);
    throw new Stop();
  }
  if (ready.status !== 200) {
    record('readiness', false, `GET /api/health/ready -> HTTP ${ready.status} (is the dev server running on ${baseUrl}?)`);
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

  // 1. The manager prepares the class: a published course with a syllabus, the class, the lead teacher, open, the enrollment.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = (courses.body?.items ?? []).find((c) => (c.syllabusCount ?? 0) > 0) ?? null;
  let syllabusItemId = null;
  for (const candidate of course ? [course] : courses.body?.items ?? []) {
    const syllabus = await call('GET', `/api/courses/${candidate.id}/syllabus`, tokens.admin);
    if (syllabus.status === 200 && syllabus.body.items?.length > 0) {
      course = candidate;
      syllabusItemId = syllabus.body.items[0].id;
      break;
    }
  }
  const now = new Date();
  if (!course || !syllabusItemId) {
    // No published course with a syllabus: the admin creates one through the API (WF-05) — create, syllabus, publish.
    const courseCode = `ACC-MOD06-CRS-${now.toISOString().slice(0, 16).replace(/[-T:]/g, '')}`;
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: courseCode, name: { ar: 'دورة قبول MOD-06', en: 'MOD-06 acceptance course' } });
    if (createdCourse.status !== 201) {
      record('0 course', false, `POST /api/courses -> HTTP ${createdCourse.status} ${createdCourse.body?.code ?? ''}`);
      throw new Stop();
    }
    const syllabus = await call('PUT', `/api/courses/${createdCourse.body.id}/syllabus`, tokens.admin, {
      items: [{ title: { ar: 'المقدمة', en: 'Introduction' } }, { title: { ar: 'التطبيق', en: 'Practice' }, estimatedMinutes: 45 }],
    });
    const published = await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' });
    const courseOk = syllabus.status === 200 && syllabus.body?.items?.length === 2 && published.status === 200 && published.body?.status === 'published';
    record('0 course (created — no published course had a syllabus)', courseOk, `course ${courseCode}: create 201, syllabus ${syllabus.status} (${syllabus.body?.items?.length ?? '?'} items), publish ${published.status} (${published.body?.status})`);
    if (!courseOk) throw new Stop();
    course = { id: createdCourse.body.id, code: createdCourse.body.code ?? courseCode };
    syllabusItemId = syllabus.body.items[0].id;
  } else {
    record('0 course', true, `using the published course ${course.code} (first syllabus item ${syllabusItemId})`);
  }
  const code = `ACC-MOD06-${now.toISOString().slice(0, 16).replace(/[-T:]/g, '')}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code, name: { ar: 'فصل قبول MOD-06', en: 'MOD-06 acceptance class' }, capacity: 5 });
  if (klass.status !== 201) {
    record('1 preparation', false, `POST /api/classes -> HTTP ${klass.status} ${klass.body?.code ?? ''}`);
    throw new Stop();
  }
  const classId = klass.body.id;
  const teachers = await call('PUT', `/api/classes/${classId}/teachers`, tokens.admin, { teachers: [{ userId: teacherId, role: 'lead' }] });
  const opened = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'open' });
  const enrolled = await call('POST', `/api/classes/${classId}/enrollments`, tokens.admin, { studentId });
  const prepOk = teachers.status === 200 && opened.status === 200 && enrolled.status === 201;
  record('1 preparation', prepOk, `class ${code} (${classId}) on course ${course.code}: create 201, teachers ${teachers.status}, open ${opened.status} (${opened.body?.status}), enroll ${enrolled.status} (${enrolled.body?.status})`);
  if (!prepOk) throw new Stop();

  // 2. The teacher creates a lesson that started two hours ago, bound to the syllabus item.
  const l1Start = new Date(now.getTime() - 2 * HOUR).toISOString();
  const l1End = new Date(now.getTime() - 1 * HOUR).toISOString();
  const l1 = await call('POST', `/api/classes/${classId}/lessons`, tokens.teacher, { title: { ar: 'درس القبول الأول', en: 'Acceptance lesson one' }, startsAt: l1Start, endsAt: l1End, syllabusItemId });
  const l1Ok = l1.status === 201 && l1.body.teacher?.userId === teacherId && l1.body.syllabusItem?.id === syllabusItemId && l1.body.status === 'scheduled' && l1.body.attendance?.recorded === 0;
  record('2 lesson one (started 2h ago)', l1Ok, `HTTP ${l1.status}; teacher=${l1.body?.teacher?.userId === teacherId ? 'the lead teacher (snapshot)' : l1.body?.teacher?.userId}; syllabusItem.sortOrder=${l1.body?.syllabusItem?.sortOrder}; status=${l1.body?.status}; attendance.recorded=${l1.body?.attendance?.recorded}`);
  if (l1.status !== 201) throw new Stop();
  const lesson1 = l1.body.id;

  // 3. A second lesson tomorrow, cancelled with a reason.
  const l2 = await call('POST', `/api/classes/${classId}/lessons`, tokens.teacher, {
    title: { ar: 'درس القبول الثاني', en: 'Acceptance lesson two' },
    startsAt: new Date(now.getTime() + 24 * HOUR).toISOString(),
    endsAt: new Date(now.getTime() + 25 * HOUR).toISOString(),
  });
  const lesson2 = l2.body?.id;
  const reason = 'Acceptance journey - test cancellation';
  const cancelled = l2.status === 201 ? await call('POST', `/api/lessons/${lesson2}/status`, tokens.teacher, { action: 'cancel', reason }) : { status: 0, body: null };
  record('3 lesson two + cancel', l2.status === 201 && cancelled.status === 200 && cancelled.body?.status === 'cancelled' && cancelled.body?.cancellationReason === reason, `create ${l2.status}; cancel ${cancelled.status} status=${cancelled.body?.status} cancellationReason=${cancelled.body?.cancellationReason ? 'present' : 'missing'}`);

  // 4. Attendance of the cancelled lesson is closed.
  const closed = lesson2 ? await call('PUT', `/api/lessons/${lesson2}/attendance`, tokens.teacher, { records: [{ studentId, status: 'present' }] }) : { status: 0, body: null };
  record('4 attendance on cancelled lesson', closed.status === 409 && closed.body?.code === 'attendance_closed' && closed.body?.reason === 'cancelled', `HTTP ${closed.status} ${closed.body?.code ?? ''} reason=${closed.body?.reason ?? ''}`);

  // 5. The sheet, one late record, then the identical batch again.
  const sheet = await call('GET', `/api/lessons/${lesson1}/attendance`, tokens.teacher);
  const row = (sheet.body?.items ?? []).find((item) => item.student?.id === studentId);
  const records = [{ studentId, status: 'late', minutesLate: 10, note: 'Acceptance note - arrived after the start' }];
  const put1 = await call('PUT', `/api/lessons/${lesson1}/attendance`, tokens.teacher, { records });
  const put2 = await call('PUT', `/api/lessons/${lesson1}/attendance`, tokens.teacher, { records });
  const sheetOk = sheet.status === 200 && sheet.body.recordable === true && row && row.record === null && row.student.email === null;
  const putOk = put1.status === 200 && put1.body?.counts?.recorded === 1 && put1.body?.counts?.late === 1 && typeof put1.body?.attendanceTakenAt === 'string' && put2.status === 200 && put2.body?.attendanceTakenAt === put1.body?.attendanceTakenAt;
  record('5 sheet + batch + identical batch', Boolean(sheetOk && putOk), `sheet ${sheet.status} recordable=${sheet.body?.recordable} student=${row ? 'listed' : 'missing'} record=${row?.record === null ? 'null' : 'present'} email=${row?.student?.email === null ? 'null (D-R07)' : 'VISIBLE'}; PUT ${put1.status} counts=${JSON.stringify(put1.body?.counts ?? null)} attendanceTakenAt=${put1.body?.attendanceTakenAt ? stamp(put1.body.attendanceTakenAt) : 'null'}; identical batch ${put2.status} attendanceTakenAt ${put2.body?.attendanceTakenAt === put1.body?.attendanceTakenAt ? 'unchanged' : 'CHANGED'}`);

  // 6. The student's own lessons and attendance.
  const mine = await call('GET', `/api/me/lessons?classId=${classId}`, tokens.student);
  const items = mine.body?.items ?? [];
  const first = items.find((item) => item.id === lesson1);
  const second = items.find((item) => item.id === lesson2);
  const mineOk =
    mine.status === 200 &&
    items.length === 2 &&
    items[0]?.id === lesson1 &&
    first?.relation === 'self' &&
    first?.attendance?.status === 'late' &&
    first?.attendance?.minutesLate === 10 &&
    second?.status === 'cancelled' &&
    second?.attendance === null &&
    !('note' in (first?.attendance ?? {})) &&
    !('recordedBy' in (first?.attendance ?? {})) &&
    !('cancellationReason' in (second ?? {})) &&
    !('userId' in (first?.teacher ?? {}));
  record('6 student "my lessons"', mineOk, `HTTP ${mine.status}; ${items.length} items; first: relation=${first?.relation} attendance=${JSON.stringify(first?.attendance ?? null)}; second: status=${second?.status} attendance=${JSON.stringify(second?.attendance ?? 'missing')}; hidden fields: note=${first?.attendance && 'note' in first.attendance ? 'VISIBLE!' : 'hidden'} cancellationReason=${second && 'cancellationReason' in second ? 'VISIBLE!' : 'hidden'} teacher.userId=${first?.teacher && 'userId' in first.teacher ? 'VISIBLE!' : 'hidden'}`);

  // 7. The seeded lessons.read of a student opens nothing.
  const list = await call('GET', `/api/lessons?classId=${classId}`, tokens.student);
  const one = await call('GET', `/api/lessons/${lesson1}`, tokens.student);
  record('7 student limits', list.status === 200 && Array.isArray(list.body?.items) && list.body.items.length === 0 && one.status === 404 && one.body?.code === 'lesson_not_found', `GET /api/lessons ${list.status} (${list.body?.items?.length ?? '?'} items); GET /api/lessons/:id ${one.status} ${one.body?.code ?? ''}`);

  // 8. The guardian (optional): the child's lessons, no sheet.
  if (tokens.guardian) {
    const child = await call('GET', `/api/me/lessons?studentId=${studentId}`, tokens.guardian);
    const childItems = child.body?.items ?? [];
    const sheetG = await call('GET', `/api/lessons/${lesson1}/attendance`, tokens.guardian);
    const childOk = child.status === 200 && childItems.length === 2 && childItems.every((item) => item.relation === 'child' && item.student?.id === studentId) && childItems[0]?.attendance?.status === 'late' && sheetG.status === 404;
    record('8 guardian', childOk, `HTTP ${child.status}; ${childItems.length} items (relation=${childItems[0]?.relation ?? '-'}, attendance=${childItems[0]?.attendance?.status ?? '-'})${childItems.length === 0 ? ' — link the guardian to the student (POST /api/users/:studentId/guardians) and rerun' : ''}; sheet ${sheetG.status} ${sheetG.body?.code ?? ''}`);
  } else {
    record('8 guardian', null, 'skipped — no guardian account given (create one, link it to the student, rerun with its password)');
  }

  // 9. The teacher's events in the audit log, newest first.
  const log = await call('GET', `/api/audit-logs?actorUserId=${teacherId}&limit=20`, tokens.admin);
  const events = (log.body?.items ?? []).filter((item) => !item.action.startsWith('auth.')).slice(0, 4);
  const expected = ['attendance.recorded', 'lessons.status.changed', 'lessons.created', 'lessons.created'];
  const logOk = log.status === 200 && events.map((e) => e.action).join(',') === expected.join(',');
  record('9 audit log (teacher)', logOk, `HTTP ${log.status}; ${events.map((e) => `${e.action} @ ${stamp(e.createdAt)}`).join(' <- ') || 'no events'} (UTC+03:00)`);

  record('10 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${code} (${classId}); lesson one ${lesson1}; lesson two ${lesson2 ?? '-'}; course ${course.code}. The rows stay in the dev database on purpose.`);
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
