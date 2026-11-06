# ArtiCode Academy — خارطة طريق التطوير (DEVELOPMENT ROADMAP)

| البند | القيمة |
|---|---|
| **إصدار الوثيقة** | 1.42.0 |
| **تاريخ آخر تحديث** | 2026-11-06 11:57 (UTC+03:00؛ قراءة ساعة الجهاز) |
| **الحالة** | **المرجع الرسمي لترتيب مراحل التطوير وتقسيم المهام ومعايير قبولها** (قرار المالك 2026-10-29، ADR-025 في الوثيقة الرئيسية) |
| **العلاقة بالوثيقة الرئيسية** | `docs/PROJECT_DOCUMENTATION.md` تبقى **المرجع التقني الوحيد** للحالة الفعلية (ما هو منفَّذ، العقود، المخطط، القرارات، التاريخ). هذه الوثيقة تُجيب عن سؤال واحد: **ماذا نبني تالياً، بأي ترتيب، وكيف نعرف أنه اكتمل.** لا تكرر الحقيقة التقنية؛ تشير إليها بالمعرّفات (`MOD-`, `FS-`, `KI-`, `ADR-`, `CH-`, `API-`) |
| **المالك** | مالك المشروع (يعتمد الترتيب والقرارات)؛ يحدّثها المطورون وClaude Code مع كل تغيير في حالة مهمة أو مرحلة |

> **قاعدة ذهبية:** أي مهمة هنا حالتها `PLANNED` حتى تُنفَّذ وتُوثَّق في الوثيقة الرئيسية بمسار ملف قابل للتحقق (RULE 13). نقاط النهاية والحقول المذكورة في المهام **مقترحات تصميم** تُثبَّت عقودها في القسم 10 من الوثيقة الرئيسية عند التنفيذ.

---

## 0. كيف تُستخدم هذه الوثيقة

### 0.1 تعريف الإنجاز (Definition of Done) لكل مهمة

تُعتبر المهمة مكتملة فقط عندما تتحقق كل البنود:

1. الكود منفَّذ وفق النطاق المذكور، بلا توسيع صامت ولا تضييق.
2. **كل معيار قبول** في المهمة له اختبار آلي يثبته (وحدة أو شامل)، أو تحقق يدوي موثَّق صراحةً عندما يستحيل الاختبار الآلي (مثل التفاعل مع الطرفية).
3. `npm run lint`، `npx tsc --noEmit`، `npm run test`، `npm run test:e2e` ناجحة في `backend/`؛ `npx tsc -b`، `npm run lint`، `npm run build` ناجحة في `frontend/` عند لمس الواجهة.
4. الوثيقة الرئيسية محدَّثة في المهمة نفسها (RULE 4/18): القسم 08 للوحدة، 10 لكل نقطة نهاية، 07 للصلاحيات، 06 لأي أثر على القاعدة، 15 للحالة، 19 لسجل التغييرات.
5. حالة المهمة هنا تُحدَّث إلى `IMPLEMENTED` مع رقم `CH-nnnn`.
6. **لا `git push` ولا نشر إنتاجي** إلا بطلب صريح من المالك. الالتزام المحلي (commit) بعد اكتمال التوثيق. **منذ CH-0070 (2026-11-02، §5b):** الالتزام على فرع المهمة لا على `main`، والدفع إلى ذلك الفرع فقط بطلب صريح من مطوّر الجلسة (المالك أو المطوّر المتعاون) — والطلب الدائم يكفي منذ CH-0085 (§5b.3 البند 1)، و`main` تتحرك بدمج PR على GitHub بعد CI أخضر.

### 0.2 الحالات

`PLANNED` (مخطَّطة، لم تبدأ) · `IN_PROGRESS` (جارية) · `IMPLEMENTED` (مكتملة بتعريف الإنجاز) · `BLOCKED` (تنتظر قراراً أو اعتمادية) · `DEFERRED` (مؤجَّلة بقرار) · `REMOVED`.

### 0.3 التقدير

`S` (نصف يوم عمل أو أقل)، `M` (يوم إلى يومين)، `L` (ثلاثة أيام أو أكثر). التقديرات إرشادية لترتيب العمل لا للالتزام الزمني.

---

## 1. نظرة عامة على المراحل

| المرحلة | المحتوى | الاعتماديات | بوابة الخروج (Exit gate) | الحالة |
|---|---|---|---|---|
| **Stage 1 — Foundation** | Git؛ هيكل الخادم والإعدادات والفحوص الصحية؛ PostgreSQL 18 في Docker + Prisma 7؛ أدوار قاعدة محدودة؛ المخطط الأول (12 جدولاً) والبذر؛ نظام التوثيق المستمر | — | `lint`/`test`/`build` ناجحة؛ `migrate diff` بلا فرق؛ CI أساسي يشغّلها | `IMPLEMENTED` — S1-R01 وS1-R02 ✔ CH-0035 (ADR-043، FS-065؛ **بوابة «CI أساسي يشغّلها» متحققة محلياً ثم على GitHub — أول تشغيل أخضر في CH-0037**)؛ S1-R03 ✔ CH-0028 |
| **Stage 1b — UI prototype** | هيكل واجهة المنتج ببيانات محلية (13 شاشة، i18n/RTL، Ant Design) | — | — (أُنجزت للمعاينة — ADR-012) | `IMPLEMENTED` (CH-0005) |
| **Stage 2 — Identity & Academy** | **MOD-01** المصادقة والجلسات؛ **MOD-03** المستخدمون والأدوار والدعوات واستعادة كلمة المرور؛ **MOD-02** الأكاديمية؛ **MOD-14** الإعدادات؛ حسم ADR-008 (نموذج النشر) | Stage 1 | MOD-01 مقفلة ✔؛ MOD-03 مكتملة بمهامها (§4)؛ MOD-02/MOD-14 بالحد الأدنى (قراءة/تعديل صف `academy`) **✔ CH-0036 (§4b)** | **`IMPLEMENTED` — مكتملة (CH-0042، 2026-11-01: قبول MOD-03 — §4.9)** — **MOD-01 مقفلة بالقبول (CH-0015، §3)**؛ **MOD-03 جارية: T00/T01 (CH-0016)، T02 (CH-0018)، T03 (CH-0020)، T04 (CH-0022)، T05 (CH-0023)، T06 (CH-0025)، T07 (CH-0027)، T08 (CH-0024)، T09 (CH-0026)، T10 (CH-0029)، T11 (CH-0030)، T12 (CH-0031)، T13 (CH-0032)، T14 (CH-0033)، T15 (CH-0034) `IMPLEMENTED` — **الدفعات A وB وC وD مكتملة: كل مهام MOD-03 (T00..T16) منفَّذة** (الواجهة: T11 ✔ CH-0030 بالتوازي مع T10؛ T12 ✔ CH-0031 وT13 ✔ CH-0032 بالتوازي في جلستين؛ T14 ✔ CH-0033 وT15 ✔ CH-0034 بالتوازي في جلستين؛ T16 ✔ CH-0028)؛ الرحلات اليدوية من المتصفح لـ T11..T15 ✔ وقبول المالك لـ MOD-03 (CH-0042، 2026-11-01 — §4.9)** (§4)؛ **MOD-02/MOD-14 بالحد الأدنى `IMPLEMENTED` (CH-0036 — MOD-02-T01 الخادم `GET`/`PATCH /api/academy` وMOD-02-T02 تبويب «عام» حقيقي؛ ADR-044؛ D-R09/D-R10 معتمدان نهائياً (أكّدهما المالك 2026-11-01 — CH-0039)؛ T03 `settings jsonb` وT04 العلامة التجارية `PLANNED`؛ الرحلة اليدوية ✔ — CH-0042) — §4b**؛ **ADR-008 محسوم بقرار المالك (2026-11-01 — CH-0040، ADR-045: نسخة كاملة لكل أكاديمية؛ قاعدة المنصة المركزية ولوحة Super Admin تصميم معتمد يُبنى في Stage 6)**؛ **MOD-03 مقبولة (CH-0042، 2026-11-01 — §4.9): البوابة مكتملة** |
| **Stage 3 — Academic core** | MOD-04 الدورات والمستويات؛ MOD-05 الفصول والتسجيلات؛ MOD-07 الجدولة؛ MOD-06 الدروس والحضور | Stage 2 | أول رحلة طالب كاملة: تسجيل → فصل → درس → حضور | `IN_PROGRESS` — **MOD-04 (§4c): T00 ✔ (CH-0041، قرارات D-R11..D-R14)، T01 ✔ (CH-0043 — الجداول الثلاثة والترحيل)، T02 ✔ (CH-0044 — API المستويات)، T03 ✔ (CH-0045 — API الدورات)، T05 ✔ (CH-0047 — صفحة الدورات الحقيقية)، T06 ✔ (CH-0049 — المستويات والمنهج في الواجهة)، T04 ✔ (CH-0050 — API المنهج، المطوّر المتعاون — C1 في §5b.2)، النصف الخادمي من T07 ✔ (CH-0051 — C2)؛ التالي إغلاق T07 من المتصفح وقبول المالك (O7)**؛ **MOD-05 (§4d): خطة T00 ✔ (CH-0076 — قرارات D-R15..D-R18)، T01 ✔ (CH-0052 — الجداول الثلاثة والترحيل)، T02 ✔ (CH-0053 — API الفصول)، T03 ✔ (CH-0054 — معلمو الفصل)، T04 ✔ (CH-0055 — التسجيلات، بالتوازي مع T03)، T05 ✔ (CH-0056 — «فصولي»؛ الخادم مكتمل)، T06 ✔ (CH-0057 — رحلة الوحدة اختباراً شاملاً TEST-052)؛ يبقى قبول المالك من Swagger (§4d.9) والواجهة T07**؛ **MOD-07 (§4e): خطة T00 ✔ (CH-0090 — قرارات D-R23..D-R29)؛ T01 ✔ (CH-0092 — جدولا `rooms` و`class_schedules` وقيدا التعارض بـ `btree_gist`)؛ التالي T02 (القاعات)** |
| **Stage 4 — Assessment** | MOD-08 الواجبات؛ MOD-09 الاختبارات والدرجات؛ MOD-10 الشهادات | Stage 3 | إصدار شهادة من درجات حقيقية | `PLANNED` |
| **Stage 5 — Finance & Communication** | MOD-11 المدفوعات والأقساط؛ MOD-12 الإشعارات (البريد/الرسائل؛ **ربط مزوّد البريد الفعلي مؤجَّل بقرار D-R08 إلى بوابة الإطلاق LR-01 في §5.1** — انظر D-R01/D-R08)؛ MOD-13 التقارير | Stage 2–4 | فاتورة ← دفعة ← إشعار | `PLANNED` |
| **Stage 6 — Scale & Reach** | MOD-15 التكاملات وواجهات المحمول؛ القاعدة المركزية للمنصة (ADR-021)؛ مراقبة ونسخ احتياطي لكل أكاديمية؛ `tr` في i18n | كل ما سبق | — | `PLANNED` |

ترتيب الوحدات داخل كل مرحلة ملزِم ما لم يغيّره المالك هنا. التصميم المستهدف لجداول المراحل 3–6 في الوثيقة الرئيسية 6.7 (`PROPOSED`).

---

## 2. المتبقي من Stage 1 (مهام صغيرة مستقلة)

| المعرّف | المهمة | معايير القبول | الحالة |
|---|---|---|---|
| S1-R01 | `engines.node` + `.nvmrc` في التطبيقين (KI-008، KI-012) | `npm ci` يحذّر عند Node أقدم من المحدد؛ التوثيق 11.1 محدَّث | **`IMPLEMENTED` (CH-0035):** `.nvmrc` جذري = `22.20.0` و`engines.node: ">=22.20.0"` في `backend/package.json` و`frontend/package.json` — النطاق يقبل الإصدار العامل محلياً وفي CI ولا يشترط 22.22.3 (KI-012 تبقى `OPEN` كترقية مستقبلية)؛ `npm ci` يمرّ في التطبيقين (الخادم بـ npm 11 — KI-045)؛ الوثيقة الرئيسية 11.1 و4.4 وKI-008 `FIXED` |
| S1-R02 | CI أساسي (GitHub Actions أو ما يختاره المالك عند إضافة remote): `lint`/`tsc`/`test`/`build` للتطبيقين + قاعدة PostgreSQL مؤقتة لـ `test:e2e` + حارس الانجراف `prisma migrate diff --exit-code` | خط أنابيب أخضر على `main`؛ فشل الانجراف يوقفه | **`IMPLEMENTED` (CH-0035، ADR-043، FS-065؛ الوثيقة الرئيسية 14.12):** `.github/workflows/ci.yml` على GitHub Actions (اعتمد المالك الافتراضي المقترح) — وظيفة `backend` بخدمة `postgres:18` مؤقتة وأدوار ADR-019 بالسكربت نفسه `10-roles.sh`، npm 11، `lint` → `migrate deploy` → `migrate diff --exit-code` → `seed` → `test` → `test:e2e -- --no-file-parallelism` → `build`؛ وظيفة `frontend` `lint` → `test` → `build`؛ **فروق التنفيذ:** الشامل ملفاً بعد ملف في CI (KI-040)، تثبيت npm 11 قبل `npm ci` في الخادم (KI-045 المكتشفة هنا)، ولا حساب مدير (كل مجموعة تبني مثبّتاتها). كل الأوامر مرّت محلياً بالترتيب نفسه (الوثيقة الرئيسية 13.4)؛ **معيار «خط أنابيب أخضر على `main`» متحقق في CH-0037** (أول دفع بطلب المالك في 2026-10-31؛ run #1 على `924a461` أخضر — الوثيقة الرئيسية 13.4/14.12) |
| S1-R03 | إطار اختبار للواجهة (Vitest + Testing Library) قبل تراكم شاشات MOD-03 (13.5) | اختبار واحد على `LoginPage` و`RequireAuth` يعمل بـ `npm run test` في `frontend/` | **`IMPLEMENTED` (CH-0028 مع MOD-03-T16؛ ADR-038، TEST-029):** `npm run test` في `frontend/` = 38 اختباراً في 6 ملفات (منها `LoginPage` 9 و`RequireAuth`/`RequireRole` 7) في نحو 17 ثانية بلا خادم ولا قاعدة؛ D-R05 اعتُمد في CH-0016 (ADR-027) |

---

## 3. إغلاق MOD-01 — سجل القبول (2026-10-29، CH-0015)

**النتيجة: MOD-01 مُعتمَدة ومقفلة.** كل معايير القبول أدناه تحققت على البيئة الحية وبالاختبارات الآلية. ما تبقى أدناه (§3.2) **ليس مانعاً للإغلاق** وإنما تحصين قبل النشر.

### 3.1 معايير القبول وما تم التحقق منه

| # | المعيار | طريقة التحقق | النتيجة |
|---|---|---|---|
| A1 | `JWT_SECRET` دائم يُحمَّل عند كل إقلاع (لا سرّ عابر) | `backend/.env` يحمل المتغير (64 حرفاً، القيمة لم تُطبع)؛ رمز موقَّع محلياً بالسرّ قُبل توقيعه على الخادم الحي **قبل** إعادة التشغيل **وبعده** (`401 session_invalid` لمستخدم غير موجود = التوقيع صحيح)؛ نسخة جديدة على المنفذ 3999 أقلعت **بلا** تحذير `ephemeral secret` | ✔ |
| A2 | لا عمليات مكررة للخادم؛ لا إيقاف لعمليات جلسات أخرى | `Get-CimInstance` + `Get-NetTCPConnection`: Nest واحد على :3000 (مراقب `nest start --watch` من جلسة Claude Code موازية)؛ **Vite اثنان**: :5173 (جلسة Claude Code) و:5174 (طرفية VS Code للمالك). لم يُوقَف أي منها؛ كلاهما يمرّر `/api` بنجاح | ✔ (مع ملاحظة: Vite مكرر — قرار المالك إبقاؤه أو إيقاف أحدهما) |
| A3 | إنشاء المدير الأول يعمل بالطريقة الموثقة على PowerShell | `npm run auth:bootstrap-admin` من pwsh بمتغيرات البيئة: إنشاء (exit 0) → إعادة التشغيل بنفس البريد `already_bootstrapped` (exit 0) → بريد آخر `refused: admin_exists` (exit 2) → بلا كلمة مرور وبلا TTY رسالة واضحة (exit 1). المدير المؤقت **حُذف** بعد التحقق؛ **المالك لم ينشئ مديره بعد** (§3.3). الإدخال التفاعلي بلا صدى غير قابل للاختبار في جلسة بلا TTY — متحقق بقراءة الكود فقط (`UNVERIFIED` تفاعلياً) | ✔ |
| A4 | الدخول والتجديد والخروج من الواجهة | عبر Vite proxy (:5173 و:5174) بالمدير المؤقت: دخول 200 + كعكة `HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=1209600`؛ `/me` 200؛ `audit-logs` 200 بصلاحية `audit.read`؛ تجديد 200 مع **تدوير** الكعكة؛ إعادة استخدام الكعكة القديمة `401 refresh_reused` وموت الجديدة معها؛ خروج 204 ثم تجديد `401 refresh_missing`؛ كلمة خاطئة `401 invalid_credentials`. العرض المرئي في متصفح `UNVERIFIED` (لا أداة متصفح في الجلسة)؛ `tsc -b`/`lint`/`vite build` نظيفة | ✔ |
| A5 | مراجعة الكعكات وCSRF للاستعداد لـ HTTPS | الكعكة httpOnly + `SameSite=Strict` + مسار مقيَّد + `Secure` افتراضياً في production؛ CORS بقائمة. **فجوة مكتشفة ومُغلقة:** محلّل `urlencoded` الافتراضي في Nest كان يقبل نموذج HTML مُرسَلاً من موقع آخر إلى `login` (login CSRF) — أُغلقت بأجسام JSON فقط (ADR-026، KI-033، SEC-R-10) مع اختبار. قيود النشر موثَّقة (SEC-R-11، 14.11) | ✔ بعد الإصلاح |
| A6 | الاختبارات والبناء | الخادم: `lint` نظيف، `tsc --noEmit` نظيف، وحدة **29/29**، شامل **29/29** على القاعدة الحية (TEST-005 8، TEST-007 9، TEST-008 12)، ترجمة مكافئة للبناء إلى مجلد مؤقت (لم يُشغَّل `npm run build` لأن `start:dev` يعمل). الواجهة: `tsc -b`، `lint`، `vite build` نظيفة | ✔ |
| A7 | لا مشاكل مانعة | لا شيء مفتوح يمنع الإغلاق؛ قائمة التحصين في §3.2 | ✔ |

### 3.2 تحصينات MOD-01 المؤجَّلة (غير مانعة؛ تُنفَّذ قبل النشر أو عند الحاجة)

| المعرّف | التحصين | متى | التقدير |
|---|---|---|---|
| MOD-01-H01 | `trust proxy` عبر متغير بيئة (مثل `TRUST_PROXY`) ليصحّ `req.ip` في التدقيق وتحديد المعدل خلف وكيل عكسي (KI-030). **منفَّذ (CH-0080، TEST-063، 2026-11-03):** `TRUST_PROXY` مغلق افتراضياً، يقبل عدد الوكلاء (1–10) أو عناوينهم/نطاقاتهم، ويرفض `true`؛ يبقى ضبطه في بيئة النشر | ~~قبل أول نشر خلف nginx/Caddy~~ منفَّذ | S |
| MOD-01-H02 | فحص `Origin`/`Sec-Fetch-Site` على مسارات الكعكة (`refresh`/`logout`) كطبقة دفاع ثانية فوق `SameSite=Strict` وJSON. **فحص CH-0016 (21 طلباً) أكد أن الخادم لا يفحص أيّاً منهما** بينما preflight وContent-Type وحد الجسم سليمة (الوثيقة الرئيسية 12.1). **`IMPLEMENTED` (CH-0018، ADR-029):** حارس عام `OriginGuard` قبل `AuthGuard` على كل طريقة مغيِّرة للحالة (POST/PUT/PATCH/DELETE) — قائمة `CORS_ORIGIN` + الأصل الذاتي + loopback خارج الإنتاج؛ بلا `Origin` يُرفض `Sec-Fetch-Site: cross-site/same-site`؛ `403 origin_forbidden`؛ TEST-013/TEST-016 تشمل النطاق الفرعي الشقيق | ~~Stage 2~~ منفَّذ | S |
| MOD-01-H03 | سقف مطلق لعمر عائلة التحديث (مثلاً 30–90 يوماً من إنشاء العائلة) بدل التمديد غير المحدود مع كل تدوير. **منفَّذ (CH-0082، TEST-065، ADR-063، 2026-11-03):** `AUTH_REFRESH_FAMILY_MAX_DAYS` = 30 افتراضياً (قرار المالك)، يُحسب من `family_id` (UUIDv7) بلا ترحيل؛ بعده `401 refresh_expired` ودخول جديد | ~~قبل النشر~~ منفَّذ | S |
| MOD-01-H04 | `helmet` لرؤوس الأمان + `SWAGGER_ENABLED=false` في الإنتاج (SEC-R-05). **منفَّذ (CH-0083، TEST-066، ADR-064، 2026-11-03):** `helmet` 8.3.0 بموافقة المالك على كل استجابة، وSwagger مغلق افتراضياً حين `NODE_ENV=production` (`true` صريح يفتحه) | ~~قبل النشر~~ منفَّذ | S (اعتمادية جديدة — وافق المالك) |
| MOD-01-H05 | تخزين مشترك (Redis) لمحدّد المعدل عند تعدد النسخ (KI-030) | عند التوسّع الأفقي | M |
| MOD-01-H06 | قائمة الجلسات النشطة للمستخدم وإلغاء جلسة بعينها؛ MFA للمدراء | Stage 5–6 | M / L |
| MOD-01-H07 | عملاء غير متصفح (المحمول): رمز التحديث في الجسم بنوع عميل صريح | Stage 6 (MOD-15) | M |
| MOD-01-H08 | **تسلسل تجديد الجلسة بين تبويبات المتصفح (KI-047، CH-0042):** قفل `navigator.locks` باسم ثابت حول `refreshSession()` في `frontend/src/api/client.ts` كي لا يرسل تبويبان الكعكة نفسها معاً فيُكشف «إعادة استخدام» وتُلغى الجلسة كلها؛ اختبار بتبويبين محاكيين؛ و/أو مهلة سماح قصيرة في `AuthService.refresh()` لرمز دُوِّر للتو. **منفَّذ في الواجهة (CH-0073، TEST-060، 2026-11-02):** القفل `articode.auth.refresh` حول طلب التجديد، والاختبار يعيد إنتاج السباق بلا قفل ويثبت نجاح التبويبين به؛ مهلة السماح في الخادم لم تُنفَّذ (غير لازمة بعد القفل؛ تبقى خياراً لمسار الخادم)؛ رحلة المتصفح بتبويبين `UNVERIFIED` | ~~قبل الاستخدام الواسع~~ منفَّذ | S |

### 3.3 إجراء يدوي متبقٍّ على المالك

- **إنشاء المدير الأول الحقيقي** (مرة واحدة، من `backend/` في PowerShell؛ كلمة المرور تُكتب عند الطلب بلا صدى ولا تُحفظ في ملف):

  ```powershell
  $env:BOOTSTRAP_ADMIN_EMAIL = 'admin@your-academy.example'
  $env:BOOTSTRAP_ADMIN_FULL_NAME = 'الاسم الكامل'
  npm run auth:bootstrap-admin
  Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL, Env:BOOTSTRAP_ADMIN_FULL_NAME
  ```

  ثم الدخول من `http://localhost:5173/login` والتحقق المرئي من صفحتَي الدخول والحساب (الوحيدان غير المتحقق منهما بصرياً).
- (اختياري) إيقاف نسخة Vite المكررة (:5173 من جلسة Claude Code، أو :5174 من طرفية VS Code) — لم تُوقَف أي منهما آلياً.

---

## 4. MOD-03 — إدارة المستخدمين والأدوار والصلاحيات (خطة التنفيذ)

### 4.1 النطاق والأهداف

| داخل النطاق | خارج النطاق (مؤجَّل بقرار) |
|---|---|
| إدارة حسابات **المعلمين والطلاب والموظفين وأولياء الأمور** (قائمة، إنشاء، تعديل، تفاصيل) | التسجيل الذاتي العام للطلاب (D-R04) |
| ربط الأدوار بالمستخدمين، وإدارة الأدوار المخصّصة وصلاحياتها | الاستيراد الجماعي من CSV (مرحلة لاحقة) |
| **دعوة المستخدمين وتفعيل الحسابات** (رمز استخدام واحد → ضبط كلمة المرور → `active`) | إرسال البريد الفعلي (Resend/SMTP أو غيره) — **مؤجَّل بقرار D-R08 إلى مهمة الإطلاق LR-01 (§5.1)**؛ داخل MOD-03 يُبنى تجريد `MailTransport` فقط (T03) |
| **استعادة كلمة المرور** (رابط إعادة ضبط بادئه المدير، والمسار الذاتي عند توفر قناة البريد) | MFA (MOD-01-H06) |
| إدارة حالات الحساب (`invited/pending/active/suspended/archived`، فك القفل، الحذف المنطقي) | نطاق الفرع `user_roles.branch_id` (يحتاج MOD-02 والفروع) |
| ربط أولياء الأمور بالطلاب (العلاقة، الولي الأساسي) | أعلام الولي التفصيلية (مالي/درجات/حضور) — تُضاف مع الوحدات المستهلكة |
| **سجل تدقيق لكل تغيير إداري** (داخل معاملة التغيير، بلا أسرار) + مرشّحات قراءة السجل | سياسة الاحتفاظ بالتدقيق (`NOT YET DETERMINED`) |
| شاشات الواجهة: المستخدمون، تفاصيل/تعديل، الدعوة، الأدوار، الربط، صفحتا التفعيل وإعادة الضبط العامتان | — |

### 4.2 إعادة استخدام الجداول الـ12 الحالية — لا جداول جديدة

| الجدول | الاستخدام في MOD-03 | ملاحظة |
|---|---|---|
| `users` | الحساب الواحد لكل شخص: الهوية، الحالة، `must_change_password`، `deleted_at`، عدّادات القفل | لا أعمدة جديدة مطلوبة |
| `roles`, `permissions`, `role_permissions` | الأدوار النظامية الخمسة (مبذورة) + الأدوار المخصّصة (`is_system=false`)؛ الكتالوج (57 مفتاحاً منذ CH-0018) ثابت من الكود | ~~لا مفاتيح جديدة~~ **استثناء واحد بقرار المالك (D-R07، CH-0018):** `users.read_contact` أُضيف إلى `permission-catalog.ts` وبُذر بلا ترحيل (البذر يمنح المفتاح الجديد للأدوار النظامية التي تحمله افتراضياً — `academy_admin` و`staff`)؛ أي إضافة لاحقة = تعديل `permission-catalog.ts` + `npm run prisma:seed` (بلا ترحيل) |
| `user_roles` | تعيين الأدوار مع `assigned_by` | `Restrict` على حذف دور ممنوح يحمي الاتساق |
| `student_profiles`, `employee_profiles` | يُنشأ الملف في معاملة إنشاء المستخدم حسب نوعه (`kind` للموظف: `teacher`/`staff`) | اتساق الدور↔الملف يُفرض في الخدمة (6.6.1 البند 2) |
| `guardian_students` | الربط n:m مع `relationship` و`is_primary` (ولي أساسي واحد — فهرس جزئي) | التعامل مع `23505` عند تعيين أساسي ثانٍ: الخدمة تُنزل الأساسي السابق في المعاملة نفسها |
| `verification_tokens` | `purpose = invitation` للدعوات، `password_reset` لإعادة الضبط، `email_verification` مستقبلاً؛ `metadata` لمعلومات غير سرية (مثل الأدوار المطلوبة) | يُخزَّن SHA-256 فقط؛ الرمز الخام يظهر مرة واحدة في استجابة الإنشاء |
| `refresh_tokens` | إلغاء الجلسات عند التعليق/الأرشفة/إعادة الضبط | موجود منذ MOD-01 |
| `audit_logs` | كل تغيير إداري حدث واحد داخل معاملة التغيير | إلحاقي؛ `assertNoSecrets()` يرفض المفاتيح الحساسة |
| `academy` | قراءة `default_locale` لتوطين الرسائل | لا تغيير |

**أثر قاعدة البيانات المتوقع لكل MOD-03: لا ترحيلات.** إن ظهرت حاجة حقيقية لعمود (مثل `users.invited_by`) تُسجَّل كقرار مستقل قبل أي ترحيل.

### 4.3 الصلاحيات المستخدمة (من الكتالوج الحالي)

`users.read` · `users.create` · `users.update` · `users.deactivate` · `users.roles.assign` · `roles.manage` · `guardians.link` · `audit.read`. الافتراضيات: `academy_admin` الكل؛ `staff`: `users.read|create|update`, `guardians.link`؛ `teacher`: `users.read`. المسارات العامة (قبول دعوة، تأكيد إعادة ضبط) بلا صلاحية لكن بتحديد معدل. **منذ T01 (CH-0016):** رؤية المحذوفين منطقياً (`includeDeleted=true`) تتطلب `users.deactivate` إضافةً إلى `users.read`. **منذ CH-0018 (D-R07 محسوم، ADR-030):** مفتاح جديد `users.read_contact` (يحمله `academy_admin` و`staff` افتراضياً، لا `teacher`) يكشف `email`/`username`/`phone` وطوابع الأمان (`emailVerifiedAt`/`lastLoginAt`/`lockedUntil`) في القائمة والتفاصيل ويفعّل البحث بالبريد/اسم المستخدم؛ حامل `users.read` وحده يرى إسقاطاً مخفَّضاً (الحقول نفسها بقيم `null`). **قاعدة الإنشاء (T02):** `users.create` للنوع الافتراضي؛ `users.roles.assign` لأي دور إضافي؛ و**لا يُمنح أي دور يحمل صلاحية لا يملكها المنشئ** (باستثناء الخط الأساسي للمتعلمين = افتراضيات `student`/`guardian` المبذورة) → `403 permission_denied` بقائمة `missing`؛ منح `academy_admin` يتطلب عملياً مديراً (D-R03).

### 4.4 نقاط النهاية المقترحة (`PLANNED` — العقود النهائية تُوثَّق في 10.2 عند التنفيذ)

| المهمة | الطريقة والمسار المقترح | الصلاحية |
|---|---|---|
| T01 | **`IMPLEMENTED` (CH-0016) — API-012/API-013:** `GET /api/users` (`q`, `status`, `role`, `includeDeleted`, `sort`, `order`, `limit`, `cursor`) · `GET /api/users/:id` (`includeDeleted`) | `users.read` (+ `users.deactivate` لـ `includeDeleted`) |
| T02 | **`IMPLEMENTED` (CH-0018) — API-014:** `POST /api/users` (`kind` student/teacher/staff/guardian + الهوية + `studentProfile`/`employeeProfile` + `roleKeys?`) → `201` بتفاصيل المستخدم (`status=invited`) | `users.create` (+ `users.roles.assign` لأدوار إضافية؛ لا تجاوز لصلاحيات المنشئ) |
| T03 | **`IMPLEMENTED` (CH-0020) — API-015/API-016/API-017:** `POST /api/users/:id/invitations` → `201 { userId, token, link, expiresAt, delivery }` مرة واحدة · `GET /api/account/invitations/:token` (عام: معاينة بمعرّفات مقنَّعة) · `POST /api/account/invitations/:token/accept` (عام: `{ password }` → `active` + جلسة كـ `login`؛ بلا `email_verified_at`) | `users.create` + قاعدة عدم التجاوز على المُصدِر (SEC-R-13) / عام بتحديد معدل |
| T04 | **`IMPLEMENTED` (CH-0022) — API-018:** `PATCH /api/users/:id` (الهوية والتفضيلات وحقول الملف الموجود بدلالة PATCH؛ `null` يفرغ؛ البريد/اسم المستخدم مع الفريدية وإسقاط `email_verified_at`؛ حدث `users.updated` بأسماء الحقول فقط) | `users.update` (+ قاعدة عدم التجاوز على تغيير `email`/`username` — SEC-R-15) |
| T05 | **`IMPLEMENTED` (CH-0023) — API-019..API-021:** `POST /api/users/:id/password-reset` (رمز إعادة ضبط لمرة واحدة لحساب `active`؛ `must_change_password=true`) · `POST /api/account/password-reset/:token/confirm` (عام؛ كلمة جديدة + فك القفل + إبطال كل الجلسات + جلسة جديدة) · `POST /api/account/password-reset/request` (عام، ذاتي — **منفَّذ ومعطَّل بالإعداد: `403 reset_disabled` حتى LR-01**) | `users.update` (+ قاعدة عدم التجاوز على أدوار الهدف — SEC-R-15) / عام |
| T06 | **`IMPLEMENTED` (CH-0025) — API-027/API-028:** `POST /api/users/:id/status` (`{ action: activate\|suspend\|archive\|restore\|unlock, reason? }` → `200` بتفاصيل المستخدم؛ `409 invalid_transition` بـ `{ from, action, allowed }`، `403 self_forbidden`، `409 last_admin`؛ `suspend`/`archive` تُبطل كل الجلسات فوراً) · `DELETE /api/users/:id` (حذف منطقي `deleted_at` + `archived` بجسم اختياري `{ reason? }` → `200`؛ المحذوف نهائي) | `users.deactivate` (فك القفل: `users.update` أو `users.deactivate`) + قاعدة عدم التجاوز على كل إجراء (SEC-R-17) |
| T07 | **`IMPLEMENTED` (CH-0027) — API-034:** `PUT /api/users/:id/roles` (`{ roleKeys: string[], employeeKind? }` استبدال كامل يُكتب كفرق → `200` بتفاصيل المستخدم؛ `400 role_unknown`، `403 self_forbidden` لسحب `academy_admin` من الذات، `409 last_admin`، `422 employee_kind_required`/`profile_mismatch`؛ الملف الناقص يُنشأ مع الدور؛ حدث `users.roles.changed`) | `users.roles.assign` + قاعدة عدم التجاوز على أدوار الهدف وعلى كل دور يُضاف (SEC-R-17/SEC-R-16) |
| T08 | **`IMPLEMENTED` (CH-0024) — API-022..API-026:** `GET /api/roles` (`users.read`) · `GET /api/permissions` · `POST /api/roles` · `PATCH /api/roles/:id` (التسمية/الوصف للمخصّصة؛ `permissions` استبدال كامل لكل دور عدا `academy_admin`) · `DELETE /api/roles/:id` (المخصّصة غير الممنوحة) — الأربعة بـ `roles.manage` | `users.read` للقائمة؛ `roles.manage` للبقية + قاعدة عدم التجاوز على كل مفتاح يُمنح أو يُضاف (SEC-R-16) |
| T09 | **`IMPLEMENTED` (CH-0026) — API-029..API-033:** `GET /api/users/:studentId/guardians` · `GET /api/users/:guardianId/students` (`{ items: [{ user بإسقاط المستدعي, relationship, isPrimary, createdAt }] }`) · `POST /api/users/:studentId/guardians` (`{ guardianId, relationship, isPrimary? }` → `201` بالرابط) · `PATCH`/`DELETE /api/users/:studentId/guardians/:guardianId` | `guardians.link` + قاعدة عدم التجاوز على أدوار الطرفين (SEC-R-18) / القراءة: `users.read` (+ `users.read_contact` للإسقاط الكامل) |
| T10 | **`IMPLEMENTED` (CH-0029) — API-011:** `GET /api/audit-logs` (`action` بادئة حرفية، `actorUserId`، `entityType`+`entityId` — المعرّف يتطلب النوع، `before`، `limit` 1–200، `cursor` من `nextCursor`؛ الأحدث أولاً بترتيب الإدراج UUIDv7؛ `nextBefore` أُزيل — KI-042) | `audit.read` |

### 4.5 المهام

> كل مهمة: النطاق → معايير القبول (AC) → الاختبارات → الاعتماديات → التقدير → الحالة. الملفات المقترحة: `backend/src/users/` (`UsersModule`)، `backend/src/roles/` (`RolesModule`)، `backend/src/account/` (رموز التفعيل وإعادة الضبط، مسارات عامة)، و`frontend/src/pages/users/*`, `frontend/src/api/users.ts` …

#### MOD-03-T00 — التحضير والقرارات (بلا كود إنتاجي)

- **النطاق:** تثبيت قرارات D-R01..D-R05 (§4.7)؛ تحديد متغيرات البيئة الجديدة (§4.8) في `env.schema.ts` + `.env.example` + 11.3؛ هيكل المجلدات الثلاثة؛ قاموس أكواد أخطاء MOD-03 (`UsersHttpException` على نمط `AuthHttpException`: `email_in_use`, `username_in_use`, `role_unknown`, `role_in_use`, `last_admin`, `self_forbidden`, `invitation_invalid`, `invitation_expired`, `invitation_consumed`, `reset_invalid`, `reset_expired`, `not_a_guardian`, `not_a_student`, …).
- **AC:** القرارات مسجَّلة هنا بحالتها؛ المتغيرات في المخطط باختبار وحدة؛ لا تغيير سلوكي.
- **الاختبارات:** TEST-003 (env) يغطي المتغيرات الجديدة.
- **الاعتماديات:** قرار المالك. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0016، 2026-10-29).** النتيجة: D-R01..D-R06 `ACCEPTED` (§4.7، ADR-027 في الوثيقة الرئيسية؛ لا تعارض جوهري، ملاحظتا تصميم مسجَّلتان هناك)؛ `AUTH_INVITATION_TTL_HOURS`=48، `AUTH_PASSWORD_RESET_TTL_MINUTES`=30، `AUTH_SELF_SERVICE_RESET_ENABLED`=false، `APP_PUBLIC_URL` اختياري — في `env.schema.ts` + `.env.example` + 11.3 (ENV-36..ENV-39) باختبار TEST-003 جديد؛ قاموس الأكواد في `backend/src/users/users.errors.ts` (`UsersHttpException`، 24 كوداً، اثنان مستخدمان في T01 والبقية محجوزة بأسماء مهامها)؛ هيكل المجلدات: `backend/src/users/` أُنشئ مع T01، و`src/roles/` و`src/account/` يُنشآن مع T08 وT03 (قرار: لا ملفات فارغة في Git).

#### MOD-03-T01 — قائمة المستخدمين وتفاصيلهم (API)

- **النطاق:** `UsersModule` + `UsersService` + `UsersController`: `GET /api/users` (بحث نصي في البريد/اسم المستخدم/الاسم، مرشّحات `status` و`role`، استبعاد المحذوفين منطقياً افتراضياً مع `includeDeleted` للمدير، ترقيم بمؤشر `(createdAt,id)`، حد 1–100)، `GET /api/users/:id` (الهوية + الأدوار + ملخص الملفات + روابط الأولياء/الطلاب + آخر دخول). DTO استجابة **بلا** `password_hash`/`failed_login_count`/عدّادات داخلية.
- **AC:** (1) بلا `users.read` → `403 permission_denied` مع `missing`؛ (2) الاستجابة لا تحوي أي حقل يطابق `/hash|password/i`؛ (3) المرشّحات تعمل مجتمعةً؛ (4) الترقيم مستقر (لا تكرار ولا فقد عبر الصفحات)؛ (5) `:id` غير موجود أو محذوف → `404 user_not_found`؛ (6) معاملات غير صالحة → `400`.
- **الاختبارات:** شامل جديد `test/users.e2e-spec.ts` (يُتخطّى بلا قاعدة) بمستخدمين مؤقتين بلاحقة فريدة يُحذفون في النهاية.
- **الاعتماديات:** MOD-01. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0016، 2026-10-29).** العقود النهائية API-012/API-013 في الوثيقة الرئيسية 10.2؛ الاختبارات TEST-011 (11 شاملة: كل معيار قبول + الأداء الأساسي) وTEST-012 (3 وحدة للمؤشر). **فروق عن المقترح أعلاه (مثبَّتة في ADR-028):** مؤشر الإنشاء يعتمد المفتاح الأساسي UUIDv7 بدل `(createdAt,id)` لأن دقة `created_at` الميكروية تُسقط صفوفاً عبر الصفحات؛ أُضيف `sort` (`createdAt`/`fullName`) و`order`؛ الحد الافتراضي 20؛ `includeDeleted` مقيَّد بصلاحية `users.deactivate` (لا "للمدير" نصاً)؛ `password_changed_at` و`must_change_password` مستبعدان أيضاً ليتحقق المعيار (2) حرفياً. **اكتشاف:** Prisma لا يهرب `%`/`_` في `contains` (KI-034) — معالَج بـ `escapeLikePattern()`.

#### MOD-03-T02 — إنشاء مستخدم بنوعه وملفه ودوره الافتراضي

- **النطاق:** `POST /api/users` بجسم: `kind` (`student|teacher|staff|guardian`)، `email?`/`username?` (أحدهما إلزامي؛ تطبيع `trim`+أحرف صغيرة)، `phone?` (E.164)، `fullName`، `fullNameLatin?`، `displayName?`، `locale?`، حقول الملف حسب النوع (`studentNumber`, `dateOfBirth`, `enrolledOn` | `employeeNumber`, `jobTitle`, `specialization`, `hiredOn`)، `roleKeys?` إضافية. ينشئ في **معاملة واحدة**: `users(status=invited, password_hash=null)` + الملف المطابق + الدور النظامي المطابق للنوع (+ الإضافية إن حمل المستدعي `users.roles.assign`) + حدث تدقيق `users.created` (المعرّفات والنوع والأدوار فقط).
- **AC:** (1) بلا `users.create` → 403؛ (2) بريد أو اسم مستخدم مكرر → `409 email_in_use`/`username_in_use` (بما في ذلك المحذوفين منطقياً)؛ (3) بلا بريد ولا اسم مستخدم → `400`؛ (4) `kind=student` ينشئ `student_profiles` ودور `student` بالضبط؛ `teacher`/`staff` ينشئ `employee_profiles.kind` المطابق؛ `guardian` بلا ملف؛ (5) أدوار إضافية بلا `users.roles.assign` → `403`؛ `academy_admin` كدور إضافي يحتاج `users.roles.assign` أيضاً؛ (6) فشل أي خطوة = لا صف ولا حدث (rollback)؛ (7) الحساب الجديد لا يستطيع الدخول قبل التفعيل (`403 account_not_activated` — سلوك MOD-01 القائم).
- **الاختبارات:** شامل في `users.e2e-spec.ts` لكل بند؛ وحدة لدوال التطبيع والتحقق.
- **الاعتماديات:** T01. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0018، 2026-10-29).** العقد النهائي API-014 في الوثيقة الرئيسية 10.2؛ الاختبارات TEST-011 (+9 شاملة لكل معيار قبول: الأنواع الأربعة، التكرار مع المحذوفين منطقياً، التراجع عند تكرار رقم الطالب/الموظف، الطلبات المتزامنة، الإدخال غير الصالح، الصلاحيات، منع التصعيد، الدخول قبل التفعيل) وTEST-014/TEST-015 (وحدة: التطبيع والتحقق، سياسة الأدوار). **فروق عن المقترح أعلاه (مثبَّتة في ADR-030):** حقول الملف في كائنَين متداخلَين `studentProfile`/`employeeProfile` (الكائن غير المطابق للنوع → `422 profile_mismatch`)؛ **قاعدة عدم التجاوز** بطلب المالك: كل صلاحية يمنحها أي دور (الافتراضي أو الإضافي) يجب أن يحملها المنشئ باستثناء الخط الأساسي للمتعلمين (افتراضيات `student`/`guardian`) — فالموظف (`staff`) يُنشئ طلاباً وأولياء أمور وموظفين لا معلمين، وحامل `users.roles.assign` بلا كل الصلاحيات لا يُنشئ مديراً؛ الأدوار النظامية الإضافية غير المتوافقة مع ملف النوع تُرفض (`student` مع غير طالب → `422 profile_mismatch`؛ `teacher`/`staff` مع طالب/ولي → `422 employee_kind_required`) ويُكمَّل ذلك في T07؛ كودان جديدان `student_number_in_use`/`employee_number_in_use` (409) من قيود الفريدية؛ حدث التدقيق `users.created` بـ `{ kind, roles, profile }` بلا بريد ولا أسماء. **اكتشاف:** مع محوّل `pg` يأتي P2002 بلا `meta.target` (الفهرس في `meta.driverAdapterError.cause.constraint.index`) — KI-036.

#### MOD-03-T03 — الدعوة وتفعيل الحساب

- **النطاق:** `AccountModule`: خدمة رموز `VerificationTokenService` (32 بايت عشوائية، SHA-256 في `verification_tokens`، TTL من `AUTH_INVITATION_TTL_HOURS`). `POST /api/users/:id/invitations` (`users.create`): يُلغي (يستهلك) دعوات المستخدم المعلّقة السابقة، يُنشئ رمزاً جديداً، ويُعيد `{ token, expiresAt }` **مرة واحدة** (التسليم اليدوي: الواجهة تبني الرابط `/invite/<token>` وتعرض زر نسخ — D-R01، وهي القناة الوحيدة حتى LR-01 بقرار D-R08)؛ حدث `users.invitation.issued`. `GET /api/account/invitations/:token` (عام): يُعيد اسم المدعو والبريد المقنَّع وتاريخ الانتهاء أو `404 invitation_invalid`/`410 invitation_expired`/`409 invitation_consumed`. `POST /api/account/invitations/:token/accept` (عام، تحديد معدل): `{ password }` بسياسة MOD-01 → في معاملة: `password_hash`, `status=active`, `password_changed_at`, `consumed_at` — **بلا `email_verified_at`** (D-R08: الرابط اليدوي لا يثبت ملكية البريد؛ يُضبط فقط عبر رسالة فعلية مُسلَّمة إلى العنوان نفسه — LR-01)؛ حدث `users.invitation.accepted` (الفاعل = المستخدم نفسه)؛ ثم إصدار جلسة كما في `login` (كعكة + رمز وصول).
- **تجريد البريد (D-R08 — CH-0019، ADR-031):** وحدة مستقلة `MailModule` في `backend/src/mail/` بواجهة `MailTransport { send(message): Promise<MailDeliveryResult> }` وخدمة `MailService` (`sendInvitation()`, `sendPasswordReset()`, لاحقاً `sendEmailVerification()`) تبني الرسالة من قوالب `ar`/`en` ولا تعرف المزوّد؛ `AccountModule` يستدعي `MailService` فقط، فإضافة Resend أو SMTP لاحقاً = تنفيذ `MailTransport` جديد بلا تغيير في المصادقة أو العقود. التنفيذ الوحيد الآن `NoopMailTransport` (لا يرسل شيئاً؛ يسجّل حدثاً بلا رمز ولا رابط ولا عنوان). **فصل الاختبار المحلي عن الإنتاج بالكود:** متغير مقترح `MAIL_TRANSPORT` (`none` افتراضياً؛ `log` للتطوير فقط يكتب الرابط إلى سجل الخادم) يُضاف إلى `env.schema.ts` + `.env.example` بقيد `superRefine`: `log` مرفوض عند `NODE_ENV=production`، و`AUTH_SELF_SERVICE_RESET_ENABLED=true` مرفوض ما دام الناقل `none`؛ لا نقطة نهاية ولا علم يكشف الرموز أو يتجاوز التحقق في الإنتاج؛ الرمز الخام يظهر مرة واحدة فقط في استجابة الإصدار للمسؤول المخوَّل في كل البيئات. الأسماء النهائية تُثبَّت في الوثيقة الرئيسية 11.3 عند التنفيذ.
- **AC:** (1) الرمز الخام لا يُخزَّن ولا يظهر في التدقيق (تجزئة فقط؛ `assertNoSecrets` لا يُطلق)؛ (2) الرمز يُستهلك مرة واحدة؛ المحاولة الثانية `409`؛ (3) المنتهي `410` ولا يغيّر الحساب؛ (4) إصدار دعوة جديدة يُبطل القديمة؛ (5) بعد القبول: `GET /api/auth/me` 200 بالأدوار المعيَّنة في T02، والدخول بالكلمة الجديدة يعمل؛ (6) حساب `suspended`/`archived` لا يُدعى (`409 user_not_invitable`)؛ (7) تحديد معدل على المسارات العامة (`429`)؛ (9) بعد القبول عبر رابط يدوي يبقى `email_verified_at` فارغاً (D-R08)؛ (10) `MAIL_TRANSPORT=log` مع `NODE_ENV=production`، و`AUTH_SELF_SERVICE_RESET_ENABLED=true` مع `MAIL_TRANSPORT=none`، يُفشلان الإقلاع برسالة تسمّي المتغير (TEST-003)؛ (11) `MailService` مختبرة بوحدة مع ناقل وهمي بلا شبكة، ولا يظهر رمز أو رابط أو عنوان بريد في `audit_logs` ولا في سجل الخادم تحت الناقل `none` (المعيار 8 هو معيار SEC-R-13 أدناه).
- **الاختبارات:** شامل `test/account.e2e-spec.ts`؛ وحدة لخدمة الرموز (التجزئة، الانتهاء) ولـ `MailService` بناقل وهمي؛ TEST-003 لحالتَي رفض الإقلاع.
- **متطلب أمني مضاف في CH-0018 (SEC-R-13):** ما دام الرمز يُسلَّم يدوياً (D-R01) يستطيع مُصدِر الدعوة قبولها بنفسه، فيجب أن يطبّق إصدار الدعوة (`POST /api/users/:id/invitations`) **قاعدة عدم التجاوز نفسها** المطبَّقة في T02 على مجموعة أدوار المستخدم المدعو مقابل صلاحيات المُصدِر (`exceedingPermissions()` في `users.policy.ts`)، وإلا `403 permission_denied`؛ معيار قبول إضافي: AC (8) موظف لا يستطيع إصدار دعوة لمعلم أو مدير أنشأه المدير.
- **الاعتماديات:** T02 ✔ (CH-0018)؛ D-R01 + D-R08 (قناة التسليم يدوية حتى LR-01؛ لا بريد فعلي في التطوير — CH-0019). **التقدير:** M (+S لتجريد البريد). **الحالة:** **`IMPLEMENTED` (CH-0020، 2026-10-30).** العقود النهائية API-015/API-016/API-017 في الوثيقة الرئيسية 10.2؛ الاختبارات TEST-020 (12 شاملة: معايير القبول 1–11 كلها بما فيها SEC-R-13 وتحديد المعدل وفحص الأصل)، TEST-017 (5 وحدة: `MailService` والناقلان والقوالب)، TEST-018 (3: خدمة الرموز)، TEST-019 (2: التقنيع)، وTEST-003 +1 (حالتا رفض الإقلاع). **فروق عن المقترح أعلاه (مثبَّتة في ADR-032):** الدعوة مقصورة على الحساب بحالة `invited` فقط (كل حالة أخرى `409 user_not_invitable` بـ `status` — أشدّ من «suspended/archived»)؛ الدعوة المُبطَلة بإصدار جديد تُقرأ `409 invitation_consumed` لا كوداً مستقلاً؛ فحص SEC-R-13 يسبق فحص الحالة؛ الاستجابة تحمل أيضاً `userId` و`link` (من `APP_PUBLIC_URL` أو نسبي) و`delivery { transport, status }`؛ القبول يسجّل `users.invitation.accepted` ثم `auth.login.succeeded` بـ `via: "invitation"` عبر `AuthService.openSession()` المستخرجة من `login`؛ المعاينة تُعيد `roles` أيضاً؛ حدود المعدل لكل IP: المعاينة 60/دقيقة والقبول 20/15 دقيقة (أعلى من `login` لأن المدعوين قد يشتركون في شبكة واحدة)؛ `MAIL_TRANSPORT` اعتُمد اسماً نهائياً (ENV-40) بناقل `log` للتطوير إضافةً إلى `none`؛ القوالب نصية فقط `ar`/`en` (`tr` تسقط إلى لغة الأكاديمية ثم `ar`). **تعديل مصاحب في MOD-01 بلا تغيير سلوكي:** استخراج `createSession()`/`openSession()` و`session.presenter.ts` (TEST-008 بلا تغيير).

#### MOD-03-T04 — تعديل بيانات المستخدم

- **النطاق:** `PATCH /api/users/:id` (`users.update`): الأسماء، `displayName`, `phone`, `locale`, `avatarUrl`, حقول الملف الموجود؛ `email`/`username` مع فحص الفريدية وإعادة ضبط `email_verified_at` عند تغيير البريد؛ حدث `users.updated` بقائمة الحقول المتغيرة (أسماء الحقول فقط، لا القيم الحساسة).
- **AC:** (1) 403 بلا الصلاحية؛ (2) تكرار → 409؛ (3) تغيير البريد يُفرغ `email_verified_at`؛ (4) حقول غير معلنة → 400؛ (5) تعديل ملف غير موجود (مثل `studentNumber` لمعلم) → `422 profile_mismatch`؛ (6) حدث تدقيق واحد بالحقول المتغيرة.
- **متطلب أمني مضاف في CH-0022 (SEC-R-15):** على نسق SEC-R-13، تغيير `email`/`username` لمستخدم تمنحه أدواره صلاحية لا يملكها المستدعي يُرفض بـ `403 permission_denied` (`exceedingPermissions()`)؛ الحقول الأخرى غير مشمولة. **فروق تنفيذ موثَّقة في API-018:** `fullName` لا يقبل `null`؛ الجسم الفارغ → `400 nothing_to_update` (كود جديد، 27)؛ إزالة آخر معرّف دخول → `400 identifier_required`؛ الطلب بلا فرق فعلي → `200` بلا كتابة ولا حدث؛ `kind`/`isActive` خارج النطاق (T06/T07).
- **الاختبارات:** شامل في `users.e2e-spec.ts` (+8) ووحدة `users.changes.spec.ts` (11) و`users.validation.spec.ts` (+1). **الاعتماديات:** T01 ✔. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0022، 2026-10-30) — API-018؛ TEST-011/TEST-014/TEST-022.**

#### MOD-03-T05 — استعادة كلمة المرور

- **النطاق:** `POST /api/users/:id/password-reset` (`users.update`): رمز `password_reset` بـ TTL من `AUTH_PASSWORD_RESET_TTL_MINUTES`، يُبطل رموز الإعادة السابقة، يُعيد `{ token, expiresAt }` مرة واحدة (تسليم يدوي حتى D-R01)، يضبط `must_change_password=true`؛ حدث `users.password_reset.issued`. `POST /api/account/password-reset/:token/confirm` (عام، تحديد معدل): `{ newPassword }` → تجزئة جديدة، `password_changed_at`، `consumed_at`، **إلغاء كل `refresh_tokens`** للمستخدم، فك القفل؛ حدث `auth.password.reset`. `POST /api/account/password-reset/request` (عام): يُعيد `202` دائماً دون كشف وجود الحساب — **لا يُنفَّذ الإرسال حتى توفر قناة بريد (D-R01/D-R08)؛ يُسجَّل كمعطَّل بعلم بيئة، وتفعيل `AUTH_SELF_SERVICE_RESET_ENABLED=true` مرفوض عند الإقلاع ما دام `MAIL_TRANSPORT=none` (قيد T03)؛ يُفعَّل في LR-01 بعد اختبار التسليم**.
- **AC:** (1) الرمز لمرة واحدة؛ المنتهي `410`؛ (2) بعد التأكيد: الجلسات القديمة ميتة (`refresh` → 401)، رموز الوصول الأقدم `token_invalid`، الدخول بالكلمة الجديدة يعمل؛ (3) حساب مقفل يُفكّ قفله بالتأكيد؛ (4) المسار الذاتي يُعيد 202 للمعروف والمجهول بزمن متقارب ولا يُنشئ رمزاً وهو معطَّل؛ (5) لا كلمة مرور ولا رمز في التدقيق.
- **فروق تنفيذ موثَّقة في API-019..API-021 وADR-033 (CH-0023):** الإصدار الإداري لحالة `active` فقط وغيرها `409 user_not_resettable` بـ `{ status }` (كود جديد؛ القاموس 28) — `invited` يُعاد دعوته (T03) و`pending`/`suspended`/`archived` شأن T06؛ قاعدة عدم التجاوز (SEC-R-15) تُطبَّق على أدوار الهدف **قبل** فحص الحالة كما الدعوة؛ الرمز المستهلك أو المُبطَل بإصدار أحدث يُقرأ `404 reset_invalid` (لا كود استهلاك — القاموس المحجوز في T00 يُحترم)؛ المسار الذاتي المعطَّل يُجيب **`403 reset_disabled`** بلا أي استعلام (بدل `202` صامت — الواجهة تحتاج الإشارة)، وعند تفعيله `202` موحَّد والمعاملة والبريد **بعد الاستجابة** (`setImmediate`) فيتحقق تقارب الزمن بالبناء، بلا `must_change_password` للطلب الذاتي؛ التأكيد يرفض الكلمة الحالية (`password_weak`) ويفتح جلسة عبر `openSession(…, "password_reset")` بعد إبطال كل `refresh_tokens`؛ حدود المعدل: التأكيد 20/15 دقيقة لكل IP، الطلب 5/15 دقيقة لكل (IP, identifier). الاستجابة بشكل API-015 (`{ userId, token, link, expiresAt, delivery }`).
- **الاختبارات:** شامل في `account.e2e-spec.ts` (+12) و`password-reset.e2e-spec.ts` (4، المسار الذاتي مفعَّلاً بناقل مسجِّل). **الاعتماديات:** T03 ✔ (خدمة الرموز). **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0023، 2026-10-30) — API-019..API-021؛ TEST-023؛ ADR-033.** يبقى تفعيل المسار الذاتي (`AUTH_SELF_SERVICE_RESET_ENABLED=true`) لمهمة LR-01 بعد اختبار التسليم.

#### MOD-03-T06 — إدارة حالات الحساب

- **النطاق:** `POST /api/users/:id/status` بجسم `{ action: activate|suspend|archive|restore|unlock, reason? }`: الانتقالات المسموحة (`pending→active`, `active→suspended`, `suspended→active`, `active|suspended→archived`, `archived→active` بـ `restore`)؛ `suspend`/`archive` تُلغي كل `refresh_tokens`؛ `unlock` يصفّر `failed_login_count` و`locked_until` (`users.update`). `DELETE /api/users/:id` حذف منطقي (`deleted_at` + `archived`). حدث `users.status.changed` بـ `{ from, to, reason }`.
- **AC:** (1) الانتقال غير المسموح → `409 invalid_transition`؛ (2) لا يستطيع المستخدم تعليق/أرشفة/حذف نفسه (`403 self_forbidden`)؛ (3) لا يمكن تعليق/أرشفة/حذف **آخر** `academy_admin` نشط (`409 last_admin`)؛ (4) بعد التعليق يفقد المستخدم الوصول فوراً (`/me` → 403) وكعكته لا تجدّد؛ (5) المحذوف منطقياً لا يظهر في القائمة ولا يدخل، وبريده يبقى محجوزاً؛ (6) كل انتقال حدث تدقيق واحد.
- **الاختبارات:** شامل. **الاعتماديات:** T01. **التقدير:** M. **الحالة:** `IMPLEMENTED` (CH-0025 — API-027/API-028، TEST-026 شامل 10 + وحدة 8، ADR-035، SEC-R-17؛ المعايير الستة متحققة بالاختبار الشامل على القاعدة الحية، وAC3 بطلبَين متزامنَين).
- **فروق تنفيذ موثَّقة في API-027/API-028 وADR-035 (CH-0025):** المحذوف منطقياً حالة زائفة نهائية `deleted` — أي إجراء عليه (بما فيه `restore` والحذف الثاني) `409 invalid_transition` بـ `{ from: "deleted", action, allowed: [] }` لحامل `users.deactivate` و`404` لغيره (قاعدة رؤية المحذوفين — T01)؛ الخطأ يحمل دائماً `allowed` (الإجراءات المتاحة من الحالة الراهنة)؛ **قاعدة عدم التجاوز (SEC-R-17) مطبَّقة على كل الإجراءات الخمسة وعلى الحذف** قبل أي فحص للحالة (لا على `suspend`/`archive`/`delete` وحدها)؛ `self_forbidden` على `suspend`/`archive`/`delete` فقط — `unlock` على الذات مسموح و`activate`/`restore` على الذات غير قابلة للتطبيق (المستدعي `active`)؛ `unlock` لحساب بلا قفل وبلا محاولات فاشلة → `200` بلا كتابة ولا حدث (idempotent كما T04)، ويقبل `users.update` **أو** `users.deactivate`؛ الصلاحية تُفحص في المتحكم لأنها تعتمد على `action`؛ آخر مدير يُعدّ بعد `SELECT … FOR UPDATE` على صفوف المدراء النشطين داخل المعاملة (المدير الموقوف ليس من النصاب فأرشفته/حذفه مسموحان)؛ الحذف المنطقي حدث مستقل **`users.deleted`** `{ action: "delete", from, to: "archived", reason, revokedSessions }` ويقبل `reason?` في جسم اختياري ويُعيد `200` بالتفاصيل (لا `204`)؛ `users.status.changed` يحمل `{ action, from, to, reason }` + `revokedSessions` عند الإبطال + `lockedUntil`/`failedAttempts` لـ `unlock`؛ `employee_profiles.is_active` خارج النطاق (حالة توظيف لا حالة حساب). لا كود جديد (المصانع على الأكواد المحجوزة؛ القاموس 28)، لا ترحيل، لا مفاتيح جديدة.

#### MOD-03-T07 — تعيين الأدوار للمستخدمين

- **النطاق:** `PUT /api/users/:id/roles` `{ roleKeys: string[] }` (`users.roles.assign`): استبدال كامل في معاملة؛ `assigned_by` = الفاعل؛ إنشاء الملف الناقص عند إضافة `student`/`teacher`/`staff` (الموظف يحتاج `kind` إن لم يوجد ملف → `422 employee_kind_required`)؛ حدث `users.roles.changed` بـ `{ added, removed }`.
- **AC:** (1) مفتاح دور غير موجود → `400 role_unknown`؛ (2) لا يمكن إزالة `academy_admin` من آخر مدير نشط (`409 last_admin`)؛ (3) لا يمكن للفاعل إزالة `academy_admin` من نفسه (`403 self_forbidden`)؛ (4) الصلاحيات الجديدة سارية في الطلب التالي بلا إعادة دخول (المبدأ يُقرأ من القاعدة)؛ (5) القائمة الفارغة مسموحة (مستخدم بلا أدوار) إلا لآخر مدير.
- **الاختبارات:** شامل. **الاعتماديات:** T02. **التقدير:** S. **الحالة:** `IMPLEMENTED` (CH-0027 — API-034، TEST-028 شامل 8 + وحدة 5، ADR-037؛ المعايير الخمسة متحققة بالاختبار الشامل على القاعدة الحية، وAC2 بطلبَين متزامنَين).
- **فروق تنفيذ موثَّقة في API-034 وADR-037 (CH-0027):** قاعدة عدم التجاوز **مرتين** — على أدوار الهدف الحالية قبل أي فحص (SEC-R-17؛ حامل `users.roles.assign` غير المدير لا يلمس أدوار معلم أو مدير ولو بإضافة `guardian`) وعلى كل دور يُضاف (SEC-R-16)؛ الاستبدال يُكتب كفرق (المنح المحتفَظ بها تبقى بتاريخها ومانحها، المضافة بـ `assigned_by` = الفاعل)؛ `employeeKind?` في الجسم يُستنتج من الدور المضاف الوحيد وإلزامي عند إضافة `teacher`+`staff` معاً لمن بلا ملف موظف (`422 employee_kind_required`)، والقيمة التي تخالف ملفاً موجوداً أو كانت ستُهمَل → `422 profile_mismatch`؛ الملفات لا تُحذف مع الدور؛ `self_forbidden` بـ `action: "remove_academy_admin"` على سحب الدور من الذات فقط؛ المدير غير `active` خارج نصاب آخر مدير؛ الهدف المدير النشط يُقفل عبر `lockActiveAdmins()` نفسها (ترتيب قفل واحد مع T06) وغيره بصف `FOR NO KEY UPDATE`؛ الطلب بلا فرق لا يكتب ولا يسجّل؛ الحدث يحمل `{ added, removed, roles, profilesCreated? }`؛ المحذوف منطقياً `404`؛ لا كود جديد. **اكتشاف:** عدّ آخر مدير في قفل T06 كان يعدّ مديراً سُحب دوره في معاملة متزامنة (لقطة READ COMMITTED لـ `user_roles`) — أُصلح في `lockActiveAdmins()` بعبارتين (KI-041).

#### MOD-03-T08 — إدارة الأدوار والصلاحيات

- **النطاق:** `RolesModule`: `GET /api/roles` (`users.read`؛ المفتاح، التسمية `{ar,en?}`، `isSystem`، عدد المستخدمين، الصلاحيات)؛ `GET /api/permissions` (`roles.manage`؛ الكتالوج النشط مجمَّعاً بالوحدة)؛ `POST /api/roles` (`roles.manage`؛ `key` بنمط `^[a-z][a-z0-9_]{2,63}$` غير محجوز، `label` بـ `ar` إلزامية، `permissions[]` من الكتالوج النشط)؛ `PATCH /api/roles/:id` (التسمية/الوصف/الصلاحيات؛ **`academy_admin` غير قابل للتعديل**؛ الأدوار النظامية الأخرى: الصلاحيات فقط)؛ `DELETE /api/roles/:id` (المخصّصة فقط؛ `409 role_in_use` إن كانت ممنوحة). أحداث `roles.created/updated/permissions.changed/deleted`.
- **AC:** (1) مفتاح مهمل (`deprecated_at`) أو غير موجود → `400 permission_unknown`؛ (2) تعديل `academy_admin` → `403 role_immutable`؛ (3) حذف دور نظامي → `403`؛ حذف ممنوح → `409`؛ (4) تغيير صلاحيات دور يسري على مستخدميه في الطلب التالي؛ (5) إعادة البذر (`npm run prisma:seed`) لا تمحو تعديلات المدير على الأدوار النظامية غير `academy_admin` (سلوك البذر القائم) — اختبار يثبته.
- **الاختبارات:** شامل `test/roles.e2e-spec.ts` (TEST-024، 12) + وحدة `roles.policy.spec.ts` (TEST-025، 4). **الاعتماديات:** T01. **التقدير:** M. **الحالة:** `IMPLEMENTED` (CH-0024؛ API-022..API-026؛ ADR-034). **فروق التنفيذ:** (1) قاعدة عدم التجاوز (SEC-R-13/15) طُبِّقت على كل مفتاح يُمنح عند الإنشاء ويُضاف عند التعديل — خيار AC6 — فحامل `roles.manage` لا يصنع دوراً بصلاحيات لا يحملها (SEC-R-16)؛ (2) حدث واحد بالضبط لكل PATCH: `roles.permissions.changed` (`added`/`removed` + `fields` لما تغيّر معها) عند تغيّر المجموعة وإلا `roles.updated` (`fields`)؛ (3) لا كود جديد في القاموس: `409 role_in_use` بـ `key` للمفتاح المأخوذ أو المحجوز (POST) وبـ `userCount` للدور الممنوح (DELETE)، `404 role_unknown` بالمعرّف؛ (4) تعديل تسمية/وصف دور نظامي غير `academy_admin` → `403 role_immutable` بـ `fields` (ملكهما للبذر الذي يحدّثهما)؛ (5) PATCH بلا فرق لا يكتب ولا يسجّل، و`{}` → `400 nothing_to_update`؛ (6) `GET /api/permissions` من جدول `permissions` المبذور (`deprecated_at IS NULL`) لا من الكود؛ (7) AC5 أُثبت باستيراد `seedCatalog()` من `prisma/seed.ts` داخل معاملة (لا تشغيل للسكربت) على `guardian` مع استعادة الافتراضيات؛ (8) لا `GET /api/roles/:id` (القائمة تحمل كل شيء). **متطلب لاحق:** T07 تطبّق القاعدة نفسها على `PUT /api/users/:id/roles`.

#### MOD-03-T09 — ربط أولياء الأمور بالطلاب

- **النطاق:** مسارات T09 في §4.4 (`guardians.link`): الربط يتطلب أن يحمل الولي دور `guardian` والطالب دور `student`؛ `relationship` من التعداد؛ `isPrimary=true` يُنزل الأساسي السابق في المعاملة نفسها؛ الفك يحذف الصف. أحداث `guardians.linked/updated/unlinked`.
- **AC:** (1) ولي بلا دور → `422 not_a_guardian`؛ طالب بلا دور → `422 not_a_student`؛ (2) الشخص نفسه → `400` (CHECK في القاعدة يُترجَم)؛ (3) أساسي واحد فقط بعد أي تسلسل عمليات؛ (4) الرابط المكرر → `409 already_linked`؛ (5) القراءة من الجهتين (`guardians` للطالب، `students` للولي) متسقة؛ (6) حدث تدقيق لكل عملية.
- **الاختبارات:** شامل `test/guardians.e2e-spec.ts` (TEST-027: 9 شاملة + 5 وحدة). **الاعتماديات:** T02. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0026، 2026-10-30)** — وحدة جديدة `backend/src/guardians/` (API-029..API-033 في الوثيقة الرئيسية 10.2؛ FS-058؛ ADR-036). **فروق التنفيذ عن النص أعلاه:** (أ) قاعدة عدم التجاوز **مطبَّقة** على أدوار الولي والطالب معاً قبل فحص الدورين في كل كتابة (SEC-R-18 — النسق نفسه كـ SEC-R-13/15/16؛ معيار «يُستحسن» صار ثابتاً)؛ (ب) الشخص نفسه يُرفض بتحقق مسبق في الكود بـ `400` بشكل أخطاء التحقق (بلا `code`) والـ CHECK يبقى الحسم ويُترجَم إلى 400 نفسه؛ (ج) «الأساسي الواحد» يُفرض بقفل `FOR UPDATE` على صف الطالب ثم تنزيل السابق ثم الكتابة في المعاملة نفسها، والفهرس الجزئي حسم السباقات (P2002 → `409 already_linked`)؛ (د) لا كود جديد: رابط غير موجود في PATCH/DELETE → `404 user_not_found` بـ `reason: not_linked`، وطرف مجهول/محذوف → `404 user_not_found` بـ `party`؛ (هـ) عناصر القوائم تحمل `user` كاملاً بإسقاط D-R07 (لا `{ userId, fullName }` فقط) لتكفي شاشة T14؛ الروابط إلى محذوفين منطقياً مخفية وغير قابلة للكتابة حتى الاستعادة؛ (و) حدث التدقيق بـ `entity_type=users`/`entity_id` = الطالب و`metadata` تحمل الولي و`demotedGuardianUserId`؛ (ز) `isPrimary` في الأجسام منطقي حصراً (التحويل الضمني كان يقبل `'yes'`). بوابة الدفعة C «ولي أمر مرتبط بطالبَين» متحققة في TEST-027 (الولي الأول مرتبط بالطالبَين ويُقرأ من الجهة الأخرى).

#### MOD-03-T10 — تغطية التدقيق الإداري ومرشّحات السجل

- **النطاق:** مراجعة أن كل مسار كاتب في T02..T09 يسجّل حدثاً واحداً داخل معاملته عبر `AuditService.record(…, tx)` مع `ip`/`userAgent` من `requestContext()`؛ توسيع `GET /api/audit-logs` بمرشّحات `action` (بادئة)، `actorUserId`، `entityType`+`entityId`؛ توثيق قاموس أحداث MOD-03 في القسم 12.
- **AC:** (1) لكل مسار كاتب اختبار يثبت حدثاً واحداً بالضبط بالاسم المتوقع ✔؛ (2) فشل التحقق أو القيد = صفر أحداث ✔؛ (3) المرشّحات تعمل مجتمعةً مع الترقيم ✔؛ (4) لا قيمة في `metadata` تطابق مفاتيح الأسرار (يُعاد استخدام `assertNoSecrets`) ✔ — كلها في TEST-030.
- **الاختبارات:** شامل `test/audit.e2e-spec.ts` (TEST-030: 14 شاملة + 5 وحدة) بدل توسيع TEST-008. **الاعتماديات:** T02..T09. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0029، 2026-10-30 — بالتوازي مع T11 في جلسة ثانية)** — عقد API-011 بمرشّحاته في الوثيقة الرئيسية 10.2، قاموس الأحداث (25 حدثاً للمصادقة وMOD-03) في 12.4، ADR-039. **فروق التنفيذ عن النص أعلاه:** (أ) مجموعة شاملة مركزية جديدة تمشي كل المسارات الكاتبة عبر API بفاعل واحد وتعدّ الأحداث بالفاعل (مستقرة على قاعدة التطوير المشتركة مع الجلسات المتوازية) بدل توسيع TEST-008؛ المراجعة أكّدت أن كل متحكم كاتب يمرّر `requestContext(req)` ويسجّل داخل معاملته — لا فجوة في الكود؛ (ب) **إصلاح ترقيم السجل (KI-042):** المؤشر الزمني `nextBefore` كان يفقد أحداث الملّي ثانية الواحدة، فصار الترتيب والمؤشر على المفتاح UUIDv7 (`cursor`/`nextCursor`، قراءة `limit+1`) و`before` مرشّح زمني فقط — تغيير عقد بلا مستهلك قبل T15؛ (ج) `entityId` يتطلب `entityType` (`400` برسالة واضحة) ليبقى الاستعلام على الفهرس؛ (د) بادئة `action` حرفية بهروب LIKE (`_` ليست بديلاً — KI-034) ونمط صارم؛ (هـ) نقل `escapeLikePattern()` إلى `users.validation.ts` لتشاركها الوحدتان؛ (و) رفع مهلة اختبارَي OpenAPI في `app`/`account` إلى 20 ثانية (KI-040). بوابة الدفعة C الثالثة («حدث واحد بالضبط لكل مسار كاتب») متحققة بـ TEST-030.

#### MOD-03-T11 — الواجهة: قائمة المستخدمين الحقيقية + إنشاء/تعديل

- **النطاق:** استبدال `UsersPage` التجريبية بجدول من `GET /api/users` (بحث، مرشّحات، ترقيم، وسوم الحالة)، درج تفاصيل/تعديل، ومعالج إنشاء (النوع ← الحقول)؛ `frontend/src/api/users.ts`؛ رسائل أخطاء بحسب `code`؛ i18n `ar`/`en`.
- **AC:** (1) الصفحة لا تستورد من `mock/data.ts`؛ (2) الإجراءات تظهر فقط لمن يحمل الصلاحية (`hasPermission`) والخادم يبقى الحدّ الأمني؛ (3) `tsc -b`/`lint`/`build` نظيفة؛ (4) تحقق يدوي موثَّق للرحلة: إنشاء → ظهور في القائمة → تعديل.
- **الاختبارات:** حسب D-R05 (إن اعتُمد الإطار: اختبار مكوّن للجدول والمعالج)؛ وإلا تحقق يدوي موثَّق. **الاعتماديات:** T01, T02, T04. **التقدير:** L. **الحالة:** **`IMPLEMENTED` (CH-0030، 2026-10-30)** — `frontend/src/pages/UsersPage.tsx` + مجلد الميزة `frontend/src/users/` + `frontend/src/api/users.ts` (FS-060؛ TEST-031 57 اختباراً؛ التفاصيل في MOD-FE-01 وصفوف «الواجهة» لـ API-012/013/014/018 في الوثيقة الرئيسية). **فروق التنفيذ عن النص أعلاه:** (أ) الترقيم keyset من API-012 يظهر كـ «السابق/التالي» على مكدّس مؤشرات (لا أرقام صفحات)، وأي تغيير في مرشّح يعيد إلى الصفحة الأولى؛ (ب) معالج الإنشاء ثلاث خطوات (النوع ← الهوية ← الملف + الأدوار الإضافية لحامل `users.roles.assign`) ويختصر إلى خطوتين لولي الأمر بلا صلاحية الأدوار؛ (ج) التعديل يرسل أصغر جسم `PATCH` بفرق محسوب محلياً (`planUserPatch()`) ولا يرسل شيئاً بلا فرق؛ بيانات الاتصال لا تُعرض ولا تُرسل بلا `users.read_contact` (D-R07)؛ `notes` خارج التعديل لأن API-013 لا يعيدها؛ (د) تسميات الأدوار النظامية من قاموس الواجهة والمخصّصة بمفتاحها حتى T13؛ (هـ) حقول التاريخ `<input type="date">` بلا تبعية جديدة. **AC:** (1) ✔ لا استيراد من `mock/data.ts`؛ (2) ✔ زر الإضافة/التعديل/عمود الاتصال/مربع المحذوفين/حقل الأدوار بحسب `hasPermission()`؛ (3) ✔ `tsc -b`/`lint`/`build` نظيفة؛ (4) **لم يُنفَّذ في الجلسة** — لا أداة متصفح ولا بيانات دخول؛ الرحلة مغطاة بالاختبارات المكوّنية، ويبقى التحقق اليدوي من المتصفح على المالك (`UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)). تبعية T15: `useUsersList`/`UsersPage` جاهزتان للحارس بالصلاحية؛ T12/T14 تضيفان تبويباتهما إلى `UserDrawer`.

#### MOD-03-T12 — الواجهة: صفحتا التفعيل وإعادة الضبط العامتان + حوار الدعوة

- **النطاق:** مساران عامان في `router.tsx`: `/invite/:token` (يقرأ `GET /api/account/invitations/:token` ويعرض نموذج كلمة المرور ثم يدخل تلقائياً) و`/reset-password/:token`؛ حوار "دعوة" في تفاصيل المستخدم يعرض الرابط المولَّد مع زر نسخ وتاريخ الانتهاء (تسليم يدوي)؛ زر "إصدار رابط إعادة ضبط".
- **AC:** (1) الرمز لا يُحفظ في `localStorage` ولا يُرسل إلى أي مسار غير مساره؛ (2) رمز منتهٍ/مستهلَك يعرض رسالة واضحة بلا نموذج؛ (3) بعد التفعيل يصل المستخدم إلى `/` بأدواره؛ (4) الصفحات تعمل بـ RTL/LTR.
- **الاعتماديات:** T03 ✔ (CH-0020)، T05 ✔ (CH-0023). **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0031، 2026-10-30 — بالتوازي مع T13 في جلسة ثانية بتكليف المالك)** — `frontend/src/account/` + `frontend/src/api/account.ts` + زرا الإصدار في `frontend/src/users/UserDrawer.tsx` (FS-061؛ TEST-032 34 اختباراً؛ ADR-040؛ صفوف «الواجهة» لـ API-015/016/017/019/020/021 في الوثيقة الرئيسية 10.2). **فروق التنفيذ عن النص أعلاه:** (أ) الجلسة التي يعيدها القبول/التأكيد تُتبنّى مباشرة عبر `AuthContext.adoptSession()` (لا تجديد إضافي ولا إعادة دخول) ثم الانتقال بـ `replace` فيسقط إدخال التاريخ الحامل للرمز؛ (ب) الرمز غير المطابق لشكل الخادم (43 حرفاً base64url) يُعدّ ميتاً محلياً بلا طلب، والأحكام `invitation_invalid|consumed|expired` و`reset_invalid|expired` تستبدل النموذج برسالة وزر إلى `/login` بينما `password_weak` يبقي النموذج؛ (ج) صفحة إعادة الضبط بلا معاينة (لا نقطة نهاية لها) فالتحقق الأول على التأكيد؛ (د) «حوار الدعوة» صار نافذة واحدة `IssuedLinkModal` للدعوة وإعادة الضبط معاً تعرض الرابط **مرة واحدة** مطلقاً (النسبي يُكمَل بأصل الواجهة) مع نسخ وانتهاء وحالة التسليم، وزر إعادة الضبط خلف تأكيد لأنه يفرض `must_change_password`؛ (هـ) صفحة «نسيت كلمة المرور» لم تُبنَ (API-021 معطَّل بـ `reset_disabled` حتى LR-01 — مؤجَّلة إليها، §5.1). **AC:** (1) ✔ بالاختبار: لا قيمة في `localStorage`/`sessionStorage` تحوي الرمز، وقائمة الطلبات على مسار الرمز وحده بلا `Authorization`؛ (2) ✔ بالاختبار لثلاثة أحكام والرمز التالف؛ (3) ✔ بالاختبار: `adoptSession` ثم الوصول إلى `/` (و`/profile` عند `mustChangePassword`)؛ (4) ✔ بالاختبار: `dir="ltr"` بالإنجليزية ومبدّل اللغة في الصفحتين. **الرحلة من متصفح حقيقي** (إصدار ← فتح الرابط ← تفعيل ← `/`) **لم تُنفَّذ في الجلسة** — `UNVERIFIED` كما AC4 لـ T11؛ تُنفَّذ مرة من `:5173` بحساب المدير التجريبي. → ✔ نفّذها المالك (دعوة ← نافذة خاصة ← تفعيل: 2026-10-31 23:59 → 2026-11-01 00:00؛ CH-0042، §4.9).

#### MOD-03-T13 — الواجهة: إدارة الأدوار والصلاحيات

- **النطاق:** تبويب "الأدوار والصلاحيات" داخل إعدادات الأكاديمية كمسار فرعي `/settings/roles` (قرار المالك D-R06 — CH-0016): قائمة الأدوار، إنشاء دور مخصّص، تحرير الصلاحيات بمصفوفة وحدة×مفتاح بأوصاف `ar`/`en` من الكتالوج، حذف. البوابة: `roles.manage` مستقلة عن `academy.settings.read` (حامل `roles.manage` وحده يصل إلى التبويب وإن لم يرَ بقية الإعدادات) — أول محتوى حقيقي في `SettingsPage` قبل MOD-14 (ملاحظة ADR-027).
- **AC:** (1) `academy_admin` يظهر للقراءة فقط؛ (2) الحفظ يعكس الاستجابة الفعلية (لا تفاؤل بلا تراجع)؛ (3) `tsc -b`/`lint`/`build` نظيفة.
- **الاعتماديات:** T08. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0032، 2026-10-30 — بالتوازي مع T12 في جلسة ثانية، قبل T14 بتكليف المالك)** — `frontend/src/pages/SettingsPage.tsx` (تبويبان) + مجلد الميزة `frontend/src/roles/` + `frontend/src/api/roles.ts` (FS-062؛ TEST-033 37 اختباراً؛ التفاصيل في MOD-FE-01 وصفوف «الواجهة» لـ API-022..API-026 في الوثيقة الرئيسية). **فروق التنفيذ عن النص أعلاه:** (أ) البوابة داخل الصفحة لا في المسار: `/settings/roles` سطر شقيق لـ `/settings` بلا `RequireRole`، و`SettingsPage` يعيد 403 بلا `roles.manage` ويُظهر تبويب «عام» (التجريبي) فقط لمن تسمح له مصفوفة الدور بـ `/settings` — فيصل حامل `roles.manage` بأي دور إلى التبويب وحده كما نصّ D-R06؛ T15 تضيفه إلى التنقل؛ (ب) قاعدة عدم التجاوز (SEC-R-16) تُعكس محلياً كقفل في المصفوفة للمفاتيح التي لا يحملها المستدعي (الخط الأساسي للمتعلمين معفى؛ المفتاح الممنوح للدور أصلاً يبقى حراً لأن إزالته وإعادته لا تُنتج `added`) والخادم يبقى الحد؛ (ج) الحفظ بأصغر جسم `PATCH` محسوب محلياً (`planRolePatch()`: التسمية/الوصف للمخصّصة فقط مع حمل `tr`، و`permissions` المجموعة الكاملة فقط عند تغيّرها؛ بلا فرق = بلا طلب)؛ (د) `academy_admin` يُفتح للعرض بلا زر حفظ، والنظامية الأخرى تعرض تسميتها نصاً وتتيح الصلاحيات فقط، والحذف لا يظهر إلا للمخصّص ويُعطَّل بتلميح إن كان ممنوحاً؛ (هـ) كتلة الترجمة `rolesAdmin.*` (لا `roles.*` المحجوزة لتسميات أدوار الواجهة). **AC:** (1) ✔ `RoleEditor.test` — كل مربعات الكتالوج مُعلَّمة ومعطَّلة ولا حفظ؛ (2) ✔ `RolesManager.test` — الصف يعرض ما أعاده الخادم لا ما كُتب، ولا حالة تفاؤلية في `useRoles`؛ (3) ✔ `tsc -b`/`lint`/`build` نظيفة. **الرحلة اليدوية من المتصفح** (إنشاء دور ← تعديل صلاحياته ← حذفه) **لم تُنفَّذ** — لا أداة متصفح ولا بيانات دخول في الجلسة (`UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)، كما T11/T12).

#### MOD-03-T14 — الواجهة: تعيين الأدوار، حالات الحساب، ربط الأولياء

- **النطاق:** في تفاصيل المستخدم: تبويب الأدوار (اختيار متعدد → `PUT`)، قائمة إجراءات الحالة بتأكيد وسبب، تبويب الأولياء/الطلاب بالربط والفك وتعيين الأساسي.
- **AC:** (1) حالات `last_admin`/`self_forbidden` تُعرض برسائل مخصّصة؛ (2) بعد تغيير أدوار المستخدم الحالي تُستدعى `reloadUser()`؛ (3) الربط يرفض محلياً نفس الشخص قبل الإرسال.
- **الاعتماديات:** T06, T07, T09. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0033، 2026-10-30 — بالتوازي مع T15 في جلسة ثانية بتكليف المالك)** — `frontend/src/users/{UserDrawer, UserRolesTab, UserStatusActions, GuardianLinksTab}.tsx` + الدوال النقية `users.{status,roles,guardians}.ts` + `frontend/src/api/{users,guardians}.ts` (FS-063؛ TEST-034 42 اختباراً؛ ADR-041؛ التفاصيل في MOD-FE-01 وصفوف «الواجهة» لـ API-027/028/029..034 في الوثيقة الرئيسية). **فروق التنفيذ عن النص أعلاه:** (أ) الدرج صار بتبويبات (التفاصيل/الأدوار/أولياء الأمور أو الطلاب بحسب الصلاحية والدور) وقائمة الروابط للعرض انتقلت من التفاصيل إلى تبويبها؛ (ب) قائمة الإجراءات `Dropdown` واحدة تُبنى من مرآة آلة حالات T06 × صلاحيات المستدعي × قاعدة الذات، و`unlock` يظهر فقط عند قفل مرئي أو مجهول؛ التأكيد `Modal` بسبب **اختياري** (1–500؛ العقد لا يُلزمه ويسجّله في التدقيق فقط) و`invalid_transition` يعيد تحميل التفاصيل؛ (ج) خيارات الأدوار من `GET /api/roles` بتسمياتها (أول ظهور لتسميات الأدوار المخصّصة في شاشات المستخدمين — هذا التبويب وحده)، قفل محلي للدور الذي لا يمكن منحه (SEC-R-16) وقراءة فقط لمن يحمل دوراً خارج المدى (SEC-R-17) و`academy_admin` مقفل على الذات، `employeeKind` يُطلب عند إضافة `teacher`+`staff` معاً، و`PUT` بالمجموعة الكاملة عند الفرق فقط؛ (د) الربط ببحث بعيد على API-012 مقيَّد بالدور المقابل (حرفان، 10 نتائج، 250 مللي ثانية) والطرف نفسه والمرتبط مسبقاً معطَّلان ومرفوضان قبل الإرسال، تغيير العلاقة من `Select` في الصف، والقائمة تُقرأ من الخادم بعد كل كتابة؛ جهة الولي تكتب عبر مسار الطالب. **AC:** (1) ✔ `last_admin` و`self_forbidden` (بدلالتيه: الإجراءات و`remove_academy_admin`) برسائل مخصّصة — `UserDrawer.{status,roles}.test` و`users.errors.test`؛ (2) ✔ `reloadUser()` مرة واحدة بعد تغيير أدوار الذات — `UserDrawer.roles.test`؛ (3) ✔ الشخص نفسه مرفوض محلياً بلا طلب — `UserDrawer.guardians.test` و`users.guardians.test`. **الرحلة اليدوية من المتصفح** (تغيير أدوار ← إيقاف واستعادة ← ربط ولي وتعيينه أساسياً) **لم تُنفَّذ** — لا أداة متصفح ولا بيانات دخول في الجلسة (`UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)، كما T11..T13 وT15).

#### MOD-03-T15 — الواجهة: الانتقال من مصفوفة الأدوار إلى الصلاحيات في التنقل

- **النطاق:** `navigation.ts` يقبل `permissions?: string[]` لكل عنصر؛ عنصر "المستخدمون" يظهر لحامل `users.read`، و"الأدوار" لحامل `roles.manage`، و"سجل التدقيق" (صفحة قراءة جديدة بسيطة) لحامل `audit.read`؛ بقية العناصر تبقى على مصفوفة الدور حتى تُنفَّذ وحداتها.
- **AC:** (1) مستخدم بدور مخصّص يحمل `users.read` فقط يرى صفحة المستخدمين ولا يرى غيرها؛ (2) `RequireRole` يتحول إلى `RequireAccess` يقبل مفتاح صلاحية أو دوراً؛ (3) لا تغيير مرئي للأدوار النظامية الحالية.
- **الاعتماديات:** T11. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0034، 2026-10-30 — بالتوازي مع T14 في جلسة ثانية بتكليف المالك)** — `frontend/src/layout/navigation.ts` + `frontend/src/auth/{access.ts, RequireAuth.tsx}` + `frontend/src/pages/AuditLogPage.tsx` + مجلد الميزة `frontend/src/audit/` + `frontend/src/api/audit.ts` (FS-064؛ TEST-035 47 اختباراً؛ ADR-042؛ التفاصيل في MOD-FE-01 وصف «الواجهة» لـ API-011 في الوثيقة الرئيسية). **فروق التنفيذ عن النص أعلاه:** (أ) عنصر التنقل بوابة واحدة لا اثنتان: إمّا `permissions` (أيّ مفتاح يكفي؛ الدور يُتجاهل) وإمّا `roles` من المصفوفة — فلا يحجب الدور شاشة يخدمها الخادم؛ (ب) لوحة التحكم مستثناة من AC1 الحرفي: تبقى لكل مسجَّل (`'everyone'`) لأنها صفحة الهبوط ومخرج صفحة 403، بينما الجدول والإشعارات التجريبيان صارا للأدوار المعروفة فقط فلا يراهما الدور المخصّص؛ (ج) `RequireAccess` يقبل `navKey` أو `permission` أو `role` (أو قائمة أدوار) ويطبّق كل المعايير المُعطاة معاً، بدالة نقية `isAllowed()` في `auth/access.ts`؛ `/settings/roles` صار محروساً في المسار أيضاً (`guarded('roles')`) مع إبقاء بوابة الصفحة الداخلية؛ (د) **AC3 ليس حرفياً للمعلم:** البذر يمنح المعلم `users.read` فيكسب عنصر «المستخدمون» (الإسقاط المخفَّض الذي يخدمه الخادم منذ CH-0018) — تعارض بين نص النطاق («المستخدمون» لحامل `users.read`) والمعيار حُسم للنطاق؛ المدير يكسب العنصرين الجديدين كما يطلب النطاق، ولا يختفي شيء عن أحد؛ المالك يستطيع سحب المفتاح من المعلم في `/settings/roles` إن أراد العكس؛ (هـ) صفحة سجل التدقيق ليست «بسيطة» تماماً: مرشّحات API-011 الخمسة بتحقق محلي بمرايا أنماط الخادم (لا طلب لقيمة سيُرفض)، اقتراحات بادئة الحدث من قاموس 12.4، ترقيم keyset «السابق/التالي» كصفحة المستخدمين، صف موسَّع بـ JSON، وترشيح بنقر الفاعل/الكيان؛ لا كتابة. **AC:** (1) ✔ `navigation.test` + `AppLayout.test` (دور مخصّص بـ `users.read` وحدها → عنصرا لوحة التحكم والمستخدمين فقط) + `RequireAuth.test`؛ (2) ✔ `RequireAccess` بثلاث خصائص و`isAllowed()`؛ (3) ✔ للمدير والموظف والطالب والولي بالمفاتيح المبذورة، مع فرق المعلم الموثَّق في (د). **الرحلة اليدوية من المتصفح** (دور مخصّص ← قائمة بعنصرين؛ المدير ← `/audit-logs` ← ترشيح وترقيم) **لم تُنفَّذ** — لا أداة متصفح ولا بيانات دخول في الجلسة (`UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)، كما T11..T13).

#### MOD-03-T16 — إطار اختبار الواجهة (مرتبط بـ S1-R03)

- **النطاق:** Vitest + Testing Library + jsdom في `frontend/`؛ اختبارات أولى لـ `LoginPage`، `RequireAuth`، وجدول المستخدمين (T11). **المنفَّذ (CH-0028):** Vitest 5 + `@testing-library/react` 16 (+ `jest-dom`، `user-event`) + jsdom 29 ككتلة `test` في `vite.config.ts`؛ عدّة مشتركة في `frontend/src/test/` (مزوّدات التطبيق + سياق مصادقة بديل + مسبار الموقع + بدائل `fetch`)؛ 38 اختباراً في 6 ملفات: `LoginPage` (9)، `RequireAuth`/`RequireRole` (7)، `AuthProvider` (5)، `api/client.ts` (11)، `roles.ts` (4)، و`UsersPage` التجريبية دخانياً (2 — اختبار الجدول الحقيقي يأتي مع T11). فروق التصميم في ADR-038 (الوثيقة الرئيسية).
- **AC:** `npm run test` في `frontend/` يعمل في أقل من 30 ثانية محلياً ✔ (نحو 17 ثانية؛ 24 ثانية في أول تشغيل بارد)؛ 3 اختبارات على الأقل خضراء ✔ (38)؛ 13.1 محدَّث ✔ (TEST-029 في 13.2).
- **الاعتماديات:** D-R05 — **اعتُمد (CH-0016) ونُفِّذ (CH-0028)**: Vitest + Testing Library + jsdom كاعتماديات تطوير. **التقدير:** S. **الحالة:** `IMPLEMENTED` (CH-0028 — قبل الدفعة D؛ أغلق S1-R03). **قاعدة للدفعة D:** كل شاشة في T11..T15 تأتي بملف اختبار بجوارها على العدّة نفسها.

### 4.6 ترتيب التنفيذ المقترح (دفعات)

| الدفعة | المهام | بوابة الدفعة |
|---|---|---|
| **A — القراءة والإنشاء والتفعيل** | ~~T00~~ ✔ → ~~T01~~ ✔ (CH-0016) → ~~T02~~ ✔ (CH-0018) → ~~T03~~ ✔ (CH-0020) — **مكتملة** | مدير يُنشئ معلماً ويدعوه، والمعلم يفعّل حسابه ويدخل — كله بالاختبارات الشاملة |
| **B — دورة حياة الحساب** | ~~T04~~ ✔ (CH-0022) → ~~T05~~ ✔ (CH-0023) → ~~T06~~ ✔ (CH-0025) — **مكتملة** | إعادة ضبط كلمة مرور ✔ (TEST-023: التأكيد يُبطل كل الجلسات) + تعليق واستعادة مع إبطال الجلسات ✔ (TEST-026: بعد `suspend` يسقط `/me` والكعكة والدخول فوراً، و`activate` يعيد الدخول) |
| **C — الأدوار والأولياء والتدقيق** | ~~T07~~ ✔ (CH-0027) → ~~T08~~ ✔ (CH-0024 — نُفِّذت قبل T07 بالتوازي مع T05 بتكليف المالك) → ~~T09~~ ✔ (CH-0026 — نُفِّذت قبل T07 بالتوازي مع T06 بتكليف المالك) → ~~T10~~ ✔ (CH-0029 — بالتوازي مع T11 في الواجهة) — **مكتملة** | دور مخصّص بصلاحيات مختارة يعمل فعلياً عبر `PermissionsGuard` ✔ (TEST-024 AC4؛ وتعيينه لمستخدم يسري في طلبه التالي ✔ TEST-028 AC4)؛ ولي أمر مرتبط بطالبَين ✔ (TEST-027 AC5)؛ حدث تدقيق واحد بالضبط لكل مسار كاتب في T02..T09 وصفر للمرفوض ✔ (TEST-030 AC1/AC2) |
| **D — الواجهة** | ~~T11~~ ✔ (CH-0030) → ~~T12~~ ✔ (CH-0031) → ~~T13~~ ✔ (CH-0032 — نُفِّذت بالتوازي مع T12 في جلسة ثانية، قبل T14 بتكليف المالك) → ~~T14~~ ✔ (CH-0033 — نُفِّذت بالتوازي مع T15 في جلسة ثانية بتكليف المالك) → ~~T15~~ ✔ (CH-0034 — نُفِّذت بالتوازي مع T14) — **مكتملة** (~~T16~~ ✔ CH-0028 — أُنجزت قبل الدفعة) | رحلة WF-02 كاملة من المتصفح (T11 القائمة والإنشاء والتعديل ✔؛ التفعيل بالرابط ✔ T12؛ تبويب الأدوار والصلاحيات ✔ T13؛ أدوار المستخدم وحالته وأولياؤه من الدرج ✔ T14؛ التنقل بالصلاحيات وسجل التدقيق ✔ T15) — مغطاة بالمكوّنات (TEST-031/TEST-032/TEST-033/TEST-034/TEST-035) **والتحقق اليدوي من المتصفح ✔ — نفّذه المالك وقبل MOD-03 (CH-0042، 2026-11-01، §4.9)** |

**الدفعة A مكتملة: MOD-03-T01 ✔ (CH-0016)، MOD-03-T02 ✔ (CH-0018)، MOD-03-T03 ✔ (CH-0020)** (T00 التحضيرية أُغلقت مع إجابة المالك على §4.7 — CH-0016). بوابة الدفعة متحققة بالاختبار الشامل TEST-020: مدير يُنشئ معلماً ويدعوه، والمعلم يفعّل حسابه ويدخل. **الدفعة B جارية: MOD-03-T04 ✔ (CH-0022)، MOD-03-T05 ✔ (CH-0023 — على `VerificationTokenService` و`MailService.sendPasswordReset()` و`openSession()` من T03؛ قاعدة عدم التجاوز مطبَّقة على الإصدار — SEC-R-15؛ المسار الذاتي منفَّذ ومعطَّل بـ `403 reset_disabled` حتى LR-01). **MOD-03-T06 ✔ (CH-0025 — بالتوازي مع T09):** تُبطل الجلسات عند `suspend`/`archive`/الحذف بالآلية نفسها (`refresh_tokens.revoked_at` داخل المعاملة) ويسقط الوصول فوراً عبر `sessionGate`؛ قاعدة عدم التجاوز على كل إجراء (SEC-R-17)؛ آخر مدير بقفل صفوف؛ بوابة الدفعة B (تعليق واستعادة مع إبطال الجلسات) متحققة بـ TEST-026 — **الدفعة B مكتملة.** الدفعة C بدأت: MOD-03-T08 ✔ (CH-0024) بالتوازي مع T05 — بوابتها الأولى (دور مخصّص بصلاحيات مختارة يعمل فعلياً عبر `PermissionsGuard` في الطلب التالي) متحققة بـ TEST-024؛ MOD-03-T09 ✔ (CH-0026) بالتوازي مع T06 — بوابتها الثانية (ولي أمر مرتبط بطالبَين) متحققة بـ TEST-027، وقاعدة عدم التجاوز مطبَّقة على طرفَي الرابط (SEC-R-18، ADR-036). **MOD-03-T07 ✔ (CH-0027 — بالتوازي مع T16 في الواجهة):** تعيين الأدوار بقاعدة عدم التجاوز على أدوار الهدف وعلى كل دور يُضاف (SEC-R-17/SEC-R-16، ADR-037)، بقفل آخر مدير المشترك مع T06 بعد إصلاح عدّه (KI-041)؛ التغيير يسري في الطلب التالي بلا إعادة دخول (TEST-028 AC4). ثم T10.** **MOD-03-T10 ✔ (CH-0029 — بالتوازي مع T11 في جلسة ثانية):** مرشّحات سجل التدقيق وترقيمه الدقيق على UUIDv7 (API-011، ADR-039؛ أصلح فقد أحداث الملّي ثانية KI-042) واختبار التغطية المركزي TEST-030 (حدث واحد بالضبط لكل مسار كاتب في T02..T09 وصفر للمرفوض) وقاموس الأحداث 12.4 — **الدفعة C مكتملة.** **MOD-03-T11 ✔ (CH-0030 — بالتوازي مع T10 في جلسة ثانية):** صفحة المستخدمين الحقيقية في الواجهة (قائمة `GET /api/users` بمرشّحات وترقيم keyset «السابق/التالي»، درج تفاصيل/تعديل بأصغر جسم `PATCH`، معالج إنشاء بثلاث خطوات؛ الأعمدة والإجراءات بحسب `hasPermission()` والخادم الحد الأمني؛ FS-060؛ TEST-031 57 اختباراً؛ AC4 اليدوي من المتصفح `UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)) — **الدفعة D بدأت.** **MOD-03-T12 ✔ (CH-0031 — بالتوازي مع T13 في جلسة ثانية بتكليف المالك):** صفحتا `/invite/:token` و`/reset-password/:token` العامتان (معاينة ← كلمة مرور ← قبول/تأكيد ← جلسة متبنّاة عبر `adoptSession()` ← `/`) وإصدار روابط الدعوة/إعادة الضبط من درج المستخدم بعرض الرابط مرة واحدة (FS-061؛ TEST-032 34 اختباراً؛ ADR-040؛ AC1..AC4 بالاختبارات والتحقق اليدوي من المتصفح `UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)؛ صفحة «نسيت كلمة المرور» مؤجَّلة إلى LR-01) — بوابة الدفعة D (رحلة WF-02 من المتصفح) مغطاة بالمكوّنات لا بالمتصفح بعد. **MOD-03-T13 ✔ (CH-0032 — بالتوازي مع T12 في جلسة ثانية بتكليف المالك، قبل T14):** تبويب «الأدوار والصلاحيات» `/settings/roles` لحامل `roles.manage` وحده (D-R06) — جدول الأدوار، درج إنشاء/تعديل بمصفوفة وحدة×مفتاح من الكتالوج النشط، `academy_admin` للقراءة فقط، حذف المخصّص غير الممنوح، القائمة من استجابة الخادم (FS-062؛ TEST-033 37 اختباراً؛ التحقق اليدوي من المتصفح `UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)). **MOD-03-T15 ✔ (CH-0034 — بالتوازي مع T14 في جلسة ثانية بتكليف المالك):** التنقل بالصلاحيات لشاشات MOD-03 («المستخدمون» لحامل `users.read`، «الأدوار والصلاحيات» `/settings/roles` لحامل `roles.manage`، «سجل التدقيق» `/audit-logs` لحامل `audit.read` — أياً كان الدور، وللأدوار المخصّصة)، `RequireAccess` بدل `RequireRole`، وصفحة سجل التدقيق الحقيقية على API-011 بمرشّحاته المتحقق منها محلياً وترقيمه (FS-064؛ TEST-035 47 اختباراً؛ ADR-042؛ AC1..AC3 بالاختبارات مع فرق المعلم الموثَّق والتحقق اليدوي من المتصفح `UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9))؛ T14 وT15 نُفِّذتا بالتوازي في جلستين. **MOD-03-T14 ✔ (CH-0033 — بالتوازي مع T15):** درج المستخدم بتبويبات — الأدوار (اختيار متعدد من `GET /api/roles` → `PUT /api/users/:id/roles` بالمجموعة الكاملة عند الفرق، أقفال محلية للمدى والذات، `reloadUser()` للذات)، إجراءات الحساب من مرآة آلة T06 بتأكيد وسبب اختياري (`POST …/status`، `DELETE`)، أولياء الأمور/الطلاب (API-029..033؛ بحث مقيَّد بالدور ورفض الذات محلياً؛ القائمة من الخادم بعد الكتابة) (FS-063؛ TEST-034 42 اختباراً؛ ADR-041؛ AC1..AC3 بالاختبارات والتحقق اليدوي من المتصفح `UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9)) — **الدفعة D مكتملة وكل مهام MOD-03 (T00..T16) منفَّذة؛ بوابتها (رحلة WF-02 من المتصفح) نفّذها المالك وقبل MOD-03 (CH-0042، §4.9).** **T16 ✔ (CH-0028 — قبل الدفعة D):** إطار اختبار الواجهة جاهز (38 اختباراً، TEST-029، ADR-038)؛ اختبارات شاشات T11..T15 تُبنى عليه.

### 4.7 قرارات المالك قبل/أثناء MOD-03

**D-R01..D-R06 اعتمدها المالك في 2026-10-29 وثُبِّتت في CH-0016 (ADR-027 في الوثيقة الرئيسية مع ملاحظتَي تصميم لا تمنعان التثبيت). D-R07 حُسم بتوجيه المالك في 2026-10-29 (CH-0018، ADR-030). D-R08 (تأجيل تكامل البريد الفعلي) اعتمده المالك في 2026-10-29 وثُبِّت في CH-0019 (ADR-031).**

| المعرّف | القرار | الخيارات | التوصية الأصلية | **القرار المعتمد / الحالة** | أثر التأخير |
|---|---|---|---|---|---|
| D-R01 | **قناة تسليم الدعوات وروابط إعادة الضبط** | (أ) يدوي: الرابط يظهر للمدير مرة واحدة وينسخه (بلا بريد) · (ب) بريد إلكتروني عبر مزوّد (SMTP/API) الآن · (ج) انتظار MOD-12 | **(أ) الآن** مع واجهة `MailTransport` فارغة قابلة للاستبدال، ثم (ب) عند اختيار المزوّد | **`ACCEPTED` (أ):** نسخ يدوي بواسطة مسؤول مخوَّل في المرحلة الأولى؛ المسار الذاتي معطَّل (`AUTH_SELF_SERVICE_RESET_ENABLED=false`) | يمنع المسار الذاتي "نسيت كلمة المرور" (T05 جزئياً)؛ التسليم اليدوي في الواجهة منفَّذ في T12 (CH-0031: الرابط يظهر للمسؤول مرة واحدة مع زر نسخ وتاريخ الانتهاء وحالة التسليم) |
| D-R02 | مدة صلاحية رمز الدعوة ورمز إعادة الضبط | 72 ساعة / 7 أيام للدعوة؛ 30 / 60 دقيقة لإعادة الضبط | دعوة **7 أيام**، إعادة ضبط **60 دقيقة** (قابلان للضبط بالبيئة) | **`ACCEPTED`:** دعوة **48 ساعة**، إعادة ضبط **30 دقيقة** (`AUTH_INVITATION_TTL_HOURS`/`AUTH_PASSWORD_RESET_TTL_MINUTES` — ENV-36/37)؛ أقصر من التوصية، وإعادة إصدار الدعوة في T03 تعوّض الانتهاء | T03/T05 |
| D-R03 | من يملك إنشاء مدراء إضافيين | فقط `users.roles.assign` (المدير افتراضياً) · أو صلاحية مستقلة `users.admins.manage` (مفتاح جديد) | الإبقاء على `users.roles.assign` مع قاعدة "آخر مدير" | **`ACCEPTED`:** مدير الأكاديمية الحامل لـ `users.roles.assign` ينشئ مدراء إضافيين بلا مفتاح جديد، مع قاعدة "آخر مدير" وحدث تدقيق لكل تعيين (T02 AC5، T07) — **نُفِّذ بالكامل في T07 (CH-0027):** `PUT /api/users/:id/roles` بـ `users.roles.assign` مع قاعدة عدم التجاوز (لا يصنع مديراً إلا من يحمل كل المفاتيح) و`409 last_admin` خلف قفل صفوف وحدث `users.roles.changed` | T07 ✔ |
| D-R04 | التسجيل الذاتي للطلاب (`users(status=pending)` + اعتماد المدير) | داخل MOD-03 · مؤجَّل إلى MOD-02/MOD-14 (يحتاج إعداد `academy.settings`) | **مؤجَّل** حتى MOD-14 (علم في `settings`) | **`ACCEPTED` (مؤجَّل):** يُفعَّل لاحقاً لكل أكاديمية بعلم في `academy.settings` ودور `is_default_for_signup` | لا أثر على A–C |
| D-R05 | اعتماد إطار اختبار الواجهة (Vitest + Testing Library + jsdom) — اعتماديات تطوير جديدة | نعم الآن · لاحقاً | **نعم قبل الدفعة D** | **`ACCEPTED` ونُفِّذ (CH-0028):** ثُبِّت في T16/S1-R03 — Vitest 5 + Testing Library + jsdom كاعتماديات تطوير في `frontend/` (ADR-038؛ لم يُثبَّت في CH-0016 — خارج نطاق T00/T01) | بدونه تبقى اختبارات الواجهة يدوية (`UNVERIFIED` مرئياً) |
| D-R06 | موقع إدارة الأدوار في الواجهة | صفحة `/roles` مستقلة · تبويب داخل `/settings` | صفحة مستقلة لحامل `roles.manage` | **`ACCEPTED` (تبويب داخل `/settings`):** بخلاف التوصية؛ يُنفَّذ كمسار فرعي `/settings/roles` ببوابة `roles.manage` مستقلة عن `academy.settings.read` (T13/T15) | T13 |
| D-R07 | **نطاق `users.read` وكشف بيانات الاتصال** (SEC-R-12 — ظهر مع T01): حامل `users.read` (المعلم والموظف افتراضياً) يرى بريد وهاتف كل المستخدمين | (أ) إسقاط مخفَّض لغير `academy_admin`/`staff` (بلا بريد/هاتف) · (ب) مفتاح جديد `users.read_contact` · (ج) نطاق `linked` للمعلم على طلابه (ADR-023) · (د) قبول الوضع الحالي | **(أ)** الآن (بلا مفتاح جديد ولا ترحيل)، و(ج) مع MOD-05 | **`ACCEPTED` (ب)+(أ) — CH-0018، ADR-030:** توجيه المالك «قيّد الوصول إلى قائمة المستخدمين الشاملة وبيانات الاتصال وفق مبدأ أقل صلاحية؛ افصل بين صلاحيات الإدارة والمدرسين والموظفين؛ لا تعتمد على `users.read` وحدها» → مفتاح جديد `users.read_contact` (المدير والموظف افتراضياً، لا المعلم) يفتح الإسقاط الكامل، وحامل `users.read` وحده يرى إسقاطاً مخفَّضاً بلا بريد/اسم مستخدم/هاتف/طوابع أمان وبلا بحث فيها؛ (ج) يبقى لـ MOD-05 | ✔ T11 (CH-0030): عمود بيانات الاتصال والبحث فيها وحقول الاتصال في التعديل بحسب `hasPermission('users.read_contact')`، وتنبيه بالإسقاط المخفَّض لغير حامله |
| D-R08 | **توقيت تكامل البريد الإلكتروني الفعلي** (Resend/SMTP أو غيره) وحدود آليات الاختبار المحلي | (أ) ربط مزوّد الآن ضمن T03 · (ب) تأجيل الربط إلى التجهيز للإطلاق مع بناء تجريد `MailTransport` الآن · (ج) انتظار MOD-12 | (ب) — امتداد طبيعي لـ D-R01 | **`ACCEPTED` (ب) — CH-0019، ADR-031:** قرار المالك «نحن حالياً في مرحلة التطوير المحلي، ولذلك قررت تأجيل التكامل الفعلي مع البريد الإلكتروني إلى مرحلة التجهيز للإطلاق»: لا ربط Resend/SMTP ولا رسائل بريد حقيقية أثناء التطوير؛ T03 تُنفَّذ بروابط يدوية قابلة للاختبار محلياً؛ **الرابط اليدوي لا يثبت ملكية البريد** (`email_verified_at` يبقى فارغاً)؛ آليات الاختبار المحلية منفصلة عن إعدادات الإنتاج ولا تجاوز للتحقق في production (قيد إقلاع في `env.schema.ts`)؛ خدمة بريد مستقلة قابلة لإضافة مزوّد لاحقاً بلا إعادة بناء المصادقة؛ مهمة LR-01 (§5.1) تربط المزوّد وتؤكد ملكية البريد وتختبر التسليم قبل الإطلاق. الأولوية: إنهاء الوظائف الأساسية للمنصة لا تكامل الخدمات الخارجية | لا أثر على الدفعات A–D؛ المسار الذاتي لإعادة الضبط (T05) وتأكيد ملكية البريد يؤجَّلان إلى LR-01 (بوابة إطلاق مانعة) |

### 4.8 المتطلبات التقنية المعلقة

| المتطلب | التفاصيل | الحالة |
|---|---|---|
| متغيرات بيئة جديدة | `AUTH_INVITATION_TTL_HOURS` (افتراضي **48** — D-R02)، `AUTH_PASSWORD_RESET_TTL_MINUTES` (افتراضي **30**)، `AUTH_SELF_SERVICE_RESET_ENABLED` (افتراضي `false` حتى D-R01)، و`APP_PUBLIC_URL` اختياري — في `env.schema.ts` + `.env.example` + 11.3 (ENV-36..ENV-39) مع اختبار TEST-003؛ المستهلكون منذ CH-0020: `VerificationTokenService` (ENV-36/ENV-37) و`MailService` (ENV-39)، وENV-38 مقيَّد بالناقل (ENV-40) | `IMPLEMENTED` (CH-0016، T00؛ مستهلَكة منذ CH-0020) |
| قناة بريد (مزوّد فعلي) | لا مزوّد بريد ولا قالب؛ D-R01 اعتمد التسليم اليدوي أولاً، وD-R08 أجّل الربط الفعلي صراحةً إلى التجهيز للإطلاق | `DEFERRED` (D-R01/D-R08 → تُنفَّذ في LR-01 §5.1 قبل أول نشر إنتاجي) |
| تجريد البريد `MailTransport` + `NoopMailTransport` | `MailModule` مستقل تستدعيه `AccountModule` بلا معرفة المزوّد (D-R08)؛ متغير `MAIL_TRANSPORT` (`none` افتراضياً، `log` للتطوير فقط) في `env.schema.ts` + `.env.example` + 11.3 | `IMPLEMENTED` (CH-0020 — `backend/src/mail/`؛ ENV-40؛ TEST-017) |
| حظر تجاوزات الاختبار المحلي في الإنتاج | قيد `superRefine` في `env.schema.ts`: `MAIL_TRANSPORT=log` مرفوض مع `NODE_ENV=production`؛ `AUTH_SELF_SERVICE_RESET_ENABLED=true` مرفوض مع ناقل `none`؛ لا نقطة نهاية ولا علم يكشف الرموز (D-R08) | `IMPLEMENTED` (CH-0020، TEST-003) |
| إطار اختبار الواجهة | D-R05 اعتُمد (CH-0016)؛ ثُبِّت في T16 (CH-0028): Vitest 5 + Testing Library + jsdom، 38 اختباراً في 6 ملفات، عدّة مشتركة في `frontend/src/test/` (TEST-029، ADR-038) | `IMPLEMENTED` (CH-0028) |
| CI وقاعدة اختبار مؤقتة | S1-R02؛ حتى ذلك تعمل الاختبارات الشاملة على قاعدة التطوير وتترك أحداث تدقيق بفاعل فارغ (KI-032) | `IMPLEMENTED` (CH-0035 — الوثيقة الرئيسية 14.12: في CI تعمل الاختبارات الشاملة على قاعدة مؤقتة لكل تشغيل فلا أثر على أي قاعدة دائمة؛ محلياً تبقى على قاعدة التطوير كما كانت؛ أول تشغيل على GitHub أخضر — CH-0037) |
| `trust proxy` + `AUTH_COOKIE_SECURE` + same-site | MOD-01-H01 و14.11 في الوثيقة الرئيسية؛ مطلوبة قبل أي نشر HTTPS خلف وكيل | `PARTIALLY_IMPLEMENTED` — `TRUST_PROXY` منفَّذ (CH-0080)؛ ضبط القيم الثلاث في بيئة النشر يبقى (قبل النشر) |
| Node | ~~تثبيت الإصدار بـ `engines`/`.nvmrc` (S1-R01)~~ ✔ CH-0035 (`.nvmrc` = `22.20.0`، `engines.node: ">=22.20.0"`)؛ الترقية إلى 22.22.3 أو أحدث لإزالة تحذيرات `EBADENGINE` (KI-012) تبقى مستقبلية بقرار المالك | `PARTIALLY_IMPLEMENTED` (S1-R01 ✔ CH-0035؛ الترقية `PLANNED`) |
| حدود المعدل للمسارات العامة الجديدة | قبول الدعوة وتأكيد إعادة الضبط وطلبها: `AuthThrottlerGuard` لكل IP | `IMPLEMENTED` (T03 في CH-0020: المعاينة 60/دقيقة والقبول 20/15 دقيقة لكل IP — أعلى من `login` بقرار ADR-032؛ T05 في CH-0023: التأكيد 20/15 دقيقة لكل IP، الطلب الذاتي 5/15 دقيقة لكل (IP, identifier) — ADR-033) |

### 4.9 إغلاق MOD-03 — سجل القبول (2026-11-01، CH-0042)

**النتيجة: MOD-03 مقبولة ومقفلة بتأكيد المالك («نعم، اقبل MOD-03»)، فاكتملت بوابة Stage 2.** الرحلات نفّذها المالك يدوياً على :5173 بحسابات `admin@`/`st@`/`te@` وولي أمر أنشأه (بريده لا يُوثَّق — المستودع عام)؛ الأوقات بتوقيت UTC+03:00 من `audit_logs`.

| # | الرحلة | الدليل | النتيجة |
|---|---|---|---|
| 1 | **T11** إنشاء ولي أمر ← ظهوره في القائمة ← تعديل | `users.created` 2026-10-31 23:59:24؛ `users.updated { fields: [displayName] }` 2026-11-01 20:02:36 | ✔ |
| 2 | **T12** إصدار دعوة من الدرج ← فتح الرابط في نافذة خاصة ← تفعيل ودخول | `users.invitation.issued` 23:59:42 ثم `users.invitation.accepted` 2026-11-01 00:00:15 (الفاعل ولي الأمر نفسه) | ✔ |
| 3 | **T13** دور مخصّص: إنشاء ← تعديل ← حذف؛ وتعديل صلاحيات دور نظامي | `roles.created` (`librarian`) 20:56:35، `roles.permissions.changed` 20:57:09، `roles.deleted` 20:57:22؛ `student` أُضيف له مفتاح 20:43:51 ثم أُزيل 20:53:13 | ✔ — أثناءها ظهر **KI-046** (أُصلح في CH-0038) |
| 4 | **T14** على الطالب: دور إضافي ثم إزالته، إيقاف ثم تفعيل، ربط ولي أمر | `users.roles.changed` ×2 21:21، `users.status.changed` (suspend ← activate) 21:21، `guardians.linked` 21:22 | ✔ (محاولة أولى خطأً على `te@` 20:59–21:03 صحّحها المالك: الأدوار 21:19، فك الربط 21:52 — بيانات تجربة لا عيوب) |
| 5 | **T15** القائمة الجانبية لكل دور وسجل التدقيق | لقطتا شاشة (الطالب مطابق؛ المعلم بعد تصحيح أدواره) ودخول `te@` 21:22 و22:18؛ تأكيد المالك أن «المستخدمون» و«الفصول والمجموعات» تظهران للمعلم وأن السجل يعرض العمليات | ✔ |
| 6 | **MOD-02-T02** تعديل اسم الأكاديمية من «عام» | `academy.updated { fields: [name] }` 21:05:51 | ✔ |
| 7 | CI على GitHub | التشغيلات #1..#3 خضراء (CH-0037/CH-0039/CH-0040) | ✔ |

**ملاحظات القبول:** (1) KI-046 (تبويب يرسل باسم مستخدم آخر) اكتُشف في الرحلة 3 وأُصلح قبل القبول (CH-0038، TEST-038). (2) **KI-047 مفتوح** (خروج مفاجئ حين يجدّد تبويبان معاً — حدثا `auth.refresh.reuse_detected` 20:19 و22:10) غير مانع للقبول؛ علاجه MOD-01-H08 في §3.2 — **أُصلح في CH-0073 (2026-11-02)**. (3) تبويبات المتصفح تتشارك الجلسة: لتجربة حسابين معاً تُستخدم نافذة خاصة أو متصفح آخر.

---

## 4b. MOD-02/MOD-14 — الحد الأدنى لإعدادات الأكاديمية (بوابة خروج Stage 2)

> أُضيف في CH-0036 (2026-10-31) لأن §1 يشترط لخروج Stage 2 «MOD-02/MOD-14 بالحد الأدنى (قراءة/تعديل صف `academy`)» بلا تفصيل مهام. هذا القسم على نمط §4: النطاق → الجداول → الصلاحيات → نقاط النهاية → المهام بمعايير قبول واختبارات → الترتيب → قرارات المالك. العقود النهائية في الوثيقة الرئيسية 10.2 (API-035/API-036) والقرار المعماري في ADR-044.
>
> **توسّع O8 (CH-0086، 2026-11-04 — المهمة O8 في §5b.2):** الإعدادات (T03 — مفتاحا الجدول الأسبوعي) والفروع (T05 جدول، T06 API) في الخادم قبل الجدولة (O9)، بقرارات المالك D-R19..D-R22 (§4b.7) وتفاصيل تقنية موصى بها في §4b.9 تُعتمد بدمج الخطة. الشاشات في مرحلة الواجهة (ADR-061).

### 4b.1 النطاق والأهداف

| داخل النطاق (الحد الأدنى) | خارج النطاق (يبقى `PLANNED` في MOD-02/MOD-14) |
|---|---|
| قراءة صف `academy` الوحيد من الخادم لكل مستخدم مصادَق (الاسم المحلي، الشعار، اللغة الافتراضية، المنطقة الزمنية، العملة، بيانات الاتصال) | إنشاء أكاديميات جديدة وتوفير قواعدها (6.6.2، ADR-021 — Stage 6) |
| تعديل الحقول نفسها بصلاحية `academy.settings.manage` بدلالة PATCH (API-018) وحدث تدقيق واحد | `academy.settings jsonb` (D3) — ينتظر مخطط zod ومستهلِكاً فعلياً (مثل علم التسجيل الذاتي D-R04) |
| تحويل تبويب «عام» في `/settings` من النموذج التجريبي إلى شاشة حقيقية (قراءة للجميع ممن يرى الشاشة، حفظ لحامل `academy.settings.manage`) | الفروع (`branches`)، العلامة التجارية قبل الدخول (مسار عام)، رفع الشعار كملف (`files`)، `slug`/`platform_academy_id` |
| حدث `academy.updated` في قاموس 12.4 واقتراحات صفحة التدقيق | تاريخ تغييرات لكل مفتاح (`academy_settings` — 6.7 اختياري) |

### 4b.2 إعادة استخدام جدول `academy` — لا جداول جديدة ولا ترحيل

| الجدول | الاستخدام | ملاحظة |
|---|---|---|
| `academy` | الصف الواحد (`singleton`): `name jsonb`، `logo_url`، `default_locale`، `timezone`، `currency`، `contact_email`، `contact_phone` تُقرأ وتُكتب؛ `slug`، `platform_academy_id`، `settings` تُقرأ جزئياً أو لا تُمسّ | **لا أعمدة جديدة ولا ترحيل**؛ قيود 6.3 (`ck_academy_name_localized`، `ck_academy_currency_iso4217`) تبقى الحد الأخير خلف تحقق DTO |
| `audit_logs` | حدث واحد `academy.updated { fields }` داخل معاملة الكتابة | `entity_type = academy`، `entity_id` = معرّف الصف |

**أثر قاعدة البيانات: لا شيء** في T01/T02/T03 (`settings` عمود قائم)؛ T05 (O8) يضيف جدول `branches` بترحيل مراجَع. غياب الصف (قاعدة غير مبذورة) خطأ تشغيلي مستقر لا ينشئ الصف تلقائياً.

### 4b.3 الصلاحيات المستخدمة (من الكتالوج الحالي — لا مفاتيح جديدة)

`academy.settings.read` · `academy.settings.manage` موجودان في `backend/src/authorization/permission-catalog.ts` منذ CH-0013 ويحملهما افتراضياً `academy_admin` وحده (البذر). **القراءة عبر API لا تتطلب أيهما** (D-R09)؛ `manage` يحمي الكتابة في الخادم؛ `read`/`manage` يحكمان ظهور شاشة الإعدادات في الواجهة فقط (المصفوفة 7.2: «الإعدادات» للمدير وحده افتراضياً — لا تغيير مرئي للأدوار النظامية).

### 4b.4 نقاط النهاية

| المهمة | الطريقة والمسار | الصلاحية |
|---|---|---|
| MOD-02-T01 | **`IMPLEMENTED` (CH-0036) — API-035:** `GET /api/academy` → `200 AcademyDto` (`id`, `slug`, `name {ar,en?,tr?}`, `logoUrl`, `defaultLocale`, `timezone`, `currency`, `contactEmail`, `contactPhone`, `createdAt`, `updatedAt`؛ بلا `settings`/`platformAcademyId`) · **API-036:** `PATCH /api/academy` بجسم `UpdateAcademyDto` (كل الحقول اختيارية؛ `null` يمسح `logoUrl`/`contactEmail`/`contactPhone` فقط؛ `{}` → `400 nothing_to_update`) → `200 AcademyDto`؛ غياب الصف → `503 academy_not_configured` | مصادقة فقط للقراءة / `academy.settings.manage` للتعديل |
| MOD-02-T03 | **`IMPLEMENTED` (CH-0088 — O8):** API-035 يُضيف `settings { scheduling { weekStartsOn, workingDays } }` للقراءة، وAPI-036 يقبل `settings` بدلالة PATCH على مستوى المفتاح | كما T01 |
| MOD-02-T06 | **`IMPLEMENTED` (CH-0089 — O8):** API-080 `GET /api/branches` · API-081 `POST /api/branches` · API-082 `PATCH /api/branches/:id` · API-083 `DELETE /api/branches/:id` | مصادقة فقط للقراءة (D-R21) / `branches.manage` للكتابة |

### 4b.5 المهام

#### MOD-02-T01 — الخادم: قراءة وتعديل صف الأكاديمية

- **النطاق:** `backend/src/academy/` بملفات `{module, controller, service, dto, errors, changes, validation, policy}.ts` على اصطلاحات MOD-03 حرفياً: `select` صريح، `AcademyHttpException` بكود مستقر، الحارسان العامان (لا `@Public()`)، `@RequirePermissions('academy.settings.manage')` على PATCH وحده، فرق نقي في `academy.changes.ts` (نمط `users.changes.ts`)، كتابة الحقول المتغيرة فقط في معاملة واحدة مع `AuditService.record()` لحدث واحد بالضبط `academy.updated { fields }` (أسماء فقط)، بلا فرق = `200` بلا كتابة ولا حدث، Swagger؛ تسجيل `AcademyModule` في `app.module.ts`؛ الحدث في قاموس 12.4.
- **AC:** (1) مستخدم مصادَق بدور بلا أي صلاحية إدارية يقرأ الصف؛ (2) PATCH بلا `academy.settings.manage` → `403 permission_denied` بلا كتابة ولا حدث؛ (3) `400` لمنطقة زمنية غير معروفة (`Intl.supportedValuesOf('timeZone')`)، عملة غير ISO 4217، اسم بلا `ar`، `null` على عمود NOT NULL، وحقل خارج النطاق (`slug`/`settings`/`platformAcademyId`)؛ `{}` → `400 nothing_to_update`؛ (4) التعديل الفعلي يُعيد الكيان بعد التطبيع ويكتب الحقول المتغيرة فقط مع حدث واحد بالضبط بأسماء الحقول بترتيب ثابت، والجسم نفسه مرة ثانية بلا كتابة ولا حدث؛ (5) غياب الصف → `503 academy_not_configured`.
- **الاختبارات:** TEST-036 — `backend/src/academy/academy.changes.spec.ts` (التخطيط النقي + قواعد الصيغة) و`academy.service.spec.ts` (503 بلا قاعدة، `nothing_to_update` قبل أي استعلام، idempotent بلا كتابة) و`backend/test/academy.e2e-spec.ts` بـ `APP_CREATE_OPTIONS` (يتخطى بلا قاعدة؛ يعدّ الأحداث بالفاعل فوق علامة مائية كما TEST-030؛ يُعيد قيم الصف الأصلية في `finally`؛ OpenAPI بمهلة 20 ثانية — KI-040).
- **الاعتماديات:** MOD-01 (الحراس)، MOD-03-T10 (قاموس التدقيق). **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0036، 2026-10-31)** — التفاصيل والفروق في §4b.8.

#### MOD-02-T02 — الواجهة: تبويب «عام» حقيقي في `/settings`

- **النطاق:** `frontend/src/api/academy.ts` (الأنواع مرآة الـ DTO؛ `getAcademy()`/`updateAcademy()` على API-035/036) + مجلد `frontend/src/academy/` (`useAcademy.ts`، `GeneralSettingsForm.tsx`، `academy.patch.ts` نقي بأصغر جسم PATCH على نمط `users.patch.ts`، `academy.validation.ts` مرايا قواعد الخادم، `academy.errors.ts`)؛ استبدال النموذج التجريبي في `pages/SettingsPage.tsx`؛ القراءة لكل من يرى الشاشة، الحفظ لحامل `academy.settings.manage` عبر `hasPermission()`؛ لا طلب بلا فرق؛ الرسائل بحسب `code`؛ عنصر التنقل `settings` يُحوَّل من الدور `admin` إلى الصلاحيتين `academy.settings.read`/`academy.settings.manage` (ADR-042: كل وحدة تنقل عنصرها إلى الصلاحيات عند تنفيذ عقدها؛ لا تغيير مرئي للأدوار النظامية لأن المدير وحده يحملهما في البذر)؛ `academy.updated` في `AUDIT_ACTION_SUGGESTIONS`؛ i18n داخل كتلة `settings` القائمة؛ لا اعتماديات جديدة.
- **AC:** (1) الشاشة تعرض قيم الخادم بعد التحميل (بحالة تحميل وخطأ قابل للإعادة)؛ (2) بلا `academy.settings.manage` الحقول للقراءة فقط ولا زر حفظ ولا طلب كتابة؛ (3) الحفظ بلا فرق لا يُرسل طلباً ويعرض «لا تغييرات»؛ (4) الحفظ يُرسل أصغر جسم PATCH (الاسم ككائن كامل عند تغيّر أي لغة، `null` للمفرَّغ، العملة بأحرف كبيرة) ويعرض الاستجابة؛ (5) أكواد الخادم (`permission_denied`، `academy_not_configured`، `nothing_to_update`، 400 تحقق) برسائل مخصّصة؛ (6) القيم غير الصالحة (منطقة زمنية/عملة) تُرفض محلياً قبل الطلب.
- **الاختبارات:** TEST-037 — اختبار Vitest لكل ملف جديد على عدّة `src/test/` (`renderWithProviders`، `mockFetch`؛ لا `getByRole` غير محصور بـ RegExp — KI-044) + تحديث `SettingsPage.test.tsx` و`navigation.test.ts`/`AppLayout.test.tsx`/`RequireAuth.test.tsx` لبوابة الصلاحية.
- **الاعتماديات:** T01، MOD-03-T13 (الصفحة والتبويبات)، T15 (التنقل بالصلاحيات). **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0036، 2026-10-31)** — التفاصيل والفروق في §4b.8؛ الرحلة اليدوية من المتصفح `UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9) كما T11..T15.

#### MOD-02-T03 — `academy.settings` jsonb بمخطط zod (O8 — مفتاحا الجدول الأسبوعي)

- **النطاق:** مخطط zod نقي في `backend/src/academy/academy.settings.ts` (D3) لأول مفتاحين (D-R20): `scheduling.weekStartsOn` — عدد صحيح 0–6 (0 = الأحد، الاصطلاح نفسه في `class_schedules.weekday` — 6.7) أو `null`؛ و`scheduling.workingDays` — قائمة مرتّبة بلا تكرار من 1 إلى 7 أيام في المدى 0–6، أو `null`. **`null` = غير مضبوط**، فلا افتراضي مرتبط ببلد (مبدأ قرار CH-0012 في المنطقة الزمنية والعملة): الواجهة تطبّق سلوك لغة المستخدم، والجدولة لا تقيّد الأيام. **القراءة:** `GET /api/academy` (API-035) يُعيد `settings` كاملاً بكل مفتاح معروف — القيمة المخزّنة أو `null`؛ قيمة مخزّنة لا تطابق المخطط تُقرأ `null` ولا تُسقط الطلب. **الكتابة:** `PATCH /api/academy` (API-036) يقبل `settings: { scheduling?: { weekStartsOn?, workingDays? } }` بدلالة PATCH **على مستوى المفتاح** (غائب = بلا تغيير، `null` = مسح، قيمة = استبدال)؛ المفاتيح غير المعروفة `400`؛ يُخزَّن المضبوط وحده (`null` يحذف المفتاح من jsonb)؛ الفرق النقي في `academy.changes.ts` يقارن المفاتيح بعد التطبيع (الأيام مرتّبة)؛ حدث واحد `academy.updated { fields }` بأسماء نقطية (`settings.scheduling.weekStartsOn`) بعد حقول الصف بترتيب ثابت؛ الصلاحية نفسها `academy.settings.manage`.
- **AC:** (1) `GET` يُعيد `settings.scheduling` بالمفتاحين، و`null` في قاعدة لم تضبطهما؛ (2) PATCH يضبط مفتاحاً واحداً دون مسّ الآخر ولا حقول الصف، ويُعيد الكيان، بحدث واحد بالأسماء النقطية، والجسم نفسه مرة ثانية بلا كتابة ولا حدث؛ (3) `null` يمسح المفتاح؛ (4) `400` لقيمة خارج 0–6، أو أيام مكررة، أو قائمة فارغة، أو نوع خاطئ، أو مفتاح غير معروف (`settings.foo`، `settings.scheduling.bar`)؛ و`{ settings: {} }` أو `{ settings: { scheduling: {} } }` وحدهما → `400 nothing_to_update`؛ (5) بلا `academy.settings.manage` → `403` بلا كتابة ولا حدث؛ (6) قيمة تالفة في القاعدة تُقرأ `null`.
- **الاختبارات:** TEST-068 — `academy.settings.spec.ts` (المخطط والتطبيع والقراءة المتسامحة) وتوسيع `academy.changes.spec.ts` و`test/academy.e2e-spec.ts` (يُعيد `settings` الأصلي في `finally`).
- **الاعتماديات:** T01، D-R20. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0088، 2026-11-04 — O8)** — TEST-068 (وحدة 13 وشامل 2 مع توسيع TEST-036)؛ AC1..AC6 ✔. **فرق التنفيذ:** PATCH صار يقفل صف الأكاديمية (`FOR NO KEY UPDATE`) ويعيد التخطيط داخل المعاملة — مفتاحان من الـ jsonb نفسه يُكتبان كائناً كاملاً، وبلا القفل يضيع أحد تعديلين متزامنين (الطلب بلا فرق يبقى بلا معاملة)؛ مقوِّم `MatchesSchema()` يستعمل مخطط zod نفسه في الـ DTO فلا تتكرر القواعد.

#### MOD-02-T04 — العلامة التجارية في الواجهة والمسار العام (مؤجَّل)

- **النطاق:** اسم الأكاديمية وشعارها في ترويسة `AppLayout` من API-035 بدل `common.academyName`، واستبدال `mockAcademySettings.currency` في لوحة التحكم والمدفوعات عند ربط وحدتيهما؛ مسار عام للعلامة التجارية قبل الدخول (صفحة الدخول) إن طلبه المالك.
- **الاعتماديات:** T01/T02؛ MOD-11 للعملة. **الحالة:** `PLANNED`.

#### MOD-02-T05 — جدول الفروع (O8 — PR الجداول)

- **النطاق:** نموذج `Branch` في آخر `schema.prisma` تحت `// MOD-02 (O8)` (§5b.3 قاعدة 3): `id` (uuidv7)، `code varchar(16)` فريد، `name jsonb` (`ar` مطلوب)، `address jsonb NULL` (نص مترجَم)، `phone varchar(32) NULL` (E.164)، `timezone text NULL` (IANA حين يختلف عن منطقة الأكاديمية؛ `NULL` = منطقتها)، `is_main bool DEFAULT false`، `is_active bool DEFAULT true`، `created_at`/`updated_at`؛ **بلا علاقات بعد** — القاعات تشير إليه في O9، ونطاق الأدوار وعمود الفصل لاحقاً (D-R22). `prisma migrate dev --create-only` ثم SQL يدوي: `ck_branches_code_trimmed`، `ck_branches_name_localized`، `ck_branches_address_localized`، `ck_branches_main_active` (`NOT is_main OR is_active`)، والفريد الجزئي `uq_branches_main ON branches (is_main) WHERE is_main` (فرع رئيسي واحد على الأكثر)؛ حارس الانجراف بلا فرق؛ يُعلَن الترحيل في #19 قبل `npm run prisma:migrate`.
- **AC:** (1) `migrate deploy` و`migrate diff --exit-code` بلا فرق؛ (2) كل CHECK يرفض المخالف (اسم بلا `ar`، عنوان بلا `ar`، رمز بمسافة أو فارغ، فرع رئيسي موقوف)؛ (3) فرعان رئيسيان يُرفضان وفرعان غير رئيسيين يُقبلان؛ (4) رمز مكرر يُرفض؛ (5) TEST-007 بـ 19 جدولاً.
- **الاختبارات:** TEST-067 — `test/branches.schema.e2e-spec.ts` على نمط TEST-039 (معاملة تُلغى دائماً)، وتحديث قائمة جداول `test/db.e2e-spec.ts` (TEST-007).
- **الاعتماديات:** D-R19. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0087، 2026-11-04 — O8)** — الترحيل `20261104092731_mod02_branches`؛ TEST-067 (6) وTEST-007 (19 جدولاً)؛ AC1 ✔ (`migrate dev` ثم `migrate diff --exit-code` = «No difference detected»)، AC2 ✔ (اسم وعنوان بلا `ar`، رمز بمسافة أو فارغ، رئيسي موقوف `23514`)، AC3 ✔ (الرئيسي الثاني `23505`)، AC4 ✔، AC5 ✔. **فرق التنفيذ:** Prisma 7 لا يولّد العميل مع `migrate dev` — `npx prisma generate` بعده (وإلا `tx.branch` غير معرّف في الاختبار).

#### MOD-02-T06 — واجهة الفروع (API)

- **النطاق:** مجلد `backend/src/branches/` (`{module, controller, service, dto, changes, errors, policy}.ts`) على نمط `levels` (CH-0044):
  - **API-080 `GET /api/branches`** — كل مستخدم مصادَق (D-R21): الفروع النشطة؛ حامل `branches.manage` يرى الموقوفة أيضاً؛ الرئيسي أولاً ثم بالرمز؛ بلا ترقيم (قائمة صغيرة كالمستويات).
  - **API-081 `POST /api/branches`** (`branches.manage`): `{ code, name, address?, phone?, timezone?, isMain? }`؛ الرمز مشذَّب بأحرف كبيرة (`courses/courses.validation.ts`)، والمنطقة الزمنية بقاعدة API-036؛ `isMain: true` يُنزل الرئيسي الحالي في المعاملة نفسها.
  - **API-082 `PATCH /api/branches/:id`** (`branches.manage`): دلالة PATCH (`null` يمسح `address`/`phone`/`timezone`)، فرق نقي في `branches.changes.ts`، و`isMain`/`isActive`؛ ترقية فرع إلى رئيسي تُنزل الآخر؛ إيقاف الرئيسي → `409 branch_is_main` ما لم يُنزله الطلب نفسه.
  - **API-083 `DELETE /api/branches/:id`** (`branches.manage`): الرئيسي → `409 branch_is_main`؛ الفرع المستعمل → `409 branch_in_use { roomCount }` (الفحص يُضاف مع جدول القاعات في O9 — قبلها لا شيء يشير إلى الفرع)؛ غيرهما يُحذف حذفاً فعلياً.
  - كل كتابة في معاملة واحدة، وما يمسّ `is_main` تحت القفل الاستشاري `pg_advisory_xact_lock(hashtext('articode.branches.main'))` (الفريد الجزئي حدّ أخير)؛ حدث تدقيق واحد بالضبط: `branches.created`، أو `branches.updated { fields, demotedBranchId? }`، أو `branches.deleted`، وصفر للمرفوض؛ بلا فرق = `200` بلا كتابة ولا حدث؛ قاموس أخطاء `branches.errors.ts` (`branch_not_found` 404، `branch_code_taken` 409، `branch_is_main` 409، `branch_in_use` 409، `nothing_to_update` 400)؛ الأحداث في 12.4؛ `BranchesModule` سطر في `app.module.ts`.
- **AC:** (1) مستخدم بلا صلاحية إدارية يقرأ الفروع النشطة وحدها، وحامل `branches.manage` يرى الموقوفة؛ (2) الكتابة بلا `branches.manage` → `403` بلا حدث؛ (3) الإنشاء يطبّع الرمز، والرمز المكرر → `409 branch_code_taken`؛ (4) ترقية فرع إلى رئيسي تُنزل السابق في المعاملة نفسها بحدث واحد يحمل `demotedBranchId`، وطلبا ترقية متزامنان لا ينتجان رئيسيين؛ (5) إيقاف الرئيسي أو حذفه → `409 branch_is_main`؛ (6) PATCH بلا فرق بلا كتابة ولا حدث، و`{}` → `400 nothing_to_update`؛ (7) `400` لمنطقة زمنية أو هاتف غير صالحين واسم بلا `ar`؛ (8) OpenAPI.
- **الاختبارات:** TEST-069 — `branches.changes.spec.ts` و`test/branches.e2e-spec.ts` (يعدّ الأحداث بالفاعل فوق علامة مائية كما TEST-030، وينظّف فروعه في `finally`).
- **الاعتماديات:** T05، D-R21. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0089، 2026-11-04 — O8)** — TEST-069 (وحدة 5 وشامل 8)؛ AC1..AC8 ✔. **فروق التنفيذ:** (أ) `branch_is_main` بثلاثة أفعال في `action`: `deactivate` و`delete` و**`promote_inactive`** الجديد (ترقية فرع موقوف أو إنشاء رئيسي موقوف دون تفعيله)؛ (ب) قفل استشاري واحد لكل كتابات الفروع مع إعادة القراءة والتخطيط بعده؛ (ج) اختبار الترقيتين المتزامنتين يمسك صف الرئيسي `FOR UPDATE` حتى ينتظر الطلبان (نمط T04) — بلا القفل `[200, 500]` (فحص طفرة).

### 4b.6 ترتيب التنفيذ

T01 → T02 في جلسة واحدة (CH-0036) بالتوازي مع S1-R01/S1-R02 في جلسة أخرى (CH-0035)؛ T03/T04 بعد قرار المالك. **O8 (CH-0086):** T05 (جدول الفروع — PR مع هذه الخطة، يُدمج أولاً) ← T03 ∥ T06 في PR ثانٍ؛ دمج T05 يفتح O9 (القاعات تشير إلى الفروع). **بوابة الخروج:** مدير يعدّل اسم الأكاديمية ومنطقتها الزمنية من `/settings` ويظهر التعديل بعد إعادة التحميل، وحدث `academy.updated` في `/audit-logs`.

### 4b.7 قرارات المالك (مُعتمَدة — D-R09/D-R10 اعتُمدت مبدئياً في CH-0036 وأكّدها المالك نهائياً في 2026-11-01، CH-0039؛ D-R19..D-R22 للمهمة O8 في 2026-11-04، CH-0086)

| المعرّف | القرار | الخيارات | **القرار المعتمد / الحالة** | أثر التأخير |
|---|---|---|---|---|
| D-R09 | **من يقرأ صف الأكاديمية** | (أ) كل مستخدم مصادَق · (ب) حامل `academy.settings.read` فقط · (ج) مسار عام للعلامة التجارية قبل الدخول | **`ACCEPTED` (أ) — أكّده المالك 2026-11-01 (CH-0039؛ كان مبدئياً منذ CH-0036):** `GET /api/academy` لكل مصادَق لأن الواجهة تحتاج الاسم والشعار واللغة والمنطقة الزمنية والعملة في كل الأدوار؛ (ج) مؤجَّل (T04)؛ لا توسّع للكتالوج؛ `academy.settings.read` يحكم الشاشة في الواجهة فقط | بدونه تبقى العلامة التجارية ثابتة في i18n |
| D-R10 | **التعديل** | حقول الهوية والإعدادات الأولية · إضافة `slug`/`settings` | **`ACCEPTED` — أكّده المالك 2026-11-01 (CH-0039؛ كان مبدئياً منذ CH-0036):** `PATCH /api/academy` بـ `academy.settings.manage`؛ دلالة PATCH كما API-018 (غائب = بلا تغيير، `null` = مسح للحقول القابلة له، `{}` → `400 nothing_to_update`)؛ الحقول `name` (`ar` مطلوب، `en?`، `tr?` — يُستبدل ككائن كامل)، `logoUrl`، `defaultLocale`، `timezone` (IANA عبر `Intl.supportedValuesOf('timeZone')` — الأسماء القانونية زائد `UTC`)، `currency` (ISO 4217، 3 أحرف كبيرة؛ تُطبَّع إلى الكبيرة)، `contactEmail` (يُطبَّع إلى الصغيرة)، `contactPhone` (E.164)؛ خارج النطاق `slug`، `platformAcademyId`، `settings` (T03) | — |
| D-R19 | **الفروع الآن أم لاحقاً** (D14 في 6.7.11) | (أ) جدول + API الآن، والربط لاحقاً · (ب) تأجيل الفروع، أكاديمية بمقر واحد في v1 | **`ACCEPTED` (أ) — المالك 2026-11-04 (CH-0086):** جدول `branches` (T05) وAPI (T06) الآن؛ القاعات تبني عليه في O9؛ الحذف للفرع غير المستعمل والمستعمل يُوقَف (نمط المستويات، بلا `deleted_at`) | بدونه تُنشأ القاعات بلا فرع ثم تحتاج ترحيلاً لربطها |
| D-R20 | **أول مفاتيح `academy.settings`** (D3) | (أ) الآن بمفتاحَي الجدول الأسبوعي · (ب) تأجيل إلى خطة MOD-07 | **`ACCEPTED` (أ) — المالك 2026-11-04 (CH-0086):** `scheduling.weekStartsOn` و`scheduling.workingDays` (T03)، تُقرأ مع API-035 وتُكتب بـ API-036 و`academy.settings.manage`؛ `null` = غير مضبوط (بلا افتراضي قُطري) | الجدولة وشاشة الجدول تفترضان أسبوعاً ثابتاً |
| D-R21 | **من يقرأ الفروع** | (أ) كل مستخدم مصادَق · (ب) حامل `branches.manage` وحده | **`ACCEPTED` (أ) — المالك 2026-11-04 (CH-0086):** كما D-R09، لأن الطالب والمعلم يحتاجان مكان الحصة؛ الموقوفة لحامل `branches.manage` وحده؛ لا مفاتيح جديدة | — |
| D-R22 | **ربط الفروع بالأدوار والفصول** | (أ) لاحقاً · (ب) الآن ضمن O8 | **`ACCEPTED` (أ) — المالك 2026-11-04 (CH-0086):** `user_roles.branch_id` (يغيّر مفتاح الجدول وكود MOD-03) و`classes.branch_id` (جدول المتعاون) خارج O8؛ ربط الفصل بالمكان عبر القاعة يُتفق عليه في خطة O9 (§4e) — **حُسم في D-R24 (CH-0090): قاعة لكل حصة، بلا أعمدة جديدة في `classes`** | — |

### 4b.8 فروق التنفيذ عن النص أعلاه (CH-0036)

(أ) **غياب الصف = `503 academy_not_configured`** لا `409`: الحالة خطأ تشغيلي (قاعدة غير مبذورة — يحلّه المشغّل بـ `npm run prisma:seed`) لا تعارض يحلّه العميل بتغيير طلبه، وتتسق مع `503` فحص الجاهزية؛ الخادم لا ينشئ الصف تلقائياً. (ب) قاموس أخطاء مستقل `academy.errors.ts` (`AcademyHttpException`) بكودَين: `academy_not_configured` و`nothing_to_update` (الاسم نفسه كما API-018/API-025 كي تشترك الواجهة في الرسالة). (ج) `name` يُستبدل ككائن كامل كما `label` في API-025 (لا دمج لغة بلغة)؛ `en`/`tr` فارغة أو `null` تُسقط اللغة؛ المقارنة بالكائن كاملاً. (د) `currency` تُطبَّع إلى الأحرف الكبيرة و`contactEmail` إلى الصغيرة قبل التحقق؛ `null` مرفوض على `name`/`defaultLocale`/`timezone`/`currency` (`ValidateIf` بدل `IsOptional` الذي يتجاهل `null`). (هـ) المنطقة الزمنية بأسماء IANA القانونية كما نصّ القرار **زائد `UTC` صراحةً**: V8 لا يُدرج `UTC` ولا `Etc/*` ولا المرادفات (`Asia/Calcutta`) في `Intl.supportedValuesOf('timeZone')`، وقاعدة التطوير المبذورة تحمل `UTC` فعلاً، فقُبل `UTC` وحده إضافةً إلى القائمة وبقيت المرادفات و`Etc/*` مرفوضة — يُراجَع إن احتاجته أكاديمية. (و) الاستجابة تُظهر `slug` للقراءة (معرّف النشر) ولا تُظهر `settings` ولا `platformAcademyId` ولا `singleton`. (ز) ملفان إضافيان على القائمة المقترحة: `academy.validation.ts` (منطقة زمنية/عملة + مُطبِّع) و`academy.policy.ts` (مفتاحا الصلاحية). (ح) الواجهة: عنصر التنقل `settings` صار بالصلاحيتين (`academy.settings.read`/`academy.settings.manage` — أيّ منهما يكفي) لا بالدور، فأُضيف المفتاح إلى مثبّتات المدير في اختبارات T15/T13 المعنية؛ `mockAcademySettings` بقي في `mock/data.ts` لأن لوحة التحكم وصفحة المدفوعات التجريبيتين ما زالتا تقرآن `currency` منه (T04)؛ المنطقة الزمنية حقل `AutoComplete` من `Intl.supportedValuesOf` والعملة حقل نصي بثلاثة أحرف تُكبَّر محلياً. (ط) **الرحلة اليدوية من المتصفح لم تُنفَّذ** (`UNVERIFIED` → ✔ المالك 2026-11-01 (CH-0042، §4.9) — كما T11..T15).


### 4b.9 تفاصيل تقنية موصى بها لـ O8 (تُعتمد بدمج الخطة — CH-0086)

| البند | الموصى به |
|---|---|
| فروق `branches` عن 6.7 | (أ) **بلا `deleted_at`** — نمط `levels`: `is_active` للإيقاف وحذف فعلي لغير المستعمل (D7/ADR-020 تقصر الحذف الناعم على الجداول التي يحتاج تاريخها)؛ (ب) `address` نص مترجَم `{ ar, en?, tr? }` بـ CHECK كبقية النصوص؛ (ج) `CHECK (NOT is_main OR is_active)` وفريد جزئي على `is_main` بدل الاعتماد على الكود وحده؛ (د) لا بذر لفرع — الأكاديمية بمقر واحد تعمل بلا فروع، والرئيسي اختياري (صفر أو واحد) |
| شكل `settings` | كائن متداخل بالمجال (`scheduling.*`) لا مفاتيح مسطّحة، كي تضيف الوحدات اللاحقة مجالاتها (`enrollment.*`، `notifications.*`) بلا تعارض؛ المخطط الواحد في `academy.settings.ts` هو المصدر الوحيد للمفاتيح؛ مفتاح جديد = تعديل المخطط + 10.2 + 6.2 في PR الوحدة المستهلكة |
| أسماء الحقول في حدث `academy.updated` | حقول الصف أولاً بترتيب `ACADEMY_PATCH_FIELDS` ثم مفاتيح الإعدادات بأسمائها النقطية بترتيب المخطط — أسماء فقط بلا قيم (12.4) |
| المعرّفات المحجوزة (كتلة المالك — §5b.4) | API-080..API-083 (الفروع)؛ TEST-067 (T05)، TEST-068 (T03)، TEST-069 (T06)؛ API-035/API-036 تُحدَّث في مكانها لـ T03 بلا معرّف جديد |
| خارج O8 | شاشة الفروع وحقلا الإعدادات في الواجهة (مرحلة الواجهة)؛ `rooms` (O9)؛ نطاق الأدوار بالفرع وعمود الفرع في الفصول (D-R22)؛ منطقة الفرع الزمنية تُخزَّن وتُقرأ ولا يستهلكها شيء قبل O9 |

---

## 4c. MOD-04 — الدورات والمستويات (خطة التنفيذ — أول وحدة في Stage 3)

> كُتبت في CH-0041 (2026-11-01) بعد حسم ADR-008 (ADR-045) وبتكليف المالك «لنبدأ بالخطوة التالية». **لا كود ولا ترحيل بعد**؛ كل مهمة `PLANNED` حتى تُنفَّذ. المصادر: الوثيقة الرئيسية 6.7.4-C (الجداول المقترحة)، 6.7.1/ADR-020 (الاصطلاحات)، 7.x (الصلاحيات)، MOD-04 في 08، WF-05 في 09؛ والنموذج الأولي `frontend/src/pages/CoursesPage.tsx`. Stage 3 تعتمد على Stage 2 (§1) التي ينقص بوابتها قبول MOD-03 وحده — التخطيط يبدأ الآن، والتنفيذ (T01 فما بعد) بعد قبول MOD-03 ما لم يقرر المالك غير ذلك.

### 4c.1 النطاق والأهداف

| داخل النطاق (قرار المالك D-R11) | خارج النطاق (مؤجَّل بقرار) |
|---|---|
| **المستويات** (`levels`): قائمة مرجعية يديرها المدير — رمز، اسم متعدد اللغات، وصف، ترتيب، تفعيل | **التصنيفات** (`course_categories`) — تُضاف لاحقاً حين يكثر عدد الدورات (D-R11) |
| **الدورات** (`courses`): رمز، اسم/ملخص/وصف متعدد اللغات، مستوى، مدة بالساعات وعدد الجلسات وفئة عمرية اختيارية، حالة `draft → published → archived` | **المتطلبات السابقة** (`course_prerequisites`) — مع MOD-05 حيث يُفحص التسجيل (D-R11) |
| **المنهج** (`course_syllabus_items`): بنود مرتبة لكل دورة (عنوان، وصف، دقائق تقديرية) — قالب الدروس الذي تبني عليه MOD-06 | **السعر والعملة** (`default_price`/`currency`) — مع MOD-11 (خطط الرسوم وتجاوز سعر الفصل) (D-R12) |
| ظهور المسودات والمؤرشفة لحامل `courses.manage` وحده؛ البقية يرون المنشورة (D-R13) | **صورة الغلاف** (`cover_file_id`) — جدول `files` غير موجود؛ تُضاف مع وحدة الملفات |
| **أرشفة بدل الحذف**؛ الحذف النهائي لمسودة غير مستخدمة وحدها (D-R14) | `student_profiles.current_level_id` — مع MOD-05 إن احتاجته |
| سجل تدقيق لكل كتابة (حدث واحد بالضبط داخل المعاملة) | المعلم وعدد الطلاب لكل دورة (عمودا النموذج الأولي) — يُشتقّان من الفصول والتسجيلات في MOD-05 |
| الواجهة: صفحة الدورات الحقيقية، درج الدورة، إدارة المستويات، محرّر المنهج | ربط الدورات بالفروع |

### 4c.2 الجداول — مجموعة فرعية من المرحلة B في 6.7.4-C بعد قرارات المالك (ترحيل واحد مراجَع في T01)

| الجدول | الأعمدة (بعد القرارات) | القيود والفهارس | الفروق عن 6.7.4-C |
|---|---|---|---|
| `levels` | `id` (uuidv7)، `code varchar(16)`، `name jsonb`، `description jsonb NULL`، `sort_order smallint`، `is_active bool DEFAULT true`، `created_at`/`updated_at` | `UNIQUE(code)`؛ `UNIQUE(sort_order)` **قابل للتأجيل** (`DEFERRABLE INITIALLY DEFERRED` بـ SQL يدوي) ليُعاد الترتيب في معاملة واحدة؛ CHECK الاسم والوصف المترجَمين (`jsonb_typeof = 'object' AND ? 'ar'` — D1) | قابلية تأجيل الفرادة (إضافة) |
| `courses` | `id`، `code varchar(32)`، `name jsonb`، `summary jsonb NULL`، `description jsonb NULL`، `level_id → levels NULL`، `status course_status` (`draft`/`published`/`archived`، افتراضي `draft`)، `duration_hours numeric(6,1) NULL`، `sessions_count smallint NULL`، `min_age`/`max_age smallint NULL`، `created_by → users NULL`، `created_at`/`updated_at` | `UNIQUE(code)`؛ فهارس `status` و`level_id` و`created_by`؛ `level_id` **Restrict** و`created_by` **SetNull**؛ CHECKs: الأسماء المترجَمة، `max_age >= min_age`، القيم الموجبة | بلا `category_id` (D-R11) وبلا `default_price`/`currency` (D-R12) وبلا `cover_file_id` وبلا `deleted_at` (D-R14 + D7/ADR-020: الأرشفة هي الإزالة) |
| `course_syllabus_items` | `id`، `course_id → courses` (**Cascade**)، `sort_order smallint`، `title jsonb`، `description jsonb NULL`، `estimated_minutes smallint NULL`، `created_at`/`updated_at` | `UNIQUE(course_id, sort_order)` قابل للتأجيل؛ فهرس `course_id` يغطيه الفريد؛ CHECKs الترجمة و`estimated_minutes > 0` | قابلية تأجيل الفرادة (إضافة) |

النتيجة: 15 نموذجاً بدل 12 + تعداد `CourseStatus` — يبقى المخطط ملفاً واحداً (عتبة التقسيم ~30 نموذجاً — الوثيقة الرئيسية 6.7). كل ترحيل يُطبَّق على كل أكاديمية على حدة (ADR-045).

### 4c.3 الصلاحيات (من الكتالوج الحالي — لا مفاتيح جديدة)

`courses.read` (كل الأدوار النظامية بالبذر) يقرأ الدورات **المنشورة** ومستوياتها ومنهجها؛ `courses.manage` (`academy_admin` وحده بالبذر) يقرأ كل الحالات ويكتب الدورات والمستويات والمنهج (D-R13). **عنصر التنقل `courses` ينتقل إلى البوابة بالصلاحية `courses.read`** (نمط ADR-042) فيظهر للموظف أيضاً لأنه يحمل المفتاح — مقبول ضمن D-R13.

### 4c.4 نقاط النهاية المقترحة (`PLANNED` — العقود النهائية تُثبَّت في 10.2 عند التنفيذ بمعرّفات API-037 فما بعد)

| الطريقة والمسار | الصلاحية | ملاحظات |
|---|---|---|
| `GET /api/levels` | `courses.read` | مرتبة بـ `sort_order`؛ غير المفعَّلة لحامل `courses.manage` فقط |
| `POST /api/levels` · `PATCH /api/levels/:id` · `DELETE /api/levels/:id` | `courses.manage` | الحذف فقط لمستوى لا تستخدمه دورة (`409 level_in_use`) |
| `PUT /api/levels/order` | `courses.manage` | إعادة ترتيب كاملة بقائمة المعرّفات في معاملة واحدة |
| `GET /api/courses` · `GET /api/courses/:id` | `courses.read` | بحث `q` (رمز/اسم)، مرشّحا `status` (لـ `manage` وحده) و`levelId`، ترقيم keyset (ADR-028)؛ غير المنشورة → `404` لغير المدير |
| `POST /api/courses` · `PATCH /api/courses/:id` | `courses.manage` | الإنشاء بحالة `draft`؛ PATCH بأصغر فرق ومقارنة الكائن المترجَم كاملاً (ADR-044) |
| `POST /api/courses/:id/status` | `courses.manage` | `{ action: publish | unpublish | archive | restore }` بآلة حالات نقية (`409 invalid_transition` كما T06) |
| `DELETE /api/courses/:id` | `courses.manage` | مسودة غير مستخدمة فقط (`409 course_not_deletable`)؛ غيرها يُؤرشف |
| `GET /api/courses/:id/syllabus` · `PUT /api/courses/:id/syllabus` | `courses.read` · `courses.manage` | المنهج كاملاً بترتيبه؛ الكتابة استبدال كامل محسوب كفرق (إضافة/تعديل/حذف/ترتيب) بحدث واحد |

### 4c.5 المهام

> كل مهمة: النطاق → معايير القبول (AC) → الاختبارات → الاعتماديات → التقدير → الحالة. المجلدات المقترحة: `backend/src/courses/` (`CoursesModule` للدورات والمنهج) و`backend/src/levels/` (`LevelsModule`)؛ الواجهة `frontend/src/courses/` و`frontend/src/api/{courses,levels}.ts`. قاموس أخطاء مستقل `courses.errors.ts` (`CoursesHttpException`) على نمط ADR-044.

#### MOD-04-T00 — التحضير والقرارات (بلا كود إنتاجي)

- **النطاق:** قرارات المالك D-R11..D-R14 (§4c.7)؛ اختيار المجموعة الفرعية من 6.7.4-C وفروقها (§4c.2)؛ مسودة قاموس الأخطاء (`course_not_found`، `course_code_taken`، `course_not_deletable`، `level_not_found`، `level_code_taken`، `level_in_use`، `invalid_transition`، `nothing_to_update`) والأحداث (`levels.created|updated|deleted|reordered`، `courses.created|updated|status.changed|deleted`، `courses.syllabus.changed`).
- **AC:** القرارات مسجَّلة هنا وفي الوثيقة الرئيسية (MOD-04 في 08، ملاحظة 6.7.4-C)؛ لا تغيير سلوكي.
- **الاعتماديات:** قرار المالك. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0041، 2026-11-01)** — D-R11..D-R14 `ACCEPTED`.

#### MOD-04-T01 — المخطط والترحيل

- **النطاق:** نماذج `Level` و`Course` و`CourseSyllabusItem` وتعداد `CourseStatus` في `schema.prisma` باصطلاحات ADR-020 (uuidv7، snake_case، `Timestamptz`، فهرس صريح لكل FK، `onDelete` صريح)؛ `prisma migrate dev --create-only` ثم SQL يدوي: CHECKs الترجمة (`? 'ar'`)، الأعمار والقيم الموجبة، وتحويل فرادتي الترتيب إلى `DEFERRABLE INITIALLY DEFERRED`؛ مراجعة الترحيل والتزامه؛ حارس الانجراف بلا فرق.
- **AC:** (1) `migrate deploy` على قاعدة نظيفة وعلى قاعدة التطوير ينجح و`migrate diff --exit-code` بلا فرق؛ (2) كل CHECK يرفض قيمة مخالفة (اسم بلا `ar`، `max_age < min_age`، دقائق سالبة)؛ (3) حذف مستوى مستخدم يُرفض (Restrict) وحذف دورة يحذف منهجها (Cascade)؛ (4) إعادة ترتيب بنود المنهج بتبديل قيمتين داخل معاملة واحدة تنجح.
- **الاختبارات:** توسيع `test/db.e2e-spec.ts` (نمط TEST-007) بمعاملات تُلغى؛ CI يطبّق الترحيل تلقائياً.
- **الاعتماديات:** T00. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0043، 2026-11-01)** — الترحيل `20261101201101_mod04_courses_levels_syllabus`؛ TEST-039 (8) وTEST-007 محدَّث؛ AC1 ✔ (`migrate deploy` + `migrate diff --exit-code` بلا فرق على قاعدة التطوير؛ القاعدة النظيفة يغطيها CI عند الرفع)، AC2 ✔، AC3 ✔، AC4 ✔ (بالاختبار؛ و`SET CONSTRAINTS … IMMEDIATE` يكشف التكرار). **فروق التنفيذ:** القيدان باسمي `uq_levels_sort_order` و`uq_course_syllabus_items_course_order` (ADR-046 في الوثيقة الرئيسية)؛ CHECK إضافي `code = btrim(code) AND code <> ''` على المستوى والدورة (بلا نمط أحرف — يُقرَّر في T02/T03)؛ CHECK على الأوصاف المترجَمة الاختيارية أيضاً؛ الاختبار ملف جديد `test/courses.schema.e2e-spec.ts` بدل التوسيع داخل `db.e2e-spec.ts` (الذي حُدِّثت قائمة جداوله إلى 15).

#### MOD-04-T02 — المستويات (API)

- **النطاق:** `LevelsModule`: القراءة والإنشاء والتعديل (PATCH بأصغر فرق) والحذف المشروط وإعادة الترتيب (§4c.4)؛ حدث تدقيق واحد لكل كتابة؛ لا شيء بلا فرق.
- **AC:** (1) بلا `courses.manage` → `403 permission_denied` على كل كتابة، والقراءة بـ `courses.read`؛ (2) `code` مكرر → `409 level_code_taken`؛ (3) حذف مستوى مستخدم → `409 level_in_use` بلا كتابة؛ (4) إعادة الترتيب ترفض قائمة ناقصة أو بمعرّف غريب (`400`) وتنجح كاملة بحدث `levels.reordered` واحد؛ (5) غير المفعَّلة مخفية عن غير المدير.
- **الاختبارات:** وحدة للمنطق النقي + شامل `test/levels.e2e-spec.ts` (يُتخطّى بلا قاعدة).
- **الاعتماديات:** T01. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0044، 2026-11-01)** — API-037..API-041؛ TEST-040 (9 وحدة + 7 شاملة)؛ AC1..AC5 ✔ بالاختبارات. **فروق التنفيذ:** (أ) الرموز تُشذَّب وتُكبَّر وصيغتها `^[A-Z0-9][A-Z0-9._-]{0,15}$` (قرار تقني — نفس النمط للدورات بطول 32)؛ (ب) الإنشاء في آخر الترتيب دائماً (لا `sortOrder` في الجسم) والترتيب بـ `PUT /api/levels/order` وحده؛ (ج) قفل استشاري معاملاتي على الإنشاء والحذف والترتيب؛ (د) `courseCount` للمدير وحده (لا يكشف وجود مسودات للقارئ)؛ (هـ) لا `GET /api/levels/:id` (القائمة صغيرة)؛ (و) حد القائمة في الترتيب 100 معرّف؛ (ز) الحذف لا يضغط الترتيب (فجوات حتى أول إعادة ترتيب)؛ (ح) `sameLocalizedText()` نُقلت إلى `authorization/localized-text.ts`.

#### MOD-04-T03 — الدورات (API)

- **النطاق:** `CoursesModule`: القائمة (بحث، مرشّحات، keyset — مع نقل `users.cursor.ts` و`escapeLikePattern()` إلى `src/common/` لأنها المستهلك الثاني كما ينص ADR-028)، التفاصيل، الإنشاء (`draft`، `created_by` = الفاعل)، PATCH بأصغر فرق، آلة الحالات النقية (`publish`: draft→published، `unpublish`: published→draft، `archive`: draft|published→archived، `restore`: archived→draft)، الحذف المشروط؛ `select` صريح دائماً.
- **AC:** (1) حامل `courses.read` وحده لا يرى إلا المنشورة (القائمة والتفاصيل — غيرها `404`) ولا يقبل مرشّح `status` غير المنشور؛ (2) المدير يرى كل الحالات ويرشّح بها؛ (3) `code` مكرر → `409 course_code_taken`؛ (4) انتقال غير مسموح → `409 invalid_transition { from, action, allowed }`؛ (5) حذف دورة غير مسودة → `409 course_not_deletable`؛ (6) حدث واحد بالضبط لكل كتابة وصفر للمرفوض ولـ PATCH المطابق؛ (7) الترقيم مستقر بلا تكرار ولا فقد.
- **الاختبارات:** وحدة (آلة الحالات، الفرق، المؤشر) + شامل `test/courses.e2e-spec.ts`.
- **الاعتماديات:** T01 (وT02 لمرشّح المستوى). **التقدير:** L. **الحالة:** **`IMPLEMENTED` (CH-0045، 2026-11-01)** — API-042..API-047؛ TEST-041 (10 وحدة + 7 شاملة)؛ AC1..AC7 ✔ بالاختبارات. **فروق التنفيذ:** (أ) نقل `users.cursor.ts` إلى `common/` صار **استخراج مؤشر عام** `common/keyset-cursor.ts` يستعمله الدورات وحدها الآن، و`users.cursor.ts` بقي (تجنّباً لتغيير وحدة مقبولة)؛ `escapeLikePattern()` يُستورد من `users/users.validation.ts` كما يفعل التدقيق؛ (ب) الترتيب `code` (افتراضي، تصاعدي) أو `createdAt` (تنازلي)؛ (ج) البحث في الرمز (حرفي، بلا حالة أحرف) وفي `name.ar`/`name.en` (هروب `%`/`_` غير متحقق — KI-048؛ **أُصلح في CH-0079**: حرفي وبلا حساسية للحالة)؛ (د) مرشّح الحالة لغير المدير بقيمة غير `published` → `403 permission_denied` (لا 400)؛ (هـ) مستوى مجهول في الجسم → `404 level_not_found`، ونطاق عمر مقلوب → `400 age_range_invalid` (كود جديد)؛ (و) `syllabusCount` في `CourseDto`؛ (ز) الأرقام في الجسم أرقام JSON حقيقية (`"12"` مرفوض)؛ (ح) الحذف والانتقالات بكتابة شرطية بدل قفل.

#### MOD-04-T04 — المنهج (API)

- **النطاق:** `GET`/`PUT /api/courses/:id/syllabus`: القراءة بالترتيب، والكتابة استبدال كامل يُحسب كفرق نقي (بنود جديدة بلا `id`، بنود قائمة بـ `id`، المحذوف ما غاب، الترتيب = ترتيب القائمة) في معاملة واحدة بحدث `courses.syllabus.changed { added, updated, removed, reordered }` واحد.
- **AC:** (1) منهج دورة غير منشورة مخفي عن غير المدير (`404`)؛ (2) `id` لا ينتمي إلى الدورة → `400`؛ (3) قائمة مطابقة → `200` بلا كتابة ولا حدث؛ (4) سقف معقول لعدد البنود (يُحدَّد في التنفيذ) → `400` فوقه.
- **الاختبارات:** وحدة لدالة الفرق + شامل ضمن `courses.e2e-spec.ts`.
- **الاعتماديات:** T03. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0050، 2026-11-03 — المطوّر المتعاون، C1)** — API-048/API-049؛ FS-072؛ TEST-045 (وحدة 6 + شامل 4)؛ AC1 ✔ (منهج غير المنشورة `404 course_not_found` لغير المدير)، AC2 ✔ (`400 syllabus_invalid { unknown, duplicates }` قبل أي كتابة)، AC3 ✔ (القائمة نفسها → `200` بالرد نفسه بلا كتابة ولا حدث)، AC4 ✔ (السقف **200** بند → `400` فوقه).
- **فروق التنفيذ:** (أ) بُني على التنفيذ المرجعي `f1a418c` من جهاز المالك (الفرع `backend/mod04-t04-syllabus-reference`) بعد مراجعته ككود جديد وتحويل معرّفاته إلى كتلة المتعاون؛ (ب) الشامل في ملف مستقل `backend/test/syllabus.e2e-spec.ts` لا كتلة في `courses.e2e-spec.ts`؛ (ج) بيانات الحدث `{ code, added, updated, removed, reordered, items }` — أُضيف الرمز وعدد البنود بعد الاستبدال؛ (د) قفل صف الدورة `FOR NO KEY UPDATE` (لا `FOR UPDATE`) فلا يحجب جداول تشير إلى الدورة (MOD-05)؛ (هـ) الدقائق 1–1440 عدداً JSON خاماً؛ (و) سطر `courses.syllabus.changed` في `AUDIT_ACTION_SUGGESTIONS` حُذف من هذا التغيير — هو جزء من O7 (الواجهة مجمّدة)؛ (ز) **KI-050:** حد جسم JSON العام 100 KB يرفض بـ `413` منهجاً واقعياً من 200 بند بأوصاف (≈ 130 KB؛ 120 بنداً تمر) — العلاج قرار المالك (`app.setup.ts` مشترك). **أُصلح في CH-0081:** قرر المالك حدّاً لمسار PUT المنهج وحده حتى 512 KB وإبقاء 100 KB للباقي (ADR-062، TEST-064).

#### MOD-04-T05 — الواجهة: صفحة الدورات ودرج الدورة

- **النطاق:** `CoursesPage` حقيقية على `GET /api/courses` (بحث، مرشّحا المستوى والحالة للمدير، «السابق/التالي» على مكدّس المؤشرات كما `useUsersList`)؛ درج دورة: تفاصيل + تعديل بأصغر PATCH + قائمة إجراءات الحالة من مرآة آلة الحالات + حذف المسودة خلف تأكيد + معالج إنشاء؛ الأعمدة: الرمز، الاسم، المستوى، الحالة، آخر تعديل (لا معلم ولا عدد طلاب — §4c.1)؛ إزالة `mockCourses` من الصفحة (لوحة التحكم تبقى على البيانات التجريبية حتى وحدتها)؛ عنصر التنقل بـ `courses.read`.
- **AC:** (1) الطالب/المعلم/الموظف يرون المنشورة فقط وبلا أزرار كتابة؛ (2) المدير ينشئ ويعدّل وينشر ويؤرشف ويستعيد من الصفحة؛ (3) أخطاء الخادم برسائل مفهومة بالكود؛ (4) لا طلب بلا فرق.
- **الاختبارات:** مكوّنات بـ Vitest + Testing Library (نمط TEST-031/TEST-034) + تحديث `navigation.test.ts` (الموظف يرى «الدورات»).
- **الاعتماديات:** T03. **التقدير:** L. **الحالة:** **`IMPLEMENTED` (CH-0047، 2026-11-02)** — FS-070؛ TEST-043 (21: مكوّنات الصفحة والدرج + الدوال النقية + الاتصال + `navigation.test.ts`)؛ AC1 ✔ (القارئ بلا أزرار كتابة ولا مرشّح حالة؛ الخادم يقصر القائمة على المنشورة)، AC2 ✔ (الإنشاء والتعديل والنشر وحذف المسودة مختبرة في المكوّنات، والأرشفة والاستعادة من القائمة نفسها بمرآة آلة الحالات المختبرة)، AC3 ✔ (`describeCoursesFailure()` بالكود والحقل)، AC4 ✔ — كلها بالاختبارات؛ **الرحلة من المتصفح جزئية** (المالك: إنشاء ونشر وإلغاء نشر `MAT103` — CH-0048؛ التعديل وجهة الطالب مع T07)؛ صف «بنود المنهج» أُزيل من الدرج بطلب المالك (CH-0048). **فروق التنفيذ:** (أ) الإنشاء نافذة واحدة `CreateCourseModal` لا معالج متعدد الخطوات (حقول قليلة بلا ملف تابع)؛ (ب) ملاحظة §4c.8 (4) حُسمت بنوع `LocalizedLabel` (الإنجليزية اختيارية) بدل `LocalizedText`؛ (ج) الترتيب بالرمز أو الأحدث، وأحجام الصفحة 20/50/100؛ (د) لوحة التحكم ما زالت تعدّ الدورات المنشورة من `mockCourses` (كما في النطاق).

#### MOD-04-T06 — الواجهة: المستويات والمنهج

- **النطاق:** إدارة المستويات (تبويب داخل صفحة الدورات لحامل `courses.manage`: جدول، إنشاء/تعديل، حذف مشروط، ترتيب بالسحب أو بأزرار أعلى/أسفل)؛ تبويب «المنهج» في درج الدورة (عرض للجميع، تحرير للمدير: إضافة/تعديل/حذف/ترتيب ثم حفظ واحد عبر `PUT`).
- **AC:** (1) حفظ المنهج يرسل طلباً واحداً بالقائمة كاملة فقط عند وجود فرق؛ (2) حذف مستوى مستخدم يعرض رسالة `level_in_use`؛ (3) القراءة فقط لغير المدير.
- **الاختبارات:** مكوّنات + دوال نقية للفرق المحلي.
- **الاعتماديات:** T02، T04، T05. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0049، 2026-11-02)** — FS-071؛ TEST-044 (24)؛ AC1 ✔ (PUT واحد بالقائمة كاملة عند الفرق فقط، ولا طلب بلا فرق)، AC2 ✔ (زر الحذف معطَّل بتلميح لمستوى مستخدَم، ورسالة `level_in_use` بعدد الدورات عند عدّ قديم)، AC3 ✔ (تبويب المنهج للقراءة فقط وتبويب المستويات غائب لغير المدير) — كلها بالاختبارات؛ **الرحلة من المتصفح `UNVERIFIED`** (مع T07). **فروق التنفيذ:** (أ) الترتيب بأسهم أعلى/أسفل لا بالسحب (بلا اعتماديات جديدة)، وكل نقرة ترسل الترتيب كاملاً فوراً؛ (ب) المستوى الجديد يُلحق آخر الترتيب (كما الخادم)؛ (ج) تبويب المنهج يعرض ملخص «n بند · m دقيقة» بدل عدّاد التفاصيل الذي أُزيل في CH-0048؛ (د) إصلاح مرافق KI-049 (قيم جلسة تعديل ملغاة كانت تعود في درج الدورة) — والخلل نفسه مؤكَّد في `UserDrawer` (MOD-03) وينتظر قرار المالك؛ **أُصلح بقرار المالك في CH-0074 (2026-11-03، `UserEditForm`، TEST-061)**.

#### MOD-04-T07 — الإغلاق: التدقيق والرحلة

- **النطاق:** الأحداث الجديدة في قاموس 12.4 و`AUDIT_ACTION_SUGGESTIONS` وتوسيع اختبار التغطية المركزي (نمط TEST-030)؛ توثيق WF-05 خطوة بخطوة في 09؛ الرحلة اليدوية من المتصفح مع المالك.
- **AC:** (1) كل مسار كاتب في T02..T04 يسجّل حدثاً واحداً بالضبط وصفراً للمرفوض (اختبار آلي)؛ (2) **بوابة الوحدة (WF-05):** المدير ينشئ مستوى ثم دورة بمنهج من ثلاثة بنود وينشرها، فيراها الطالب في قائمته بمنهجها، ولا يرى مسودة أخرى، وتظهر الأحداث في `/audit-logs`.
- **الاعتماديات:** T02..T06. **التقدير:** S. **الحالة:** **`PARTIALLY_IMPLEMENTED` — النصف الخادمي ✔ (CH-0051، 2026-11-03 — المطوّر المتعاون، C2)**: AC1 ✔ — TEST-030 يمرّ بالمسارات الكاتبة التسعة في T02..T04 (حدث واحد بالضبط لكل طلب، وصفر لأحد عشر طلباً مرفوضاً ولأربع كتابات مطابقة للمخزَّن)؛ AC2 مؤتمت عبر API — TEST-046 (`backend/test/courses.journey.e2e-spec.ts`: المستوى ← الدورة ← منهج من ثلاثة بنود ← النشر ← الطالب يراها بمستواها ومنهجها ولا يرى المسودة ← الأحداث في `GET /api/audit-logs`)؛ WF-05 موثَّقة خطوة بخطوة في القسم 09 من الوثيقة الرئيسية؛ الأحداث التسعة في 12.4. **جزء الواجهة (O7-F — CH-0067، 2026-11-06، المتعاون):** `courses.syllabus.changed` في `AUDIT_ACTION_SUGGESTIONS` ✔ (TEST-081)، ومطابقة `frontend/src/api/syllabus.ts` لعقد API-048/API-049 وللمخطط الحي `/api/docs-json` ✔ (مطابق بلا تعديل؛ ملاحظة توثيق Swagger للمالك — KI-051 في الوثيقة الرئيسية 16). **المتبقي:** رحلة WF-05 من المتصفح مع فحص تبويب المنهج على الخادم الحقيقي وظهور الأحداث في `/audit-logs` — `UNVERIFIED` (لا أداة متصفح في جلسة CH-0067)، ثم قبول المالك لـ MOD-04 في §4c.9 (O7).

### 4c.6 ترتيب التنفيذ (دفعات)

| الدفعة | المهام | بوابة الدفعة |
|---|---|---|
| **A — القرارات والمخطط** | ~~T00~~ ✔ (CH-0041) → ~~T01~~ ✔ (CH-0043) — **مكتملة محلياً** | ترحيل مراجَع ملتزم ✔، وCI أخضر عليه — ينتظر الرفع |
| **B — الخادم** | ~~T02~~ ✔ (CH-0044) ∥ ~~T03~~ ✔ (CH-0045) → ~~T04~~ ✔ (CH-0050) — **مكتملة** | العقود في 10.2 واختبارات شاملة خضراء |
| **C — الواجهة** | ~~T05~~ ✔ (CH-0047) → ~~T06~~ ✔ (CH-0049) — **مكتملة في الواجهة؛ تبويب المنهج على عقد T04 المنفَّذ (CH-0050)، والتحقق منه في المتصفح ضمن O7** | شاشات تعمل على الخادم بلا بيانات تجريبية ✔ (المكوّنات مختبرة؛ الرحلة من المتصفح مع T07) |
| **D — الإغلاق** | T07 (النصف الخادمي ✔ CH-0051 — C2؛ كود الواجهة ✔ CH-0067 — O7-F؛ الباقي رحلة المتصفح ثم O7) | رحلة WF-05 من المتصفح؛ قبول المالك لـ MOD-04 |

> **التقسيم بين المطورين:** منذ 2026-11-02 (CH-0070) كانت T04 عند مطوّر الخادم وT05/T06 عند المالك (الواجهة) — نُفِّذت T05/T06. **منذ 2026-11-03 (§5b.2، CH-0075، ADR-061):** T04 = C1 والنصف الخادمي من T07 (TEST-030 وWF-05 في القسم 09) = C2 عند المطوّر المتعاون؛ الرحلة من المتصفح والقبول = O7 عند المالك.

### 4c.7 قرارات المالك (2026-11-01 — CH-0041)

| المعرّف | القرار | الخيارات | **القرار المعتمد** | الأثر |
|---|---|---|---|---|
| D-R11 | **نطاق النسخة الأولى** | المنهج · التصنيفات · المتطلبات السابقة (اختيار متعدد إلى جانب الدورات والمستويات) | **`ACCEPTED`: المنهج فقط** (الموصى به)؛ التصنيفات لاحقاً؛ المتطلبات السابقة مع MOD-05 | 3 جداول بدل 5 في T01 |
| D-R12 | **سعر الدورة** | لا سعر الآن (مع MOD-11) · سعر افتراضي اختياري بعملة الأكاديمية | **`ACCEPTED`: لا سعر في MOD-04** (الموصى به) — يُبنى مع خطط الرسوم في MOD-11 | لا `default_price`/`currency` ولا سؤال العملة لكل دورة (D15 يبقى لـ MOD-11) |
| D-R13 | **ظهور غير المنشور** | مدير الدورات فقط · المعلمون يرون المسودات أيضاً | **`ACCEPTED`: حامل `courses.manage` وحده** (الموصى به)؛ الصفحة تظهر للموظف لأنه يحمل `courses.read` | فلترة الحالة في الخادم؛ عنصر التنقل بالصلاحية |
| D-R14 | **الحذف** | أرشفة بدل الحذف · حذف منطقي | **`ACCEPTED`: أرشفة بدل الحذف** (الموصى به)؛ الحذف النهائي لمسودة غير مستخدمة فقط | لا `deleted_at` على `courses` (متسق مع D7/ADR-020)؛ آلة حالات بأربعة إجراءات |

### 4c.8 ملاحظات تقنية من مراجعة التوثيق (تُحسم في المهمة المعنية)

(1) قسم MOD-04 في 08 كان يتوقع جدول `course_levels`، بينما 6.7.4-C والنموذج الأولي يضعان مستوى واحداً لكل دورة (`courses.level_id`) — المعتمد هو 6.7.4-C (مستوى واحد). (2) 6.7.1 يقترح CHECK الترجمة بلا `? 'ar'` بينما D1 والترحيل المنفَّذ يشترطانه — يُتّبع المنفَّذ. (3) أسماء القيود: يُتّبع نمط الترحيل المنفَّذ (أسماء Prisma الافتراضية، و`ck_`/`uq_` للمكتوب يدوياً) لا اقتراح 6.7.1. (4) نوع `LocalizedText` في الواجهة يشترط `en` بينما الخادم يجعلها اختيارية — يُعالَج في T05 لأن أسماء الدورات قد تأتي بالعربية وحدها — **حُسم في T05 (CH-0047):** أنواع الدورات والمستويات في الواجهة تستعمل `LocalizedLabel` (الإنجليزية اختيارية). (5) بذر المستويات: لا بذر — المستويات بيانات أكاديمية يديرها المدير (البذر للكتالوج والأدوار النظامية فقط)؛ قاعدة التطوير تُملأ من الواجهة أو بسكربت تطوير إن لزم. (6) قسم MOD-05 في 08 يذكر «فصول لدورة ومستوى» بينما `classes` بلا `level_id` — يُحسم في خطة MOD-05.

---

## 4d. MOD-05 — الفصول والتسجيلات (خطة التنفيذ — الوحدة الثانية في Stage 3)

> كُتبت في CH-0076 (2026-11-03) — المهمة O2 في §5b.2 بتكليف المالك، وقراراته D-R15..D-R18 (§4d.7) أُخذت في الجلسة نفسها. **لا كود ولا ترحيل بعد**؛ كل مهمة `PLANNED` حتى تُنفَّذ. **التنفيذ عند المطوّر المتعاون (C3)** على اتفاق «الخادم أولاً» (ADR-061)، وواجهة الوحدة مؤجَّلة إلى مرحلة الواجهة (T07). المصادر: الوثيقة الرئيسية 6.7.4-C (`classes`، `class_teachers`، `enrollments`)، كتالوج الصلاحيات وأدوار النظام (`backend/src/authorization/permission-catalog.ts`، `system-roles.ts`)، MOD-05 في 08، WF-03 وWF-04 في 09، واصطلاحات MOD-03/MOD-04 المنفَّذة (keyset — ADR-028، آلات حالات نقية، حدث تدقيق واحد لكل كتابة، قاموس أخطاء لكل وحدة — ADR-044).

### 4d.1 النطاق والأهداف

| داخل النطاق | خارج النطاق (مؤجَّل بقرار) |
|---|---|
| **الفصول** (`classes`): تنفيذ دورة منشورة لمجموعة طلاب — رمز، اسم متعدد اللغات، سعة، تاريخا بدء وانتهاء للعرض، ملاحظات، وحالة `planned → open → running → completed` أو `cancelled` بإجراءات يدوية (D-R17) | **المتطلبات السابقة** (`course_prerequisites`) — حتى يُعرف «إكمال الدورة» من الدرجات (MOD-09، Stage 4) (D-R15؛ كانت قد نُقلت من MOD-04 إلى هنا بـ D-R11) |
| **معلمو الفصل** (`class_teachers`): معلم رئيسي واحد على الأكثر ومساعدون، بصلاحية `classes.teachers.assign` | **الفترات الدراسية** (`academic_terms`) و**الفروع والقاعات** (`branch_id`، `default_room_id`) — تضيفها O8 (MOD-02/MOD-14) وMOD-07 بترحيلاتها (D-R15) |
| **التسجيلات** (`enrollments`): يسجّل حامل `enrollments.manage` الطالب فيصبح `active` مباشرة، بسعة صارمة؛ وانسحاب وإكمال وإلغاء وإعادة تفعيل بإجراءات (D-R18) | **قائمة الانتظار** و**التسجيل الذاتي** (`enrollments.self_enroll`، مع علم D-R04 في `academy.settings`) (D-R18) |
| **الرؤية بالصلاحيات والملكية** (D-R16): حمَلة `*.manage` يرون الكل، والمعلم فصوله المسندة وقوائمها، والطالب فصوله وولي الأمر فصول أبنائه عبر `GET /api/me/classes` — بلا مفاتيح جديدة | **السعر** (`price_override`) مع MOD-11 (D-R12)؛ **الدرجة النهائية** (`final_score`، `final_grade_label`، `grade_scheme_id`) مع MOD-09 |
| سجل تدقيق لكل كتابة (حدث واحد بالضبط داخل المعاملة) | **فحص العمر** (`courses.min_age`/`max_age` مقابل تاريخ الميلاد) — لا يُفرض في النسخة الأولى |
| | **الواجهة** — في مرحلة الواجهة (ADR-061): صفحة `/classes` حقيقية بدل `mockClasses`، درج الفصل، «فصولي» (T07) |

### 4d.2 الجداول — مجموعة فرعية من المرحلة B في 6.7.4-C بعد قرارات المالك (ترحيل واحد مراجَع في T01)

| الجدول | الأعمدة (بعد القرارات) | القيود والفهارس | الفروق عن 6.7.4-C |
|---|---|---|---|
| `classes` | `id` (uuidv7)، `course_id → courses` (**Restrict**)، `code varchar(32)`، `name jsonb`، `capacity smallint`، `status class_status` (`planned`/`open`/`running`/`completed`/`cancelled`، افتراضي `planned`)، `starts_on date NULL`، `ends_on date NULL`، `notes text NULL`، `created_by → users NULL` (**SetNull**)، `created_at`/`updated_at` | `UNIQUE(code)`؛ فهارس `course_id` و`status` و`created_by`؛ CHECKs: الاسم المترجَم (`? 'ar'` — D1)، الرمز مشذَّب وغير فارغ (كما MOD-04-T01)، `capacity > 0`، `ends_on >= starts_on` | بلا `term_id` و`branch_id` و`default_room_id` (D-R15)، وبلا `price_override` (D-R12)، وبلا `enrollment_opens_at`/`enrollment_closes_at` (D-R18)، وبلا `deleted_at` (D-R17 + D7/ADR-020: الإلغاء هو الإزالة)؛ `created_by` إضافة على نمط `courses` |
| `class_teachers` | `class_id → classes` (**Cascade**)، `teacher_user_id → users` (**Restrict**)، `role class_teacher_role` (`lead`/`assistant`)، `assigned_at timestamptz DEFAULT now()`، `assigned_by → users NULL` (**SetNull**) | `PK(class_id, teacher_user_id)`؛ فهرس `teacher_user_id`؛ فريد جزئي `(class_id) WHERE role = 'lead'` (SQL يدوي) | `assigned_by` إضافة على نمط `user_roles.assigned_by` |
| `enrollments` | `id`، `class_id → classes` (**Restrict**)، `student_user_id → users` (**Restrict**)، `status enrollment_status` (`pending`/`active`/`completed`/`withdrawn`/`cancelled`)، `source enrollment_source` (`admin`/`self`/`import`/`transfer`، افتراضي `admin`)، `enrolled_at`، `activated_at NULL`، `completed_at NULL`، `withdrawn_at NULL`، `withdrawal_reason text NULL`، `created_by → users NULL` (**SetNull**)، `created_at`/`updated_at` | `UNIQUE(class_id, student_user_id)` (إعادة التسجيل = إعادة تفعيل الصف نفسه)؛ فهارس `student_user_id` و`status` | بلا `final_score`/`final_grade_label`/`grade_scheme_id` (MOD-09)؛ القيم `pending` و`self`/`import`/`transfer` موجودة في التعدادين ولا تستعملها النسخة الأولى (تجنّباً لترحيل تعداد لاحقاً)؛ `created_by` إضافة |

النتيجة: 18 نموذجاً بدل 15 + أربعة تعدادات (`ClassStatus`، `ClassTeacherRole`، `EnrollmentStatus`، `EnrollmentSource`) — يبقى المخطط ملفاً واحداً (العتبة ~30 نموذجاً — الوثيقة الرئيسية 6.7). عدد المسجّلين لا يُخزَّن: يُحسب من التسجيلات النشطة (6.7.4-C).

### 4d.3 الصلاحيات (من الكتالوج الحالي — لا مفاتيح جديدة)

| المفتاح | من يملكه بالبذر | ما يتيحه في MOD-05 |
|---|---|---|
| `classes.read` | المعلم، الموظف، المدير | قراءة الفصول؛ **بلا `classes.manage` تقتصر على الفصول المسندة إلى المستخدم** في `class_teachers` (غيرها `404`) — D-R16 |
| `classes.manage` | الموظف، المدير | كل الفصول بكل حالاتها، والإنشاء والتعديل والإجراءات والحذف |
| `classes.teachers.assign` | المدير وحده | `PUT /api/classes/:id/teachers` |
| `enrollments.read` | المعلم، الموظف، المدير | قائمة طلاب الفصل — لحامل `enrollments.manage`، أو للمعلم المسند إلى الفصل |
| `enrollments.manage` | الموظف، المدير | التسجيل وإجراءات التسجيل |
| `enrollments.self_enroll` | المدير وحده (ضمن كل المفاتيح) | غير مستعمل في النسخة الأولى (D-R18) |
| — (الملكية) | كل مستخدم مصادَق | `GET /api/me/classes`: تسجيلات المستخدم طالباً، وتسجيلات أبنائه المرتبطين في `guardian_students` وليَّ أمر |

### 4d.4 نقاط النهاية المقترحة (`PLANNED` — العقود النهائية تُثبَّت في 10.2 عند التنفيذ بمعرّفات من كتلة المتعاون، من API-050)

| الطريقة والمسار | الصلاحية | ملاحظات |
|---|---|---|
| `GET /api/classes` · `GET /api/classes/:id` | `classes.read` | بحث `q` (رمز/اسم)، مرشّحات `courseId` و`status` و`teacherId`، ترقيم keyset (ADR-028)؛ بلا `classes.manage` الفصول المسندة فقط؛ التفاصيل تضم المعلمين و`enrolledCount` |
| `POST /api/classes` · `PATCH /api/classes/:id` | `classes.manage` | الإنشاء بحالة `planned` لدورة **منشورة** فقط (`422 course_not_published`)؛ PATCH بأصغر فرق؛ سعة أقل من عدد النشطين → `409 capacity_below_enrolled` |
| `POST /api/classes/:id/status` | `classes.manage` | `{ action, reason? }` والإجراءات `open`/`start`/`complete`/`cancel`/`restore` بآلة حالات نقية (`409 invalid_transition`)؛ `complete` يكمل التسجيلات النشطة و`cancel` يلغيها في المعاملة نفسها |
| `DELETE /api/classes/:id` | `classes.manage` | فصل `planned` بلا أي تسجيل فقط (`409 class_not_deletable`)؛ غيره يُلغى |
| `PUT /api/classes/:id/teachers` | `classes.teachers.assign` | استبدال كامل `{ teachers: [{ userId, role }] }` محسوب كفرق؛ رئيسي واحد على الأكثر؛ كل معلم يحمل دور `teacher` فعلياً (`422 not_a_teacher`) |
| `GET /api/classes/:id/enrollments` | `enrollments.read` | لحامل `enrollments.manage` أو للمعلم المسند؛ مرشّح `status`؛ هوية الطالب بإسقاط D-R07 |
| `POST /api/classes/:id/enrollments` | `enrollments.manage` | `{ studentId }` → `active`؛ الفصل `open` أو `running` وإلا `409 class_not_enrollable`؛ السعة تحت قفل صف الفصل (`409 class_full`)؛ الطالب يحمل دور `student` فعلياً (`422 not_a_student`)؛ تسجيل قائم → `409 already_enrolled` |
| `POST /api/enrollments/:id/status` | `enrollments.manage` | `{ action, reason? }` والإجراءات `withdraw`/`complete`/`cancel`/`reactivate` بآلة حالات نقية؛ `reactivate` يفحص السعة وحالة الفصل |
| `GET /api/me/classes` | أي مستخدم مصادَق (ملكية) | تسجيلات المستخدم طالباً وتسجيلات أبنائه وليَّ أمر، مع ملخص الفصل والدورة والمعلم الرئيسي؛ بلا مفاتيح (D-R16) |

### 4d.5 المهام

> كل مهمة: النطاق → معايير القبول (AC) → الاختبارات → الاعتماديات → التقدير → الحالة. المجلد المقترح `backend/src/classes/` (`ClassesModule`: الفصول والمعلمون والتسجيلات و«فصولي») — أو فصل التسجيلات في `backend/src/enrollments/` إن كبر، يقرره المنفّذ في T02. قاموس أخطاء مستقل `classes.errors.ts` (`ClassesHttpException`) على نمط ADR-044.

#### MOD-05-T00 — التحضير والقرارات (بلا كود إنتاجي)

- **النطاق:** قرارات المالك D-R15..D-R18 (§4d.7)؛ المجموعة الفرعية من 6.7.4-C وفروقها (§4d.2)؛ مسودة قاموس الأخطاء (`class_not_found`، `class_code_taken`، `class_not_deletable`، `class_not_enrollable`، `class_full`، `capacity_below_enrolled`، `course_not_published`، `not_a_teacher`، `not_a_student`، `user_not_found`، `user_not_eligible`، `already_enrolled`، `enrollment_not_found`، `invalid_transition`، `nothing_to_update`) والأحداث (`classes.created|updated|status.changed|deleted`، `classes.teachers.changed`، `enrollments.created|status.changed`).
- **AC:** القرارات مسجَّلة هنا وفي الوثيقة الرئيسية (MOD-05 في 08، ملاحظة 6.7.4-C)؛ لا تغيير سلوكي.
- **الاعتماديات:** قرار المالك. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0076، 2026-11-03)** — D-R15..D-R18 `ACCEPTED`.

#### MOD-05-T01 — المخطط والترحيل

- **النطاق:** نماذج `Class` و`ClassTeacher` و`Enrollment` والتعدادات الأربعة في آخر `schema.prisma` تحت `// MOD-05` (§5b.3 قاعدة 3)، باصطلاحات ADR-020 (uuidv7، snake_case، `Timestamptz`، فهرس صريح لكل FK، `onDelete` صريح)؛ العلاقات العكسية على `User` و`Course`؛ `prisma migrate dev --create-only` ثم SQL يدوي: CHECKs (الاسم المترجَم، الرمز المشذَّب، السعة، التاريخان) والفريد الجزئي للمعلم الرئيسي؛ حارس الانجراف بلا فرق. **PR جداول مستقل يُدمج قبل T02** — ودمجه يفتح للمالك O9 (الجدولة).
- **AC:** (1) `migrate deploy` و`migrate diff --exit-code` بلا فرق؛ (2) كل CHECK يرفض المخالف (اسم بلا `ar`، سعة 0، `ends_on < starts_on`)؛ (3) معلمان رئيسيان لفصل واحد يُرفضان؛ (4) حذف دورة لها فصل يُرفض (Restrict)، وحذف فصل يحذف معلميه (Cascade) ويُرفض بوجود تسجيل (Restrict)؛ (5) تسجيل ثانٍ للطالب نفسه في الفصل نفسه يُرفض.
- **الاختبارات:** `test/classes.schema.e2e-spec.ts` على نمط TEST-039، وتحديث قائمة جداول `test/db.e2e-spec.ts` (TEST-007) إلى 18.
- **الاعتماديات:** T00. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0052، 2026-11-03 — المطوّر المتعاون، C3)** — الترحيل `20261103123442_mod05_classes_teachers_enrollments`؛ TEST-047 (6) وTEST-007 (18 جدولاً)؛ AC1 ✔ (`migrate dev` ثم `migrate diff --exit-code` = «No difference detected»)، AC2 ✔ (اسم بلا `ar`، سعة 0 أو سالبة، `ends_on < starts_on`، ورمز بمسافة أو فارغ)، AC3 ✔ (الرئيسي الثاني `23505`)، AC4 ✔ (حذف دورة لها فصل وفصل له تسجيل `23001`، وحذف فصل بلا تسجيلات يحذف معلميه)، AC5 ✔ (التسجيل الثاني `23505`).
- **فروق التنفيذ (من مراجعة الخطة قبل الترحيل):** (أ) فهرسان لم يذكرهما §4d.2: `enrollments.created_by` و`class_teachers.assigned_by` — كل FK مفهرس (TEST-007)؛ (ب) `enrollments.status` **بلا قيمة افتراضية** — كل كاتب يحدّدها (`active` في النسخة الأولى — D-R18)، و`enrolled_at` افتراضياً `now()`؛ (ج) الفريد `(class_id, student_user_id)` باسم `uq_enrollments_class_student`؛ (د) أُعلن الترحيل على GitHub قبل إنشائه بدفع النماذج وحدها إلى الفرع `backend/mod05-t01-schema` (اتفاق §5b.3، والتواصل عبر GitHub)؛ (هـ) **ملاحظة لـ T04:** قفل صف الفصل عند التسجيل يُقترح `FOR NO KEY UPDATE` بدل `FOR UPDATE` — يسلسل التسجيلات المتزامنة في الفصل نفسه ولا يحجب صفوف جداول أخرى تشير إلى الفصل (كما في المنهج — CH-0050).

#### MOD-05-T02 — الفصول (API)

- **النطاق:** القائمة والتفاصيل والإنشاء والتعديل وآلة الحالات والحذف (§4d.4) بقاعدة الرؤية D-R16 (حامل `classes.read` بلا `classes.manage` يرى فصوله المسندة فقط)؛ `select` صريح؛ keyset عبر `common/keyset-cursor.ts`؛ هروب `%`/`_` في `q` (درس KI-048)؛ حدث واحد لكل كتابة ولا شيء بلا فرق؛ وفحص «لا فصول» في حذف الدورة (§4d.8 ملاحظة 2).
- **AC:** (1) بلا `classes.manage` → `403` على كل كتابة؛ المعلم يرى فصله المسند ولا يرى غيره (`404`)؛ (2) الإنشاء لدورة غير منشورة → `422 course_not_published`، والرمز المكرر → `409 class_code_taken`؛ (3) آلة الحالات: `open` planned→open، `start` open→running، `complete` running→completed، `cancel` planned/open/running→cancelled، `restore` cancelled→planned؛ غير المسموح → `409 invalid_transition { from, action, allowed }`؛ (4) `complete` و`cancel` يحدّثان التسجيلات النشطة في المعاملة نفسها بحدث `classes.status.changed` واحد يذكر عددها، و`restore` لا يعيد تفعيلها؛ (5) سعة أقل من النشطين → `409 capacity_below_enrolled`؛ (6) الحذف لفصل `planned` بلا تسجيلات وحده؛ (7) حذف دورة لها فصل → `409` لا `500`.
- **الاختبارات:** وحدة لآلة الحالات وللفرق + شامل `test/classes.e2e-spec.ts`.
- **الاعتماديات:** T01. **التقدير:** L. **الحالة:** **`IMPLEMENTED` (CH-0053، 2026-11-03 — المطوّر المتعاون، C3)** — `backend/src/classes/` (`ClassesModule`)؛ API-050..API-055؛ FS-073؛ TEST-048 (وحدة 8 + شامل 9)؛ AC1 ✔ (الكتابات الأربع `403` بلا `classes.manage`، المعلم يرى المسند وحده و`404` لغيره، و`teacherId` لا يوسّع رؤيته)، AC2 ✔، AC3 ✔، AC4 ✔ (`affectedEnrollments` في الحدث)، AC5 ✔، AC6 ✔، AC7 ✔ (`409 course_in_use { classCount }` — كود جديد في قاموس MOD-04).
- **فروق التنفيذ:** (أ) قاموس MOD-05 كاملاً في `classes.errors.ts` من الآن (أكواد T03/T04 بمصانعها) ومفاتيح الوحدة الخمسة في `classes.policy.ts` — كي لا تتعارض جلستا T03 وT04 المتوازيتان على ملف واحد؛ (ب) ثلاثة أكواد لم تذكرها مسودة T00: `course_not_found` (404)، `cursor_invalid` (400)، `date_range_invalid` (400)؛ (ج) القائمة والتفاصيل بالشكل نفسه (`ClassDto` بالمعلمين و`enrolledCount`)؛ (د) `courseId` غير قابل للتعديل (الفصل لدورة واحدة)؛ (هـ) `reason?` اختياري في إجراءات الحالة يُسجَّل في الحدث كما MOD-03-T06؛ (و) **الأقفال لـ T04:** تغيير السعة والحالة يقفل صف الفصل `FOR NO KEY UPDATE` ثم يعدّ بعبارة ثانية — فليأخذ التسجيل وإعادة التفعيل في T04 القفل نفسه (لا `FOR UPDATE` كما في نص T04 أعلاه) ليتسلسلا معه؛ الحذف يأخذ `FOR UPDATE`.

#### MOD-05-T03 — معلمو الفصل (API)

- **النطاق:** `PUT /api/classes/:id/teachers` استبدال كامل محسوب بفرق نقي (على نمط `diffRoleKeys()`)؛ المعلم مستخدم بحالة `invited` أو `active` غير محذوف منطقياً، يحمل دور `teacher` (صف `user_roles` فعلي)؛ `assigned_by` = الفاعل؛ حدث `classes.teachers.changed { added, removed, roleChanged }` واحد؛ لا كتابة ولا حدث بلا فرق.
- **AC:** (1) بلا `classes.teachers.assign` → `403`؛ (2) أكثر من رئيسي → `400`؛ (3) مستخدم بلا دور `teacher` → `422 not_a_teacher`، بحالة غير مقبولة → `422 user_not_eligible`، مجهول أو محذوف → `404 user_not_found`؛ (4) قائمة مطابقة → `200` بلا كتابة ولا حدث؛ (5) المعلم المضاف يرى الفصل فوراً في `GET /api/classes`.
- **الاختبارات:** وحدة للفرق + شامل ضمن `classes.e2e-spec.ts`.
- **الاعتماديات:** T02. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0054، 2026-11-03 — المطوّر المتعاون، C3)** — `backend/src/classes/class-teachers.*`؛ API-056؛ FS-074؛ TEST-049 (وحدة 5 + شامل 7)؛ AC1 ✔، AC2 ✔ (`400 teachers_invalid { duplicates, leadCount }`)، AC3 ✔، AC4 ✔، AC5 ✔.
- **فروق التنفيذ:** (أ) كود `teachers_invalid` جديد لأن المسودة لم تحدد كود الـ 400؛ (ب) شروط الأهلية تُفحص على كل صف يُكتب (مضاف أو تغيّر دوره) لا على الباقين بلا تغيير — معلم عُلّق بعد إسناده لا يعطّل تعديل بقية القائمة، ولا يُرقّى؛ (ج) تغيير الدور يحفظ `assigned_at`/`assigned_by` الأصليين؛ (د) لا فحص `exceedingPermissions()` (الإسناد لا يغيّر صلاحيات أحد)؛ (هـ) الاختبار الشامل في `test/class-teachers.e2e-spec.ts` لا في `classes.e2e-spec.ts`؛ (و) لا قيد على حالة الفصل؛ (ز) `STUDENT_ROLE_KEY` و`ELIGIBLE_USER_STATUSES` في `classes.policy.ts` لـ T04.

#### MOD-05-T04 — التسجيلات (API)

- **النطاق:** قائمة طلاب الفصل والتسجيل وآلة حالات التسجيل (§4d.4). الإضافة وإعادة التفعيل تقفلان صف الفصل (`SELECT … FOR UPDATE`) ثم تعدّان النشطين **بعبارة ثانية بلقطة جديدة** (درس KI-041 تحت READ COMMITTED)؛ الطالب مستخدم بحالة `invited` أو `active` غير محذوف منطقياً يحمل دور `student` فعلياً؛ `created_by` = الفاعل؛ هوية الطالب في القائمة بإسقاط D-R07؛ حدث واحد لكل كتابة (`enrollments.created` أو `enrollments.status.changed { action, from, to, reason? }`).
- **AC:** (1) بلا `enrollments.manage` → `403` على الكتابة، والقائمة لحامل `enrollments.manage` أو للمعلم المسند وحدهما (غيرهما `404`)؛ (2) فصل ليس `open` ولا `running` → `409 class_not_enrollable`؛ (3) عند السعة → `409 class_full`، **وتسجيلان متزامنان على المقعد الأخير ينجح أحدهما فقط**؛ (4) مستخدم بلا دور `student` → `422 not_a_student`، وتسجيل قائم بأي حالة → `409 already_enrolled { enrollmentId, status }`؛ (5) الإجراءات: `withdraw` active→withdrawn (`withdrawn_at` والسبب)، `complete` active→completed، `cancel` active→cancelled، `reactivate` withdrawn/cancelled→active (يفحص السعة وحالة الفصل)؛ غير المسموح → `409 invalid_transition`.
- **الاختبارات:** وحدة لآلة الحالات + شامل `test/enrollments.e2e-spec.ts` مع اختبار التزامن.
- **الاعتماديات:** T02. **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0055، 2026-11-03 — المطوّر المتعاون، C3؛ بالتوازي مع T03 في جلسة ثانية وworktree مستقل)** — `backend/src/enrollments/` (`EnrollmentsModule`)؛ API-057..API-059؛ FS-075؛ TEST-050 (وحدة 8 + شامل 9 — 7 + 2 بعد مراجعة PR #14)؛ AC1 ✔ (الكتابتان `403` بلا `enrollments.manage`، المعلم المسند — رئيسياً أو مساعداً — يقرأ القائمة بلا بيانات اتصال وبلا سبب الانسحاب مع ظهور `student.deletedAt`، معلم فصل آخر `404`)، AC2 ✔ (`planned`/`completed`/`cancelled`)، AC3 ✔ (`class_full`، و**سباق المقعد الأخير** بأربعة طلبات متداخلة ينجح أحدها وحده — والاختبار يفشل إن أُزيل القفل — وسباق إعادة تفعيل وتسجيل جديد على المقعد الأخير ينجح أحدهما وحده)، AC4 ✔ (`not_a_student`، `already_enrolled { enrollmentId, status }` لتسجيل قائم `active`/`withdrawn`/`completed`/`cancelled`، ومعهما `user_not_eligible` و`user_not_found`)، AC5 ✔ (الإجراءات الأربعة و`invalid_transition { from, action, allowed }`، و`reactivate` يُرفض على فصل ممتلئ أو غير مفتوح، **ولطالب لم يعد مؤهلاً** — محذوف `404 user_not_found`، موقوف `422 user_not_eligible`، بلا دور `student` `422 not_a_student` — منذ مراجعة PR #14).
- **فروق التنفيذ:** (أ) **القفل `FOR NO KEY UPDATE`** لا `FOR UPDATE` كما في نص النطاق أعلاه — قفل T02/T03 نفسه (§4d.5 T02 (و))، فتتسلسل كتابات الفصل كلها ولا يُحجب `FOR KEY SHARE` الذي يأخذه إدراج التسجيل؛ (ب) **وحدة Nest مستقلة** `backend/src/enrollments/` بدل `ClassesModule` كي لا تتعارض الجلستان المتوازيتان على `classes.module.ts`، وتستعمل قاموس `classes.errors.ts` بلا كود جديد (مصنع `invalid_transition` بصياغة التسجيل في `enrollments.errors.ts` — نمط `guardians.errors.ts`) وثوابت T03 المشتركة (`STUDENT_ROLE_KEY`، `ELIGIBLE_USER_STATUSES`)؛ (ج) ترتيب الفحوص في التسجيل: الفصل ← الطالب (`404` ← `422 user_not_eligible` ← `422 not_a_student` — ترتيب T03) ← التسجيل القائم ← حالة الفصل ← السعة؛ (د) القائمة بكل الحالات افتراضياً ومرشّح `status`، وترقيم keyset (`limit` 1–100، افتراضي 50) بترتيب التسجيل الأول؛ وقراءتها تحتاج `enrollments.manage` أو الإسناد إلى الفصل — `classes.manage` وحده لا يكفي؛ (هـ) `reactivate` يفرّغ `withdrawn_at`/`withdrawal_reason`/`completed_at` ويضبط `activated_at` (الصف يصف التسجيل الحالي والتاريخ في سجل التدقيق)، و`enrolled_at` يبقى تاريخ التسجيل الأول؛ **ويعيد فحص الطالب كتسجيل جديد** (`404 user_not_found` ← `422 user_not_eligible` ← `422 not_a_student`) قبل حالة الفصل والسعة — **قرار المالك في مراجعة PR #14 (2026-11-03):** إعادة التفعيل تفتح فترة نشاط جديدة، فلا تتوقف الأهلية على تاريخ الطالب؛ النسخة الأولى من هذا الفرق («لا يعيد فحص حالة الطالب أو دوره») أُسقطت وصُحّح الكود (CH-0055 البند 6)؛ (و) `reason` (1–500) يُحفظ في `withdrawal_reason` عند `withdraw` وحده ويُسجَّل في الحدث لكل إجراء؛ (ز) أحداث `entityType: enrollments` و`entityId` = التسجيل، وبياناتها `classId`/`classCode`/`studentUserId` معرّفات فقط؛ (ح) تسجيل طالب حُذف حسابه منطقياً لاحقاً يبقى في القائمة بـ `student.deletedAt` (الأثر على التسجيلات النشطة خارج النطاق — §4d.7؛ أما إعادة تفعيل تسجيله المنسحب أو الملغى فتُرفض — (هـ))؛ (ط) **اختبار التزامن يمسك صف الفصل `FOR UPDATE`** من الاختبار حتى تنتظر الطلبات الأربعة ثم يحرّره — بلا ذلك تصل الطلبات إلى القاعدة متتابعة فيمر الاختبار حتى بلا قفل (جُرّب)؛ (ي) **قرارات المالك على هذه الفروق (مراجعة PR #14 في 2026-11-03، و#19 في 2026-11-04):** النسخة الأولى من (هـ) — `reactivate` لا يعيد فحص الطالب — **مرفوضة** وصُحّحت (CH-0055 البند 6)؛ وعرض القائمة للمعلم المسند **مقبول بتعديل:** يرى `student.deletedAt` ولا يرى `withdrawalReason` (`null` لمن لا يملك `enrollments.manage` — CH-0055 البند 7)؛ والباقي (أ..د، و..ط) مقبول كما هو.

#### MOD-05-T05 — «فصولي» للطالب وولي الأمر (API)

- **النطاق:** `GET /api/me/classes` بلا مفتاح صلاحية (ملكية — D-R16): تسجيلات المستخدم طالباً، وتسجيلات أبنائه المرتبطين في `guardian_students` وليَّ أمر (كل عنصر يذكر الطالب)، بحالتي `active` و`completed` افتراضياً، مع ملخص الفصل (رمز، اسم، حالة، تاريخان) والدورة (رمز، اسم) والمعلم الرئيسي؛ لا قوائم طلاب أخرى ولا بيانات اتصال.
- **AC:** (1) الطالب يرى فصوله فقط؛ (2) ولي الأمر يرى فصول أبنائه المرتبطين فقط، ولا يرى طالباً فُكّ ارتباطه؛ (3) مستخدم بلا تسجيلات ولا أبناء → قائمة فارغة لا `403`؛ (4) لا حقل اتصال ولا هوية لغير المستخدم وأبنائه، إلا اسم المعلم الرئيسي للفصل (`leadTeacher { fullName, displayName }` — قرار المالك في #19، 2026-11-04).
- **الاختبارات:** شامل ضمن `enrollments.e2e-spec.ts`.
- **الاعتماديات:** T04، MOD-03-T09 (روابط أولياء الأمور). **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0056، 2026-11-03 — المطوّر المتعاون، C3)** — `backend/src/enrollments/my-classes.*` (ضمن `EnrollmentsModule`)؛ API-060؛ FS-076؛ TEST-051 (وحدة 3 + شامل 4 — الرابع بعد مراجعة المالك: مستدعٍ طالب وولي أمر معاً؛ والعنصر يحمل `withdrawnAt` منذ المراجعة)؛ AC1 ✔ (الطالب يرى فصليه `active`/`completed` وحدهما)، AC2 ✔ (ولي الأمر يرى فصول ابنيه المرتبطين، لا غير المرتبط ولا المحذوف منطقياً، وفك الربط يُخفي فوراً)، AC3 ✔ (`{ items: [] }` لا `403`، وبلا رمز `401`)، AC4 ✔ (لا `email`/`username`/`phone`/`withdrawalReason` ولا طالب غير المستدعي وأبنائه).
- **فروق التنفيذ:** (أ) مرشّح `status` اختياري يستبدل الافتراضيين (لرؤية المنسحب أو الملغى)؛ (ب) بلا ترقيم — قائمة كاملة الأحدث تسجيلاً أولاً (تسجيلات المستخدم وأبنائه قليلة)؛ (ج) **المعلم الرئيسي باسمه وحده** (`fullName`، `displayName`) بلا معرّفه ولا بيانات اتصاله — يُقرأ AC4 «لا هوية لغير المستخدم وأبنائه» على أنه لا طلاب آخرون ولا بيانات اتصال، والنطاق نفسه يطلب المعلم الرئيسي؛ (د) الابن المحذوف منطقياً مخفي كما في روابط MOD-03-T09، أما المستخدم نفسه فيرى تسجيلاته دائماً؛ (هـ) **دور `guardian` شرط لرؤية فصول الأبناء** — قرار المالك في #19 (2026-11-04) يرفض النسخة الأولى من هذا الفرق («لا فحص لدور `student`/`guardian` — الملكية من البيانات: `student_user_id` وروابط `guardian_students` التي تشترط الدورين عند إنشائها»)، فولي أمر نُزع دوره وبقيت روابطه لا يرى شيئاً من فصول أبنائه: `seesChildren()` في `my-classes.policy.ts` على أدوار المستدعي المقروءة من القاعدة في كل طلب؛ أما الطالب فيرى تسجيلاته دون فحص لدور `student`؛ (و) الاختبار الشامل كتلة متداخلة في `test/enrollments.e2e-spec.ts` (كما تقول الخطة) بمعرّف اختبار مستقل TEST-051؛ (ز) **قرارات المالك على هذه الفروق (#19، 2026-11-04):** (ج) المعلم الرئيسي باسمه وحده — **مقبول**، وصُحّح نص AC4 أعلاه ليستثني اسمه؛ (هـ) **مرفوض** وصُحّح كما في (هـ) أعلاه (وحدة + شامل في TEST-051)؛ (ب) بلا ترقيم الآن — **مقبول**؛ والباقي (أ، د، و) مقبول كما هو.

#### MOD-05-T06 — الإغلاق: التدقيق والرحلات والقبول

- **النطاق:** الأحداث الجديدة في قاموس 12.4 (توسيع TEST-030 في بوابة Stage 3 — C5، §5b.3 قاعدة 5)؛ توثيق WF-03 (تعيين معلم لفصل) وWF-04 (تسجيل طالب في فصل — بلا جزء الدفع، MOD-11) خطوة بخطوة في 09؛ تجربة المالك من Swagger وتسجيل القبول في §4d.9 (جديد على نمط §4.9).
- **AC:** (1) كل مسار كاتب يثبت «حدثاً واحداً وصفراً للمرفوض» في اختباراته؛ (2) **بوابة الوحدة:** المدير ينشئ فصلاً لدورة منشورة، يسند معلماً رئيسياً، يفتح التسجيل، يسجّل طالبين؛ فيرى المعلم الفصل وقائمته، ويرى الطالب فصله في «فصولي»، ويرى ولي أمره الفصل نفسه — اختبار شامل واحد يمر بالرحلة.
- **الاعتماديات:** T01..T05. **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0057، 2026-11-03 — المطوّر المتعاون، C3)؛ قبول المالك معلَّق (§4d.9)** — `backend/test/classes.journey.e2e-spec.ts`؛ TEST-052 (شامل 1)؛ WF-03 وWF-04 خطوة بخطوة في القسم 09 من الوثيقة الرئيسية؛ AC1 ✔ (رُوجعت المسارات الكاتبة السبعة API-052..API-056 وAPI-058 وAPI-059: لكلٍّ منها في TEST-048/049/050 «حدث واحد» و«صفر للمرفوض»؛ والقاموس 12.4 كان مكتملاً بالأحداث الثمانية منذ T02..T05)، AC2 ✔ (الرحلة كاملة في اختبار واحد، وأحداثها الخمسة بترتيبها في `GET /api/audit-logs`).
- **فروق التنفيذ:** (أ) المدير **دور مخصّص** بمفاتيح `academy_admin` التي تحتاجها الرحلة (`classes.*` و`enrollments.*` و`users.read_contact` و`audit.read`) لا الدور نفسه — كي لا يمسّه اختبار «آخر مدير» في TEST-026 (نمط TEST-046)؛ أما المعلم والطالبان وولي الأمر فبأدوارهم **المزروعة الفعلية** (`teacher`/`student`/`guardian`)، فتثبت الرحلة صلاحيات البذر أيضاً؛ (ب) الدورة المنشورة ورابط ولي الأمر شرطان مسبقان يُكتبان بـ Prisma (رحلتاهما WF-05 — TEST-046، وMOD-03-T09 — TEST-027)؛ (ج) تحققات إضافية تشرح الخطوات: المعلم لا يرى الفصل قبل إسناده (`404`)، والتسجيل قبل `open` → `409 class_not_enrollable`، والمعلم لا يسجّل (`403`)، والطالب وولي الأمر لا يقرآن قائمة الفصول ولا قائمة الطلاب (`403`)؛ (د) لا كود ولا حدث جديد؛ TEST-030 لا يُمسّ (توسيعه في بوابة Stage 3 — C5).

#### MOD-05-T07 — الواجهة (مؤجَّلة إلى مرحلة الواجهة — ADR-061)

- **النطاق:** صفحة `/classes` حقيقية بدل `mockClasses` (قائمة، ودرج فصل بتفاصيله ومعلميه وقائمة طلابه وإجراءاته)، و«فصولي» للطالب وولي الأمر، وعنصر التنقل بالصلاحية أو الملكية، والأحداث في `AUDIT_ACTION_SUGGESTIONS`.
- **الحالة:** **جزئية — الفصول والمعلمون ✔ (CH-0064، مهمة الواجهة J-F01 للمطوّر المتعاون، FS-080، TEST-058):** صفحة `/classes` حقيقية على API-050..API-056 (قائمة ببحث ومرشّحات الدورة والحالة والمعلم وترقيم بالمؤشر، درج بالتفاصيل والتعديل وإجراءات الحالة والحذف، تبويب المعلمين، نافذة الإنشاء)، وعنصر التنقل بـ `classes.read` وحده (ضُبط بمراجعة المالك على PR #26 — كل قراءات `/api/classes` تشترطه)، و`classes.*` في `AUDIT_ACTION_SUGGESTIONS`؛ الرحلة من المتصفح 15/15 يدوياً بيد جلال (2026-11-04 — الوثيقة الرئيسية 13.4)، والاختبار 16 (حذف فصل مخطَّط، اختياري) `PENDING`؛ مراجعة المالك على PR #26 (2026-11-04): موافقة بإصلاح واحد نُفّذ (CH-0064) وخمس ملاحظات غير مانعة مؤجَّلة إلى PR لاحق (الوثيقة الرئيسية 19 CH-0064 «النتيجة»)؛ الدمج بعد CI أخضر. **الباقي (J-F04):** قائمة طلاب الفصل والتسجيل وإجراءاته، و«فصولي» للطالب وولي الأمر — على API-057..API-060، وT04/T05 مدموجتان منذ CH-0055/CH-0056 (#27، #29). **ملاحظة:** نُفِّذ الجزء الأول بطلب جلال على تقسيم جديد قال إنه اتُّفق عليه (جلال للواجهة، محمد للخادم) ولم يُكتب بعد في §5b ولا في ADR — يُوثَّق في PR `docs/` مستقل بتأكيد المالك. **تحديث 1.33.1:** المالك اعتمده في #19 (2026-11-04 15:09 UTC+03:00)؛ الباقي توثيقه في §5b وADR جديد في ذلك الـ PR. **تحديث 1.39.2:** كُتب في §5b وADR-065 (CH-0091، 2026-11-04).

### 4d.6 ترتيب التنفيذ (دفعات)

| الدفعة | المهام | بوابة الدفعة |
|---|---|---|
| **A — القرارات والمخطط** | ~~T00~~ ✔ (CH-0076) → ~~T01~~ ✔ (CH-0052 — PR جداول مستقل) | ترحيل مراجَع مدموج وCI أخضر — يفتح O9 (الجدولة) |
| **B — الخادم** | ~~T02~~ ✔ (CH-0053) → ~~T03~~ ✔ (CH-0054) ∥ ~~T04~~ ✔ (CH-0055) → ~~T05~~ ✔ (CH-0056) — **مكتملة** | العقود في 10.2 واختبارات شاملة خضراء |
| **C — الإغلاق** | ~~T06~~ ✔ (CH-0057) — قبول المالك معلَّق (§4d.9) | رحلة الوحدة اختباراً شاملاً؛ قبول المالك |
| **D — الواجهة** | T07 جارية: الفصول والمعلمون ✔ (CH-0064 — J-F01) → التسجيلات و«فصولي» (J-F04) | شاشات تعمل على الخادم بلا بيانات تجريبية؛ الرحلة من المتصفح |

> **التقسيم (§5b.2، ADR-061):** T00 عند المالك (O2 — هذه الخطة)؛ T01..T06 عند المطوّر المتعاون (C3)؛ القبول عند المالك؛ T07 في مرحلة الواجهة.

### 4d.7 قرارات المالك (2026-11-03 — CH-0076)

| المعرّف | القرار | الخيارات | **القرار المعتمد** | الأثر |
|---|---|---|---|---|
| D-R15 | **نطاق النسخة الأولى** | الأساس فقط · + المتطلبات السابقة · + المتطلبات والفترات الدراسية | **`ACCEPTED`: الأساس فقط** (الموصى به): `classes` و`class_teachers` و`enrollments` | 3 جداول في T01؛ المتطلبات السابقة حتى يُعرف الإكمال (Stage 4)؛ الفترات والفروع والقاعات مع O8 وMOD-07 |
| D-R16 | **الرؤية** | الصلاحيات + الملكية · الصلاحيات فقط | **`ACCEPTED`: الصلاحيات + الملكية** (الموصى به) | المعلم يرى فصوله المسندة وقوائمها؛ الطالب وولي الأمر عبر `GET /api/me/classes`؛ لا مفاتيح جديدة |
| D-R17 | **حالة الفصل** | يدوياً بإجراءات · تلقائياً بالتواريخ | **`ACCEPTED`: يدوياً بإجراءات** (الموصى به)؛ الحذف النهائي لفصل `planned` بلا تسجيلات وحده، وغيره يُلغى | آلة حالات بخمسة إجراءات؛ التواريخ للعرض فقط؛ لا `deleted_at` |
| D-R18 | **التسجيل** | بيد الإدارة بسعة صارمة · + قائمة انتظار · + تسجيل ذاتي الآن | **`ACCEPTED`: بيد الإدارة، سعة صارمة** (الموصى به) | `active` مباشرة؛ `409 class_full`؛ لا انتظار؛ التسجيل الذاتي مع D-R04 لاحقاً |

**تفاصيل تقنية موصى بها تُعتمد بمراجعة المالك ودمجه هذه الخطة** (لم تُطرح أسئلة مستقلة): الفصل لدورة منشورة عند إنشائه فقط، وإلغاء نشر الدورة أو أرشفتها لا يمس فصولها القائمة؛ التسجيل في الفصول `open` و`running` فقط؛ `complete`/`cancel` للفصل يكملان/يلغيان تسجيلاته النشطة في المعاملة نفسها، و`restore` لا يعيد تفعيلها؛ لا فحص للعمر في النسخة الأولى؛ الطالب والمعلم بحالة `invited` أو `active` فقط (المعلَّق والمؤرشف → `422 user_not_eligible`، والمحذوف منطقياً → `404`)؛ أثر إيقاف الحساب أو حذفه على تسجيلات قائمة خارج النطاق.

### 4d.8 ملاحظات تقنية من مراجعة التوثيق والكود (تُحسم في المهمة المعنية)

(1) **دورا الطالب وولي الأمر بلا مفاتيح الفصول** (`system-roles.ts`: لا `classes.read` ولا `enrollments.read`) — لذلك «فصولي» بالملكية في T05 (D-R16) بدل منح مفاتيح. (2) **حذف دورة لها فصول:** حذف الدورة (API-047) يقبل المسودة وحدها، لكن دورة منشورة لها فصل يمكن إلغاء نشرها ثم حذفها، فيصطدم الحذف بـ Restrict على `classes.course_id` (P2003 غير مترجَم → `500`) — T02 يضيف فحص «لا فصول» إلى حذف الدورة مع اختبار (AC7). (3) **التزامن على المقعد الأخير:** قفل صف الفصل ثم العدّ بعبارة ثانية بلقطة جديدة (KI-041). (4) **`enrolledCount`** محسوب لا مخزَّن (6.7.4-C)، وشريط الإشغال في النموذج الأولي (`ClassesPage`) = `enrolledCount / capacity` للواجهة لاحقاً. (5) **المعرّفات:** API من كتلة المتعاون بدءاً من API-050 (API-048/049 للمنهج)، وTEST/CH/FS من كتلته. (6) **قسم MOD-05 في 08** كان يتوقع جدول `groups` — المعتمد 6.7.4-C: الفصل نفسه هو المجموعة.

### 4d.9 إغلاق MOD-05 — سجل القبول (معلَّق — أُعدّ في CH-0057)

**النتيجة: معلَّقة.** التنفيذ مكتمل (T01..T06) وبوابة الوحدة اختبار شامل أخضر (TEST-052)؛ القبول للمالك بعد أن يجرّب الرحلة من Swagger (`/api/docs`، اتفاق §5b.3 — رحلة المتصفح تنتظر T07). بعد دمج السلسلة #15 ← #16 ← #14 ← #17 ← PR T06 في `main`: سحب، `npm run prisma:deploy` (ترحيل MOD-05 مدموج منذ PR #12)، ثم الخطوات أدناه بحساب المدير وحسابات `te@`/`st@` وولي أمر مرتبط بالطالب (يُنشأ ويُربط من شاشة المستخدمين أو بـ API-014/API-015/API-031). كل خطوة بزر **Authorize** بالرمز `accessToken` من `POST /api/auth/login` للحساب المذكور.

| # | الحساب | الطلب في Swagger | المتوقع | النتيجة |
|---|---|---|---|---|
| 1 | المدير | `POST /api/classes` بـ `{ courseId, code, name: { ar }, capacity: 2 }` لدورة **منشورة** | `201` وحالة `planned` | — |
| 2 | المعلم `te@` | `GET /api/classes/{id}` | `404 class_not_found` (غير مسند بعد — D-R16) | — |
| 3 | المدير | `PUT /api/classes/{id}/teachers` بـ `{ teachers: [{ userId: <te@>, role: "lead" }] }` | `200` والمعلم في `teachers` | — |
| 4 | المدير | `POST /api/classes/{id}/enrollments` بـ `{ studentId: <st@> }` قبل الفتح | `409 class_not_enrollable` | — |
| 5 | المدير | `POST /api/classes/{id}/status` بـ `{ action: "open" }` ثم التسجيل نفسه مرة أخرى | `200` (`open`) ثم `201` (`active`) | — |
| 6 | المعلم `te@` | `GET /api/classes` ثم `GET /api/classes/{id}/enrollments` | الفصل ظاهر، والطالب في القائمة بلا `email`/`phone` | — |
| 7 | الطالب `st@` | `GET /api/me/classes` | عنصر واحد `relation: self` بالدورة والمعلم الرئيسي باسمه | — |
| 8 | ولي الأمر | `GET /api/me/classes` | الفصل نفسه `relation: child` باسم الطالب | — |
| 9 | المدير | `GET /api/audit-logs?actorUserId=<المدير>` | `enrollments.created` ← `classes.status.changed` ← `classes.teachers.changed` ← `classes.created` (ومعها `auth.*`) | — |
| 10 | CI على GitHub | PRs السلسلة الخمسة | خضراء | — |

**التسجيل:** يكتب المالك هنا تاريخ التجربة ونتيجة كل خطوة (✔/✗ بدليل من `audit_logs` كما في §4.9)، وملاحظات القبول، ثم «MOD-05 مقبولة» بإدخال CH من كتلته — وبعده تُعلَّم T06 مقبولة في §4d.5 وFS-017 في الوثيقة الرئيسية. أي خطوة ✗ تُفتح لها مهمة إصلاح عند المتعاون قبل القبول.

---

## 4e. MOD-07 — الجدولة: القاعات والجدول الأسبوعي (خطة التنفيذ — الوحدة الثالثة في Stage 3)

> كُتبت في CH-0090 (2026-11-04) — المهمة O9 في §5b.2. قرارات المالك D-R23..D-R29 (§4e.7) أُخذت في الجلسة نفسها بقبول التوصيات كلها. **لا كود ولا ترحيل بعد**، وكل مهمة `PLANNED` حتى تُنفَّذ.
>
> **التنفيذ:** عند المالك. منذ تنسيق 2026-11-04 (#19، 12:09 UTC) صار الخادم كله عند المالك والواجهة عند جلال. الواجهة لا تدخل هذه الخطة: صفحة `/schedule` الحقيقية بدل `mockSchedule` مهمة واجهة.
>
> **المصادر:**
> - الوثيقة الرئيسية: 6.7.4 (`rooms` في المجموعة B، و`class_schedules` و`lessons` في المجموعة C)، و6.7.10 (المرحلة B تشمل «قيود التعارض»)، وMOD-07 في 08، وWF-06 في 09.
> - خارطة الطريق: D-R19..D-R22 (§4b.7) — الفروع منفَّذة، و«ربط الفصل بالمكان عبر القاعة يُتفق عليه في §4e» (D-R22).
> - الكود: المفتاحان `scheduling.weekStartsOn`/`workingDays` (CH-0088)، وكتالوج الصلاحيات (`schedule.read`/`schedule.manage`).
> - خطة MOD-06 لجلال (§4f، PR #24): تنتظر من هذه الخطة جدولَي `rooms` و`class_schedules`، وفيها أسئلة Q1..Q5 للمالك. D-R25 هنا يوافق توصية Q5 (أ)، وD-R29 يوافق توصية Q2 (أ).

### 4e.1 النطاق والأهداف

| داخل النطاق | خارج النطاق (مؤجَّل بقرار) |
|---|---|
| **القاعات** (`rooms`): رمز، اسم متعدد اللغات، سعة اختيارية، نوع (`classroom`/`lab`/`hall`/`virtual`)، تفعيل/إيقاف؛ اختيارياً في فرع (`branch_id`) — القاعة بلا فرع = مقر الأكاديمية | **الفترات الدراسية** (`academic_terms`) و**العطل** — حتى تُطلب (D-R23) |
| **الجدول الأسبوعي للفصل** (`class_schedules`): حصص متكررة (يوم الأسبوع، من/إلى بالتوقيت المحلي، قاعة اختيارية، معلم اختياري من معلمي الفصل، سريان `effective_from`..`effective_to`) | **قاعة افتراضية للفصل** (`classes.default_room_id`) و**فرع للفصل** (`classes.branch_id`) — مكان الفصل هو قاعات حصصه (D-R24) |
| **كشف التعارض**: لا تُحجز قاعة ولا معلم لحصتين متداخلتين في اليوم نفسه وفترتَي سريان متداخلتين (D-R25) | **سعة القاعة مقابل سعة الفصل** — لا فحص في النسخة الأولى (يُعرض في الواجهة) |
| **القراءة**: جدول الفصل (برؤية الفصل — D-R16)، وجدول الأكاديمية لمن يديرها، و«جدولي» لكل مستخدم بالملكية (D-R27) | **التقويم اليومي بالتواريخ** — هو الدروس (`lessons`، MOD-06)؛ هذه الخطة أسبوعية |
| **توليد الدروس من الجدول** (T05) عبر خدمة الدروس في MOD-06، بعد جداولها وخدمتها (D-R29) | **التسجيل الذاتي في الحصص** وأي تبديل للحصص بين الطلاب |
| سجل تدقيق لكل كتابة (حدث واحد بالضبط داخل المعاملة)، وقاموس أخطاء مستقل (ADR-044) | **الواجهة** — مهمة واجهة (جلال) |

### 4e.2 الجداول — مجموعة فرعية من 6.7.4 بعد قرارات المالك (ترحيل واحد مراجَع في T01)

| الجدول | الأعمدة (بعد القرارات) | القيود والفهارس | الفروق عن 6.7.4 |
|---|---|---|---|
| `rooms` | `id` (uuidv7)، `branch_id → branches NULL` (**Restrict**)، `code varchar(16)`، `name jsonb NULL`، `capacity smallint NULL`، `kind room_kind` (`classroom`/`lab`/`hall`/`virtual`، افتراضي `classroom`)، `is_active boolean DEFAULT true`، `created_at`/`updated_at` | `UNIQUE NULLS NOT DISTINCT (branch_id, code)` (SQL يدوي — رمز فريد داخل الفرع، والقاعات بلا فرع معاً)؛ فهرس `branch_id`؛ CHECKs: الرمز مشذَّب وغير فارغ (نمط MOD-04-T01)، الاسم المترجَم إن وُجد (`? 'ar'` — D1)، `capacity > 0` | افتراضي `kind` إضافة؛ لا `deleted_at` (الإيقاف بدل الحذف — نمط `levels`/`branches`) |
| `class_schedules` | `id`، `class_id → classes` (**Cascade**)، `weekday smallint` (0 = الأحد … 6 = السبت — كما `scheduling.*`)، `start_time time`، `end_time time`، `room_id → rooms NULL` (**Restrict**)، `teacher_user_id → users NULL` (**Restrict**)، `effective_from date`، `effective_to date NULL` (بلا نهاية)، `created_by → users NULL` (**SetNull**)، `created_at`/`updated_at` | CHECKs: `weekday BETWEEN 0 AND 6`، `end_time > start_time`، `effective_to IS NULL OR effective_to >= effective_from`؛ فهارس `class_id` و`(room_id, weekday)` و`(teacher_user_id, weekday)`؛ **قيدا استبعاد** (D-R25): القاعة والمعلم — §4e.8 (1) | ON DELETE للقاعة والمعلم محدَّد (Restrict)؛ `created_by` إضافة على نمط `classes`؛ `effective_to >= effective_from` بدل `>` (حصة يوم واحد) |

النتيجة: 21 نموذجاً بدل 19 + تعداد واحد (`RoomKind`)، وأول إضافة (extension) في القاعدة (`btree_gist` — D-R25). الأوقات `time` بلا منطقة: **تُفهم بالتوقيت المحلي لفرع القاعة، وإلا منطقة الأكاديمية**، وتتحول إلى `timestamptz` عند توليد الدروس فقط (T05).

### 4e.3 الصلاحيات (من الكتالوج الحالي — لا مفاتيح جديدة)

| المفتاح | من يملكه بالبذر | ما يتيحه في MOD-07 |
|---|---|---|
| `schedule.manage` | المدير وحده | إنشاء القاعات وتعديلها وحذفها، واستبدال جدول الفصل، وجدول الأكاديمية كاملاً، والتوليد (T05)؛ يستطيع المدير منحه لدور الموظف من شاشة الأدوار (D-R27) |
| `classes.manage` | الموظف، المدير | قراءة جدول الأكاديمية كاملاً وجدول أي فصل (D-R27) |
| `classes.read` | المعلم، الموظف، المدير | جدول الفصول التي يراها (D-R16: بلا `classes.manage` = الفصول المسندة فقط) |
| `schedule.read` | كل الأدوار النظامية (ضمن خط الأساس للمتعلم) | «جدولي» `GET /api/me/schedule` بالملكية: حصص فصول الطالب النشطة، وفصول أبناء ولي الأمر، وفصول المعلم المسندة (D-R27) |
| — (كل مستخدم مصادَق) | — | قائمة القاعات النشطة (مكان الحصة — نمط D-R21 للفروع) |

### 4e.4 نقاط النهاية المقترحة (`PLANNED` — العقود النهائية تُثبَّت في 10.2 عند التنفيذ بمعرّفات من كتلة المالك، من API-084)

| المعرّف | الطريقة والمسار | الصلاحية | ملاحظات |
|---|---|---|---|
| API-084 | `GET /api/rooms` | أي مستخدم مصادَق | النشطة وحدها، وحامل `schedule.manage` يرى الموقوفة؛ مرشّحا `branchId` (`none` = بلا فرع) و`kind`؛ بلا ترقيم (قائمة صغيرة) |
| API-085 | `POST /api/rooms` | `schedule.manage` | فرع موجود ونشط إن أُعطي (`404 branch_not_found` / `422 branch_inactive`)؛ رمز مكرر في الفرع `409 room_code_taken` |
| API-086 | `PATCH /api/rooms/:id` | `schedule.manage` | دلالة PATCH بأصغر فرق؛ نقل القاعة بين الفروع مسموح؛ الإيقاف لا يمس حصصاً قائمة (تبقى، وتُرفض الحصص الجديدة على قاعة موقوفة) |
| API-087 | `DELETE /api/rooms/:id` | `schedule.manage` | قاعة لا تشير إليها حصة ولا درس فقط، وإلا `409 room_in_use { slotCount }` (الإيقاف هو البديل) |
| API-088 | `GET /api/classes/:id/schedule` | `classes.read` (برؤية الفصل) | حصص الفصل مرتبة باليوم ثم الوقت، مع القاعة والفرع والمعلم؛ فصل لا يراه المستخدم `404` (D-R16) |
| API-089 | `PUT /api/classes/:id/schedule` | `schedule.manage` | استبدال كامل `{ slots: [{ id?, weekday, startTime, endTime, roomId?, teacherUserId?, effectiveFrom, effectiveTo? }] }` يُحسب فرقاً (نمط المنهج — CH-0050)؛ تحت قفل صف الفصل؛ التعارض `409 schedule_conflict`؛ حدث واحد عند الفرق فقط |
| API-090 | `GET /api/schedule` | `schedule.manage` أو `classes.manage` | جدول الأكاديمية الأسبوعي؛ مرشّحات `branchId`، `roomId`، `teacherId`، `classId`، `weekday`، و`on` (تاريخ: الحصص السارية فيه، افتراضياً اليوم بمنطقة الأكاديمية) |
| API-091 | `GET /api/me/schedule` | `schedule.read` (بالملكية) | حصص فصول المستخدم: طالباً (تسجيلات `active`)، ولي أمر (أبناؤه في `guardian_students`)، معلماً (فصوله في `class_teachers`)؛ مع ملخص الفصل والدورة؛ بلا بيانات اتصال |
| API-092 | `POST /api/classes/:id/schedule/generate` | `schedule.manage` | **محجوز لـ T05** (D-R29): `{ from, to }` → دروس `lessons` لكل حصة سارية في المدى عبر خدمة MOD-06 |

### 4e.5 المهام

> كل مهمة: النطاق → معايير القبول (AC) → الاختبارات → الاعتماديات → التقدير → الحالة. المجلد المقترح `backend/src/schedule/` (`ScheduleModule`: القاعات وجدول الفصل والقراءات والتوليد) بقاموس أخطاء `schedule.errors.ts` (`ScheduleHttpException`). المعرّفات من كتلة المالك: TEST-070..075، FS-093..096، API-084..092.

#### MOD-07-T00 — الخطة والقرارات (بلا كود إنتاجي)

- **النطاق:** هذه الخطة.
  - **قرارات المالك:** D-R23..D-R29 (§4e.7).
  - **المجموعة الفرعية:** من 6.7.4، بفروقها في §4e.2.
  - **مسودة قاموس الأخطاء:** `room_not_found` 404، `room_code_taken` 409 `{ roomCode, branchId }`، `room_in_use` 409 `{ slotCount }`، `room_inactive` 422 `{ roomId }`، `branch_not_found` 404، `branch_inactive` 422، `class_not_found` 404، `class_not_schedulable` 409 `{ status }`، `schedule_invalid` 400 `{ unknown, duplicates }`، `schedule_conflict` 409 `{ kind: room|teacher, slot, conflictingSlotId, conflictingClassId }`، `non_working_day` 422 `{ weekday }`، `teacher_not_assigned` 422 `{ userId }`، `nothing_to_update` 400.
  - **الأحداث:** `rooms.created|updated|deleted`، `classes.schedule.changed`.
- **AC:**
  - القرارات مسجَّلة هنا.
  - MOD-07 في 08 تشير إلى الخطة.
  - لا تغيير سلوكي.
- **التقدير:** S. **الحالة:** **`IMPLEMENTED` (CH-0090، 2026-11-04)** — D-R23..D-R29 `ACCEPTED`.

#### MOD-07-T01 — جدولا `rooms` و`class_schedules` (PR جداول مستقل — يفتح MOD-06-T01)

- **النطاق:**
  - النموذجان والتعداد في `schema.prisma` تحت `// MOD-07 (O9)`.
  - علاقة `Branch.rooms`، و`Class.schedules`، و`User` للمعلم والمنشئ.
  - **الترحيل:** يُنشأ بـ `prisma migrate dev --create-only` ثم يُضاف SQL يدوي:
    - `CREATE EXTENSION IF NOT EXISTS btree_gist`.
    - الـ CHECKs.
    - الفريد `NULLS NOT DISTINCT`.
    - قيدا الاستبعاد (§4e.8 (1)).
  - ثم `migrate dev` و`npx prisma generate`.
  - **يُعلَن في #19 قبل التشغيل**: ترحيل واحد غير مدموج في كل مرة.
- **AC:**
  - **AC1:** فحص الانحراف (`migrate diff --exit-code`) نظيف. ويُتحقق أن Prisma 7 لا يرى الإضافة ولا قيدَي الاستبعاد فرقاً، وإلا يُعتمد بديل §4e.8 (2) ويُسجَّل.
  - **AC2:** اختبار المخطط على القاعدة الحية:
    - كل CHECK يرفض قيمته الخاطئة.
    - الرمز فريد داخل الفرع، والقاعات بلا فرع معاً.
    - Restrict يمنع حذف فرع له قاعة، وقاعة لها حصة.
    - Cascade يحذف حصص الفصل مع الفصل.
  - **AC3:** قيد القاعة يرفض حصتين متداخلتين لها في اليوم نفسه بسريان متداخل (`23P01`).
    - ويقبل الحصص المتلاصقة (10:00–11:00 و11:00–12:00).
    - ويقبل يومين مختلفين، وسرياناً غير متداخل، وحصة بلا قاعة.
    - والأمر نفسه لقيد المعلم.
  - **AC4:** الدور `articode_app` يقرأ ويكتب الجدولين بلا صلاحية إضافية. والإضافة يُنشئها `articode_migrator` (موثوقة — 6.7).
- **الاختبارات:** TEST-070 (`test/schedule.schema.e2e-spec.ts` على نمط TEST-039/TEST-047/TEST-067)، وTEST-007 (عدد الجداول 21).
- **الاعتماديات:** T00، وموافقة المالك على الترحيل والإضافة (أُعطيت في جلسة 2026-11-04). **التقدير:** M. **الحالة:** **`IMPLEMENTED` (CH-0092، 2026-11-04)** — الترحيل `20261104144352_mod07_rooms_class_schedules`؛ TEST-070 (12) وTEST-007 (21 جدولاً)؛ AC1..AC4 ✔ — **AC1:** `migrate diff --exit-code` نظيف مع الإضافة وقيدَي الاستبعاد و`NULLS NOT DISTINCT`، فلا حاجة إلى بديل §4e.8 (2). **فروق التنفيذ:** الوقت `time(0)` (دقة الثانية؛ الـ API يرسل `HH:MM`)؛ لا فهرس مستقل لـ `rooms.branch_id` لأن الفريد `(branch_id, code)` يبدأ به.

#### MOD-07-T02 — واجهة القاعات + «الفرع قيد الاستعمال» (API-084..087)

- **النطاق:**
  - `RoomsController`/`RoomsService` (نمط `branches.*` و`levels.*`): القراءة لكل مصادَق، والكتابة بـ `schedule.manage`.
  - الفرق النقي `planRoomUpdate()`.
  - حدث واحد لكل كتابة فعلية.
  - **وفي `DELETE /api/branches/:id`:** يُنفَّذ الفحص المحجوز `409 branch_in_use { roomCount }` قبل الحذف (CH-0089 حجزه).
- **AC:**
  - **AC1:** القراءة بلا مفتاح، والموقوفة لحامل `schedule.manage` وحده.
  - **AC2:** الكتابة بلا `schedule.manage` تعطي `403`، بلا كتابة ولا حدث.
  - **AC3:** رمز مكرر داخل الفرع يعطي `409 room_code_taken`، والرمز نفسه في فرع آخر مقبول. وفرع مجهول `404`، وموقوف `422`.
  - **AC4:** حذف قاعة لها حصة يعطي `409 room_in_use`، وحذف الحرة ينجح بحدث واحد.
  - **AC5:** حذف فرع له قاعة يعطي `409 branch_in_use { roomCount }`، بلا كتابة ولا حدث.
  - **AC6:** PATCH بلا فرق يعطي `200` بلا كتابة ولا حدث، و`{}` يعطي `400 nothing_to_update`.
- **الاختبارات:** TEST-071 (وحدة `rooms.changes.spec.ts` + شامل `rooms.e2e-spec.ts`، وتحديث `branches.e2e-spec.ts`).
- **الاعتماديات:** T01. **التقدير:** M. **الحالة:** `PLANNED`.

#### MOD-07-T03 — جدول الفصل الأسبوعي (API-088/089)

- **النطاق:**
  - `GET` برؤية الفصل (يُعاد استعمال منطق الرؤية في `classes.service.ts`).
  - `PUT` استبدال كامل محسوب فرقاً بالمخطِّط النقي `planScheduleReplacement()` (نمط `planSyllabusReplacement()`): المُعطى بـ `id` يُبقى أو يُعدَّل، والجديد بلا `id` يُدرج، والغائب يُحذف.
  - **الكتابة:** في معاملة واحدة خلف قفل صف الفصل `FOR NO KEY UPDATE` (قفل T02/T03/T04 نفسه).
  - **الفحوص قبل أي كتابة**، بهذا الترتيب:
    1. الفصل موجود ومرئي.
    2. الفصل `planned`/`open`/`running`، وإلا `409 class_not_schedulable`.
    3. المعرّفات المجهولة والمكررة تعطي `400 schedule_invalid`.
    4. كل حصة: اليوم 0–6، و`end > start`، والسريان سليم، و`workingDays` إن ضُبط (`422 non_working_day` — D-R28)، والقاعة موجودة ونشطة (`404`/`422 room_inactive`)، والمعلم مسند إلى الفصل (`422 teacher_not_assigned` — D-R26).
    5. ثم الكتابة. وأي `23P01` من قيدَي الاستبعاد يُترجم إلى `409 schedule_conflict` بنوعه والحصة المتعارضة (§4e.8 (1)).
  - **الأحداث:** `classes.schedule.changed { code, added, updated, removed }` واحد عند الفرق فقط.
  - **ربط بـ MOD-05 (D-R26):**
    - إزالة معلم من الفصل (`PUT /api/classes/:id/teachers`) تُفرغ `teacher_user_id` في حصص ذلك الفصل في المعاملة نفسها.
    - `complete`/`cancel` الفصل يُنهي حصصه المفتوحة (`effective_to` = اليوم بمنطقة الأكاديمية، إن كانت أبعد) كي لا تحجز القاعة والمعلم بعد انتهائه (§4e.8 (3)).
- **AC:**
  - **AC1:** بلا `schedule.manage` يعطي `403`، والقراءة بلا رؤية للفصل `404`.
  - **AC2:** الاستبدال بحدث واحد بأرقامه، والقائمة نفسها بترتيب آخر بلا كتابة ولا حدث.
  - **AC3:** تعارض القاعة وتعارض المعلم مع فصل آخر يعطيان `409 schedule_conflict { kind }`، وتداخل داخل الطلب نفسه كذلك. والمتلاصقة مقبولة.
  - **AC4:** يوم خارج `workingDays` يعطي `422 non_working_day`، ويُقبل إن لم يُضبط المفتاح.
  - **AC5:** معلم غير مسند `422`، وإزالته من الفصل تُفرغ حصصه.
  - **AC6:** فصل `completed`/`cancelled` يعطي `409 class_not_schedulable`، وإكمال الفصل يُنهي حصصه المفتوحة فتتحرر قاعتها.
  - **AC7:** طلبان متزامنان على القاعة نفسها في الوقت نفسه لفصلين: ينجح أحدهما وحده. يُثبَت بالقيد، مع فحص طفرة بلا القيد.
- **الاختبارات:** TEST-072 (وحدة `schedule.changes.spec.ts` + شامل `class-schedule.e2e-spec.ts`، وتحديث `class-teachers.e2e-spec.ts` و`classes.e2e-spec.ts` للربطين).
- **الاعتماديات:** T01، T02 (القاعات). **التقدير:** L. **الحالة:** `PLANNED`.

#### MOD-07-T04 — جدول الأكاديمية و«جدولي» (API-090/091)

- **النطاق:**
  - **`GET /api/schedule`** لحامل `schedule.manage` أو `classes.manage`، بالمرشّحات ومعامل `on` (الحصص السارية في تاريخ).
  - **`GET /api/me/schedule`** بالملكية لحامل `schedule.read`: الطالب من تسجيلاته `active`، وولي الأمر من أبنائه، والمعلم من فصوله.
  - كل حصة بمنطقة عرضها (فرع القاعة، وإلا منطقة الأكاديمية).
  - هوية المعلم بإسقاط D-R07، بلا بيانات اتصال.
- **AC:**
  - **AC1:** الطالب يرى حصص فصوله وحدها، وولي الأمر حصص أبنائه، والمعلم حصص فصوله.
  - **AC2:** بلا `schedule.read` يعطي `403`، وجدول الأكاديمية بلا المفتاحين `403`.
  - **AC3:** المرشّحات و`on` يعيدان الحصص الصحيحة. حصة انتهى سريانها لا تظهر في `on` بعده.
  - **AC4:** لا مفتاح يطابق `/hash|password/i`، ولا بريد ولا هاتف.
- **الاختبارات:** TEST-073.
- **الاعتماديات:** T03. **التقدير:** M. **الحالة:** `PLANNED`.

#### MOD-07-T05 — توليد الدروس من الجدول (API-092 — بعد MOD-06-T01/T02)

- **النطاق:** `{ from, to }` (تاريخان، بحد أقصى يُتفق عليه، 6 أشهر مقترحة). ينشئ لكل حصة سارية، ولكل تاريخ في المدى يوافق يومها، درساً `lessons`، عبر **خدمة MOD-06 المصدَّرة** (`LessonsService.createLessons()` — D-R29):
  - **`starts_at`/`ends_at`:** الوقت المحلي محوَّلاً إلى `timestamptz` بمنطقة فرع القاعة، وإلا منطقة الأكاديمية. يُحسب بأداة صغيرة على `Intl` بلا اعتمادية جديدة، وتُختبر عبر انتقال التوقيت الصيفي.
  - **`schedule_id`، والقاعة، والمعلم:** من الحصة، وإلا المعلم الرئيسي.
  - **لا يكرر** درساً موجوداً للحصة نفسها في التاريخ نفسه، فالتوليد قابل للإعادة.
  - **أيام خارج `workingDays`** تُتخطى.
- **AC:**
  - مدى صحيح ينشئ عدد الدروس المتوقع بحدث واحد.
  - الإعادة لا تنشئ شيئاً.
  - منطقة بتوقيت صيفي تعطي أوقات UTC الصحيحة على جانبي الانتقال.
  - تعارض مع درس قائم يُرفض بقيد MOD-06.
- **الاختبارات:** TEST-074.
- **الاعتماديات:** T03، وMOD-06-T01 (جدول `lessons`) وT02 (خدمته) — عقد الخدمة يُثبَّت مع MOD-06. **التقدير:** L. **الحالة:** `PLANNED`.

#### MOD-07-T06 — الإغلاق

- **النطاق:**
  - كل مسار كاتب في T02..T05 يثبت «حدث واحد بالضبط، وصفر للمرفوض» في ملفه.
  - تُضاف الأحداث إلى 12.4.
  - تُضاف إلى TEST-030 في بوابة Stage 3 (C5).
  - رحلة WF-06 (جدول أسبوعي ← توليد ← درس) في 09.
  - تجربة Swagger من المطوّر الآخر.
- **AC:** معايير T01..T05 كلها باختبارات ناجحة، وقبول المالك مسجَّل هنا (§4e.9).
- **الاختبارات:** TEST-075.
- **الاعتماديات:** T01..T05. **التقدير:** S. **الحالة:** `PLANNED`.

### 4e.6 ترتيب التنفيذ (دفعات)

| الدفعة | المهام | شرط الخروج |
|---|---|---|
| **A — الجداول** | T00 (هذه الخطة) → T01 (PR جداول مستقل بإعلان في #19) | الترحيل مدموج وفحص الانحراف نظيف؛ **يفتح MOD-06-T01** (جدول `lessons` يشير إلى `rooms` و`class_schedules`) |
| **B — الخادم** | T02 → T03 → T04 (T02 ∥ MOD-06-T01 ممكن) | العقود في 10.2 واختبارات شاملة خضراء |
| **C — التوليد والإغلاق** | T05 (بعد MOD-06-T02) → T06 | رحلة WF-06 وقبول المالك |

### 4e.7 قرارات المالك (2026-11-04 — CH-0090)

| المعرّف | القرار | الخيارات | القرار المعتمد |
|---|---|---|---|
| D-R23 | **نطاق النسخة الأولى** | (أ) القاعات + الجدول الأسبوعي + القراءات + التوليد لاحقاً؛ (ب) + الفترات الدراسية `academic_terms`؛ (ج) + العطل | **`ACCEPTED` (أ) — المالك 2026-11-04:** السريان `effective_from/to` يكفي الآن، والفترات والعطل تُضاف بترحيل حين تُطلب |
| D-R24 | **مكان الفصل** | (أ) قاعة لكل حصة (والفرع عبرها)، بلا أعمدة جديدة في `classes`؛ (ب) + `classes.default_room_id`؛ (ج) + `classes.branch_id` | **`ACCEPTED` (أ) — المالك 2026-11-04:** لا يمس جدول `classes`، والحصة هي ما يُحجز فعلاً؛ ينفّذ D-R22 |
| D-R25 | **كشف التعارض** | (أ) قيدا استبعاد في القاعدة (القاعة والمعلم) — **أول إضافة: `btree_gist`**؛ (ب) فحص في التطبيق تحت قفل استشاري؛ (ج) بلا فحص في النسخة الأولى | **`ACCEPTED` (أ) — المالك 2026-11-04:** يصمد أمام الطلبات المتزامنة بلا قفل عام، وهو ما توصي به خطة MOD-06 (Q5 (أ)) للدروس، فتُضاف الإضافة مرة واحدة هنا |
| D-R26 | **معلم الحصة** | (أ) اختياري، ويجب أن يكون من معلمي الفصل؛ إزالته من الفصل تُفرغه في الحصص؛ (ب) بلا عمود — المعلم الرئيسي ضمناً (ولا كشف لتعارض المعلم) | **`ACCEPTED` (أ) — المالك 2026-11-04:** كشف تعارض المعلم من غاية الوحدة (08)، والفراغ = المعلم الرئيسي عند التوليد |
| D-R27 | **الصلاحيات والرؤية** | (أ) الكتابة بـ `schedule.manage` (المدير، ويُمنح للموظف من شاشة الأدوار)، وجدول الأكاديمية لـ `schedule.manage` أو `classes.manage`، وجدول الفصل برؤية الفصل، و«جدولي» بـ `schedule.read` بالملكية، والقاعات لكل مصادَق؛ (ب) `schedule.read` يرى جدول الأكاديمية كاملاً | **`ACCEPTED` (أ) — المالك 2026-11-04:** على نمط D-R16: الطالب لا يرى فصول غيره، ولا مفاتيح جديدة |
| D-R28 | **أيام الدوام** (`scheduling.workingDays`) | (أ) تُفرض عند كتابة الحصص إن ضُبطت (`422 non_working_day`)، بلا أثر رجعي، ويتخطاها التوليد؛ (ب) للعرض فقط | **`ACCEPTED` (أ) — المالك 2026-11-04:** تمنع خطأ إدخال واضحاً، و`null` يبقى «بلا قيد» |
| D-R29 | **من يولّد الدروس** (يوافق Q2 في §4f) | (أ) MOD-07 يولّد عبر خدمة MOD-06 المصدَّرة، في T05 بعد جدول الدروس وخدمته؛ (ب) MOD-06 يملك التوليد | **`ACCEPTED` (أ) — المالك 2026-11-04:** فهم الجدول الأسبوعي (الأيام والسريان والمنطقة والتوقيت الصيفي) عند من يصممه، والكتابة في `lessons` عبر خدمة واحدة؛ والخادم كله عند المالك منذ 2026-11-04 |

> أسئلة MOD-06 (Q1..Q5 في §4f، PR #24) تأخذ أرقامها التالية حين تُحسم. وD-R29 (مقبول) يحسم Q2 فعلياً بخيارها (أ)، وD-R25 يُدخل `btree_gist`، فيبقى لـ Q5 قرار قيود الدروس وحدها.

### 4e.8 تفاصيل تقنية موصى بها (تُعتمد بدمج الخطة)

1. **قيدا الاستبعاد (D-R25 (أ))**، SQL يدوي في ترحيل T01:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ALTER TABLE class_schedules ADD CONSTRAINT ex_class_schedules_room EXCLUDE USING gist (
     room_id WITH =, weekday WITH =,
     tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time) WITH &&,
     daterange(effective_from, effective_to, '[]') WITH &&
   ) WHERE (room_id IS NOT NULL);
   -- والمثل لـ teacher_user_id: ex_class_schedules_teacher
   ```
   - `tsrange` بنصف فترة مفتوحة `[)`، فالحصص المتلاصقة لا تتعارض.
   - `daterange` بنهاية `NULL` بلا حد.
   - الخدمة تترجم `23P01` باسم القيد إلى `schedule_conflict { kind }`، ثم تقرأ الحصة المتعارضة لتعيد معرّفها وفصلها.
2. **Prisma والإضافة:** Prisma 7 لا يمثّل قيود الاستبعاد (كما الـ CHECKs). وبلا ميزة `postgresqlExtensions` لا يرى الإضافة.
   - **يُتحقق في T01** أن فحص الانحراف يبقى نظيفاً.
   - إن لم يبقَ نظيفاً، تُعرَّف الإضافة في `schema.prisma` أو يُكتفى بخيار D-R25 (ب)، ويُسجَّل ذلك في ADR من كتلة المالك.
   - قاعدة CI المؤقتة (`postgres:18`) تحمل `btree_gist` ضمن الإضافات القياسية.
3. **حصص الفصل المنتهي:** قيد الاستبعاد لا يرى حالة الفصل، فحصص فصل مكتمل أو ملغى بلا `effective_to` تحجز القاعة إلى الأبد.
   - **الحل:** `complete`/`cancel` (MOD-05-T02) يضبط `effective_to` لحصص الفصل المفتوحة على يوم الإجراء بمنطقة الأكاديمية، في المعاملة نفسها.
   - `restore` لا يعيد فتحها.
   - هذا تعديل صغير على خدمة الفصول، وهي اليوم عند المالك.
4. **المنطقة الزمنية:** الحصة تُخزَّن وقتاً محلياً، ومنطقتها منطقة فرع قاعتها، وإلا منطقة الأكاديمية. لا تحويل في T01..T04، فالتحويل في T05 وحده (DST).
5. **ترتيب الأقفال:** صف الفصل (`FOR NO KEY UPDATE`) أولاً كما في MOD-05. لا يُقفل صف القاعة، فالتعارض بين فصلين يحسمه القيد لا القفل.
6. **الأحداث:** `entityType: rooms` و`classes`، وبياناتها معرّفات وأرقام فقط (لا أسماء). وتُضاف إلى `AUDIT_ACTION_SUGGESTIONS` في مهمة الواجهة.

## 5. المراحل اللاحقة (3–6) — موجز

تفاصيل الجداول في الوثيقة الرئيسية 6.7.4 ومراحلها في 6.7.10. أهم الاعتماديات العابرة: **MOD-02/MOD-14** (الفروع والإعدادات) قبل الجدولة؛ **قناة البريد (LR-01 — D-R08)** قبل الإشعارات والتسجيل الذاتي؛ ~~حسم ADR-008/ADR-021~~ **محسومان (CH-0040، ADR-045)**: نسخة كاملة لكل أكاديمية الآن، وتنفيذ قاعدة المنصة المركزية ولوحة Super Admin والمنسّق المركزي للترحيلات في Stage 6؛ **S1-R02 (CI)** قبل أي نشر.

### 5.1 بوابة الإطلاق — مهام التجهيز قبل أول نشر إنتاجي (LR-nn)

مهام لا تنتمي إلى وحدة بعينها لكنها **مانعة لأول نشر إنتاجي** (Exit gate للإطلاق). تُنفَّذ بعد اكتمال الوظائف الأساسية للمنصة (أولوية المالك — D-R08) وقبل النشر، إلى جانب تحصينات §3.2 (~~MOD-01-H01~~ ✔ CH-0080، ~~H03~~ ✔ CH-0082، ~~H04~~ ✔ CH-0083) ومتطلبات §4.8 (`trust proxy`، CI S1-R02). حالتها كلها `PLANNED`؛ تُحدَّث هنا وتُوثَّق في الوثيقة الرئيسية عند التنفيذ.

#### LR-01 — ربط قناة البريد الإلكتروني وتأكيد ملكية البريد واختبار التسليم

- **النطاق:** (1) اختيار المزوّد (Resend أو SMTP أو غيره — قرار المالك عند بدء المهمة) وتنفيذه كـ `MailTransport` ثانٍ في `backend/src/mail/` خلف التجريد المبني في T03 **بلا تغيير في `AccountModule` أو عقود MOD-03**؛ (2) متغيرات بيئة المزوّد (المفتاح/المضيف/عنوان المرسل `MAIL_FROM`) في `env.schema.ts` + `.env.example` + 11.3 بالأسماء فقط (RULE 16)، إلزامية في production متى كان الناقل فعلياً؛ (3) قوالب `ar`/`en` للدعوة وإعادة الضبط وتأكيد البريد مع `APP_PUBLIC_URL` (ENV-39) لبناء الروابط؛ (4) **تدفق تأكيد ملكية البريد:** رمز `verification_tokens(purpose=email_verification)` يُرسَل إلى العنوان نفسه، وقبوله وحده يضبط `email_verified_at` (مسار عام مقترح `POST /api/account/email-verification/:token` — العقد يُثبَّت في 10.2 عند التنفيذ)، مع إعادة إرسال بتحديد معدل؛ (5) تفعيل المسار الذاتي «نسيت كلمة المرور» (`AUTH_SELF_SERVICE_RESET_ENABLED=true`، T05) بعد نجاح اختبار التسليم؛ (6) إعداد نطاق الإرسال (SPF/DKIM/DMARC) وعنوان مرسل مملوك للأكاديمية؛ (7) اختبار التسليم على بيئة staging بصناديق بريد حقيقية (دعوة، إعادة ضبط، تأكيد) مع قياس زمن الوصول ومعالجة الارتداد؛ (8) سياسة السجلات: لا رمز ولا رابط ولا محتوى رسالة في `audit_logs` أو سجل الخادم؛ أحداث `mail.delivery.sent`/`mail.delivery.failed` بمعرّف الرسالة ونوعها فقط؛ (9) سلوك الفشل: تعذّر المزوّد لا يُفشل الطلب الإداري (الرابط اليدوي يبقى متاحاً بـ D-R01) ويُسجَّل الحدث؛ (10) ADR للمزوّد المختار وتحديث 3.7 و11.3 و12 وMOD-12 في الوثيقة الرئيسية.
- **AC:** (1) دعوة حقيقية تصل إلى صندوق اختبار خارجي ورابطها يفعّل الحساب؛ (2) `email_verified_at` يُضبط **فقط** عبر رسالة مُسلَّمة إلى العنوان (تأكيد البريد أو دعوة مُرسَلة بالبريد) ولا يُضبط عبر رابط يدوي منسوخ — اختبار يثبت الحالتين؛ (3) `MAIL_TRANSPORT=log` أو أي ناقل تطويري يُفشل الإقلاع في production (TEST-003)؛ (4) فشل المزوّد (مفتاح خاطئ/انقطاع) → الطلب الإداري ينجح وحدث `mail.delivery.failed` يُسجَّل بلا محتوى؛ (5) لا مفتاح مزوّد في المستودع ولا في التوثيق؛ فحص `git log -p` نظيف قبل أي رفع؛ (6) المسار الذاتي يُعيد `202` للمعروف والمجهول بزمن متقارب ويرسل فعلياً للمعروف فقط؛ (7) التوثيق محدَّث (3.7، 11.3، 12، MOD-12، ADR المزوّد).
- **الاختبارات:** وحدة بناقل وهمي للقوالب وسياسة الفشل؛ شامل على staging بتحقق يدوي موثَّق (التسليم الحقيقي لا يُؤتمت محلياً).
- **الاعتماديات:** T03 (التجريد والرموز) ✔ قبلها، T05 ✔، T12 ✔ (CH-0031 — صفحة «نسيت كلمة المرور» في الواجهة أُجِّلت من T12 إلى هذه المهمة لأن API-021 معطَّل حتى تفعيله هنا)، قرار المالك على المزوّد ونطاق بريد مملوك، بيئة staging (الوثيقة الرئيسية 14.11) وCI (S1-R02). **التقدير:** M. **الحالة:** `PLANNED` — **بوابة إطلاق مانعة** (لا نشر إنتاجي قبل اكتمالها).

---

## 5b. اتفاق العمل المتوازي — تقسيم بالطبقة: المالك على الخادم، والمطوّر المتعاون على الواجهة (2026-11-04، CH-0091، ADR-065)

> **منذ 2026-11-04 (قرار المالك في issue التنسيق #19، 12:09 UTC — ADR-065، وثّقه CH-0091):** المالك على **الخادم كله**، والمطوّر المتعاون على **الواجهة كلها**. يحل محل اتفاق «الخادم أولاً» (2026-11-03، CH-0075، ADR-061 → `SUPERSEDED`)، الذي حلّ هو نفسه محل اتفاق المسارين (CH-0070، ADR-060). قواعد الفروع وPR وCI والمراجعة والمخطط وكتل المعرّفات باقية (§5b.3). البنود الخادمية في قائمة المتعاون السابقة (C4..C10) انتقلت إلى المالك بترتيبها وشروطها. هذا القسم هو **المرجع الوحيد لتقسيم العمل**: عندما تُسأل أي جلسة Claude Code «ما التالي؟» أو «ما الخطة؟» فالجواب من §5b.2 لمطوّر الجلسة. الخلاصة التشغيلية مكرَّرة في `CLAUDE.md` (قسم «Parallel work») لأنه يُحمَّل تلقائياً في كل جلسة؛ القرار ومبرراته في الوثيقة الرئيسية ADR-065. لا ملف توثيق ثالث (RULE 20).

### 5b.1 المطوّران

| | **المالك — محمد (Mohammed)** | **المطوّر المتعاون — جلال (Jallal)** |
|---|---|---|
| الجهاز | جهاز المالك | جهاز المتعاون |
| المسؤولية (ADR-065) | **الخادم كله:** NestJS وPrisma والمخطط والترحيلات والأمان واختبارات الخادم وعقود الـ API (10.2 في الوثيقة الرئيسية) | **الواجهة كلها:** React وربط الـ API وتجربة المستخدم واختبارات الواجهة |
| الفروع | `backend/<الوحدة>-<المهمة>`، و`docs/<الموضوع>` للخطط والقرارات | `frontend/<المهمة>` (مهام `J-Fnn`)، و`docs/<الموضوع>` لتخطيط الواجهة |
| العمل | قائمة المالك في §5b.2 (البنود `O`، والبنود الخادمية `C4..C10` المنقولة إليه) | قائمة الواجهة في §5b.2 (البنود `J-Fnn`) |
| القرارات | يقرر: قرارات `D-Rnn` في خطة كل وحدة، والاعتماديات الجديدة، ومفاتيح الصلاحيات الجديدة، وأي تعديل على هذا الاتفاق | يقترح في وصف الـ PR أو في #19 (ومنها حاجات الشاشات من العقود)، والمالك يقرر |

كل جلسة تنتمي إلى مطوّر واحد. **لا يُستدل عليه من اسم مستخدم git** — أكثر من نسخة من المستودع تلتزم باسم `jalla` (CH-0077 جاء من نسخة أخرى بهذا الاسم — CH-0078). الجلسة تعرفه مما يقوله المطوّر أو من ذاكرة Claude Code على الجهاز نفسه، وإلا تسأل مرة واحدة «المالك أم المطوّر المتعاون؟» قبل لمس أي ملف. يُستحسن أن يضبط كل جهاز `git config user.name`/`user.email` خاصاً به ليظهر في التاريخ من كتب ماذا. **السبب (CH-0079):** مستودع جهاز المالك كان مضبوطاً محلياً (`.git/config`) على الاسم `jalla` — اسم المتعاون — مع بريد المالك، فظهرت التزامات المالك حتى `066cebb` باسم `jalla`؛ منذ 2026-11-03 يلتزم جهاز المالك باسم `Mohammed`.

### 5b.2 قائمة المهام لكل مطوّر (بالترتيب)

**«التالي»** = أول بند حالته ليست ✔ وشرط بدئه متحقق. إن كان البند الأول ينتظر شرطاً، تذكر الجلسة ما ينتظره وتقترح أول بند ممكن بعده. **كل PR ينهي بنداً يعلّمه ✔ هنا (مع `CH-nnnn` ورقم الـ PR) وفي قائمة `CLAUDE.md` في الـ PR نفسه** — وبهذا يبقى الجواب صحيحاً دائماً. الترتيب يتبع المراحل في §1؛ اعتماديات كل وحدة تُثبَّت في خطتها (T00) قبل التنفيذ؛ وأي تعديل على القائمتين يمر بالمالك.

**قائمة المالك**

| # | المهمة | المرجع | شرط البدء | الحالة |
|---|---|---|---|---|
| O1 | دمج PR #4 (إصلاح KI-049) ثم PR هذا الاتفاق | CH-0074، CH-0075 | — | ✔ CH-0075 (PR #4 دُمج في `cefe648`، ثم PR هذا الاتفاق) |
| O2 | **خطة MOD-05 (الفصول والتسجيلات)** في §4d: النطاق والجداول والمهام ومعايير قبولها وقرارات المالك (D-R15 فما بعد) — أولوية لأنها تفتح عمل المتعاون (C3) | §1، §5، الوثيقة الرئيسية 6.7.4 | — | ✔ CH-0076 (§4d — D-R15..D-R18 `ACCEPTED`؛ PR هذه الخطة) |
| O3 | KI-048: هروب `%`/`_` في بحث `q` على اسم الدورة، مع اختبار (منقولة من قائمة المتعاون) | الوثيقة الرئيسية 16 | — | ✔ CH-0079 (TEST-062؛ PR هذه المهمة) |
| O4 | MOD-01-H01: `TRUST_PROXY` | §3.2 | — | ✔ CH-0080 (TEST-063؛ PR هذه المهمة) |
| O5 | MOD-01-H03: سقف مطلق لعمر عائلة التحديث | §3.2 | — | ✔ CH-0082 (TEST-065، ADR-063؛ PR هذه المهمة) |
| O6 | MOD-01-H04: `helmet` + `SWAGGER_ENABLED=false` في الإنتاج (اعتمادية جديدة — وافق المالك في 2026-11-03) | §3.2 | — | ✔ CH-0083 (TEST-066، ADR-064؛ PR هذه المهمة) |
| O7 | إغلاق MOD-04 من جهة المالك: تسجيل القبول في §4c.9 بعد رحلة WF-05 من المتصفح. **منذ ADR-065:** جزء الواجهة (`courses.syllabus.changed` في `AUDIT_ACTION_SUGGESTIONS`، ومطابقة عقد المنهج إن تغيّر) انتقل إلى قائمة الواجهة (بند «O7-F» أدناه) | §4c.5 (T07) | C1 وC2 مدموجتان (✔)؛ وO7-F | `PLANNED` |
| O8 | MOD-02/MOD-14 في الخادم: إضافة المهام إلى §4b (MOD-02-T03 `settings`، ومهمة جديدة للفروع بقرار D14) ثم تنفيذها — تسبق الجدولة | §4b.5، §5، الوثيقة الرئيسية 6.7.11 (D14) | O2 | ✔ CH-0086..CH-0089 (الخطة §4b + D-R19..D-R22؛ T05 جدول `branches` — PR #22؛ T03 مفتاحا الإعدادات وT06 API-080..083 — PR هذه المهمة) |
| O9 | MOD-07 الجدولة: الخطة في §4e ثم التنفيذ | §1 (Stage 3) | جداول MOD-05 (C3) مدموجة، وO8 | جارية — T00 ✔ (CH-0090، الخطة في §4e وقرارات D-R23..D-R29 — PR #28)؛ T01 ✔ (CH-0092 — جدولا `rooms` و`class_schedules`، أول إضافة `btree_gist`، TEST-070 — PR هذه المهمة)؛ التالي T02 (القاعات API-084..087 + `branch_in_use`)؛ T03..T06 `PLANNED` |
| O10 | MOD-08 الواجبات: الخطة في §4g ثم التنفيذ | §1 (Stage 4) | بوابة Stage 3 (C5) | `PLANNED` |
| O11 | MOD-11 المدفوعات والأقساط: الخطة في §4i ثم التنفيذ | §1 (Stage 5) | قرار D15؛ MOD-05 | `PLANNED` |
| O12 | MOD-13 التقارير بالمشاركة مع C10: الخطة في §4k | §1 (Stage 5) | الوحدات التي يقرأ منها كل تقرير | `PLANNED` |

**قائمة المطوّر المتعاون السابقة (الخادم) — البنود C4..C10 عند المالك منذ ADR-065**

> البنود المنجزة (C1..C3) بقيت بأسمائها للتاريخ. **C4..C10 انتقلت إلى المالك** بترتيبها وشروطها، و«التالي» للمالك هو أول بند غير منجز وشرطه متحقق في القائمتين معاً، بترتيب المراحل في §1. استثناء واحد: **PR خطة MOD-06 (#24 — C4/T00، CH-0058)** يبقى للمتعاون حتى يُغلق بالتنسيق (قاعدة #19: لا تنتقل ملكية الفروع تلقائياً)، وقرارات Q1..Q5 فيه للمالك، والتنفيذ (T01 فما بعد) عند المالك.

| # | المهمة | المرجع | شرط البدء | الحالة |
|---|---|---|---|---|
| C1 | **MOD-04-T04 المنهج** (API-048/API-049): العقد الذي تنتظره الواجهة في CH-0072 (الوثيقة الرئيسية 19) و`frontend/src/api/syllabus.ts`؛ تنفيذ سابق كامل على الفرع البعيد `backend/mod04-t04-syllabus-reference`: الالتزام `f1a418c` من جهاز المالك (الفرع المحلي `backup/local-main-2026-11-02`) مُعاداً تطبيقه على `main` `5dcc39a`، وفُحص في 2026-11-03 (`lint` والأنواع والوحدة واختبارات المنهج والدورات الشاملة و`build` — CH-0078؛ CH-0077 كان قد بحث في نسخة أخرى). يراجعه المتعاون ككود جديد، ويحوّل معرّفاته المتقاعدة (CH-0046، TEST-042، FS-069) إلى كتلته، ويضيف التوثيق، ويفتح PR المهمة من فرعه — أو يبني من العقد | §4c.5 | — | ✔ CH-0050 (FS-072، TEST-045، KI-050؛ PR #10 — دُمج 2026-11-03) |
| C2 | النصف الخادمي من T07: توسيع TEST-030 لكل مسار كاتب في T02..T04، وتوثيق WF-05 في القسم 09 | §4c.5 (T07) | C1 | ✔ CH-0051 (TEST-030 + TEST-046 — رحلة WF-05 عبر API؛ PR #11 — `backend/mod04-t07-audit`) |
| C3 | MOD-05 الفصول والتسجيلات: PR الجداول أولاً ثم الـ API | §4d (يكتبها O2) | O2 مدموجة | ✔ التنفيذ CH-0052..CH-0057 (قبول المالك معلَّق — §4d.9) — T01 ✔ (CH-0052، PR #12 — دُمج 2026-11-03)؛ T02 ✔ (CH-0053 — `backend/mod05-t02-classes`)؛ T03 ✔ (CH-0054 — `backend/mod05-t03-teachers` فوق T02)؛ T04 ✔ (CH-0055 — `backend/mod05-t04-enrollments` فوق T03، بالتوازي معها)؛ T05 ✔ (CH-0056 — `backend/mod05-t05-my-classes` فوق T04)؛ T06 ✔ (CH-0057 — `backend/mod05-t06-closure` فوق T05)؛ **التنفيذ مكتمل** — PRs #15 (T02) ← #16 (T03) ← #14 (T04) ← #17 (T05) ← PR هذه المهمة (T06)، وقبول المالك من Swagger معلَّق (§4d.9) |
| C4 | MOD-06 الدروس والحضور: الخطة في §4f ثم التنفيذ | §1 (Stage 3) | **الخطة (T00 في §4f) مسموحة الآن** (قرار المالك في #19، 2026-11-04 — CH-0085)؛ التنفيذ (T01 فما بعد) ينتظر جداول MOD-07 (O9) مدموجة | `PLANNED` |
| C5 | **بوابة Stage 3:** اختبار شامل لرحلة الطالب (تسجيل ← فصل ← درس ← حضور) مع توسيع TEST-030 لأحداث المرحلة، ويراجعه المالك | §1 | C4 وO9 | `PLANNED` |
| C6 | MOD-09 الاختبارات والدرجات: الخطة في §4h ثم التنفيذ | §1 (Stage 4) | C5؛ قرار D17 | `PLANNED` |
| C7 | MOD-10 الشهادات (ضمن §4h) | §1 (Stage 4) | C6 | `PLANNED` |
| C8 | LR-01 قناة البريد الفعلية | §5.1 | قرار المالك على المزوّد | `PLANNED` |
| C9 | MOD-12 الإشعارات: الخطة في §4j ثم التنفيذ | §1 (Stage 5) | C8 | `PLANNED` |
| C10 | MOD-13 التقارير بالمشاركة مع O12 | §1 (Stage 5) | كما O12 | `PLANNED` |

**قائمة الواجهة — المطوّر المتعاون (منذ ADR-065)**

> شاشة كل وحدة تُبنى بعد دمج عقدها في 10.2، فلا «مرحلة واجهة» منفصلة. المصدر: الشاشات المؤجَّلة في §5b.6، وخطط الوحدات (بند الواجهة في كل خطة، مثل MOD-05-T07). يضيف المتعاون بنوده التالية (`J-Fnn`) هنا في PR واجهته، والمالك يعتمد الترتيب.

| # | المهمة | المرجع | شرط البدء | الحالة |
|---|---|---|---|---|
| J-F01 | صفحة الفصول `/classes` حقيقية على API-050..API-056 (جزء من MOD-05-T07) | §4d.5 (T07) | MOD-05-T02/T03 مدموجتان (✔) | رُوجع 2026-11-04 — موافقة المالك بإصلاح واحد نُفّذ (عنصر التنقل بـ `classes.read` وحده)؛ CH-0064، PR #26، الدمج بعد CI أخضر |
| J-F02 | «الجدول الأسبوعي» في تبويب «عام» في `/settings` (`settings.scheduling` على API-035/API-036) | §4b.5 (T03) | MOD-02-T03 مدموجة (✔) | قيد المراجعة — CH-0065، PR #32 |
| O7-F | جزء الواجهة من إغلاق MOD-04 (منقول من O7): `courses.syllabus.changed` في `AUDIT_ACTION_SUGGESTIONS`، ومطابقة `frontend/src/api/syllabus.ts` لعقد API-048/API-049، ثم رحلة WF-05 من المتصفح مع المالك | §4c.5 (T07) | C1 وC2 مدموجتان (✔) | جزئية — CH-0067 (الفرع `frontend/mod04-o7f`، لم يُرفع بعد): الاقتراح ✔ (TEST-081) ومطابقة العقد ✔ (بلا تعديل؛ KI-051 للمالك)؛ **المتبقي:** رحلة WF-05 من المتصفح مع المالك (`UNVERIFIED`) |
| J-F03.. | التالي بترتيب العقود المدموجة: تسجيلات الفصل و«فصولي» (API-057..API-060 — المذكورة J-F04 في #26)، ثم شاشات MOD-07 بعد عقودها (§4e)، وأحداث التدقيق الجديدة في `AUDIT_ACTION_SUGGESTIONS` | §5b.6 | دمج عقد كل شاشة | يكتبها المتعاون |

**بعد القوائم:** خادم Stage 6 (MOD-15 والقاعدة المركزية) قرار لاحق للمالك.

### 5b.3 قواعد منع التعارض

1. **الفروع وPR (من ADR-060، باقية):** بداية كل جلسة `git fetch origin` ثم `git switch main && git merge --ff-only origin/main` (على جهاز المالك مع `-c http.sslBackend=schannel` — KI-035)؛ فرع لكل مهمة من `main` المحدَّث: `backend/<الوحدة>-<المهمة>` للمالك (مثل `backend/mod05-t01-schema`)، و`frontend/<المهمة>` للمتعاون، و`docs/<الموضوع>` للتخطيط وحده (ADR-065)؛ `git rebase origin/main` قبل الدفع؛ الدفع إلى فرع الجلسة فقط وبطلب صريح من مطوّرها، بعد فحص التاريخ الكامل للأسرار (`--force-with-lease` بعد rebase فقط)؛ **الطلب الدائم يكفي (منذ 2026-11-04 — CH-0085):** طلب المطوّران كلاهما أن يرفع Claude Code كل مهمة منتهية (فحوص البند 8 والتوثيق حسب RULE 18) ويفتح لها PR فوراً — قاعدته `main`، أو الفرع الذي تحته إن كان مكدَّساً — ويكتب في issue التنسيق #19 «فُتح PR #n — <المهمة>»، ويعلن أي ترحيل في #19 قبل `npm run prisma:migrate`؛ وفي بداية كل جلسة يقرأ التعليقات الجديدة في #19 وعلى الـ PRs المفتوحة ويعرض على المطوّر ما صار جاهزاً للدمج. الحدود باقية: لا رفع إلى `main` ولا إلى فروع المطوّر الآخر، ولا `--force` بلا `--with-lease`، ولا دمج قبل CI أخضر (والبند 2)، ولا أسرار ولا قيم متغيرات بيئة في أي تعليق؛ تنفيذه المحلي (ذاكرة Claude Code وقواعد سماح في `.claude/settings.local.json` غير الملتزم) خاص بكل جهاز؛ PR على GitHub ثم CI أخضر ثم «Rebase and merge». لا أحد يدفع `main`.
2. **المراجعة المتبادلة:** كل PR يراجعه المطوّر الآخر (تعليق أو موافقة على GitHub) قبل الدمج. إن لم تصل المراجعة خلال يوم عمل، يدمج صاحب الـ PR بعد CI أخضر ويذكر ذلك في الدردشة.
3. **المخطط والترحيلات — أخطر نقطة تعارض:**
   - (أ) كل وحدة تبدأ بـ PR صغير للجداول (النماذج + الترحيل + اختبار المخطط على نمط TEST-039) يُدمج قبل الخدمات، فيبني عليه الآخر فوراً.
   - (ب) **ترحيل واحد غير مدموج في كل مرة:** يُعلن في الدردشة قبل `npm run prisma:migrate`. إن دُمج ترحيل الآخر أولاً: احذف مجلد ترحيلك المحلي غير المدموج، ثم `git rebase origin/main` و`npm run prisma:deploy`، ثم ولّد ترحيلك من جديد فوقه. **لا تعديل لترحيل مدموج أبداً.**
   - (ج) النماذج الجديدة في آخر `schema.prisma` تحت تعليق `// MOD-xx`. أسطر العلاقات العكسية على النماذج المشتركة (`User`، `Course`، …) هي التعارض المتوقع: أبقِ الطرفين، ثم `npx prisma format` وحارس الانجراف (`migrate diff … --exit-code`).
   - (د) بعد كل سحب لـ `main`: `npm run prisma:deploy` إن ظهر ترحيل جديد، و`npm run prisma:seed` إن تغيّر البذر، و`npx -y npm@11 ci` إن تغيّر `backend/package-lock.json`.
   - (هـ) SQL اليدوي (CHECK، القيود المؤجَّلة — ADR-046) يُلحق بالترحيل بعد `--create-only` كما في MOD-04-T01.
4. **الملفات المشتركة الأخرى:** `app.module.ts` سطر لكل وحدة (عند التعارض أبقِ الطرفين). كتالوج الصلاحيات (57 مفتاحاً) يغطي مسبقاً الفصول والتسجيلات والجدولة والدروس والحضور والواجبات والاختبارات والدرجات والأسئلة والشهادات والرسوم والفواتير والمدفوعات والإشعارات والتقارير والفروع وتسجيلات الدروس؛ مفتاح جديد بقرار المالك في PR مستقل مع `npm run prisma:seed`. مساعدات `common/` و`authorization/` تُعدَّل في PR صغير مستقل لا داخل PR ميزة. قاموس أخطاء لكل وحدة (`src/<الوحدة>/<الوحدة>.errors.ts`). اعتمادية جديدة بموافقة المالك وفي PR مستقل. متغير بيئة جديد في `env.schema.ts` و`.env.example` و11.3 في الـ PR نفسه.
5. **أحداث التدقيق:** كل وحدة تثبت «حدثاً واحداً لكل كتابة وصفراً للمرفوض» في اختبارها الشامل، وتضيف أحداثها إلى 12.4. توسيع TEST-030 المشترك (`backend/test/audit.e2e-spec.ts`) يتم مرة لكل مرحلة في مهمة بوابتها (C2 لـ MOD-04، C5 لـ Stage 3، …) كي لا يعدّله PRان معاً. `AUDIT_ACTION_SUGGESTIONS` في الواجهة يضيف إليه المتعاون الأحداث الجديدة في PR واجهته، فاذكرها في وصف PR الخادم وفي إعلان #19 (ADR-065).
6. **الوثائق المشتركة:** كل مطوّر يعدّل أقسام وحدته فقط بتعديلات موضعية: 06 (جداولها)، 08 (قسم `MOD-xx`)، 10.2 (صفوف نقاطها)، 12.4 (أحداثها)، 13، 15 (صفوفها)، 16، 17، 19، وفي هذه الوثيقة قسم خطتها وصفوفه في §5b.2. القسم 19 إلحاق بالترتيب الزمني، و«آخر معرّف تغيير» في الترويسة = آخر إدخال زمنياً. تعارض عند rebase في 19 أو §6 أو `CLAUDE.md` → إبقاء الطرفين بالترتيب الزمني، ورقم إصدار §6 يُعاد ليلي آخر رقم على `main`. **أحرف أقسام الخطط محجوزة:** §4d MOD-05 (O2)، §4e MOD-07 (O9)، §4f MOD-06 (C4)، §4g MOD-08 (O10)، §4h MOD-09 وMOD-10 (C6/C7)، §4i MOD-11 (O11)، §4j MOD-12 (C9)، §4k MOD-13 (O12/C10)؛ مهام MOD-02/MOD-14 تُضاف إلى §4b.
7. **العقد أولاً:** PR مسودة مبكر فيه الـ DTO وعقد 10.2 (`PLANNED` حتى الدمج — RULE 13)، فيعرف الآخر الشكل قبل أن يبني عليه.
8. **قبل كل دفع:** الخادم `lint` → `test` → `test:e2e -- --no-file-parallelism` → `build` (وحارس الانجراف عند لمس المخطط)؛ استثناء الواجهة `lint` → `test` → `build` بالتسلسل (KI-044).
9. **القبول (ADR-065؛ كان «القبول في الخادم أولاً» — ADR-061):** وحدة الخادم مقبولة حين تنجح اختبارات كل معايير قبولها (وحدة + شامل)، وتُجرَّب من Swagger (`/api/docs`) — يجرّبها المالك، أو المتعاون أثناء ربط شاشتها — ويسجّل المالك قبولها في خطتها. رحلة المتصفح لوحدة جديدة `UNVERIFIED` حتى تُدمج شاشتها، ثم تُجرَّب وتُسجَّل في خطة الوحدة. بوابة كل مرحلة اختبار شامل لرحلتها.
10. **وصف كل PR:** المعرّفات المستخدمة، وأقسام التوثيق، والترحيلات والقفل والبيئة والبذر، والبند المُنجز في §5b.2، وما يحتاجه المطوّر الآخر.
11. **تنسيق يومي قصير في issue التنسيق #19:** أي ترحيل قادم، وأي عقد تغيّر، وأي قرار ينتظر المالك.
12. **لا يعدّل أحد فرع الآخر (ADR-065):** لإكمال عمل الآخر أو إصلاحه يُدفع فرع جديد باسم صاحبه (مثل `…-rebased`) ويُفتح PR بديل، ويُغلق الأصلي برابط مع بقاء مؤلّف الالتزامات (كما في #27/#29/#30/#31 بدل #14/#17/#25/#11).
13. **إعلان العقد (ADR-065):** كل عقد API جديد أو متغيّر يُعلن للمتعاون في #19 عند فتح PR الخادم وعند دمجه: الطريقة والمسار، والصلاحيات، والـ DTOs، والأخطاء بأكوادها، ومثال طلب واستجابة، وحالة الدمج، والأحداث الجديدة.

### 5b.4 المعرّفات المحجوزة

| النوع | المالك | المطوّر المتعاون |
|---|---|---|
| `CH-nnnn` | CH-0070..CH-0099 (المستعمل حتى CH-0092؛ CH-0077 كتبته جلسة على جهاز آخر — CH-0078) | CH-0050..CH-0069 (050..057 مستعملة؛ 064 لواجهة الفصول J-F01؛ 067 لـ O7-F) |
| `TEST-nnn` | TEST-060..079 (060..070 مستعملة؛ 071..075 محجوزة لـ O9 — §4e) | TEST-045..059 (045..052 مستعملة؛ 058 لـ J-F01)؛ **والكتلة التالية TEST-080..TEST-099 محجوزة له (CH-0091)** (081 لـ O7-F) لأن PRات الواجهة المفتوحة تبلغ TEST-059، آخر الكتلة الأولى |
| `ADR-nnn` | ADR-060..069 (060..065 مستعملة) | ADR-047..059 |
| `FS-nnn` | FS-090..109 (090..094 مستعملة؛ 095..096 محجوزة لـ O9) | FS-072..089 (072..076 مستعملة؛ 080 لـ J-F01) |
| `KI-nnn` | KI-070..089 (070 مستعمل) | KI-050..069 (050 و051 مستعملان — 051 في CH-0067) |
| `API-nnn` | **API-080..API-109 (جديد — CH-0075)**؛ 080..083 مستعملة لفروع O8 (CH-0089)؛ 084..092 محجوزة لـ O9 (§4e.4) | API-048..API-079 (048/049 للمنهج، 050..055 للفصول — CH-0053، 056 لمعلمي الفصل — CH-0054، 057..059 للتسجيلات — CH-0055، 060 لـ «فصولي» — CH-0056) |
| `D-Rnn` | يرقّمها المالك عند القرار، بالتسلسل من D-R15 (D-R15..D-R18 لـ MOD-05 — CH-0076؛ D-R19..D-R22 لـ O8 — CH-0086؛ D-R23..D-R29 لـ O9 — CH-0090؛ التالي D-R30) | — |

منذ CH-0072 (قرار المالك): CH-0047..CH-0049 وTEST-043/044 وFS-070/071 وKI-049 أخذها عمل الواجهة المكتوب قبل اتفاق CH-0070، وCH-0046 وTEST-042 وFS-069 لا تُستعمل. عند استنفاد كتلة تُحجز التالية هنا بإدخال CH؛ تبدأ الكتل التالية بعد أعلى رقم محجوز (CH-0100، TEST-100، ADR-070، FS-110، KI-090، API-110). كتل المتعاون صارت لعمل الواجهة منذ ADR-065، والخادمية منها (API-048..API-079) لم تعد تُستعمل لعمل جديد.

### 5b.5 الإعداد الأول لجهاز المطوّر المتعاون (مرة واحدة)

Node 22.20.0 (`.nvmrc`) وDocker Desktop؛ `.env` جذري من `.env.example` بقيم محلية ثم `docker compose up -d`؛ `backend/.env` من `backend/.env.example` (`JWT_SECRET` ≥ 32 حرفاً، `SEED_ACADEMY_*`، `MAIL_TRANSPORT=log` اختياري)؛ `cd backend && npx -y npm@11 ci` ثم `npm run prisma:deploy` ثم `npm run prisma:seed` ثم `npm run auth:bootstrap-admin` (أو `npm run dev:demo-users`)؛ `npm run start:dev` و`GET /api/health/ready` = 200؛ ثم `npm run test` و`npm run test:e2e -- --no-file-parallelism` للخط الأساس (133 وحدة + 173 شاملة بعد CH-0045). لا تُنسخ ملفات `.env` ولا بيانات بين الجهازين. ذاكرة Claude Code على الجهاز الثاني فارغة: `CLAUDE.md` والوثيقتان هما كل السياق.

### 5b.6 الحالة والتاريخ

| البند | الحالة |
|---|---|
| هذا الاتفاق | `ACCEPTED` (المالك، 2026-11-04 في #19 — ADR-065؛ وثّقه CH-0091) |
| الاتفاق السابق | «الخادم أولاً»: المطوّران على الخادم بتقسيم الوحدات (2026-11-03، CH-0075، ADR-061 → `SUPERSEDED`). ما تم فيه: C1 (PR #10)، وC2 (#11 ← بديله #31)، وC3 (#12 و#15 و#16 و#14 ← #27 و#17 ← #29 و#25 ← #30)، وO2..O6 وO8 وخطة O9 (#28). وقبله المساران (2026-11-02، CH-0070، ADR-060 → `SUPERSEDED`): PR #2 (T05 + T06)، وPR #3 (MOD-01-H08)، وPR #4 (إصلاح KI-049 — CH-0074). التفاصيل في الوثيقة الرئيسية 19 و§6 هنا |
| شاشات بلا تنفيذ بعد (قائمة الواجهة) | شاشات MOD-05..MOD-13 (بدأت بـ J-F01)؛ تسميات الأدوار المخصصة في قائمة المستخدمين ورأس الدرج؛ MOD-02-T04 (العلامة التجارية)؛ رحلات المتصفح المؤجلة |
| مرحلة الواجهة | **أُلغيت كمرحلة منفصلة (ADR-065):** الشاشات تُبنى بالتوازي مع الخادم بعد دمج عقودها |
| خادم Stage 6 | قرار المالك لاحقاً — التوصية: بعد مرحلة الواجهة، لأن الإطلاق الأول لا يحتاجه (ADR-045: نسخة كاملة لكل أكاديمية بإجراء يدوي) |

---

## 6. سجل تغييرات هذه الوثيقة

| الإصدار | التاريخ | التغيير | المرجع |
|---|---|---|---|
| 1.0.0 | 2026-10-29 | إنشاء الوثيقة بطلب المالك: المراحل، إغلاق MOD-01 بسجل القبول، خطة MOD-03 (T00..T16)، القرارات المطلوبة، المتطلبات المعلقة | CH-0015، ADR-025 |
| 1.1.0 | 2026-10-29 | T00 وT01 `IMPLEMENTED`؛ D-R01..D-R06 `ACCEPTED` بقرار المالك (مع القرارات المعتمدة في §4.7)؛ D-R07 جديد `PENDING` (نطاق `users.read`)؛ T13 بحسب D-R06؛ T16 وS1-R03 من `BLOCKED` إلى `PLANNED`؛ §4.8 المتغيرات `IMPLEMENTED`؛ ملاحظة فحص CSRF على MOD-01-H02؛ §4.3 قاعدة `includeDeleted` | CH-0016، ADR-027، ADR-028 |
| 1.1.1 | 2026-10-29 | S1-R02 (CI) و§4.8 من `BLOCKED` إلى `PLANNED` بعد ربط المستودع بـ GitHub (remote `origin`) وأول رفع لـ `main` | CH-0017 |
| 1.2.0 | 2026-10-29 | T02 `IMPLEMENTED` (API-014؛ قاعدة عدم تجاوز صلاحيات المنشئ وفروق التصميم في §4.5)؛ MOD-01-H02 `IMPLEMENTED` (`OriginGuard`)؛ D-R07 `ACCEPTED` بتوجيه المالك (`users.read_contact` + إسقاط مخفَّض)؛ §4.2/§4.3 الاستثناء الوحيد لقاعدة «لا مفاتيح جديدة» (57 مفتاحاً)؛ متطلب SEC-R-13 مضاف إلى نطاق T03؛ الدفعة A: التالية T03 | CH-0018، ADR-029، ADR-030 |
| 1.3.0 | 2026-10-29 | قرار المالك D-R08 `ACCEPTED` (تأجيل تكامل البريد الفعلي إلى التجهيز للإطلاق)؛ نطاق T03 موسَّع بفقرة «تجريد البريد» (`MailTransport`/`NoopMailTransport`، `MAIL_TRANSPORT` مقترح، قيد إقلاع يمنع الناقل التطويري والمسار الذاتي بلا ناقل في production) ومعايير قبول 9–11، و`email_verified_at` لا يُضبط بالرابط اليدوي؛ T05 مربوطة بالناقل؛ §1 (Stage 5)، §4.1، §4.8 (ثلاثة صفوف)، §5 محدَّثة؛ **قسم جديد §5.1 «بوابة الإطلاق»** بالمهمة LR-01 (ربط المزوّد، تأكيد ملكية البريد، اختبار التسليم) كبوابة مانعة لأول نشر إنتاجي | CH-0019، ADR-031 |
| 1.4.0 | 2026-10-30 | T03 `IMPLEMENTED` (API-015..API-017؛ فروق التصميم في §4.5 وADR-032)؛ الدفعة A مكتملة والتالية T04 (§4.6)؛ §1 (حالة Stage 2 — كانت تشير خطأً إلى «التالية T02» منذ CH-0018؛ صُحِّحت)؛ §4.4 صف T03؛ §4.8 (تجريد البريد وقيد الإنتاج `IMPLEMENTED`، حدود المعدل `PARTIALLY_IMPLEMENTED`) | CH-0020، ADR-032 |
| 1.4.1 | 2026-10-30 | لا تغيير في حالة أي مهمة أو قرار. ملاحظة تشغيلية للتطوير المحلي فقط: حسابات تجريبية لكل دور (`admin`/`teacher`/`student`) عبر `npm run dev:demo-users` (FS-050 وSEC-R-14 في الوثيقة الرئيسية؛ يرفض production) تُغني عن إنشاء حسابات يدوياً أثناء تنفيذ T04..T16 واختبار شاشات الواجهة (T11/T12)؛ المسار الرسمي للحسابات الحقيقية يبقى T02 + T03 | CH-0021 |
| 1.4.2 | 2026-10-30 | T04 `IMPLEMENTED` (API-018؛ فروق التنفيذ والمتطلب الأمني SEC-R-15 في §4.5)؛ الدفعة B بدأت والتالية T05 (§4.6، مع متطلب القاعدة نفسها على إصدار رمز إعادة الضبط)؛ §1 (حالة Stage 2)، §4.4 | CH-0022 |
| 1.5.0 | 2026-10-30 | T05 `IMPLEMENTED` (API-019..API-021؛ فروق التنفيذ في §4.5 وADR-033: الإصدار لحساب `active` فقط، `403 reset_disabled` للمسار الذاتي المعطَّل، العمل بعد الاستجابة عند تفعيله)؛ الدفعة B: التالية T06 (§4.6)؛ §4.8 (حدود المعدل للمسارات العامة `IMPLEMENTED`)؛ §1 (حالة Stage 2؛ T08 جارية بالتوازي — CH-0024)، §4.4 صف T05 | CH-0023، ADR-033 |
| 1.5.1 | 2026-10-30 | T08 `IMPLEMENTED` (API-022..API-026؛ فروق التنفيذ وSEC-R-16 في §4.5)؛ الدفعة C بدأت بـ T08 بالتوازي مع T05 والتالية فيها T07 (§4.6)؛ §1 (حالة Stage 2)، §4.4 صف T08؛ رأس الوثيقة كان ما زال 1.4.2 بعد صف 1.5.0 — صُحِّح | CH-0024، ADR-034 |
| 1.6.0 | 2026-10-30 | T09 `IMPLEMENTED` (API-029..API-033؛ فروق التنفيذ وSEC-R-18 في §4.5 وADR-036: القاعدة على الطرفين، 400 تحقق للربط الذاتي، قفل صف الطالب للأساسي الواحد، `user_not_found` بدلالتين، `user` كاملاً بإسقاط D-R07)؛ الدفعة C: T08 وT09 منفَّذتان بالتوازي والمتبقي T07 ثم T10 (§4.6 — بوابة «ولي مرتبط بطالبَين» متحققة)؛ §1 (حالة Stage 2)، §4.4 صف T09 | CH-0026، ADR-036 |
| 1.6.1 | 2026-10-30 | T06 `IMPLEMENTED` (API-027/API-028؛ فروق التنفيذ وSEC-R-17 في §4.5 وADR-035: المحذوف منطقياً حالة نهائية، القاعدة على كل إجراء، `self_forbidden` على ما يسحب الوصول فقط، `unlock` idempotent بصلاحيتين، آخر مدير بقفل `FOR UPDATE`، حدث `users.deleted` مستقل، `DELETE` بـ `200` وجسم اختياري)؛ **الدفعة B مكتملة** وبوابتها متحققة بـ TEST-026 (§4.6)؛ §1 (حالة Stage 2)، §4.4 صف T06. كُتب فوق 1.6.0 (CH-0026) بالتسلسل المتفق عليه | CH-0025، ADR-035 |
| 1.7.0 | 2026-10-30 | T07 `IMPLEMENTED` (API-034؛ فروق التنفيذ في §4.5 وADR-037: قاعدة عدم التجاوز على أدوار الهدف وعلى كل دور يُضاف، الاستبدال كفرق، `employeeKind` بالاستنتاج أو صريحاً، الملفات لا تُحذف، المدير غير `active` خارج النصاب، قفل مشترك مع T06؛ اكتشاف KI-041 وإصلاحه)؛ الدفعة C: المتبقي T10 فقط (§4.6)؛ D-R03 منفَّذ بالكامل (§4.7)؛ §1 (حالة Stage 2)، §4.4 صف T07. كُتب فوق 1.6.1 (CH-0025) بالتسلسل المتفق عليه مع جلسة T16 (CH-0028 تكتب بعده) | CH-0027، ADR-037 |
| 1.7.1 | 2026-10-30 | T16 `IMPLEMENTED` وS1-R03 مغلقة (CH-0028؛ TEST-029؛ فروق التنفيذ في §4.5 وADR-038: Vitest 5 داخل `vite.config.ts`، اختبارات بجوار المصدر بنمط `*.test.{ts,tsx}`، عدّة مشتركة بسياق مصادقة بديل، استيراد صريح بلا globals)؛ D-R05 منفَّذ (§4.7)؛ §1 (حالة Stage 1)، §2، §4.6 (الدفعة D وقاعدة «كل شاشة باختبار»)، §4.8. كُتب بعد 1.7.0 (CH-0027) بالتسلسل المتفق عليه | CH-0028، ADR-038 |
| 1.8.0 | 2026-10-30 | T10 `IMPLEMENTED` (API-011 بمرشّحاته وترقيمه الدقيق؛ فروق التنفيذ في §4.5 وADR-039: مجموعة تغطية مركزية TEST-030 تعدّ بالفاعل، إصلاح KI-042، اقتران `entityId` بـ `entityType`، بادئة حرفية مهرَّبة)؛ الدفعة C مكتملة والتالية الدفعة D بترتيب T11 → T12 → T14 → T13 → T15 (§4.6؛ T11 جارية بالتوازي في جلسة ثانية)؛ §1 (حالة Stage 2)، §4.4 صف T10 | CH-0029، ADR-039 |
| 1.8.1 | 2026-10-30 | T11 `IMPLEMENTED` (CH-0030؛ FS-060؛ TEST-031؛ فروق التنفيذ في §4.5: ترقيم keyset كـ «السابق/التالي» على مكدّس مؤشرات، معالج بثلاث خطوات يختصر إلى خطوتين لولي الأمر، أصغر جسم `PATCH` محسوب محلياً، بيانات الاتصال بحسب `users.read_contact`، تواريخ `<input type="date">`؛ AC1..AC3 ✔ وAC4 اليدوي من المتصفح `UNVERIFIED`)؛ الدفعة D بدأت والتالية T12 → T14 → T13 → T15 (§1، §4.6)؛ صف أثر D-R07 على T11 ✔ (§4.7) | CH-0030 |
| 1.9.0 | 2026-10-30 | T12 `IMPLEMENTED` (CH-0031؛ FS-061؛ TEST-032؛ ADR-040؛ فروق التنفيذ في §4.5: جلسة متبنّاة عبر `adoptSession()` بلا تجديد ولا إعادة دخول، الرمز التالف الشكل ميت محلياً، أحكام الرابط الميت بلا نموذج، إعادة الضبط بلا معاينة، نافذة واحدة للرابط المُصدَر مرة واحدة بعرض مطلق، زر إعادة الضبط خلف تأكيد، صفحة «نسيت كلمة المرور» مؤجَّلة إلى LR-01؛ AC1..AC4 بالاختبارات والتحقق اليدوي من المتصفح `UNVERIFIED`)؛ ترتيب الدفعة D صار T11 → T12 → T13 (بالتوازي مع T12 في جلسة ثانية بتكليف المالك) → T14 → T15 (§1، §4.6)؛ صف أثر D-R01 ✔ (§4.7)؛ LR-01 تتلقى صفحة «نسيت كلمة المرور» (§5.1) | CH-0031 |
| 1.9.1 | 2026-10-30 | T13 `IMPLEMENTED` (CH-0032؛ FS-062؛ TEST-033؛ فروق التنفيذ في §4.5: البوابة `roles.manage` داخل `SettingsPage` على مسار شقيق بلا `RequireRole` وتبويب «عام» بحسب مصفوفة الدور، قاعدة عدم التجاوز كقفل محلي في المصفوفة، أصغر جسم `PATCH` بالمجموعة الكاملة عند تغيّرها، `academy_admin` للعرض فقط، كتلة `rolesAdmin.*`؛ AC1..AC3 ✔ والتحقق اليدوي من المتصفح `UNVERIFIED`)؛ الدفعة D: T11 ✔ → T12 ✔ → T13 ✔ (بالتوازي مع T12) → T14 → T15 (§1، §4.6) | CH-0032 |
| 1.10.0 | 2026-10-30 | T15 `IMPLEMENTED` (CH-0034؛ FS-064؛ TEST-035؛ ADR-042؛ فروق التنفيذ في §4.5: عنصر التنقل بوابة واحدة (صلاحيات أو مصفوفة الدور)، لوحة التحكم مستثناة من AC1 كصفحة هبوط، `RequireAccess` بثلاث خصائص تُطبَّق معاً وبوابة `/settings/roles` في المسار أيضاً، المعلم يكسب «المستخدمون» لأن البذر يمنحه `users.read` (AC3 غير حرفي)، صفحة سجل التدقيق بالمرشّحات الخمسة والترقيم؛ التحقق اليدوي من المتصفح `UNVERIFIED`)؛ الدفعة D: T11 ✔ → T12 ✔ → T13 ✔ → T14 (قيد التنفيذ بالتوازي مع T15 في جلسة ثانية) → T15 ✔ — T14 وT15 نُفِّذتا بالتوازي وT15 تُغلق الدفعة مع وصول T14 (§1، §4.6) | CH-0034 |
| 1.10.1 | 2026-10-30 | T14 `IMPLEMENTED` (CH-0033؛ FS-063؛ TEST-034؛ ADR-041؛ فروق التنفيذ في §4.5: درج بتبويبات، قائمة إجراءات واحدة من مرآة آلة الحالات بسبب اختياري، خيارات الأدوار من `GET /api/roles` بأقفال المدى والذات، بحث بعيد للأطراف مع رفض الذات محلياً، القوائم من الخادم بعد الكتابة؛ AC1..AC3 ✔ بالاختبارات والتحقق اليدوي من المتصفح `UNVERIFIED`)؛ **الدفعة D مكتملة بـ T14 وT15 معاً (بالتوازي في جلستين) وكل مهام MOD-03 (T00..T16) منفَّذة** (§1، §4.6)؛ كُتب بعد 1.10.0 (CH-0034) بالتسلسل المتفق عليه | CH-0033، ADR-041 |
| 1.11.0 | 2026-10-31 | S1-R01 وS1-R02 `IMPLEMENTED` (CH-0035؛ ADR-043؛ FS-065؛ فروق التنفيذ في §2: الشامل ملفاً بعد ملف في CI — KI-040، تثبيت npm 11 قبل `npm ci` في الخادم — KI-045 المكتشفة أثناء التنفيذ، لا حساب مدير في CI؛ معيار «خط أنابيب أخضر على `main`» `UNVERIFIED` حتى يرفع المالك ويبلغ)؛ **Stage 1 مكتملة** (§1)؛ §4.8 (صفا CI وNode)؛ كُتب بالتوازي مع جلسة MOD-02/MOD-14 (CH-0036) التي تدرج §4b وتوثّق بعده بالتسلسل المتفق عليه | CH-0035، ADR-043 |
| 1.12.0 | 2026-10-31 | **§4b جديد — MOD-02/MOD-14 الحد الأدنى** (النطاق، لا جداول ولا ترحيل، الصلاحيات من الكتالوج، API-035/API-036، المهام MOD-02-T01..T04، الترتيب، D-R09/D-R10 معتمدان مبدئياً، فروق التنفيذ §4b.8): T01 وT02 `IMPLEMENTED` (CH-0036؛ FS-066؛ TEST-036/TEST-037؛ ADR-044؛ غياب الصف `503`، الاسم ككائن كامل، `UTC` مقبول صراحةً، عنصر التنقل `settings` بالصلاحيتين، `mockAcademySettings` باقٍ للوحة التحكم والمدفوعات؛ الرحلة اليدوية من المتصفح `UNVERIFIED`)، T03/T04 `PLANNED`؛ §1 (بوابة خروج Stage 2: MOD-02/MOD-14 ✔؛ المتبقي قبول MOD-03 وحسم ADR-008). §4b أُدرج قبل commit 1.11.0 بإذن الجلسة A وكُتب الباقي بعده بالتسلسل المتفق عليه (كُتب بعد CH-0035) | CH-0036، ADR-044 |
| 1.12.1 | 2026-10-31 | S1-R02: معيار «خط أنابيب أخضر على `main`» متحقق — أول دفع إلى GitHub بطلب المالك وأول تشغيل CI أخضر على `924a461` (CH-0037؛ الوثيقة الرئيسية 13.4/14.12)؛ §1 صف Stage 1، §2 S1-R02، §4.8 صف CI، الترويسة |
| 1.12.2 | 2026-11-01 | D-R09 وD-R10 (§4b.7) صارا `ACCEPTED` نهائياً بتأكيد المالك («أوافق عليها» — CH-0039)؛ §1 صف Stage 2؛ الترويسة. التشغيل الثاني لـ CI على GitHub (`75ed668`) أخضر أيضاً (الوثيقة الرئيسية 13.4) |
| 1.13.0 | 2026-11-01 | **ADR-008 محسوم بقرار المالك (CH-0040، ADR-045):** نسخة كاملة لكل أكاديمية الآن، وقاعدة المنصة المركزية ولوحة Super Admin تصميم معتمد يُبنى في Stage 6؛ §1 صف Stage 2 (لم يبقَ في البوابة إلا قبول MOD-03)، §5 (الاعتماديات العابرة)، الترويسة |
| 1.14.0 | 2026-11-01 | **§4c جديد — خطة MOD-04 (الدورات والمستويات، أول وحدة في Stage 3)** (CH-0041): النطاق، ثلاثة جداول من 6.7.4-C بفروقها، الصلاحيات (لا مفاتيح جديدة؛ التنقل بـ `courses.read`)، نقاط النهاية المقترحة، المهام T00..T07 بمعايير قبولها واختباراتها، الدفعات A..D، قرارات المالك D-R11..D-R14 `ACCEPTED` (المنهج فقط مع الدورات والمستويات، لا سعر قبل MOD-11، غير المنشور لـ `courses.manage` وحده، أرشفة بدل الحذف)، ملاحظات تقنية؛ T00 `IMPLEMENTED`؛ §1 صف Stage 3؛ الترويسة |
| 1.15.0 | 2026-11-01 | **MOD-03 مقبولة ومقفلة واكتملت Stage 2** (CH-0042): §4.9 سجل القبول الجديد (الرحلات بأدلتها من `audit_logs`)؛ §1 صفّا Stage 2 (`IMPLEMENTED`) وStage 3 (T01 التالية)؛ §4.6 بوابة الدفعة D ✔؛ §3.2 MOD-01-H08 الجديد (KI-047)؛ الترويسة |
| 1.16.0 | 2026-11-01 | MOD-04-T01 `IMPLEMENTED` (CH-0043): الجداول `levels`/`courses`/`course_syllabus_items` وتعداد `course_status` بالترحيل الثالث، مع فروق التنفيذ في §4c.5؛ §4c.6 الدفعة A مكتملة محلياً (CI عند الرفع)؛ §1 صف Stage 3 `IN_PROGRESS`؛ الترويسة |
| 1.17.0 | 2026-11-01 | MOD-04-T02 `IMPLEMENTED` (CH-0044): API المستويات API-037..API-041 مع فروق التنفيذ في §4c.5؛ §4c.6 الدفعة B بدأت؛ §1 صف Stage 3؛ الترويسة |
| 1.18.0 | 2026-11-01 | MOD-04-T03 `IMPLEMENTED` (CH-0045): API الدورات API-042..API-047 مع فروق التنفيذ في §4c.5؛ §4c.6 الدفعة B تنتظر T04؛ §1 صف Stage 3؛ الترويسة |
| 1.19.0 | 2026-11-02 | **§5b جديد — اتفاق العمل المتوازي** (CH-0070، ADR-060): مسارا الخادم (المطوّر المتعاون) والواجهة (المالك) بملكية الملفات وكتل المعرّفات المحجوزة ونموذج الفروع/PR وترتيب المهام ونقاط الالتقاء وخطوات إعداد الجهاز الثاني؛ §0.1 البند 6 (الفروع بدل `main`)؛ ملاحظة التقسيم تحت جدول §4c.6؛ الترويسة | CH-0070 |
| 1.19.1 | 2026-11-02 | §5b.3 البند 1: خطّاف `git-sync-check.mjs` (جلب للقراءة فقط عند بدء الجلسة + تذكير عند التوقف؛ لا رفع تلقائي بقرار المالك)؛ الترويسة | CH-0071 |
| 1.20.0 | 2026-11-02 | MOD-04-T05 `IMPLEMENTED` (CH-0047): صفحة الدورات الحقيقية مع فروق التنفيذ في §4c.5 (الرحلة من المتصفح `UNVERIFIED`)؛ §4c.6 الدفعة C بدأت والتالية T06؛ §4c.8 (4) محسومة؛ §1 صف Stage 3؛ الترويسة |
| 1.20.1 | 2026-11-02 | T05 (CH-0048): الرحلة من المتصفح جزئية بأدلتها، وصف «بنود المنهج» أُزيل من درج الدورة بطلب المالك؛ الترويسة |
| 1.21.0 | 2026-11-02 | MOD-04-T06 `IMPLEMENTED` (CH-0049): تبويبا المستويات والمنهج مع فروق التنفيذ في §4c.5؛ §4c.6 **الدفعة C مكتملة في الواجهة** (تبويب المنهج ينتظر T04 — CH-0072) والتالية D (T07)؛ §1 صف Stage 3؛ الترويسة |
| 1.21.1 | 2026-11-02 | مزامنة مع `main` بعد اتفاق §5b (CH-0072): عمل الواجهة T05/T06 على الفرع `frontend/mod04-t05-t06-courses`، T04 المحلية أُسقطت ليعيدها مسار الخادم (قرار المالك)؛ §5b.1 كتلة الخادم تبدأ من CH-0050/TEST-045/FS-072/KI-050؛ §5b.2 ملاحظة الحالة؛ §5b.4؛ صفوف Stage 3 و§4c.6 بلا ادعاء T04؛ الترويسة | CH-0072 |
| 1.21.2 | 2026-11-02 | MOD-01-H08 منفَّذ في الواجهة (CH-0073، KI-047 FIXED، TEST-060): §3.2 صف H08؛ §4.9 ملاحظة القبول (2)؛ §5b.2 ملاحظة حالة جديدة (PR #2 مدموج)؛ §5b.4 «أول دمج عبر PR» تم؛ الترويسة | CH-0073 |
| 1.21.3 | 2026-11-03 | KI-049 في `UserDrawer` أُصلح بقرار المالك (CH-0074، TEST-061): §4c.5 (ملاحظة T06 (د))؛ §5b.2 ملاحظة حالة جديدة (PR #3 مدموج، الحشو بدأ)؛ الترويسة | CH-0074 |
| 1.22.0 | 2026-11-03 | **§5b مُعاد كتابته — اتفاق «الخادم أولاً»** بطلب المالك: المالك والمطوّر المتعاون كلاهما على الخادم بتقسيم الوحدات حتى تكتمل القائمتان، ثم الواجهة؛ §5b.1 المطوّران وكيف تعرف الجلسة من يسأل؛ §5b.2 قائمة مرتبة لكل مطوّر (O1..O12، C1..C10) بشرط بدء وحالة، و«التالي» = أول بند غير منجز وشرطه متحقق؛ §5b.3 قواعد منع التعارض (المخطط والترحيلات، الملفات المشتركة، أحداث التدقيق، الوثائق، أحرف أقسام الخطط المحجوزة، المراجعة المتبادلة، القبول)؛ §5b.4 المعرّفات مع كتلة API جديدة للمالك (API-080..109)؛ §5b.6 الحالة والتاريخ والمؤجَّل إلى الواجهة؛ §1 (صف Stage 3) و§4c.6 (صف الدفعة C وملاحظة التقسيم)؛ الترويسة | CH-0075، ADR-061 |
| 1.23.0 | 2026-11-03 | **§4d جديد — خطة MOD-05 (الفصول والتسجيلات)** (المهمة O2): النطاق، الجداول الثلاثة (`classes`، `class_teachers`، `enrollments`) وفروقها عن 6.7.4-C، الصلاحيات من الكتالوج الحالي + الملكية، نقاط النهاية المقترحة، المهام T00..T07 بمعايير قبولها (T01..T06 للمتعاون — C3، وT07 مؤجَّلة إلى مرحلة الواجهة)، الدفعات، وقرارات المالك **D-R15..D-R18 `ACCEPTED`** (الأساس فقط؛ الصلاحيات + الملكية؛ حالة الفصل يدوياً؛ التسجيل بيد الإدارة بسعة صارمة) مع تفاصيل تقنية موصى بها تُعتمد بدمج الخطة؛ §5b.2 O2 ✔؛ §1 صف Stage 3؛ الترويسة | CH-0076 |
| 1.23.1 | 2026-11-03 | تصحيح اتساق (CH-0077): صف C1 في §5b.2 كان يقول إن التنفيذ المحلي السابق لـ T04 (`f1a418c`) على جهاز المالك ويُرفع فرعاً بالطلب — غير موجود في المستودع، فصار «تُبنى T04 من العقد»؛ §5b.4 (CH حتى CH-0077، و`D-R` التالي D-R19)؛ الترويسة | CH-0077 |
| 1.23.2 | 2026-11-03 | تصحيح CH-0077 وقاعدة «من يسأل» (CH-0078): تنفيذ T04 القديم موجود على جهاز المالك ورُفع فرعاً مرجعياً `backend/mod04-t04-syllabus-reference` (صف C1 في §5b.2)؛ هوية المطوّر لا تُستدل من اسم git (§5b.1)؛ §5b.4 (CH حتى CH-0078)؛ الترويسة | CH-0078 |
| 1.23.3 | 2026-11-03 | O3 ✔ (CH-0079): KI-048 أُصلح (البحث في اسم الدورة حرفي وبلا حساسية للحالة، TEST-062) — §5b.2 صف O3، §4c.5 فروق T03؛ §5b.1 اسما المطوّرين (محمد المالك، جلال المتعاون) وسبب اسم `jalla` المشترك (كان مضبوطاً على جهاز المالك، صار `Mohammed`)؛ §5b.4 (CH حتى CH-0079، TEST حتى 062)؛ الترويسة | CH-0079 |
| 1.23.4 | 2026-11-03 | O4 ✔ (CH-0080): MOD-01-H01 منفَّذ — `TRUST_PROXY` (§3.2 صف H01، §4.8 صف `trust proxy` إلى `PARTIALLY_IMPLEMENTED`، §5.1 قائمة التحصينات، §5b.2 صف O4)؛ §5b.4 (CH حتى CH-0080، TEST حتى 063)؛ الترويسة | CH-0080 |
| 1.24.0 | 2026-11-03 | MOD-04-T04 `IMPLEMENTED` (CH-0050 — المطوّر المتعاون، المهمة C1 ✔ في §5b.2): API المنهج API-048/API-049 مع فروق التنفيذ في §4c.5 (التنفيذ المرجعي بعد المراجعة، ملف شامل مستقل، بيانات الحدث، قفل `FOR NO KEY UPDATE`، KI-050)؛ §4c.6 الدفعة B مكتملة؛ §1 صف Stage 3؛ §5b.4 (CH-0050، TEST-045، FS-072، KI-050)؛ الترويسة | CH-0050 |
| 1.26.0 | 2026-11-03 | MOD-05-T01 `IMPLEMENTED` (CH-0052 — المطوّر المتعاون، أول مهام C3): الجداول `classes` و`class_teachers` و`enrollments` والتعدادات الأربعة في ترحيل مراجَع، مع فروق التنفيذ في §4d.5 (فهرسان إضافيان، `enrollments.status` بلا افتراضي، ملاحظة القفل لـ T04)؛ §4d.6 الدفعة A مكتملة؛ §1 صف Stage 3؛ §5b.2 صف C3 (جارية)؛ §5b.4 (CH-0052، TEST-047)؛ الترويسة | CH-0052 |
| 1.26.1 | 2026-11-03 | KI-050 أُصلح بقرار المالك (CH-0081): حدّ جسم JSON لمسار PUT المنهج حتى 512 KB والباقي 100 KB (ADR-062، TEST-064) — §4c.5 فروق T04؛ §5b.4 (CH حتى CH-0081، TEST حتى 064، ADR حتى 062)؛ الترويسة | CH-0081 |
| 1.27.0 | 2026-11-03 | MOD-05-T02 `IMPLEMENTED` (CH-0053 — المطوّر المتعاون، C3): API الفصول API-050..API-055 و`409 course_in_use` لحذف دورة لها فصول (AC7)، مع فروق التنفيذ في §4d.5 (القاموس كاملاً للجلستين المتوازيتين، ثلاثة أكواد إضافية، قفل `FOR NO KEY UPDATE` لـ T04)؛ §4d.6 الدفعة B بدأت؛ §1 صف Stage 3؛ §5b.2 صف C3؛ §5b.4 (CH-0053، TEST-048، FS-073، API-050..055)؛ الترويسة — الإصدار 1.27.0 يحمله أيضاً PR #11 (CH-0051) غير المدموج، ومن يُدمج ثانياً يعيد الترقيم | CH-0053 |
| 1.28.0 | 2026-11-03 | MOD-05-T03 `IMPLEMENTED` (CH-0054 — المطوّر المتعاون، C3): معلمو الفصل API-056 كاستبدال كامل بفرق، مع فروق التنفيذ في §4d.5 (`teachers_invalid`، فحص الصفوف المكتوبة وحدها، ثوابت مشتركة لـ T04)؛ §4d.6؛ §1 صف Stage 3؛ §5b.2 صف C3 (T04 جارية بالتوازي)؛ §5b.4 (CH-0054، TEST-049، FS-074، API-056 + حجز CH-0055/TEST-050/FS-075/API-057..059 لـ T04)؛ الترويسة — مبني على فرع T02 غير المدموج | CH-0054 |
| 1.29.0 | 2026-11-04 | O5 ✔ (CH-0082؛ أُعيد تأسيسه على `main` بعد دمج T02 — PR #15 — ثم بعد دمج T03 — PR #16، فصار 1.29.0 بدل 1.27.0): MOD-01-H03 منفَّذ — `AUTH_REFRESH_FAMILY_MAX_DAYS`=30 (قرار المالك؛ ENV-44، ADR-063، TEST-065) — §3.2 صف H03، §5.1، §5b.2 صف O5، §5b.4 (CH حتى CH-0082، TEST حتى 065، ADR حتى 063)؛ الترويسة | CH-0082 |
| 1.30.0 | 2026-11-04 | O6 ✔ (CH-0083؛ أُعيد تأسيسه على O5 بعد دمج T02 ثم بعد دمج T03 — PR #16، فصار 1.30.0 بدل 1.28.0): MOD-01-H04 منفَّذ — `helmet` (اعتمادية جديدة بموافقة المالك) وSwagger مغلق افتراضياً في الإنتاج (ADR-064، TEST-066)؛ تحصينات MOD-01 قبل النشر H01..H04 كلها منفَّذة — §3.2 صف H04، §5.1، §5b.2 صف O6، §5b.4 (CH حتى CH-0083، TEST حتى 066، ADR حتى 064)؛ الترويسة | CH-0083 |
| 1.30.1 | 2026-11-04 | توثيق إجرائي (CH-0085): الطلب الدائم بالرفع التلقائي صار قاعدة للمطوّرَين — §0.1 البند 6 و§5b.3 البند 1 (رفع كل مهمة منتهية وفتح PR لها وسطر في #19، وقراءة #19 في بداية كل جلسة، والحدود باقية)؛ §5b.2 صف C4: خطة §4f (T00) مسموحة الآن والتنفيذ ينتظر جداول MOD-07؛ §5b.4 (CH حتى CH-0085)؛ الترويسة — مكدَّس على PR #20 | CH-0085 |
| 1.31.0 | 2026-11-04 | **خطة O8** (CH-0086): §4b توسّع بالإعدادات والفروع — T03 مفصّلة (مفتاحا `scheduling.*`)، T05 جدول `branches` وT06 API الفروع (API-080..083) بمعايير قبولها واختباراتها (TEST-067..069)، قرارات المالك **D-R19..D-R22 `ACCEPTED`** (الفروع الآن، المفتاحان الآن، القراءة لكل مصادَق، الربط لاحقاً)، §4b.9 التفاصيل التقنية الموصى بها؛ §5b.2 صف O8 (جارية)؛ §5b.4 (CH حتى CH-0086، TEST 067..069 وAPI-080..083 محجوزة، D-R التالي D-R23)؛ الترويسة | CH-0086 |
| 1.31.1 | 2026-11-04 | MOD-02-T05 `IMPLEMENTED` (CH-0087 — O8): جدول `branches` في الترحيل الخامس، TEST-067؛ §4b.5 T05 (الحالة وفرق التنفيذ)؛ §5b.2 صف O8؛ §5b.4 (CH حتى CH-0087، TEST حتى 067، FS 091)؛ الترويسة | CH-0087 |
| 1.32.0 | 2026-11-04 | **O8 ✔** — MOD-02-T03 `IMPLEMENTED` (CH-0088: مفتاحا `academy.settings`) وMOD-02-T06 `IMPLEMENTED` (CH-0089: API-080..083): §4b.4 و§4b.5 (الحالة وفروق التنفيذ)؛ §5b.2 صف O8 ✔ (التالي O9)؛ §5b.4 (CH حتى CH-0089، TEST حتى 069، FS حتى 092، API-080..083 مستعملة)؛ الترويسة | CH-0088، CH-0089 |
| 1.33.0 | 2026-11-04 | MOD-05-T04 `IMPLEMENTED` (CH-0055 — المطوّر المتعاون، C3، بالتوازي مع T03): التسجيلات API-057..API-059 في `EnrollmentsModule` مستقلة، مع فروق التنفيذ في §4d.5 (قفل `FOR NO KEY UPDATE` بدل `FOR UPDATE`، الوحدة المستقلة، ترتيب الفحوص، ما يفرّغه `reactivate`، اختبار السباق بإمساك صف الفصل)؛ §4d.6 (T04 ✔، التالي T05)؛ §1 صف Stage 3؛ §5b.2 صف C3؛ §5b.4 (CH-0055، TEST-050، FS-075، API-057..059 مستعملة)؛ الترويسة — مبني على فرع T03 غير المدموج (ترتيب الدمج T02 → T03 → T04)؛ كُتب أصلاً في 2026-11-03 بإصدار 1.29.0، وأُعيد ترقيمه بعد إعادة التأسيس على `main` `77bb2f5` (بعد دمج #18..#23) | CH-0055 |
| 1.33.1 | 2026-11-04 | متابعة مراجعة المالك لـ PR #14 (CH-0055 البندان 6 و7): `reactivate` يعيد فحص الطالب كتسجيل جديد، و`withdrawalReason` لحامل `enrollments.manage` وحده (قرار المالك في #19) — §4d.5 T04: الفرق (هـ) صُحّح و(ح) دُقّق و(ي) يسجّل قرارات المالك، وسطر الحالة (TEST-050 شامل 9، AC1/AC3/AC4/AC5)؛ الترويسة — الفرع أُعيد تأسيسه على `main` بعد دمج PR #15 وPR #16؛ أُعيد ترقيمه من 1.29.1 بعد إعادة التأسيس على `main` `77bb2f5` | CH-0055 |
| 1.34.0 | 2026-11-04 | MOD-05-T05 `IMPLEMENTED` (CH-0056 — المطوّر المتعاون، C3): «فصولي» API-060 بالملكية بلا مفتاح، مع فروق التنفيذ في §4d.5 (مرشّح `status`، بلا ترقيم، المعلم الرئيسي باسمه وحده، الابن المحذوف منطقياً مخفي)؛ §4d.6 **الدفعة B (الخادم) مكتملة** والتالي T06؛ §1 صف Stage 3؛ §5b.2 صف C3؛ §5b.4 (CH-0056، TEST-051، FS-076، API-060)؛ الترويسة — مبني على فرع T04 غير المدموج (ترتيب الدمج T02 → T03 → T04 → T05)؛ ثم (2026-11-04) قرارات المالك في #19: دور `guardian` شرط لفصول الأبناء (الفرق (هـ) صُحّح)، ونص AC4 يستثني اسم المعلم الرئيسي، و(ز) يسجّل القرارات؛ كُتب أصلاً في 2026-11-03 بإصدار 1.30.0، وأُعيد ترقيمه في 2026-11-04 بعد إعادة التأسيس على #14 المعاد تأسيسه (`434de1f`، فوق `main` `77bb2f5`) | CH-0056 |
| 1.34.1 | 2026-11-04 | MOD-05-T05 بعد إعادة التأسيس على #14 (`434de1f`) وملاحظات مراجعة المالك (CH-0056، جهاز المالك، بعد انتقال جلال إلى الواجهة): `withdrawnAt` في عنصر «فصولي»، وTEST-051 شامل 4 (فحص عميق لاستجابة ولي الأمر، ومستدعٍ طالب وولي أمر)؛ §4d.5 T05 سطر الحالة؛ الترويسة | CH-0056 |
| 1.35.0 | 2026-11-04 | MOD-05-T06 `IMPLEMENTED` (CH-0057 — المطوّر المتعاون، C3): بوابة الوحدة اختبار شامل واحد TEST-052 (رحلة WF-03/WF-04 بأدوار `teacher`/`student`/`guardian` المزروعة)، مع فروق التنفيذ في §4d.5 (المدير دور مخصّص، الشرطان المسبقان بـ Prisma، تحققات الخطوات)؛ **§4d.9 جديد** — سجل قبول MOD-05 معلَّق بخطوات تجربة المالك من Swagger؛ §4d.6 الدفعة C؛ §1 صف Stage 3؛ §5b.2 صف C3 (التنفيذ مكتمل)؛ §5b.4 (CH-0057، TEST-052)؛ الترويسة — مبني على فرع T05 غير المدموج (ترتيب الدمج T02 → T03 → T04 → T05 → T06)؛ كُتب أصلاً في 2026-11-03 بإصدار 1.31.0، وأُعيد ترقيمه في 2026-11-04 بعد إعادة التأسيس على #17 المعاد تأسيسه (فوق #14 `434de1f` و`main` `77bb2f5`) | CH-0057 |
| 1.35.1 | 2026-11-04 | MOD-04-T07 `PARTIALLY_IMPLEMENTED` (CH-0051 — المطوّر المتعاون، المهمة C2 ✔ في §5b.2؛ أُعدّ بالإصدار 1.25.0 ثم 1.27.0 ثم 1.28.1 ثم 1.29.1 ثم 1.30.2 ثم 1.31.2 ثم 1.32.1، وأُعيد ترقيمه بعد دمج PR #12 ثم PR #15 وPR #16 ثم PR #18 وPR #20 وPR #21 ثم PR #22 وPR #23 ثم PR #27 وPR #29 وPR #30 (MOD-05-T04..T06، 2026-11-04 — جهاز المالك) قبله): النصف الخادمي — TEST-030 لكل مسار كاتب في T02..T04 (AC1)، ورحلة WF-05 عبر API في TEST-046 (AC2 مؤتمتاً)، وWF-05 في القسم 09؛ الباقي O7؛ §4c.6 الدفعة D؛ §1 صف Stage 3؛ §5b.4 (CH-0051، TEST-046)؛ الترويسة | CH-0051 |
| 1.36.0 | 2026-11-04 | **خطة O9** (CH-0090): §4e جديدة — MOD-07 الجدولة: القاعات `rooms` والجدول الأسبوعي `class_schedules` (حصص متكررة بسريان)، كشف تعارض القاعة والمعلم بقيدَي استبعاد (أول إضافة `btree_gist`)، القراءات (جدول الفصل، جدول الأكاديمية، «جدولي»)، والتوليد عبر خدمة MOD-06 في T05؛ المهام T00..T06 بمعايير قبولها واختباراتها (TEST-070..075)، API-084..092؛ قرارات المالك **D-R23..D-R29 `ACCEPTED`**؛ §1 صف Stage 3؛ §4b.7 D-R22 (حُسم في D-R24)؛ §5b.2 صف O9 (جارية)؛ §5b.4 (CH حتى CH-0090، TEST 070..075 وFS 093..096 وAPI-084..092 محجوزة، D-R التالي D-R30)؛ الترويسة — أُعيد تأسيسه على `main` `731ac34` بعد دمج #27 و#29 و#30 و#31، فصار 1.36.0 بدل 1.34.0 | CH-0090 |
| 1.37.0 | 2026-11-04 | **§5b — اتفاق جديد: تقسيم بالطبقة** (قرار المالك في #19، 12:09 UTC؛ ADR-065 يحل محل ADR-061): المالك على الخادم كله والمتعاون على الواجهة كلها؛ العنوان والمقدمة؛ §5b.1 (المسؤولية والفروع)؛ §5b.2 (O7: القبول عند المالك وجزء الواجهة إلى «O7-F»؛ البنود الخادمية C4..C10 عند المالك، وPR خطة MOD-06 #24 يبقى للمتعاون حتى يُغلق بالتنسيق؛ **قائمة الواجهة الجديدة** J-F01 (#26) وJ-F02 (#32) وO7-F وما يليها)؛ §5b.3 (القواعد 1 و5 و9 و11، وقاعدتان جديدتان 12 «لا يعدّل أحد فرع الآخر» و13 «إعلان العقد»)؛ §5b.4 (ADR-065؛ CH-0091؛ كتلة TEST-080..099 للمتعاون)؛ §5b.6 (لا مرحلة واجهة منفصلة)؛ الترويسة | CH-0091، ADR-065 |
| 1.38.0 | 2026-11-04 | **MOD-07-T01 `IMPLEMENTED`** (CH-0092، O9): جدولا `rooms` و`class_schedules` بترحيل سادس فيه أول إضافة `btree_gist` وقيدا الاستبعاد لتعارض القاعة والمعلم؛ AC1 (حارس الانجراف نظيف بلا بديل §4e.8 (2)) وAC2..AC4 بـ TEST-070؛ فروق التنفيذ في §4e.5 T01 (`time(0)`، لا فهرس مستقل لـ `branch_id`)؛ §1 صف Stage 3؛ §5b.2 صف O9 (التالي T02)؛ §5b.4 (CH-0092، TEST-070، FS-093/094)؛ الترويسة | CH-0092 |
| 1.39.0 | 2026-11-04 | **MOD-05-T07 جزئية — صفحة الفصول في الواجهة** (CH-0064، مهمة الواجهة J-F01 للمطوّر المتعاون جلال): §4d.5 T07 (الحالة: الفصول والمعلمون ✔، والباقي التسجيلات و«فصولي» في J-F04) و§4d.6 الدفعة D؛ التقسيم الجديد (جلال للواجهة، محمد للخادم) **لم يُكتب بعد في §5b** — PR `docs/` مستقل بتأكيد المالك؛ الترويسة | CH-0064 |
| 1.39.1 | 2026-11-04 | J-F01 — نتائج الرحلة اليدوية من المتصفح (CH-0064، قبل الدمج): 15/15، والاختبار 16 (حذف فصل مخطَّط، اختياري) `PENDING`؛ §4d.5 T07 (الحالة، وملاحظة التقسيم: اعتمده المالك في #19 ولم يُكتب بعد في §5b)؛ الترويسة؛ **بعد إعادة التأسيس على `main` `24ed9ce`** (#27/#29/#30) **ثم على `731ac34`** (#31): الإصداران 1.36.0/1.36.1 بدل 1.33.0/1.33.1، وإشارات #14/#17 في T07 صُحّحت | CH-0064 |
| 1.39.2 | 2026-11-04 | J-F01 — مراجعة المالك على PR #26 (CH-0064): موافقة بإصلاح واحد نُفّذ — عنصر التنقل `classes` بـ `classes.read` وحده (§4d.5 T07، §5b.2 صف J-F01)، وخمس ملاحظات غير مانعة مؤجَّلة؛ ملاحظة التقسيم في T07 صارت موثَّقة (CH-0091)؛ **بعد إعادة التأسيس على `main` `1b09c8e`** (CH-0090..CH-0092): الإصدارات 1.39.0/1.39.1/1.39.2 بدل 1.36.0/1.36.1، وجدول §5b.4 بصفوف المالك؛ الترويسة | CH-0064 |
| 1.42.0 | 2026-11-06 | **O7-F جزئية** (CH-0067، مهمة الواجهة للمطوّر المتعاون جلال): `courses.syllabus.changed` في `AUDIT_ACTION_SUGGESTIONS` (TEST-081) ومطابقة `frontend/src/api/syllabus.ts` لعقد API-048/API-049 وللمخطط الحي (بلا تعديل؛ KI-051 للمالك)؛ رحلة WF-05 من المتصفح `UNVERIFIED`؛ §4c.5 T07 و§4c.6 الدفعة D و§5b.2 صف O7-F و§5b.4 (CH-0067، TEST-081، KI-051)؛ الترويسة. **الرقم 1.42.0** يلي 1.40.x (PR #32) و1.41.x (PR #35) غير المدموجين، ومن يدمج أخيراً يعيد الترقيم |
