// MOD-10 acceptance journey (roadmap 4h.10.9) — run by the owner through accept-mod10.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student, guardian? }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
// Evidence rows: a class coded `ACC-MOD10-yyMMddHHmm` (and a course `ACC-MOD10-CRS-…` only when no course is
// published), its exam and result, the student's final grade on the academy's DEFAULT grade scheme, a revoked
// certificate and its issued replacement, and the audit events.
class Stop extends Error {}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let raw = Buffer.concat(chunks).toString('utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const input = JSON.parse(raw);
const baseUrl = (input.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const results = [];
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Etc/GMT-3', hour12: false });
/** The server's reason for a refusal: the stable `code` and the validation message(s), for FAIL lines. */
const why = (r) => [r.body?.code, Array.isArray(r.body?.message) ? r.body.message.join('; ') : r.body?.message].filter(Boolean).join(': ') || `HTTP ${r.status}`;
/** `HTTP <status>` plus the server's reason when the status is not the expected one. */
const got = (r, expected) => `${r.status}${r.status === expected ? '' : ` (${why(r)})`}`;
/** The band of a percentage: the highest lower bound at or below it (D-R46). */
const bandOf = (scheme, percent) => [...(scheme?.bands ?? [])].sort((a, b) => b.minPercent - a.minPercent).find((band) => band.minPercent <= percent) ?? null;
const serialNumber = (serial) => Number(String(serial ?? '').split('-').pop());
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD10 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

// Dev-only tooling: the journey writes rows (a class, an exam, a final grade, certificates) and signs in with real
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
  const adminId = await userIdOf(tokens.admin, input.admin, 'ADMIN');
  record('logins', true, `${tokens.guardian ? 'four' : 'three'} accounts signed in${tokens.guardian ? '' : ' (guardian skipped)'}; user ids resolved`);

  // The academy's default grade scheme — the finalization uses it (MOD-09, accepted in CH-0173).
  const schemes = await call('GET', '/api/grade-schemes', tokens.teacher);
  const scheme = (schemes.body?.items ?? []).find((item) => item.isDefault) ?? null;
  if (schemes.status !== 200 || !scheme) {
    record('0 default grade scheme', false, `GET /api/grade-schemes -> ${got(schemes, 200)}; ${scheme ? '' : 'no default scheme — run "npm run prisma:seed" in backend/ once, then rerun'}`);
    throw new Stop();
  }
  const band = bandOf(scheme, 90);
  record('0 default grade scheme', band?.isPass === true, `"${scheme.name?.ar}" — 90% falls in ${band ? `${band.label?.ar}${band.letter ? ` ${band.letter}` : ''} (${band.isPass ? 'pass' : 'FAIL — the journey needs a passing band at 90%'})` : 'no band'}`);
  if (band?.isPass !== true) throw new Stop();

  // yyMMddHHmm — the evidence suffix of the class (and of the course when one has to be created).
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');

  // 1. The admin prepares the class: a published course, the class, the lead teacher, open, the enrollment.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD10-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-10', en: 'MOD-10 acceptance course' } });
    const published = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (published.status !== 200) {
      record('1 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${published.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  const classCode = `ACC-MOD10-${stampCode}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: { ar: 'فصل قبول MOD-10', en: 'MOD-10 acceptance class' }, capacity: 5 });
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

  // 2. Real grades: the teacher's weighted exam (max 50, weight 100) scored 45 and published; the class runs; the teacher fixes the final grades (90%).
  const exam = await call('POST', `/api/classes/${classId}/exams`, tokens.teacher, { title: { ar: 'اختبار قبول MOD-10', en: 'MOD-10 acceptance exam' }, type: 'final', maxScore: 50, weight: 100 });
  const scheduled = exam.status === 201 ? await call('POST', `/api/exams/${exam.body.id}/status`, tokens.teacher, { action: 'schedule' }) : { status: 0 };
  const scored = exam.status === 201 ? await call('PUT', `/api/exams/${exam.body.id}/results`, tokens.teacher, { results: [{ studentId, status: 'scored', score: 45 }] }) : { status: 0 };
  const examPublished = exam.status === 201 ? await call('POST', `/api/exams/${exam.body.id}/status`, tokens.teacher, { action: 'publish' }) : { status: 0 };
  const started = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'start' });
  const fixed = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const fixedFinal = (fixed.body?.students ?? []).find((item) => item.student?.id === studentId)?.final ?? null;
  record(
    '2 real grades',
    exam.status === 201 && scheduled.status === 200 && scored.status === 200 && examPublished.status === 200 && started.status === 200 && fixed.status === 200 && fixedFinal?.percent === 90 && fixedFinal?.isPass === true,
    `exam ${got(exam, 201)}, schedule ${got(scheduled, 200)}, result ${got(scored, 200)}, publish ${got(examPublished, 200)}; start ${got(started, 200)}; finalize ${got(fixed, 200)} percent=${fixedFinal?.percent} band=${fixedFinal?.label?.ar ?? '?'} ${fixedFinal?.letter ?? ''}`,
  );
  if (fixed.status !== 200) throw new Stop();

  // 3. No certificate while the class runs; the admin completes it; the preview shows the student eligible.
  const tooEarly = await call('POST', `/api/classes/${classId}/certificates`, tokens.admin, {});
  const completed = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'complete' });
  const preview = await call('GET', `/api/classes/${classId}/certificates`, tokens.admin);
  const previewItem = (preview.body?.items ?? []).find((item) => item.student?.id === studentId);
  record(
    '3 completed class + preview',
    tooEarly.status === 409 && tooEarly.body?.code === 'class_not_completed' && completed.status === 200 && preview.status === 200 && preview.body?.issuable === 1 && previewItem?.reason === null,
    `issue on a running class ${tooEarly.status} ${tooEarly.body?.code ?? ''}; complete ${got(completed, 200)}; preview ${got(preview, 200)} issuable=${preview.body?.issuable} student reason=${previewItem ? JSON.stringify(previewItem.reason) : 'missing'}`,
  );
  if (completed.status !== 200) throw new Stop();

  // 4. The admin issues: one certificate with its serial PREFIX-YYYY-NNNNN and its verification code.
  const issued = await call('POST', `/api/classes/${classId}/certificates`, tokens.admin, {});
  const certificate = issued.body?.issued?.[0] ?? null;
  record(
    '4 issue',
    issued.status === 200 && issued.body?.issued?.length === 1 && /^[A-Z0-9]{2,10}-\d{4}-\d{5,}$/.test(certificate?.serial ?? '') && /^[A-Z2-7]{20}$/.test(certificate?.verificationCode ?? ''),
    `POST /api/classes/:id/certificates ${got(issued, 200)} issued=${issued.body?.issued?.length ?? '?'} serial=${certificate?.serial ?? 'none'} grade=${certificate ? `${certificate.grade?.percent} ${certificate.grade?.label?.ar}` : '-'} snapshot student=${certificate?.snapshot?.student?.fullName ?? '-'}`,
  );
  if (!certificate) throw new Stop();

  // 5. Anyone verifies it without signing in (typed in lower case) — no internal id, no revocation reason.
  const verified = await call('GET', `/api/certificates/verify/${encodeURIComponent(certificate.verificationCode.toLowerCase())}`, null);
  const verifyLeak = ['id', 'enrollmentId', 'verificationCode', 'revokeReason'].filter((key) => key in (verified.body ?? {}));
  const unknown = await call('GET', `/api/certificates/verify/${'A'.repeat(20)}`, null);
  record(
    '5 public verification',
    verified.status === 200 && verified.body?.serial === certificate.serial && verified.body?.status === 'issued' && verifyLeak.length === 0 && unknown.status === 404,
    `no token: ${got(verified, 200)} serial=${verified.body?.serial} status=${verified.body?.status} name=${verified.body?.student?.fullName} course=${verified.body?.course?.code} grade=${verified.body?.grade?.percent}; internal fields ${verifyLeak.length ? `VISIBLE: ${verifyLeak.join(', ')}` : 'hidden'}; unknown code ${unknown.status} ${unknown.body?.code ?? ''}`,
  );

  // 6. «My certificates»: the student sees it (self) without the issuer; the teacher holds neither key.
  const mine = await call('GET', `/api/me/certificates?classId=${classId}`, tokens.student);
  const mineItem = mine.body?.items?.[0];
  const teacherMine = await call('GET', '/api/me/certificates', tokens.teacher);
  record(
    '6 "my certificates"',
    mine.status === 200 && mineItem?.serial === certificate.serial && mineItem?.relation === 'self' && !('issuedBy' in (mineItem ?? {})) && teacherMine.status === 403,
    `student ${got(mine, 200)} ${mine.body?.items?.length ?? '?'} item: serial=${mineItem?.serial} relation=${mineItem?.relation} issuer ${'issuedBy' in (mineItem ?? {}) ? 'VISIBLE!' : 'hidden'}; teacher ${teacherMine.status} ${teacherMine.body?.code ?? ''}`,
  );

  // 7. The certified class's grades are locked (D-R54).
  const locked = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  record('7 grades locked', locked.status === 409 && locked.body?.code === 'grades_certified', `finalize again ${locked.status} ${locked.body?.code ?? ''} certificateCount=${locked.body?.certificateCount}`);

  // 8. The admin revokes it with a reason; the verification shows it revoked without the reason.
  const reason = 'Acceptance check - revoked and reissued';
  const revoked = await call('POST', `/api/certificates/${certificate.id}/revoke`, tokens.admin, { reason });
  const shown = await call('GET', `/api/certificates/verify/${certificate.verificationCode}`, null);
  record(
    '8 revoke',
    revoked.status === 200 && revoked.body?.status === 'revoked' && shown.body?.status === 'revoked' && !JSON.stringify(shown.body ?? '').includes(reason),
    `revoke ${got(revoked, 200)} status=${revoked.body?.status} revokedAt=${revoked.body?.revokedAt ? stamp(revoked.body.revokedAt) : 'null'} (UTC+03:00); verification status=${shown.body?.status} reason ${JSON.stringify(shown.body ?? '').includes(reason) ? 'VISIBLE!' : 'hidden'}`,
  );

  // 9. The guardian (optional): the child's certificates.
  if (tokens.guardian) {
    const child = await call('GET', `/api/me/certificates?studentId=${studentId}&classId=${classId}`, tokens.guardian);
    const childItem = (child.body?.items ?? [])[0];
    record('9 guardian', child.status === 200 && childItem?.relation === 'child' && childItem?.serial === certificate.serial, `HTTP ${child.status}; ${childItem ? `relation=${childItem.relation} serial=${childItem.serial} status=${childItem.status}` : 'missing — link the guardian to the student (POST /api/users/:studentId/guardians) and rerun'}`);
  } else {
    record('9 guardian', null, 'skipped — no guardian account given');
  }

  // 10. The grades unlock and a new certificate gets a new, higher serial — the evidence row stays.
  const unlocked = await call('POST', `/api/classes/${classId}/final-grades`, tokens.teacher, {});
  const again = await call('POST', `/api/classes/${classId}/certificates`, tokens.admin, {});
  const fresh = again.body?.issued?.[0] ?? null;
  record(
    '10 reissue',
    unlocked.status === 200 && again.status === 200 && fresh?.serial && fresh.serial !== certificate.serial && serialNumber(fresh.serial) > serialNumber(certificate.serial),
    `finalize ${got(unlocked, 200)}; issue ${got(again, 200)} new serial=${fresh?.serial ?? 'none'} (was ${certificate.serial})`,
  );

  // 11. The audit log: the admin's certificate events, newest first.
  const adminLog = await call('GET', `/api/audit-logs?actorUserId=${adminId}&action=certificates.&limit=10`, tokens.admin);
  const certEvents = (adminLog.body?.items ?? []).slice(0, 3);
  record(
    '11 audit log',
    adminLog.status === 200 && certEvents.map((e) => e.action).join(',') === 'certificates.issued,certificates.revoked,certificates.issued',
    `admin ${adminLog.status}: ${certEvents.map((e) => `${e.action} @ ${stamp(e.createdAt)}`).join(' <- ') || 'no events'} (UTC+03:00)`,
  );

  record('12 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${classCode} (${classId}); revoked certificate ${certificate.serial}; issued certificate ${fresh?.serial ?? '?'}; course ${course.code}. The rows stay in the dev database on purpose.`);
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
