// MOD-11 acceptance journey (roadmap 4i.9) — run by the owner through accept-mod11.ps1.
// Reads ONE JSON object from stdin: { baseUrl, admin: { identifier, password }, teacher, student, guardian? }
// and calls the real endpoints exactly as Swagger's "Authorize" + "Try it out" would.
// Never prints passwords or tokens. Never calls process.exit() after reading stdin (Windows libuv assertion).
// Evidence rows: a class coded `ACC-MOD11-yyMMddHHmm` (and a course `ACC-MOD11-CRS-…` only when no course is
// published), the student's enrollment, a fee plan for the class, the issued invoice with one completed and one
// reversed payment, and the audit events. The invoice and receipt numbers it takes stay taken.
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
const seqOf = (number) => Number(String(number ?? '').split('-').pop());
const FINANCE_EVENT = /^(fee_plans|invoices|payments)\./;
function record(step, ok, evidence) {
  results.push({ step, ok, evidence });
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'}  ${step}: ${evidence}`);
}

async function call(method, path, token, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'User-Agent': 'ACC-MOD11 owner journey', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
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

/** The student's invoice in «my invoices», or null. */
async function myInvoice(token, invoiceId) {
  const r = await call('GET', '/api/me/invoices', token);
  return { status: r.status, item: (r.body?.items ?? []).find((item) => item.id === invoiceId) ?? null, count: r.body?.items?.length };
}

// Dev-only tooling: the journey writes rows (a class, a fee plan, invoices, payments) and signs in with real
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
  const studentId = await userIdOf(tokens.admin, input.student, 'STUDENT');
  const adminId = await userIdOf(tokens.admin, input.admin, 'ADMIN');
  record('logins', true, `${tokens.guardian ? 'four' : 'three'} accounts signed in${tokens.guardian ? '' : ' (guardian skipped)'}; user ids resolved`);

  // yyMMddHHmm — the evidence suffix of the class (and of the course when one has to be created).
  const stampCode = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, '');

  // 1. The admin prepares a class with the student enrolled.
  const courses = await call('GET', '/api/courses?status=published&limit=100', tokens.admin);
  let course = courses.body?.items?.[0] ?? null;
  if (!course) {
    const createdCourse = await call('POST', '/api/courses', tokens.admin, { code: `ACC-MOD11-CRS-${stampCode}`, name: { ar: 'دورة قبول MOD-11', en: 'MOD-11 acceptance course' } });
    const published = createdCourse.status === 201 ? await call('POST', `/api/courses/${createdCourse.body.id}/status`, tokens.admin, { action: 'publish' }) : { status: 0 };
    if (published.status !== 200) {
      record('1 preparation', false, `no published course and creating one failed (${createdCourse.status} ${why(createdCourse)} / ${published.status})`);
      throw new Stop();
    }
    course = { id: createdCourse.body.id, code: createdCourse.body.code };
  }
  const classCode = `ACC-MOD11-${stampCode}`;
  const klass = await call('POST', '/api/classes', tokens.admin, { courseId: course.id, code: classCode, name: { ar: 'فصل قبول MOD-11', en: 'MOD-11 acceptance class' }, capacity: 5 });
  if (klass.status !== 201) {
    record('1 preparation', false, `POST /api/classes -> HTTP ${klass.status} ${why(klass)}`);
    throw new Stop();
  }
  const classId = klass.body.id;
  const opened = await call('POST', `/api/classes/${classId}/status`, tokens.admin, { action: 'open' });
  const enrolled = await call('POST', `/api/classes/${classId}/enrollments`, tokens.admin, { studentId });
  const prepOk = opened.status === 200 && enrolled.status === 201;
  record('1 preparation', prepOk, `class ${classCode} (${classId}) on course ${course.code}: create 201, open ${got(opened, 200)}, enroll ${got(enrolled, 201)}`);
  if (!prepOk) throw new Stop();

  // 2. A fee plan for the class: 1,200 in two halves — today and in 30 days (D-R60).
  const plan = await call('POST', '/api/fee-plans', tokens.admin, {
    name: { ar: `خطة قبول MOD-11 ${stampCode}`, en: `MOD-11 acceptance plan ${stampCode}` },
    classId,
    lines: [
      { description: { ar: 'رسوم الدورة', en: 'Course fee' }, amount: 1000 },
      { description: { ar: 'الكتب', en: 'Books' }, amount: 200 },
    ],
    installments: [
      { percent: 50, dueOffsetDays: 0 },
      { percent: 50, dueOffsetDays: 30 },
    ],
  });
  record('2 fee plan', plan.status === 201 && plan.body?.total === 1200 && plan.body?.class?.id === classId, `POST /api/fee-plans ${got(plan, 201)} total=${plan.body?.total} class=${plan.body?.class?.code ?? '-'} shares=${(plan.body?.installments ?? []).map((share) => `${share.percent}%+${share.dueOffsetDays}d`).join(', ')}`);
  if (plan.status !== 201) throw new Stop();

  // 3. The class is invoiced from the plan and issued at once; the same request again creates nothing.
  const batch = await call('POST', `/api/classes/${classId}/invoices`, tokens.admin, { feePlanId: plan.body.id, issue: true });
  const invoice = batch.body?.created?.[0] ?? null;
  const repeat = await call('POST', `/api/classes/${classId}/invoices`, tokens.admin, { feePlanId: plan.body.id, issue: true });
  record(
    '3 class invoices',
    batch.status === 200 && batch.body?.created?.length === 1 && invoice?.status === 'issued' && /^INV-\d{4}-\d{5,}$/.test(invoice?.number ?? '') && invoice?.total === 1200 && repeat.status === 200 && repeat.body?.created?.length === 0 && repeat.body?.skipped?.[0]?.reason === 'already_invoiced',
    `POST /api/classes/:id/invoices ${got(batch, 200)} created=${batch.body?.created?.length ?? '?'} number=${invoice?.number ?? 'none'} status=${invoice?.status} total=${invoice?.total} ${invoice?.currency ?? ''}; repeat created=${repeat.body?.created?.length ?? '?'} skipped=${repeat.body?.skipped?.[0]?.reason ?? '-'}`,
  );
  if (!invoice) throw new Stop();

  // 4. «My invoices»: the student sees it unpaid with both installments, without the internal note; the teacher holds no finance key.
  const mine = await myInvoice(tokens.student, invoice.id);
  const teacherMine = await call('GET', '/api/me/invoices', tokens.teacher);
  const teacherOffice = await call('GET', '/api/invoices', tokens.teacher);
  const parts = (mine.item?.installments ?? []).map((part) => `${part.amount}@${part.dueOn}`).join(', ');
  record(
    '4 "my invoices"',
    mine.status === 200 && mine.item?.relation === 'self' && mine.item?.paymentState === 'unpaid' && mine.item?.installments?.length === 2 && !('notes' in (mine.item ?? {})) && teacherMine.status === 403 && teacherOffice.status === 403,
    `student ${mine.status}: relation=${mine.item?.relation} state=${mine.item?.paymentState} balance=${mine.item?.balance} installments ${parts || 'none'}; internal note ${'notes' in (mine.item ?? {}) ? 'VISIBLE!' : 'hidden'}; teacher /api/me/invoices ${teacherMine.status}, /api/invoices ${teacherOffice.status}`,
  );

  // 5. The first payment covers the first installment; a receipt RCPT-YYYY-NNNNN.
  const firstPay = await call('POST', `/api/invoices/${invoice.id}/payments`, tokens.admin, { amount: 600, method: 'cash', payerName: 'ولي الأمر' });
  record(
    '5 first payment',
    firstPay.status === 201 && /^RCPT-\d{4}-\d{5,}$/.test(firstPay.body?.number ?? '') && firstPay.body?.invoice?.paid === 600 && firstPay.body?.invoice?.paymentState === 'partial',
    `POST /api/invoices/:id/payments ${got(firstPay, 201)} receipt=${firstPay.body?.number ?? 'none'} paid=${firstPay.body?.invoice?.paid} balance=${firstPay.body?.invoice?.balance} state=${firstPay.body?.invoice?.paymentState}`,
  );
  if (firstPay.status !== 201) throw new Stop();

  // 6. A second payment by transfer, the next receipt number; a payment above the balance is refused.
  const secondPay = await call('POST', `/api/invoices/${invoice.id}/payments`, tokens.admin, { amount: 400, method: 'bank_transfer', reference: `ACC-${stampCode}` });
  const over = await call('POST', `/api/invoices/${invoice.id}/payments`, tokens.admin, { amount: 200.01, method: 'cash' });
  record(
    '6 second payment + over balance',
    secondPay.status === 201 && seqOf(secondPay.body?.number) === seqOf(firstPay.body?.number) + 1 && secondPay.body?.invoice?.paid === 1000 && over.status === 409 && over.body?.code === 'payment_exceeds_balance' && over.body?.balance === 200,
    `second ${got(secondPay, 201)} receipt=${secondPay.body?.number ?? 'none'} paid=${secondPay.body?.invoice?.paid} balance=${secondPay.body?.invoice?.balance}; 200.01 more -> ${over.status} ${over.body?.code ?? ''} balance=${over.body?.balance}`,
  );
  if (secondPay.status !== 201) throw new Stop();

  // 7. The student sees both receipts, the first installment paid and the second partly.
  const afterPays = await myInvoice(tokens.student, invoice.id);
  const allocation = (afterPays.item?.installments ?? []).map((part) => `${part.paid}/${part.amount} ${part.status}`).join(', ');
  record(
    '7 student view after payments',
    afterPays.item?.paid === 1000 && afterPays.item?.balance === 200 && afterPays.item?.payments?.length === 2 && afterPays.item?.installments?.[0]?.status === 'paid' && afterPays.item?.installments?.[1]?.status === 'partial',
    `paid=${afterPays.item?.paid} balance=${afterPays.item?.balance} receipts=${(afterPays.item?.payments ?? []).map((payment) => payment.number).join(', ')} installments ${allocation}`,
  );

  // 8. The second payment was a mistake: the admin reverses it with a reason; the student keeps one receipt.
  const reversed = await call('POST', `/api/payments/${secondPay.body.id}/reverse`, tokens.admin, { reason: 'Acceptance check - wrong amount' });
  const twice = await call('POST', `/api/payments/${secondPay.body.id}/reverse`, tokens.admin, { reason: 'again' });
  const afterReverse = await myInvoice(tokens.student, invoice.id);
  record(
    '8 reverse a payment',
    reversed.status === 200 && reversed.body?.status === 'reversed' && reversed.body?.invoice?.paid === 600 && twice.status === 409 && twice.body?.code === 'payment_reversed' && afterReverse.item?.payments?.length === 1 && afterReverse.item?.balance === 600,
    `reverse ${got(reversed, 200)} status=${reversed.body?.status} paid=${reversed.body?.invoice?.paid}; again ${twice.status} ${twice.body?.code ?? ''}; student receipts=${afterReverse.item?.payments?.length} balance=${afterReverse.item?.balance}`,
  );

  // 9. An invoice with a completed payment is not cancelled (the evidence invoice stays issued).
  const cancel = await call('POST', `/api/invoices/${invoice.id}/status`, tokens.admin, { action: 'cancel', reason: 'Acceptance check' });
  record('9 cancel refused', cancel.status === 409 && cancel.body?.code === 'invoice_has_payments' && cancel.body?.paymentCount === 1, `cancel -> ${cancel.status} ${cancel.body?.code ?? ''} paymentCount=${cancel.body?.paymentCount}`);

  // 10. A draft by hand: edited, invisible to the student, deleted.
  const draft = await call('POST', '/api/invoices', tokens.admin, {
    studentId,
    lines: [{ description: { ar: 'رسوم إضافية', en: 'Extra fee' }, amount: 300 }],
    installments: [{ amount: 300, dueOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }],
    notes: 'Acceptance draft',
  });
  const edited = draft.status === 201 ? await call('PATCH', `/api/invoices/${draft.body.id}`, tokens.admin, { discountAmount: 50, discountReason: 'منحة', installments: [{ amount: 250, dueOn: draft.body.installments?.[0]?.dueOn }] }) : { status: 0 };
  const hidden = draft.status === 201 ? await myInvoice(tokens.student, draft.body.id) : { item: 'skipped' };
  const removed = draft.status === 201 ? await call('DELETE', `/api/invoices/${draft.body.id}`, tokens.admin) : { status: 0 };
  record(
    '10 draft lifecycle',
    draft.status === 201 && draft.body?.number === null && edited.status === 200 && edited.body?.total === 250 && hidden.item === null && removed.status === 204,
    `create ${got(draft, 201)} number=${draft.body?.number}; edit ${got(edited, 200)} total=${edited.body?.total}; student sees the draft: ${hidden.item === null ? 'no' : 'YES!'}; delete ${got(removed, 204)}`,
  );

  // 11. The guardian (optional): the child's invoice.
  if (tokens.guardian) {
    const child = await myInvoice(tokens.guardian, invoice.id);
    record('11 guardian', child.status === 200 && child.item?.relation === 'child' && child.item?.balance === 600, `HTTP ${child.status}; ${child.item ? `relation=${child.item.relation} balance=${child.item.balance}` : 'missing — link the guardian to the student (POST /api/users/:studentId/guardians) and rerun'}`);
  } else {
    record('11 guardian', null, 'skipped — no guardian account given');
  }

  // 12. The audit log: the admin's finance events of this run, newest first.
  const adminLog = await call('GET', `/api/audit-logs?actorUserId=${adminId}&limit=50`, tokens.admin);
  const financeEvents = (adminLog.body?.items ?? []).filter((event) => FINANCE_EVENT.test(event.action)).slice(0, 8).map((event) => event.action);
  const expected = ['invoices.deleted', 'invoices.updated', 'invoices.created', 'payments.reversed', 'payments.recorded', 'payments.recorded', 'invoices.batch_created', 'fee_plans.created'];
  record('12 audit log', adminLog.status === 200 && financeEvents.join(',') === expected.join(','), `admin ${adminLog.status}: ${financeEvents.join(' <- ') || 'no events'}`);

  record('13 CI', null, 'manual — CI on main after the task PR is merged');
  console.log(`\nEVIDENCE: class ${classCode} (${classId}); fee plan ${plan.body.id}; invoice ${invoice.number} (paid 600 of 1200, one reversed payment); receipts ${firstPay.body.number}, ${secondPay.body.number} (reversed); course ${course.code}. The rows stay in the dev database on purpose.`);
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
