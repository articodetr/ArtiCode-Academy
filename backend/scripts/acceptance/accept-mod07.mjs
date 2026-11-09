// MOD-07 acceptance journey (roadmap 4e.9) — run by the owner through accept-mod07.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
// Evidence rows: classes and a course coded `ACC-MOD07-…`; the branch and the two rooms are coded `A7BR-`, `A7RB-`,
// `A7RS-` + `yyMMddHHmm`, because branch and room codes take 16 characters at most (LEVEL_CODE_PATTERN).
class Stop extends Error {}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const input = JSON.parse(raw);
const baseUrl = (input.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const DAY_MS = 86_400_000;
const BRANCH_ZONE = 'Europe/Berlin';
const results = [];
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Etc/GMT-3', hour12: false });
/** The server's reason for a refusal: the stable `code` and the validation message(s), for FAIL lines. */
const why = (r) => [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD07 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

// Local calendar helpers (UTC-midnight arithmetic on YYYY-MM-DD strings).
const utcMidnight = (date) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date, days) => new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (date) => new Date(utcMidnight(date)).getUTCDay();
const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

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
    record('readiness', false, `cannot reach ${baseUrl} (${error?.cause?.code ?? error?.message ?? 'network error'}) — start the API first: in backend/ run "npm run start:dev", wait until it listens on :3000, then run this script again`);
    throw new Stop();
  }
  if (ready.status !== 200) {
    record('readiness', false, `GET /api/health/ready -> HTTP ${ready.status}`);
    throw new Stop();
  }
  record('readiness', true, `GET /api/health/ready -> 200 (${baseUrl})`);

  const tokens = { admin: await login('ADMIN', input.admin), teacher: await login('TEACHER', input.teacher), student: await login('STUDENT', input.student) };
  const teacherId = await userIdOf(tokens.admin, input.teacher, 'TEACHER');
  const studentId = await userIdOf(tokens.admin, input.student, 'STUDENT');
  record('logins', true, 'three accounts signed in; user ids resolved');

  const academy = await call('GET', '/api/academy', tokens.admin);
  const academyZone = academy.body?.timezone ?? 'UTC';
  // yyMMddHHmm — short enough for the 16-character branch/room codes below.
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');

  // 1. A branch in a daylight-saving zone, a room in it and a room at the site; the teacher reads the room list.
  const branch = await call('POST', '/api/branches', tokens.admin, { code: `A7BR-${stampCode}`, name: { ar: 'فرع قبول MOD-07', en: 'MOD-07 acceptance branch' }, timezone: BRANCH_ZONE });
  const branchId = branch.status === 201 ? branch.body.id : null;
  const roomBranch = await call('POST', '/api/rooms', tokens.admin, { code: `A7RB-${stampCode}`, name: { ar: 'قاعة برلين' }, ...(branchId ? { branchId } : {}) });
  const roomSite = await call('POST', '/api/rooms', tokens.admin, { code: `A7RS-${stampCode}`, name: { ar: 'قاعة المقر' } });
  const roomList = await call('GET', '/api/rooms', tokens.teacher);
  const listed = (roomList.body?.items ?? []).map((r) => r.id);
  const roomsOk = roomBranch.status === 201 && roomSite.status === 201 && roomList.status === 200 && listed.includes(roomBranch.body?.id) && listed.includes(roomSite.body?.id);
  record('1 branch + rooms', roomsOk, `branch ${branch.status}${branchId ? ` (${BRANCH_ZONE})` : ` (${why(branch)}) — rooms without a branch`}; rooms ${roomBranch.status}/${roomSite.status}${roomBranch.status === 201 && roomSite.status === 201 ? '' : ` (${why(roomBranch)} / ${why(roomSite)})`}; GET /api/rooms ${roomList.status} lists both=${listed.includes(roomBranch.body?.id) && listed.includes(roomSite.body?.id)}`);
  if (!roomsOk) throw new Stop();
  const roomZone = branchId ? BRANCH_ZONE : academyZone;

  // 2. A published course (first one, or a new acceptance course) and class A with the teacher and the student.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD07-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-07', en: 'MOD-07 acceptance course' } });
    const published = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (published.status !== 200) {
      record('2 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${published.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  const classCode = `ACC-MOD07-${stampCode}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: { ar: 'فصل قبول MOD-07', en: 'MOD-07 acceptance class' }, capacity: 5 });
  if (klass.status !== 201) {
    record('2 preparation', false, `POST /api/classes -> HTTP ${klass.status} ${why(klass)}`);
    throw new Stop();
  }
  const classId = klass.body.id;
  const teachers = await call('PUT', `/api/classes/${classId}/teachers`, tokens.admin, { teachers: [{ userId: teacherId, role: 'lead' }] });
  const opened = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'open' });
  const enrolled = await call('POST', `/api/classes/${classId}/enrollments`, tokens.admin, { studentId });
  const prepOk = teachers.status === 200 && opened.status === 200 && enrolled.status === 201;
  record('2 preparation', prepOk, `class ${classCode} (${classId}) on course ${course.code}: create 201, teachers ${teachers.status}${teachers.status === 200 ? '' : ` (${why(teachers)})`}, open ${opened.status}${opened.status === 200 ? '' : ` (${why(opened)})`}, enroll ${enrolled.status}${enrolled.status === 201 ? '' : ` (${why(enrolled)})`}`);
  if (!prepOk) throw new Stop();

  // 3. The weekly schedule: two slots on the first two working days (else Sunday and Tuesday).
  const settings = academy.body?.settings?.scheduling?.workingDays ?? null;
  const allowed = Array.isArray(settings) && settings.length > 0 ? settings : [0, 1, 2, 3, 4, 5, 6];
  const weekdayA = allowed.includes(0) && allowed.includes(2) ? 0 : allowed[0];
  const weekdayB = allowed.includes(0) && allowed.includes(2) ? 2 : (allowed[1] ?? allowed[0]);
  const saved = await call('PUT', `/api/classes/${classId}/schedule`, tokens.admin, {
    slots: [
      { weekday: weekdayA, startTime: '10:00', endTime: '11:00', roomId: roomBranch.body.id, teacherUserId: teacherId, effectiveFrom: '2026-01-01' },
      { weekday: weekdayB, startTime: '12:00', endTime: '13:00', roomId: roomSite.body.id, effectiveFrom: '2026-01-01' },
    ],
  });
  const slots = saved.body?.slots ?? [];
  const slotA = slots.find((s) => s.startTime === '10:00');
  const slotB = slots.find((s) => s.startTime === '12:00');
  const readByTeacher = await call('GET', `/api/classes/${classId}/schedule`, tokens.teacher);
  const readByStudent = await call('GET', `/api/classes/${classId}/schedule`, tokens.student);
  record('3 weekly schedule', saved.status === 200 && slots.length === 2 && Boolean(slotA && slotB) && readByTeacher.status === 200 && readByStudent.status === 403, `PUT ${saved.status}${saved.status === 200 ? '' : ` (${why(saved)})`} (${slots.length} slots, weekdays ${weekdayA}/${weekdayB}); teacher GET ${readByTeacher.status}; student GET ${readByStudent.status} (expected 403)`);
  if (saved.status !== 200) throw new Stop();

  // 4. Another class cannot book the branch room at an overlapping time; an adjacent slot is fine.
  const other = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: `${classCode}-B`, name: { ar: 'فصل قبول آخر' }, capacity: 5 });
  const otherId = other.body?.id;
  await call('PUT', `/api/classes/${otherId}/teachers`, tokens.admin, { teachers: [{ userId: teacherId, role: 'lead' }] });
  const clash = await call('PUT', `/api/classes/${otherId}/schedule`, tokens.admin, { slots: [{ weekday: weekdayA, startTime: '10:30', endTime: '11:30', roomId: roomBranch.body.id, effectiveFrom: '2026-01-01' }] });
  const adjacent = await call('PUT', `/api/classes/${otherId}/schedule`, tokens.admin, { slots: [{ weekday: weekdayA, startTime: '11:00', endTime: '12:00', roomId: roomBranch.body.id, effectiveFrom: '2026-01-01' }] });
  record('4 double booking refused / adjacent accepted', clash.status === 409 && clash.body?.code === 'schedule_conflict' && clash.body?.kind === 'room' && clash.body?.conflictingSlotId === slotA?.id && clash.body?.conflictingClassId === classId && adjacent.status === 200, `clash ${clash.status} ${clash.body?.code ?? ''} kind=${clash.body?.kind} conflictingSlotId=${clash.body?.conflictingSlotId === slotA?.id ? 'slot A' : clash.body?.conflictingSlotId} conflictingClass=${clash.body?.conflictingClassId === classId ? 'class A' : clash.body?.conflictingClassId}; adjacent ${adjacent.status}`);

  // 5. Readings: the academy timetable of class A; "my schedule" of the student and the teacher.
  const timetable = await call('GET', `/api/schedule?classId=${classId}`, tokens.admin);
  const tt = timetable.body?.slots ?? [];
  const zoneA = tt.find((s) => s.id === slotA?.id)?.timeZone;
  const zoneB = tt.find((s) => s.id === slotB?.id)?.timeZone;
  const mineStudent = await call('GET', '/api/me/schedule', tokens.student);
  const mineTeacher = await call('GET', '/api/me/schedule', tokens.teacher);
  const studentItems = (mineStudent.body?.items ?? []).filter((i) => i.class?.id === classId);
  const teacherItems = (mineTeacher.body?.items ?? []).filter((i) => i.class?.id === classId);
  record('5 timetable readings', timetable.status === 200 && tt.length === 2 && zoneA === roomZone && zoneB === academyZone && studentItems.length === 2 && studentItems.every((i) => i.relation === 'self') && teacherItems.length === 2 && teacherItems.every((i) => i.relation === 'teacher'), `GET /api/schedule ${timetable.status} (${tt.length} slots; zones ${zoneA}/${zoneB}, expected ${roomZone}/${academyZone}); student ${mineStudent.status} ${studentItems.length} items (${[...new Set(studentItems.map((i) => i.relation))].join(',')}); teacher ${mineTeacher.status} ${teacherItems.length} items (${[...new Set(teacherItems.map((i) => i.relation))].join(',')})`);

  // 6. Generation for the last two weeks, then again.
  const today = todayIn(academyZone);
  const from = addDays(today, -14);
  const to = addDays(today, -1);
  let expected = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdayOf(d) === weekdayA || weekdayOf(d) === weekdayB) expected += weekdayA === weekdayB ? 2 : 1;
  const generated = await call('POST', `/api/classes/${classId}/schedule/generate`, tokens.admin, { from, to });
  const again = await call('POST', `/api/classes/${classId}/schedule/generate`, tokens.admin, { from, to });
  const lessons = generated.body?.lessons ?? [];
  const genOk = generated.status === 200 && generated.body?.created === expected && lessons.every((l) => l.teacher?.userId === teacherId && [slotA?.id, slotB?.id].includes(l.scheduleId)) && again.status === 200 && again.body?.created === 0 && again.body?.existing === expected;
  record('6 generation + repeat', genOk, `generate ${generated.status}${generated.status === 200 ? '' : ` (${why(generated)})`} created=${generated.body?.created} (expected ${expected}) existing=${generated.body?.existing} offDays=${generated.body?.offDays}; first lesson ${lessons[0] ? `${lessons[0].startsAt} (${stamp(lessons[0].startsAt)} UTC+03:00)` : '-'}; repeat ${again.status} created=${again.body?.created} existing=${again.body?.existing}`);
  if (!genOk || lessons.length === 0) throw new Stop();

  // 7. The teacher and the student see the generated lessons.
  const forTeacher = await call('GET', `/api/lessons?classId=${classId}&limit=100`, tokens.teacher);
  const forStudent = await call('GET', `/api/me/lessons?classId=${classId}&limit=100`, tokens.student);
  record('7 generated lessons visible', forTeacher.status === 200 && forTeacher.body?.items?.length === lessons.length && forStudent.status === 200 && forStudent.body?.items?.length === lessons.length && forStudent.body.items.every((i) => i.relation === 'self' && i.attendance === null), `teacher GET /api/lessons ${forTeacher.status} (${forTeacher.body?.items?.length ?? '?'} items); student GET /api/me/lessons ${forStudent.status} (${forStudent.body?.items?.length ?? '?'} items, attendance null=${forStudent.body?.items?.every((i) => i.attendance === null)})`);

  // 8. Attendance on the earliest generated lesson (it has started).
  const first = lessons[0];
  const sheet = await call('GET', `/api/lessons/${first.id}/attendance`, tokens.teacher);
  const put = await call('PUT', `/api/lessons/${first.id}/attendance`, tokens.teacher, { records: [{ studentId, status: 'present' }] });
  const seen = await call('GET', `/api/me/lessons?classId=${classId}&limit=100`, tokens.student);
  const seenFirst = (seen.body?.items ?? []).find((i) => i.id === first.id);
  record('8 attendance on a generated lesson', sheet.status === 200 && sheet.body?.recordable === true && put.status === 200 && put.body?.counts?.present === 1 && seenFirst?.attendance?.status === 'present', `sheet ${sheet.status} recordable=${sheet.body?.recordable}; PUT ${put.status} counts=${JSON.stringify(put.body?.counts ?? null)}; student sees attendance=${seenFirst?.attendance?.status ?? 'null'}`);

  // 9. The audit log of the admin: the newest events in order.
  const adminId = (await call('GET', '/api/auth/me', tokens.admin)).body?.user?.id ?? (await userIdOf(tokens.admin, input.admin, 'ADMIN'));
  const log = await call('GET', `/api/audit-logs?actorUserId=${adminId}&limit=20`, tokens.admin);
  const actions = (log.body?.items ?? []).filter((i) => !i.action.startsWith('auth.')).slice(0, 6).map((i) => `${i.action} @ ${stamp(i.createdAt)}`);
  record('9 audit log (admin)', log.status === 200 && actions[0]?.startsWith('lessons.created') && actions[1]?.startsWith('classes.schedule.changed'), `HTTP ${log.status}; ${actions.join(' <- ') || 'no events'} (UTC+03:00)`);

  record('10 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${classCode} (${classId}); other class ${otherId ?? '-'}; rooms ${roomBranch.body.id} / ${roomSite.body.id}; branch ${branchId ?? '-'}; ${lessons.length} generated lessons; course ${course.code}. The rows stay in the dev database on purpose.`);
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
