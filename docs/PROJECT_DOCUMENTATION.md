# ArtiCode Academy — التوثيق التقني الرئيسي (Master Project Documentation)

| البند | القيمة |
|---|---|
| **إصدار الوثيقة** | 1.6.2 |
| **تاريخ آخر مزامنة مع الكود** | 2026-10-29 18:10 (UTC+03:00) |
| **آخر معرّف تغيير مسجّل** | CH-0012 |
| **مرحلة المشروع الحالية** | Stage 1 — Foundation (جارية): Git (CH-0004)، هيكل واجهة تجريبي ببيانات محلية (CH-0005)، تهيئة الخادم وربطه بالواجهة (CH-0006)، PostgreSQL 18 محلية في Docker موصولة بـ Prisma 7 مع فحص جاهزية (CH-0007)، أدوار قاعدة بيانات محدودة الصلاحيات ومصدر واحد لإعدادات القاعدة (CH-0008). لا نماذج بيانات ولا مصادقة بعد؛ تصميم المخطط الأول في 6.6: الاتجاه معتمد مبدئياً وD1/D4/D5 معتمدة (CH-0009)، والبقية PROPOSED؛ التصميم المستهدف الكامل لكل الوحدات في 6.7 (D11..D22) PROPOSED (CH-0010)؛ فرز القرارات المانعة للترحيل الأول (D2, D3, D6..D8, D11, D20..D22) ودليل تنفيذه والتراجع عنه في 6.6.5 (CH-0011) بانتظار اعتماد المالك |
| **المالك التقني للوثيقة** | فريق تطوير ArtiCode Academy (يُحدَّث بواسطة المطورين و Claude Code وفق `CLAUDE.md`) |
| **اللغة** | عربية مهنية مع الإبقاء على المعرّفات التقنية والأسماء البرمجية بالإنجليزية |

> **قاعدة ذهبية:** هذه الوثيقة هي **المرجع التقني الوحيد المعتمد** للمشروع. كل ما فيها إمّا مُستند إلى دليل من الكود الفعلي، أو موسوم صراحةً بأحد الوسوم التالية:
>
> | الوسم | المعنى |
> |---|---|
> | `IMPLEMENTED` | منفّذ فعلياً ويوجد دليل في الكود |
> | `PARTIALLY_IMPLEMENTED` | منفّذ جزئياً |
> | `PLANNED` | مخطَّط له ولم يُنفَّذ بعد |
> | `DEPRECATED` | مهمَل وسيُزال |
> | `REMOVED` | أُزيل من الكود (مع الإبقاء على سجله التاريخي) |
> | `UNVERIFIED` | لم يتسنَّ التحقق منه من الكود أو من البيئة |
> | `NOT YET DETERMINED` | قرار أو معلومة لم تُحسم بعد |
>
> أي معلومة عن ميزة مستقبلية مأخوذة من **موجز مالك المشروع بتاريخ 2026-10-28** تُعامل كـ *متطلب* وليس كـ *تنفيذ*.

---

## فهرس المحتويات

- [01. PROJECT OVERVIEW — نظرة عامة على المشروع](#01-project-overview--نظرة-عامة-على-المشروع)
- [02. PRODUCT REQUIREMENTS — متطلبات المنتج](#02-product-requirements--متطلبات-المنتج)
- [03. TECHNOLOGY STACK — الحزمة التقنية](#03-technology-stack--الحزمة-التقنية)
- [04. PROJECT STRUCTURE — هيكل المشروع](#04-project-structure--هيكل-المشروع)
- [05. SYSTEM ARCHITECTURE — معمارية النظام](#05-system-architecture--معمارية-النظام)
- [06. DATABASE DOCUMENTATION — توثيق قاعدة البيانات](#06-database-documentation--توثيق-قاعدة-البيانات)
- [07. USER ROLES AND PERMISSIONS — الأدوار والصلاحيات](#07-user-roles-and-permissions--الأدوار-والصلاحيات)
- [08. SYSTEM MODULES — وحدات النظام](#08-system-modules--وحدات-النظام)
- [09. USER WORKFLOWS — رحلات المستخدم](#09-user-workflows--رحلات-المستخدم)
- [10. API DOCUMENTATION — توثيق واجهات البرمجة](#10-api-documentation--توثيق-واجهات-البرمجة)
- [11. CONFIGURATION AND ENVIRONMENT — الإعداد والبيئة](#11-configuration-and-environment--الإعداد-والبيئة)
- [12. SECURITY ARCHITECTURE — المعمارية الأمنية](#12-security-architecture--المعمارية-الأمنية)
- [13. TESTING AND QUALITY ASSURANCE — الاختبار وضمان الجودة](#13-testing-and-quality-assurance--الاختبار-وضمان-الجودة)
- [14. DEPLOYMENT AND OPERATIONS — النشر والتشغيل](#14-deployment-and-operations--النشر-والتشغيل)
- [15. FEATURE STATUS MATRIX — مصفوفة حالة الميزات](#15-feature-status-matrix--مصفوفة-حالة-الميزات)
- [16. KNOWN ISSUES AND TECHNICAL DEBT — المشكلات المعروفة والدين التقني](#16-known-issues-and-technical-debt--المشكلات-المعروفة-والدين-التقني)
- [17. ARCHITECTURAL DECISION LOG — سجل القرارات المعمارية](#17-architectural-decision-log--سجل-القرارات-المعمارية)
- [18. DEVELOPMENT ROADMAP — خارطة طريق التطوير](#18-development-roadmap--خارطة-طريق-التطوير)
- [19. PROJECT CHANGE HISTORY — سجل تغييرات المشروع](#19-project-change-history--سجل-تغييرات-المشروع)
- [20. DOCUMENTATION MAINTENANCE — صيانة التوثيق](#20-documentation-maintenance--صيانة-التوثيق)
- [الملحق A — اصطلاحات المعرّفات](#الملحق-a--اصطلاحات-المعرّفات)
- [الملحق B — سجل التحقق من الكود](#الملحق-b--سجل-التحقق-من-الكود)

---

## 01. PROJECT OVERVIEW — نظرة عامة على المشروع

### 1.1 اسم المشروع

**ArtiCode Academy** — منصة شاملة لإدارة الأكاديميات والتعلّم.

### 1.2 الغرض والأهداف التجارية

وفق موجز مالك المشروع (2026-10-28)، يهدف المنتج إلى تمكين الأكاديميات التعليمية من إدارة كامل دورة حياتها التشغيلية والأكاديمية في منصة واحدة:

- إدارة الأكاديمية والمستخدمين (معلمون، طلاب، أولياء أمور، موظفون).
- إدارة المحتوى التعليمي (دورات، مستويات، فصول، مجموعات، دروس مباشرة ومسجّلة).
- الجدولة والتقويم.
- التقييم (واجبات، اختبارات، درجات، شهادات، سجلات أكاديمية).
- الإدارة المالية (مدفوعات، أقساط، متابعة مالية).
- الإشعارات والتقارير.
- أدوار وصلاحيات مخصّصة، ودعم تعدد اللغات.

### 1.3 الجمهور المستهدف

| الفئة | الوصف | الحالة |
|---|---|---|
| مالكو/مديرو الأكاديميات | يديرون نشر الأكاديمية وإعداداتها ومستخدميها | PLANNED |
| المعلمون | يديرون الدروس والتقييمات | PLANNED |
| الطلاب | يتابعون الدروس ويؤدون الواجبات والاختبارات | PLANNED |
| أولياء الأمور | يتابعون تقدّم الطلاب والمدفوعات | PLANNED |
| الموظفون الإداريون | يدعمون العمليات اليومية (تسجيل، مالية، دعم) | PLANNED |

### 1.4 المشكلات التي يحلّها المنتج (الرؤية)

- تشتّت أدوات الأكاديميات بين أنظمة متعددة (جدولة، تقييم، مالية، تواصل).
- الحاجة إلى عزل بيانات كل أكاديمية (نشر مستقل وقاعدة بيانات مخصّصة لكل أكاديمية).
- الحاجة إلى صلاحيات مرنة تناسب هياكل إدارية مختلفة.
- دعم اللغة العربية ولغات أخرى في واجهة واحدة.

### 1.5 رؤية المنتج ونطاق النظام (PLANNED)

- نشر مستقل لكل أكاديمية (Independent academy deployments).
- قاعدة بيانات مخصّصة لكل أكاديمية (Dedicated database per academy).
- تكاملات مستقبلية وتطبيقات محمولة.
- قابلية التوسّع والصيانة على المدى الطويل.

### 1.6 مرحلة التطوير الحالية — ما هو موجود فعلاً (حالة الكود بتاريخ 2026-10-29)

| العنصر | الحالة الفعلية |
|---|---|
| `backend/` | **NestJS 12** مهيأ (CH-0006): تحقق من متغيرات البيئة بـ zod، `ValidationPipe` عام، CORS من الإعدادات، بادئة `/api`، Swagger على `/api/docs`، ونقطة نهاية حقيقية واحدة `GET /api/health`. أُزيلت نقطة الهيكل `GET /`. لا قاعدة بيانات ولا مصادقة ولا منطق أعمال بعد. الاختبارات (5 وحدة + 6 شاملة) والبناء ناجحة. |
| `frontend/` | تطبيق **Vite 8 + React 19 + TypeScript 7** مع **Ant Design 6** و**react-router 7** و**i18next** (CH-0005): دخول تجريبي، تخطيط عام (قائمة جانبية + ترويسة)، 13 شاشة وحدة ببيانات محلية ثنائية اللغة، عربية افتراضياً مع RTL. **لا اتصال بالخادم ولا بيانات حقيقية** — نموذج أولي للمعاينة (MOD-FE-01). |
| قاعدة البيانات | **PostgreSQL 18.6 تعمل محلياً في Docker** (`compose.yaml`، CH-0007) و**Prisma 7.10.1 موصول** عبر `PrismaModule`؛ `GET /api/health/ready` يتحقق من الاتصال فعلياً. منذ CH-0008 يتصل التطبيق بدور `articode_app` (DML فقط) وتجري الترحيلات بدور `articode_migrator` (مالك القاعدة)، والـ superuser للإدارة فقط؛ إعدادات القاعدة في `.env` الجذري وحده (ADR-019). **لا كيانات ولا ترحيلات بعد** (نموذج البيانات يأتي مع MOD-01/MOD-03؛ التصميم المقترح في 6.6، وقد اعتمد المالك D1/D4/D5 منه في CH-0009). |
| المصادقة والصلاحيات | **غير موجودة في الخادم.** في الواجهة مصادقة تجريبية (أي بيانات تُقبل) وبوابات أدوار للعرض فقط (KI-017). |
| التكامل بين الواجهة والخادم | **موجود بالحد الأدنى (CH-0006):** proxy في Vite من `/api` إلى المنفذ 3000، CORS مفعّل في الخادم، عميل HTTP في الواجهة، وبطاقة "الاتصال بالخادم" في لوحة التحكم تستدعي `GET /api/health`. شاشات الوحدات ما زالت تقرأ من `frontend/src/mock/data.ts`. منذ CH-0007 تعرض البطاقة حالة قاعدة البيانات أيضاً عبر `GET /api/health/ready`. |
| نظام الإصدارات | **تحت Git منذ CH-0004** (فرع `main`، commit الأساس `127cb1d`). لا remote ولا سياسة فروع بعد. |
| التوثيق | قبل هذه الوثيقة: ملفا README افتراضيان من الأطر فقط. |
| نظام التوثيق المستمر | `IMPLEMENTED` بتاريخ 2026-10-28: هذه الوثيقة + `CLAUDE.md` + خطّاف تحقق (`.claude/hooks/doc-sync-check.mjs`). |

**الخلاصة:** المشروع في **المرحلة 1 (Foundation)**: Git مُفعّل، هيكل واجهة تجريبي يسمح بمعاينة شاشات المنتج، خادم مهيأ مربوط بالواجهة، وقاعدة PostgreSQL محلية في Docker موصولة بـ Prisma (بلا نماذج بعد). المتبقي من المرحلة 1: أول مخطط بيانات وترحيل (التصميم المقترح في 6.6 بانتظار اعتماد المالك)، المصادقة، CI. كل ميزات الرؤية المذكورة أعلاه `PLANNED` ما لم يُذكر خلاف ذلك (التفصيل في [القسم 15](#15-feature-status-matrix--مصفوفة-حالة-الميزات)).

---

## 02. PRODUCT REQUIREMENTS — متطلبات المنتج

> مصدر هذه المتطلبات: موجز مالك المشروع بتاريخ 2026-10-28. وُسمت كلٌّ منها بـ **CONFIRMED-REQUIREMENT** (مطلب مؤكد من المالك) أو **RECOMMENDED** (توصية هندسية من فريق التوثيق تحتاج إلى اعتماد). لا يوجد أي منها منفّذاً حالياً.

### 2.1 القدرات الجوهرية للمنتج (Core capabilities)

| المعرّف | القدرة | النوع | الحالة |
|---|---|---|---|
| REQ-01 | نشر مستقل لكل أكاديمية | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-02 | قاعدة بيانات مخصّصة لكل أكاديمية | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-03 | إدارة الأكاديمية (إعدادات، هوية، فروع إن وُجدت) | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-04 | إدارة المستخدمين: معلمون، طلاب، أولياء أمور، موظفون | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-05 | الدورات والمستويات والفصول والمجموعات | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-06 | الدروس المباشرة والمسجّلة | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-07 | الجداول الزمنية والجدولة | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-08 | الواجبات والاختبارات والدرجات | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-09 | الشهادات والسجلات الأكاديمية | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-10 | المدفوعات والأقساط والمتابعة المالية | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-11 | الإشعارات والتقارير | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-12 | أدوار وصلاحيات مخصّصة | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-13 | دعم تعدد اللغات | CONFIRMED-REQUIREMENT | PLANNED |
| REQ-14 | تكاملات مستقبلية وتطبيقات محمولة | CONFIRMED-REQUIREMENT | PLANNED |

### 2.2 متطلبات إدارة الأكاديمية

- إنشاء أكاديمية وتهيئتها بقاعدة بيانات خاصة (REQ-01, REQ-02).
- إدارة هوية الأكاديمية وإعداداتها العامة (REQ-03).
- إدارة الهيكل التنظيمي والأدوار (REQ-12).

### 2.3 المتطلبات الوظيفية (Functional)

مستمدّة من REQ-03 إلى REQ-14. تفاصيل كل وحدة في [القسم 08](#08-system-modules--وحدات-النظام). **لم تُكتب بعد قصص مستخدم أو معايير قبول تفصيلية** — `NOT YET DETERMINED`.

### 2.4 المتطلبات غير الوظيفية (Non-functional)

| المعرّف | المتطلب | النوع | ملاحظات |
|---|---|---|---|
| NFR-01 | قابلية التوسّع والصيانة طويلة الأمد | CONFIRMED-REQUIREMENT | يُترجم عملياً إلى معمارية وحدات (NestJS modules) وتوثيق مستمر |
| NFR-02 | عزل بيانات كل أكاديمية | CONFIRMED-REQUIREMENT | انظر ADR-008 |
| NFR-03 | أهداف أداء قابلة للقياس (زمن استجابة، تزامن) | RECOMMENDED | لم تُحدَّد أرقام — `NOT YET DETERMINED` |
| NFR-04 | توفّر وتعافٍ من الكوارث (نسخ احتياطي لكل قاعدة بيانات) | RECOMMENDED | `NOT YET DETERMINED` |
| NFR-05 | أمان: مصادقة قوية، تشفير كلمات المرور، تحقق من المدخلات، سجلات تدقيق | RECOMMENDED | انظر [القسم 12](#12-security-architecture--المعمارية-الأمنية) |
| NFR-06 | إمكانية الوصول (Accessibility) وفق WCAG | RECOMMENDED | المستوى المستهدف `NOT YET DETERMINED` |
| NFR-07 | تعدد اللغات مع دعم الاتجاه من اليمين لليسار (RTL) للعربية | CONFIRMED-REQUIREMENT (اللغات) / RECOMMENDED (RTL) | الواجهة: ar (افتراضي، RTL) + en منذ CH-0005 (ADR-010). الخادم: بلا i18n |
| NFR-08 | قابلية الاختبار (اختبارات وحدة وتكامل وشاملة) | RECOMMENDED | الأطر موجودة (Vitest) بلا اختبارات ذات معنى بعد |

### 2.5 متطلبات قابلية التوسّع والأداء

- نموذج النشر المستقل لكل أكاديمية يعني أن التوسّع أفقيٌّ على مستوى الأكاديمية، لا على مستوى مستأجرين متعددين في قاعدة واحدة (PLANNED، انظر ADR-008).
- لا توجد قياسات أداء حالية (لا يوجد ما يُقاس) — `UNVERIFIED`.

### 2.6 إمكانية الوصول وتعدد اللغات

- الواجهة: بنية i18n منفّذة منذ CH-0005 (`frontend/src/i18n/*`): العربية افتراضياً مع `dir="rtl"`، والإنجليزية ثانوية، مع تبديل فوري وحفظ الاختيار محلياً (ADR-010). الخادم: لا i18n — `PLANNED`.
- إمكانية الوصول: لا فحص WCAG بعد. مكوّنات Ant Design توفّر أساساً (ARIA) لكن المستوى الفعلي `UNVERIFIED`.

---

## 03. TECHNOLOGY STACK — الحزمة التقنية

### 3.1 الخادم (Backend) — `backend/`

الإصدارات المثبّتة مأخوذة من `backend/package-lock.json` (lockfileVersion 3) الذي أُنشئ في CH-0003 بتاريخ 2026-10-28 وحُدّث في CH-0006 (إضافة 5 حزم وإزالة `@nestjs/mau`) ثم في CH-0007 (إضافة Prisma 7 وpg) بتاريخ 2026-10-29.

| التقنية | الإصدار المعلَن في `package.json` | الإصدار المثبّت فعلياً | الدور |
|---|---|---|---|
| Node.js | غير معلَن (لا يوجد حقل `engines`) | **v22.20.0** على جهاز التطوير | بيئة التشغيل. بعض أدوات التطوير تطلب 22.22.3 أو أحدث (KI-012) |
| TypeScript | `^6.0.2` | **6.0.3** | لغة البرمجة |
| NestJS `@nestjs/core` | `^12.0.1` | **12.3.2** | إطار الخادم |
| `@nestjs/common` | `^12.0.1` | **12.3.2** | الديكوريتورات والأدوات المشتركة |
| `@nestjs/platform-express` | `^12.0.1` | **12.3.2** | محوّل HTTP، ويعتمد على Express **5.3.0** |
| `reflect-metadata` | `^0.2.2` | **0.2.2** | دعم الديكوريتورات |
| `rxjs` | `^7.8.1` | **7.8.2** | تدفقات تفاعلية (اعتمادية NestJS) |
| `@nestjs/config` | `^12.0.1` | **12.0.1** | تحميل `.env` والتحقق من البيئة (`validate` بـ zod) — CH-0006 |
| `@nestjs/swagger` | `^12.0.5` | **12.0.5** | توليد OpenAPI وواجهة Swagger UI على `/api/docs` — CH-0006. يجلب `swagger-ui-dist` ومعه حزمة القياس `@scarf/scarf` (KI-020) |
| `class-validator` / `class-transformer` | `^0.15.1` / `^0.5.1` | **0.15.1** / **0.5.1** | يتطلبهما `ValidationPipe` العام — CH-0006 |
| `zod` | `^4.6.7` | **4.6.7** | مخطط متغيرات البيئة (`src/config/env.schema.ts`) — CH-0006 |
| `@prisma/client` | `^7.10.1` | **7.10.1** | عميل Prisma وقت التشغيل؛ الكود المولَّد في `src/generated/prisma` (متجاهَل في Git) — CH-0007 (ADR-018) |
| `@prisma/adapter-pg` | `^7.10.1` | **7.10.1** | محوّل السائق الذي تتطلبه Prisma 7 (بلا محركات Rust) فوق `pg` — CH-0007 |
| `pg` / `@types/pg` | `^8.23.1` / `^8.23.1` (dev) | **8.23.1** | سائق PostgreSQL لـ Node ومجمّع الاتصالات — CH-0007 |
| `prisma` | `^7.10.1` (dev) | **7.10.1** | واجهة الأوامر: generate / migrate / studio. مثبّتة على الإصدار الرئيسي 7 لأن وسم `latest` على npm كان `8.0.0-rc.28` وقت التثبيت (KI-026) — CH-0007 |
| `dotenv` | `^18.0.9` (dev) | **18.0.9** | تحميل `backend/.env` ثم `.env` الجذري لأوامر Prisma فقط (`prisma.config.ts`)؛ التطبيق يستخدم `@nestjs/config` — CH-0007، CH-0008 |
| `@nestjs/cli` | `^12.0.0` (dev) | **12.0.11** | أوامر `nest build/start` |
| `@nestjs/schematics` | `^12.0.0` (dev) | **12.0.0** | توليد الوحدات |
| `@nestjs/testing` | `^12.0.1` (dev) | **12.3.2** | أدوات الاختبار |
| ~~`@nestjs/mau`~~ | — | **أُزيلت في CH-0006** | كانت أداة نشر Mau (AWS) غير مستخدمة ومصدر كل ثغرات `npm audit` (KI-011 RESOLVED). أُزيل معها سكربت `deploy` |
| Vitest | `^4.1.2` (dev) | **4.1.12** | إطار الاختبار (وحدة + e2e) |
| `@vitest/coverage-v8` | `^4.1.2` (dev) | **4.1.12** | تغطية الاختبارات |
| `supertest` / `@types/supertest` | `^7.0.0` (dev) | **7.3.1** (supertest) | اختبارات HTTP الشاملة |
| `vite-tsconfig-paths` | `^5.1.4` (dev) | **5.1.4** | حلّ مسارات tsconfig داخل Vitest. Vite 8 يدعم ذلك أصلياً ويُظهر تحذيراً (KI-013) |
| oxlint | `^1.58.0` (dev) | **1.90.0** | الفحص الثابت (Linter) |
| Prettier | `^3.4.2` (dev) | **3.9.10** | التنسيق |
| `@types/node` | `^24.0.0` (dev) | **24.19.2** | أنواع Node (لاحظ: أعلى من إصدار التشغيل 22 — KI-008) |
| `@types/express` | `^5.0.0` (dev) | **5.0.6** | أنواع Express |
| `source-map-support` | `^0.5.21` (dev) | مثبّت | خرائط المصدر |

**نمط الوحدات:** ESM (`"type": "module"` في `package.json`، و`module: nodenext` في `tsconfig.json`). لذلك تستخدم الاستيرادات النسبية لاحقة `.js` حتى لملفات `.ts` (مثال: `import { AppModule } from './app.module.js'`).

### 3.2 الواجهة (Frontend) — `frontend/`

| التقنية | الإصدار المعلَن | الإصدار المثبّت (من `package-lock.json`، تم التحقق 2026-10-28؛ الصفوف الخمسة الأخيرة أُضيفت وتحقّقت 2026-10-29) | الدور |
|---|---|---|---|
| React | `^19.3.1` | **19.3.1** | مكتبة الواجهة |
| React DOM | `^19.3.1` | **19.3.1** | التصيير في المتصفح |
| Vite | `^8.3.5` | **8.3.5** | أداة البناء وخادم التطوير |
| TypeScript | `~7.0.2` | **7.0.2** | لغة البرمجة (الإصدار 7 = المنفّذ الأصلي "tsgo") |
| `@vitejs/plugin-react` | `^6.1.2` | **6.1.2** | دعم React/JSX في Vite (يستخدم Oxc) |
| oxlint | `^1.89.0` | **1.90.0** | الفحص الثابت |
| `@types/react` / `@types/react-dom` | `^19.3.0` | **19.3.0** | الأنواع |
| `@types/node` | `^24.19.2` | **24.19.2** | أنواع Node لإعدادات Vite |
| `antd` | `^6.6.8` | **6.6.8** | مكتبة مكوّنات الواجهة؛ RTL عبر `ConfigProvider direction` — أُضيفت في CH-0005 (ADR-009) |
| `@ant-design/icons` | `^6.3.4` | **6.3.4** | أيقونات antd — CH-0005 |
| `react-router` | `^7.18.5` | **7.18.5** | التوجيه في المتصفح؛ مثبّت عمداً على الإصدار الرئيسي 7 (ADR-011) — CH-0005 |
| `i18next` | `^26.5.11` | **26.5.11** | محرك الترجمة — CH-0005 (ADR-010) |
| `react-i18next` | `^17.1.9` | **17.1.9** | ربط i18next بـ React (`useTranslation`) — CH-0005 |

تثبيت الحزم الخمس أضاف 73 حزمة (102 حزمة مدقَّقة، `npm audit`: 0 ثغرات) بتاريخ 2026-10-29.

### 3.3 قاعدة البيانات و ORM

| البند | الحالة |
|---|---|
| محرك قاعدة البيانات | **PostgreSQL 18.6** (صورة `postgres:18` الرسمية) تعمل محلياً عبر `compose.yaml` — IMPLEMENTED للتطوير (CH-0007، ADR-016). الإنتاج `NOT YET DETERMINED` |
| ORM | **Prisma 7.10.1** مع `@prisma/adapter-pg` — IMPLEMENTED كبنية (ADR-014، ADR-018)؛ **لا نماذج بعد** |
| نظام الترحيلات | Prisma Migrate (`backend/prisma/migrations/`) — لا ترحيلات بعد؛ أول ترحيل يأتي مع أول نموذج |
| الاتصال | `DATABASE_URL` (ENV-08) → `PrismaService` (`backend/src/prisma/prisma.service.ts`)؛ اختياري خارج الإنتاج (ADR-017) |

### 3.4 المصادقة

لا توجد أي مكتبة مصادقة (`@nestjs/passport`, `@nestjs/jwt`, `bcrypt`, …) في الاعتماديات. `PLANNED` — انظر MOD-01.

### 3.5 أدوات الاختبار

- الخادم: Vitest 4 + `@nestjs/testing` + supertest (موجودة في الاعتماديات، مع اختبارين توليديين).
- الواجهة: **لا يوجد** إطار اختبار مثبّت.

### 3.6 النشر

لا توجد إعدادات نشر للإنتاج (لا Dockerfile للتطبيق، لا CI). يوجد `compose.yaml` في الجذر **للتطوير المحلي فقط** (PostgreSQL 18) منذ CH-0007. سكربت `nest deploy` (Mau) أُزيل في CH-0006. انظر [القسم 14](#14-deployment-and-operations--النشر-والتشغيل).

### 3.7 الخدمات الخارجية

**لا توجد** أي تكاملات خارجية في الكود.

### 3.8 بيئة التطوير (تم التحقق 2026-10-28)

| الأداة | الإصدار |
|---|---|
| نظام التشغيل | Windows 11 (10.0.26100) |
| Node.js | v22.20.0 |
| npm | 10.9.3 |
| Claude Code (امتداد VS Code) | 2.1.312 |
| Git Bash | متوفر (يُستخدم لتشغيل خطّافات Claude Code) |
| Git | 2.46.2.windows.1 (تم التحقق 2026-10-29، CH-0004) |
| Docker Desktop | محرك 29.9.2، Compose v5.6.1، السياق `desktop-linux`، WSL 2 (توزيعة `docker-desktop`) — تم التحقق 2026-10-29 (CH-0007). واجهة الأوامر مثبّتة لكل مستخدم في `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` وتظهر في PATH للجلسات الجديدة فقط (KI-025) |
| PostgreSQL | 18.6 داخل Docker فقط؛ لا `psql` مثبّت على Windows (يُستخدم عبر `docker compose exec`) |
| PowerShell | 7+ |

### 3.9 أسباب الخيارات المعمارية المؤكدة

| الخيار | الدليل | السبب المسجَّل |
|---|---|---|
| NestJS على Node.js/TypeScript | `backend/package.json`, `backend/src/*` | ذُكر Node.js و NestJS في النقاشات المعمارية السابقة (موجز المالك). **لا يوجد توثيق داخل المستودع لسبب الاختيار** — انظر ADR-001 |
| React + Vite + TypeScript | `frontend/package.json`, `frontend/vite.config.ts` | **السبب غير مسجَّل** — ADR-002 |
| Vitest بدل Jest | `backend/vitest.config.ts` | هو الافتراضي الذي يولّده `@nestjs/cli` 12؛ **لا دليل على أنه اختيار متعمّد** — ADR-005 |
| oxlint بدل ESLint | `backend/oxlint.json`, `frontend/.oxlintrc.json` | افتراضي قوالب الأطر؛ السبب غير مسجَّل — ADR-006 |

---

## 04. PROJECT STRUCTURE — هيكل المشروع

### 4.1 الشجرة الفعلية بتاريخ 2026-10-29 بدون مجلدات الاعتماديات

```text
ArtiCodeAcademy/
├── .git/                             ← مستودع Git، الفرع main (أُنشئ في CH-0004)
├── .gitignore                        ← تجاهل جذري: node_modules, dist, coverage, *.tsbuildinfo, .env* (CH-0004)
├── .gitattributes                    ← تطبيع نهايات الأسطر إلى LF + وسم الثنائيات (CH-0004)
├── compose.yaml                      ← PostgreSQL 18 للتطوير المحلي: منفذ 127.0.0.1:5432، مجلد postgres_data، فحص صحي (CH-0007)؛ متغيرات الأدوار + تركيب initdb (CH-0008)
├── .env.example                      ← المصدر الوحيد لإعدادات القاعدة: POSTGRES_* (superuser) + DB_MIGRATOR_* + DB_APP_* (+ DB_HOST)؛ يقرؤه compose والخادم وPrisma CLI (CH-0007، CH-0008)
├── docker/
│   └── postgres/initdb/
│       └── 10-roles.sh               ← ينشئ دوري articode_migrator (مالك القاعدة) وarticode_app (DML)؛ آلي في أول تشغيل، ويُعاد تشغيله يدوياً لمجلد قائم (CH-0008)
├── CLAUDE.md                         ← تعليمات التشغيل الدائمة لـ Claude Code (أُضيف في CH-0002)
├── docs/
│   └── PROJECT_DOCUMENTATION.md      ← هذه الوثيقة (المرجع الوحيد المعتمد)
├── .claude/
│   ├── settings.json                 ← إعدادات المشروع لـ Claude Code (خطّافات التحقق من التوثيق)
│   ├── hooks/
│   │   └── doc-sync-check.mjs        ← سكربت التحقق من مزامنة التوثيق (SessionStart + Stop)
│   └── .doc-sync/                    ← حالة الخطّاف (بصمات الملفات لكل جلسة) — متجاهَل بـ .gitignore ذاتي
├── backend/                          ← تطبيق NestJS 12 (ESM)، مهيأ منذ CH-0006
│   ├── .env.example                  ← أسماء متغيرات البيئة وقيمها الافتراضية (بلا أسرار) — CH-0006؛ منذ CH-0008 بلا DATABASE_URL افتراضي (يُشتق من .env الجذري)
│   ├── .gitignore                    ← node_modules، .env، /src/generated/prisma (أنشأه prisma init — CH-0007)
│   ├── .prettierignore               ← src/generated، dist (CH-0007)
│   ├── .prettierrc
│   ├── README.md                     ← README الافتراضي لـ NestJS (غير خاص بالمشروع)
│   ├── nest-cli.json
│   ├── oxlint.json
│   ├── package.json                  ← بلا سكربت deploy ولا @nestjs/mau منذ CH-0006
│   ├── package-lock.json             ← lockfileVersion 3 (أُنشئ في CH-0003، حُدّث في CH-0006 وCH-0007)
│   ├── prisma.config.ts              ← إعداد Prisma CLI: المخطط، مجلد الترحيلات، عنوان الترحيلات بدور migrator من .env الجذري (CH-0007، CH-0008)
│   ├── prisma/
│   │   └── schema.prisma             ← generator prisma-client → src/generated/prisma؛ datasource postgresql؛ بلا نماذج (CH-0007)
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── vitest.config.ts              ← اختبارات الوحدة (**/*.spec.ts)
│   ├── vitest.config.e2e.ts          ← الاختبارات الشاملة (**/*.e2e-spec.ts)
│   ├── src/
│   │   ├── main.ts                   ← bootstrap: NestFactory → configureApp → listen
│   │   ├── app.module.ts             ← الوحدة الجذرية: ConfigModule (envFilePath من env-files.ts، validate) + PrismaModule + HealthModule
│   │   ├── app.setup.ts              ← configureApp(): بادئة /api، CORS، ValidationPipe، Swagger، shutdown hooks
│   │   ├── common/
│   │   │   └── package-info.ts       ← اسم الحزمة وإصدارها من package.json + SERVICE_NAME
│   │   ├── config/
│   │   │   ├── env.schema.ts         ← مخطط zod لمتغيرات البيئة + validateEnv()؛ يشتق DATABASE_URL من DB_APP_* عند غيابه (CH-0008)
│   │   │   ├── env.schema.spec.ts    ← 11 اختبار وحدة (TEST-003)
│   │   │   ├── database-url.ts       ← buildPostgresUrl() وpostgresUrlFromEnv() والافتراضيات المشتركة مع compose (CH-0008)
│   │   │   ├── database-url.spec.ts  ← 6 اختبارات وحدة (TEST-006)
│   │   │   └── env-files.ts          ← ENV_FILE_PATHS: backend/.env.local ← backend/.env ← ../.env الجذري (CH-0008)
│   │   ├── prisma/                   ← طبقة الوصول إلى قاعدة البيانات (CH-0007)
│   │   │   ├── prisma.module.ts      ← @Global()؛ يصدّر PrismaService
│   │   │   └── prisma.service.ts     ← PrismaClient + PrismaPg من DATABASE_URL؛ db، ping()، إغلاق عند الإيقاف
│   │   ├── generated/prisma/         ← عميل Prisma المولَّد (متجاهَل في Git؛ يُولَّد في postinstall وbuild)
│   │   └── health/
│   │       ├── health.module.ts
│   │       ├── health.controller.ts  ← GET /api/health (API-002)، GET /api/health/ready (API-004)
│   │       ├── health.service.ts     ← check() حيوية، readiness() جاهزية عبر PrismaService.ping()
│   │       ├── health.dto.ts         ← HealthResponseDto، ReadinessResponseDto، DatabaseCheckDto
│   │       └── health.service.spec.ts ← 4 اختبارات وحدة (TEST-004)
│   └── test/
│       └── app.e2e-spec.ts           ← 7 اختبارات شاملة: health، readiness، 404، CORS، X-Powered-By، OpenAPI (TEST-005)
└── frontend/                         ← تطبيق Vite 8 + React 19 + Ant Design 6 (هيكل منتج تجريبي منذ CH-0005)
    ├── .gitignore
    ├── .oxlintrc.json
    ├── README.md                     ← README الافتراضي لقالب Vite (غير خاص بالمشروع)
    ├── index.html                    ← lang="ar" dir="rtl"، العنوان "ArtiCode Academy"
    ├── package.json                  ← + antd, @ant-design/icons, react-router@7, i18next, react-i18next
    ├── package-lock.json             ← lockfileVersion 3
    ├── tsconfig.json                 ← مراجع إلى app/node
    ├── tsconfig.app.json
    ├── tsconfig.node.json
    ├── .env.example                  ← VITE_API_BASE_URL و API_PROXY_TARGET (CH-0006)
    ├── vite.config.ts                ← plugins: [react()] + proxy من /api إلى الخادم (CH-0006)
    ├── public/
    │   └── favicon.svg               ← أيقونة قالب Vite، لم تُستبدل بعد (KI-019)
    └── src/
        ├── main.tsx                  ← نقطة الدخول: يحمّل ./i18n ثم يصيّر <App /> داخل StrictMode
        ├── index.css                 ← أنماط عامة بالحد الأدنى (ارتفاع كامل، خط النظام)
        ├── vite-env.d.ts             ← أنواع import.meta.env (VITE_API_BASE_URL) — CH-0006
        ├── api/                      ← طبقة الاتصال بالخادم (CH-0006)
        │   ├── client.ts             ← apiGet() + ApiError؛ يحترم VITE_API_BASE_URL
        │   ├── health.ts             ← fetchHealth() / fetchReadiness() وأنواع HealthReport / ReadinessReport (API-002، API-004)
        │   └── useHealth.ts          ← useEndpoint() عام + useHealth() + useReadiness() (checking / ok / error)
        ├── app/
        │   ├── App.tsx               ← ConfigProvider (اتجاه + لغة + ثيم antd) → AntdApp → AuthProvider → AppRouter
        │   └── router.tsx            ← createBrowserRouter: /login عام؛ البقية داخل RequireAuth → AppLayout
        ├── auth/                     ← مصادقة تجريبية (mock) تُستبدل بعميل MOD-01
        │   ├── roles.ts              ← ROLES = admin | teacher | student | guardian | staff
        │   ├── auth-context.ts       ← AuthContext + useAuth()
        │   ├── AuthProvider.tsx      ← جلسة تجريبية في localStorage (aca.mockUser)
        │   └── RequireAuth.tsx       ← RequireAuth (→ /login) و RequireRole (بوابة واجهة فقط → 403)
        ├── components/
        │   ├── PageHeader.tsx        ← عنوان + وصف + إجراءات
        │   ├── ServerStatusCard.tsx  ← بطاقة "الاتصال بالخادم" في لوحة التحكم (CH-0006)
        │   ├── StatusTag.tsx         ← ألوان مفردات labels.* المشتركة
        │   ├── LanguageSwitcher.tsx  ← العربية / English
        │   └── RoleSwitcher.tsx      ← "عرض كـ" لمعاينة الأدوار
        ├── i18n/
        │   ├── language.ts           ← SUPPORTED_LANGUAGES, directionOf(), نوع LocalizedText
        │   ├── index.ts              ← تهيئة i18next (ar افتراضياً؛ التخزين في localStorage: aca.language)
        │   ├── ar.ts                 ← القاموس المرجعي (يصدّر النوع Translation)
        │   ├── en.ts                 ← مُلزَم بنوع Translation لضمان تطابق المفاتيح
        │   └── useLocalized.ts       ← اختيار النص من LocalizedText حسب اللغة النشطة
        ├── layout/
        │   ├── navigation.ts         ← NAV_ITEMS: المفتاح، المسار، الأيقونة، الأدوار، الوحدة (MOD-xx)
        │   ├── AppLayout.tsx         ← Sider (قائمة حسب الدور) + Header + Content (Outlet)
        │   └── AppLayout.css
        ├── mock/
        │   └── data.ts               ← بيانات تجريبية ثنائية اللغة لكل وحدة (تُحذف عند الربط بالخادم)
        └── pages/
            ├── LoginPage.tsx / LoginPage.css
            ├── DashboardPage.tsx
            ├── UsersPage.tsx, CoursesPage.tsx, ClassesPage.tsx, SchedulePage.tsx
            ├── LessonsPage.tsx, AssignmentsPage.tsx, ExamsPage.tsx, CertificatesPage.tsx
            ├── PaymentsPage.tsx, NotificationsPage.tsx, ReportsPage.tsx, SettingsPage.tsx
            └── NotFoundPage.tsx, ForbiddenPage.tsx
```

أُزيلت في CH-0005: `frontend/src/App.tsx` (قالب)، `frontend/src/App.css`، `frontend/src/assets/{hero.png, react.svg, vite.svg}`، `frontend/public/icons.svg`. أُزيلت في CH-0006: `backend/src/app.controller.ts`، `backend/src/app.service.ts`، `backend/src/app.controller.spec.ts` (هيكل `Hello World`).

### 4.2 مسؤوليات المجلدات

| المسار | المسؤولية | ملاحظات |
|---|---|---|
| `backend/src/` | كود الخادم المصدري. `nest-cli.json` يحدده كـ `sourceRoot` | المخرجات في `backend/dist/` (تُحذف قبل كل بناء: `deleteOutDir: true`) |
| `backend/test/` | الاختبارات الشاملة (e2e) | مستبعَد من البناء عبر `tsconfig.build.json`؛ يستدعي `configureApp()` الحقيقية |
| `backend/src/config/` | مخطط متغيرات البيئة والتحقق منها — مصدر الحقيقة لكل ما يُقرأ من البيئة؛ منذ CH-0008 يضم اشتقاق عنوان القاعدة (`database-url.ts`، مشترك مع Prisma CLI) وترتيب ملفات env (`env-files.ts`) | أي متغير جديد يُضاف هنا وفي `.env.example` و11.3 |
| `backend/src/health/` | وحدة الفحص الحي (`GET /api/health`) | نمط المجلد لكل وحدة: module / controller / service / dto / spec |
| `backend/src/common/` | أدوات مشتركة بلا حالة (معلومات الحزمة) | |
| `backend/prisma/` | مخطط Prisma (`schema.prisma`) والترحيلات (`migrations/` عند إنشائها) | مصدر الحقيقة لنموذج البيانات (القسم 06) — CH-0007 |
| `backend/src/prisma/` | وحدة الوصول إلى قاعدة البيانات (`PrismaModule` عام، `PrismaService`) | الوحدات تحقن `PrismaService` وتستخدم `.db`؛ لا `PrismaClient` خاص بأي وحدة |
| `backend/src/generated/` | عميل Prisma المولَّد | متجاهَل في Git؛ لا يُعدَّل يدوياً؛ مستثنى من oxlint وPrettier |
| `frontend/src/` | كود الواجهة | `tsconfig.app.json` يشمل `src` فقط |
| `frontend/src/app/` | تركيب التطبيق: المزوّدات (`App.tsx`) والموجّه (`router.tsx`) | CH-0005 |
| `frontend/src/api/` | عميل HTTP وتعريفات الاستدعاءات والخطافات المرتبطة بالخادم | يطابق عقود القسم 10؛ المسارات تتضمن البادئة `/api` (KI-021) — CH-0006 |
| `frontend/src/auth/` | المصادقة التجريبية، الأدوار، حارسا المسارات | تُستبدل بعميل MOD-01 الحقيقي |
| `frontend/src/components/` | مكوّنات مشتركة صغيرة (رأس صفحة، وسم حالة، مبدّلا اللغة والدور) | |
| `frontend/src/i18n/` | تهيئة i18next، القواميس، أدوات اللغة | إضافة لغة = قاموس جديد + إدخال في `SUPPORTED_LANGUAGES` + ترجمة antd |
| `frontend/src/layout/` | التخطيط العام وتعريف التنقل (`NAV_ITEMS`) | **مصدر الحقيقة** لمسارات الشاشات وأدوارها |
| `frontend/src/mock/` | بيانات تجريبية محلية | **تُحذف** تدريجياً عند ربط كل وحدة بالخادم (ADR-012) |
| `frontend/src/pages/` | شاشة لكل وحدة منتج + 404/403 | ملف واحد لكل شاشة بتصدير مُسمّى |
| `frontend/public/` | أصول ثابتة تُنسخ كما هي | |
| `docs/` | التوثيق المعتمد | ملف واحد حالياً |
| `.claude/` | أدوات Claude Code الخاصة بالمشروع | لا تحتوي على أي كود تطبيق |
| `docker/` | ملفات دعم حاويات التطوير: `postgres/initdb/10-roles.sh` يُركَّب في `/docker-entrypoint-initdb.d` لإنشاء دوري القاعدة (CH-0008) | لا كود تطبيق؛ يعمل آلياً في أول تشغيل مجلد فارغ ويُعاد تشغيله يدوياً لمجلد قائم |

### 4.3 نقاط الدخول (Entry points)

| التطبيق | الملف | ما يفعله |
|---|---|---|
| Backend | `backend/src/main.ts` | `NestFactory.create<NestExpressApplication>(AppModule)` → `configureApp(app)` (`app.setup.ts`) → `app.listen(PORT)` ثم تسجيل عنواني API وSwagger. `await` على المستوى الأعلى (ESM). المنفذ يأتي من `ConfigService` بعد التحقق، لا من `process.env` مباشرة (CH-0006) |
| Frontend | `frontend/index.html` → `frontend/src/main.tsx` | يحمّل `./i18n` (تهيئة i18next وضبط `lang`/`dir` على `<html>`) ثم يُنشئ جذر React داخل `<div id="root">` ويصيّر `<App />` من `src/app/App.tsx` داخل `StrictMode` |

### 4.4 ملفات الإعداد ودلالاتها

| الملف | أهم الإعدادات الفعلية |
|---|---|
| `backend/tsconfig.json` | `module: nodenext`, `target: ES2023`, `strict: true`, `strictPropertyInitialization: false`, `emitDecoratorMetadata`, `experimentalDecorators`, `types: ["vitest/globals", "node"]`, `outDir: ./dist`, `incremental: true` |
| `backend/tsconfig.build.json` | يرث السابق، `rootDir: ./src`، يستبعد `test`, `dist`, `**/*spec.ts` |
| `backend/nest-cli.json` | `collection: @nestjs/schematics`, `sourceRoot: src`, `deleteOutDir: true` |
| `backend/vitest.config.ts` | `globals: true`, `include: ['**/*.spec.ts']`, إضافة `vite-tsconfig-paths` |
| `backend/vitest.config.e2e.ts` | نفس السابق مع `include: ['**/*.e2e-spec.ts']` |
| `backend/oxlint.json` | `no-explicit-any: off`, `no-floating-promises: warn`, `env.node: true`؛ `ignorePatterns: ["src/generated/**"]` (CH-0007) |
| `compose.yaml` (جذري) | اسم المشروع `articode-academy`؛ خدمة `postgres` (`postgres:18`, `restart: unless-stopped`)؛ متغيرات من `.env` الجذري (`POSTGRES_USER`/`POSTGRES_PASSWORD` إلزاميان، `POSTGRES_DB` افتراضياً `articode_academy`، `POSTGRES_PORT` افتراضياً `5432`)؛ النشر `127.0.0.1:${POSTGRES_PORT}:5432`؛ المجلد `postgres_data:/var/lib/postgresql`؛ فحص صحي `pg_isready` كل 10 ثوانٍ (CH-0007)؛ منذ CH-0008: `DB_MIGRATOR_USER`/`DB_APP_USER` (افتراضياً `articode_migrator`/`articode_app`) و`DB_MIGRATOR_PASSWORD`/`DB_APP_PASSWORD` إلزاميان، وتركيب `./docker/postgres/initdb` على `/docker-entrypoint-initdb.d` للقراءة فقط |
| `backend/prisma.config.ts` | يحمّل `backend/.env` ثم `../.env` الجذري بـ dotenv (الأول يغلب، `quiet`)؛ `schema: prisma/schema.prisma`؛ `migrations.path: prisma/migrations`؛ `datasource.url` = `MIGRATION_DATABASE_URL` أو المشتق من `DB_MIGRATOR_*` (عبر `src/config/database-url.ts`) أو `DATABASE_URL` كخيار أخير (CH-0007، CH-0008) |
| `backend/prisma/schema.prisma` | `generator client { provider = "prisma-client", output = "../src/generated/prisma", moduleFormat = "esm", importFileExtension = "js" }`؛ `datasource db { provider = "postgresql" }`؛ بلا نماذج (CH-0007) |
| `backend/.gitignore` | `node_modules`, `.env`, `/src/generated/prisma` (أنشأه `prisma init` — CH-0007) |
| `backend/.prettierignore` | `src/generated/`, `dist/` (CH-0007) |
| `backend/.prettierrc` | `singleQuote: true`, `trailingComma: all` |
| `frontend/vite.config.ts` | `plugins: [react()]` + `server.proxy['/api']` → `API_PROXY_TARGET` (افتراضياً `http://localhost:3000`) مع `changeOrigin`؛ يقرأ `.env*` عبر `loadEnv(mode, cwd, '')` (CH-0006) |
| `backend/.env.example` / `frontend/.env.example` | قوالب متغيرات البيئة بالأسماء والافتراضيات فقط (CH-0006)؛ تُنسخ إلى `backend/.env` و`frontend/.env.local` المتجاهَلين في Git؛ منذ CH-0008 لا يحمل `backend/.env.example` قيمة `DATABASE_URL` (مثال تجاوز معلّق فقط) لأن القالب الجذري `.env.example` هو مصدر إعدادات القاعدة لكل القرّاء |
| `frontend/tsconfig.app.json` | `target: es2023`, `moduleResolution: bundler`, `jsx: react-jsx`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals/Parameters`, `noEmit`. **لا يُعلن `strict`** لكن تم التحقق (2026-10-28) أن TypeScript 7.0.2 يطبّق الفحوص الصارمة افتراضياً (`noImplicitAny`, `strictNullChecks` فعّالان) |
| `frontend/tsconfig.node.json` | إعدادات `vite.config.ts` فقط |
| `frontend/.oxlintrc.json` | plugins: `react`, `typescript`, `oxc`؛ `react/rules-of-hooks: error`؛ `react/only-export-components: warn` |
| `frontend/.gitignore` | يتجاهل `node_modules`, `dist`, `*.local`, ملفات المحرّرات (أصبح مغطّى بالجذري، وأُبقي كما ولّده القالب) |
| `.gitignore` (جذري) | `node_modules/`, `dist/`, `dist-ssr/`, `coverage/`, `*.tsbuildinfo`, `.env` و`.env.*` (مع استثناء `.env.example`)، سجلات، `.claude/settings.local.json`، ملفات المحرّرات ونظام التشغيل (CH-0004) |
| `.gitattributes` | `* text=auto eol=lf` لتطبيع نهايات الأسطر، ووسم `png/jpg/gif/ico/woff/woff2` كثنائية (CH-0004) |

### 4.5 الاصطلاحات التطويرية المعتمدة (مستنتجة من الإعدادات الفعلية)

1. **الخادم ESM:** الاستيرادات النسبية تنتهي بـ `.js`.
2. **التنسيق في الخادم:** Prettier مع علامات اقتباس مفردة وفواصل لاحقة. تشغيل: `npm run format`.
3. **الواجهة (اصطلاح فعلي منذ CH-0005، غير مفروض بأداة — KI-004):** بلا فواصل منقوطة، اقتباس مفرد، مسافتان. مكوّن واحد لكل ملف بتصدير مُسمّى (`export function UsersPage`)، والمكوّن الجذري `App` وحده تصدير افتراضي. الخطافات والسياقات والثوابت في ملفات `.ts` منفصلة عن ملفات المكوّنات (لإرضاء `react/only-export-components`). `import type` في سطر مستقل. استيرادات نسبية بلا لاحقة. لا `enum` ولا خصائص مُنشئ (`erasableSyntaxOnly`). كل نص ظاهر عبر `t()`، والبيانات ثنائية اللغة بنوع `LocalizedText`.
4. **الفحص الثابت:** oxlint في كلا التطبيقين (`npm run lint`).
5. **أسماء ملفات NestJS:** `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.spec.ts`, `<name>.e2e-spec.ts` (اصطلاح الإطار ومتّبع في الهيكل الحالي).
6. **التوثيق:** كل تغيير في الكود يستلزم تحديث هذه الوثيقة وفق `CLAUDE.md`.
7. **الخادم (منذ CH-0006):** مجلد لكل وحدة `src/<feature>/` بملفات `<feature>.module.ts`, `.controller.ts`, `.service.ts`, `.dto.ts`, `.spec.ts`؛ كل متغير بيئة يُعلن في `config/env.schema.ts` ويُقرأ عبر `ConfigService<Env, true>` بـ `{ infer: true }` (لا `process.env` مباشرة)؛ كل DTO يحمل `@ApiProperty`؛ الإعداد العام للتطبيق في `app.setup.ts` ويستخدمه `main.ts` والاختبارات الشاملة معاً.
8. **قاعدة البيانات (منذ CH-0007):** `prisma/schema.prisma` مصدر الحقيقة لنموذج البيانات؛ العميل يُولَّد ولا يُلتزم به (`postinstall` و`build` يشغّلان `prisma generate`)؛ الترحيلات تُولَّد بـ `prisma migrate dev`، تُراجع، وتُلتزم في `prisma/migrations/`؛ **لا** `prisma db push` ولا مزامنة تلقائية في أي بيئة مشتركة؛ الوحدات تحقن `PrismaService` ولا تُنشئ `PrismaClient` خاصاً بها. الخادم يتصل بدور التطبيق (`DB_APP_*`، DML فقط) وأوامر Prisma بدور الترحيلات (`DB_MIGRATOR_*`، مالك القاعدة)؛ **لا يُستخدم superuser** في أي منهما (ADR-019).
9. **إعدادات البيئة (منذ CH-0008):** إعدادات القاعدة تُكتب مرة واحدة في `.env` الجذري (الذي يقرؤه compose والخادم وPrisma CLI)؛ `backend/.env` اختياري للتجاوزات فقط ولا يحمل بيانات اعتماد؛ القوالب `.env.example` بقيم وهمية فقط، وكل متغير جديد يُعلن في `env.schema.ts` و11.3.

---

## 05. SYSTEM ARCHITECTURE — معمارية النظام

### 5.1 المعمارية الحالية الفعلية (IMPLEMENTED)

منذ CH-0006 أصبح المشروع **تطبيقين متصلين عبر HTTP**، ومنذ CH-0007 يقف الخادم على **قاعدة PostgreSQL محلية في Docker** عبر Prisma: الواجهة (React) تستدعي الخادم (NestJS) عبر proxy خادم Vite في التطوير، مع CORS مفعّل للاستدعاء المباشر. الاستدعاءان الحقيقيان حتى الآن: `GET /api/health` و`GET /api/health/ready` (الأخير ينفّذ `SELECT 1` على PostgreSQL)؛ شاشات الوحدات ما زالت على بيانات محلية:

```mermaid
flowchart LR
    subgraph Dev["Developer machine (Windows 11, Node 22)"]
        subgraph FE["frontend/ (Vite dev server, default :5173)"]
            IDX["index.html\nlang=ar dir=rtl"] --> MAIN["src/main.tsx\n(i18n init)"] --> APP["src/app/App.tsx\nantd ConfigProvider + AuthProvider"]
            APP --> RTR["src/app/router.tsx\nreact-router 7"]
            RTR --> LOGIN["pages/LoginPage\n(mock login)"]
            RTR --> LAYOUT["RequireAuth → layout/AppLayout\n+ 13 module pages (RequireRole)"]
            LAYOUT --> MOCK[("src/mock/data.ts\nlocal demo data")]
            LAYOUT --> HC["components/ServerStatusCard\napi/useHealth → api/client"]
            PROXY["Vite proxy\n/api → API_PROXY_TARGET"]
            HC -->|"GET /api/health"| PROXY
        end
        subgraph BE["backend/ (NestJS 12 + Express, PORT from env, default 3000)"]
            BOOT["src/main.ts\nNestFactory.create()"] --> SETUP["app.setup.ts configureApp()\nprefix /api · CORS · ValidationPipe · Swagger"]
            SETUP --> MOD["AppModule\nConfigModule.forRoot(validate: zod)"]
            MOD --> HM["HealthModule"]
            HM --> HCTRL["HealthController\nGET /api/health"]
            HCTRL --> HSVC["HealthService\ncheck() · readiness()"]
            HSVC --> PRISMA["PrismaService\nPrismaClient + @prisma/adapter-pg"]
            SETUP --> SW["Swagger UI\n/api/docs · /api/docs-json"]
        end
        subgraph DOCKER["Docker Desktop (WSL 2) — compose.yaml"]
            PG[("postgres:18\nvolume postgres_data\n127.0.0.1:5432 only")]
        end
        PRISMA -->|"SELECT 1 (readiness); future queries"| PG
    end
    Browser(("Browser")) --> IDX
    PROXY -->|"HTTP"| HCTRL
    Client(("HTTP client / Swagger")) -->|"GET /api/health"| HCTRL
```

**تدفق الطلب الحقيقي الوحيد (CH-0006):**

```mermaid
sequenceDiagram
    participant B as Browser (DashboardPage)
    participant V as Vite dev server (:5173)
    participant E as Express + CORS + global prefix
    participant K as HealthController
    participant S as HealthService
    B->>V: fetch GET /api/health (same origin)
    V->>E: proxy → http://localhost:3000/api/health
    E->>K: route match @Controller('health') @Get()
    K->>S: check()
    S-->>K: { status, service, version, environment, timestamp, uptimeSeconds }
    K-->>E: HealthResponseDto
    E-->>V: 200 OK, application/json (no X-Powered-By)
    V-->>B: 200 OK, JSON → ServerStatusCard "متصل"
```

> تم التحقق فعلياً في CH-0006 عبر curl على الخادم الحي: `GET /api/health` مباشرةً وعبر proxy Vite أعادا `200` وJSON متطابقاً؛ رأس `Access-Control-Allow-Origin` يُعاد للأصل المسموح فقط؛ لا رأس `X-Powered-By` (KI-014 RESOLVED)؛ `GET /` أصبح `404` (HTML افتراضي من Express خارج البادئة)، و`GET /api/<غير موجود>` يُعيد `404` بصيغة JSON من NestJS. (التحقق السابق لـ `GET /` في CH-0003 أصبح تاريخياً.)

**تدفق الجاهزية (CH-0007) — أول عبور لحدّ قاعدة البيانات:**

```mermaid
sequenceDiagram
    participant B as Browser (ServerStatusCard)
    participant K as HealthController
    participant S as HealthService
    participant P as PrismaService
    participant D as PostgreSQL 18 (Docker)
    B->>K: GET /api/health/ready
    K->>S: readiness()
    S->>P: ping()
    P->>D: SELECT 1 (pg pool, timeout 5 s)
    D-->>P: 1 row
    P-->>S: { ok: true, latencyMs }
    S-->>K: { status: "ready", checks: { database: { status: "up", latencyMs } } }
    K-->>B: 200 JSON (503 with "not_ready" when down or not_configured)
```

### 5.2 المعمارية المستهدفة (PLANNED — غير ملزِمة، تصور للتخطيط فقط)

```mermaid
flowchart TB
    subgraph Academy_A["Academy A deployment (PLANNED)"]
        FEA["Web app (React)"] -->|"REST/JSON (+JWT)"| APIA["NestJS API"]
        APIA --> DBA[("PostgreSQL\ndedicated DB")]
    end
    subgraph Academy_B["Academy B deployment (PLANNED)"]
        FEB["Web app (React)"] --> APIB["NestJS API"]
        APIB --> DBB[("PostgreSQL\ndedicated DB")]
    end
    MOB["Mobile apps (PLANNED)"] -.-> APIA
    EXT["External integrations (PLANNED)"] -.-> APIA
```

- نموذج النشر المستقل لكل أكاديمية مأخوذ من موجز المالك (REQ-01, REQ-02).
- آلية إدارة النشرات المتعددة (لوحة Super Admin مركزية؟ أم نشر يدوي لكل أكاديمية؟) — `NOT YET DETERMINED` (ADR-008). **مقترح (PROPOSED):** قاعدة منصة مركزية (6.6.2، D10) ووضعا نشر `single`/`multi` بمزوّد `TenantDb` واحد (6.7.2، D9) — ADR-021.

### 5.3 التواصل بين الواجهة والخادم

| البند | الحالة |
|---|---|
| بروتوكول | REST/JSON عبر HTTP — IMPLEMENTED منذ CH-0006 لنقطة `GET /api/health` (ADR-015) |
| CORS في الخادم | مفعّل من الإعدادات: `enableCors({ origin: CORS_ORIGIN[], credentials: true })` في `backend/src/app.setup.ts` |
| Proxy في Vite | `server.proxy['/api']` → `API_PROXY_TARGET` (افتراضياً `http://localhost:3000`) في `frontend/vite.config.ts` |
| عميل HTTP في الواجهة | `frontend/src/api/client.ts` (`fetch` + `ApiError`)؛ `VITE_API_BASE_URL` فارغ افتراضياً (نفس الأصل → proxy) |
| طبقة بيانات الواجهة | بيانات تجريبية محلية (`frontend/src/mock/data.ts`) لشاشات الوحدات؛ الاستدعاء الحقيقي الوحيد: `frontend/src/api/health.ts` (ADR-012) |
| توثيق OpenAPI/Swagger | `@nestjs/swagger`: UI على `/api/docs` وJSON على `/api/docs-json` عندما `SWAGGER_ENABLED=true` (API-003) |
| الخادم ↔ قاعدة البيانات | Prisma 7 فوق `pg` (`@prisma/adapter-pg`) إلى PostgreSQL 18 في Docker على `127.0.0.1:5432` (CH-0007) بدور `articode_app` محدود الصلاحيات، بينما يتصل Prisma CLI بدور `articode_migrator` (CH-0008، ADR-019)؛ عندما يعمل الخادم داخل Docker Compose يكون المضيف `postgres` (اسم الخدمة) وتُحقن `DATABASE_URL` صراحةً |

### 5.4 علاقات الوحدات

**الخادم (CH-0006):** `AppModule` يستورد `ConfigModule.forRoot({ isGlobal, validate: validateEnv })` و`HealthModule`. `HealthModule` → `HealthController` → `HealthService` الذي يحقن `ConfigService<Env, true>`. `app.setup.ts` (خارج شجرة الوحدات) يقرأ `ConfigService` من حاوية التطبيق ليطبّق البادئة وCORS والتحقق وSwagger؛ يستدعيه `main.ts` والاختبار الشامل. `common/package-info.ts` تستهلكه `HealthService` و`app.setup.ts`. **قاعدة البيانات (CH-0007):** `PrismaModule` عام (`@Global`) يصدّر `PrismaService`؛ `HealthService` يحقنه لفحص الجاهزية؛ أي وحدة بيانات قادمة تحقنه بدل إنشاء عميل خاص.

**الواجهة (CH-0005):** `main.tsx` → `app/App.tsx` → `app/router.tsx` → `layout/AppLayout` → `pages/*`. الملف `layout/navigation.ts` هو مصدر الحقيقة للمسارات والأدوار ويستهلكه `AppLayout` (بناء القائمة) و`auth/RequireAuth` (البوابة `canAccess`) بينما يطابقه `router.tsx` يدوياً. `auth/*` لا يعتمد إلا على `layout/navigation.ts` و`pages/ForbiddenPage`. كل الصفحات تعتمد على `mock/data.ts` و`i18n/useLocalized` و`components/*`.

### 5.5 الأنماط المعمارية

| النمط | الحالة | الدليل |
|---|---|---|
| Modular monolith بوحدات NestJS | IMPLEMENTED (بالحد الأدنى) | `AppModule` |
| Controller → Service (حقن الاعتماديات) | IMPLEMENTED | `AppController` يحقن `AppService` عبر المُنشئ |
| Repository / Data access layer | PARTIALLY_IMPLEMENTED | `PrismaService` (`backend/src/prisma/`) كطبقة وصول وحيدة (CH-0007)؛ لا مستودعات ولا نماذج بعد |
| فصل الحيوية عن الجاهزية (liveness / readiness) | IMPLEMENTED | `GET /api/health` بلا اعتماديات؛ `GET /api/health/ready` يفحص القاعدة ويُعيد 503 عند التعطل (CH-0007، ADR-017) |
| DTO + Validation pipes | PARTIALLY_IMPLEMENTED | `ValidationPipe` عام (`whitelist`, `forbidNonWhitelisted`, `transform`) في `backend/src/app.setup.ts` مع `class-validator`/`class-transformer`؛ **لا يوجد بعد DTO طلب يحمل قواعد تحقق** فسلوكه غير مُختبَر (KI-022) |
| OpenAPI بالديكوريتورات (`@ApiProperty`, `@ApiOperation`) | IMPLEMENTED | `backend/src/health/health.dto.ts`, `health.controller.ts`؛ الوثيقة تُولَّد في `app.setup.ts` |
| Guards / Roles | PLANNED | لا يوجد |
| Configuration module (`@nestjs/config`) | IMPLEMENTED | `ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ENV_FILE_PATHS, validate: validateEnv })` في `app.module.ts`؛ الملفات بالترتيب `backend/.env.local` ← `backend/.env` ← `../.env` الجذري (`config/env-files.ts`)؛ المخطط في `config/env.schema.ts` (zod) يشتق `DATABASE_URL` من `DB_APP_*` عند غيابه — CH-0006، CH-0008 |
| التوجيه في المتصفح (client-side routing) | IMPLEMENTED | `frontend/src/app/router.tsx` (react-router 7، `createBrowserRouter`) |
| i18n + RTL في الواجهة | IMPLEMENTED | `frontend/src/i18n/*`, `frontend/src/app/App.tsx` (`ConfigProvider direction/locale`) |
| بوابة أدوار على مستوى الواجهة (UI gating) | IMPLEMENTED كنموذج — **ليس فرضاً أمنياً** | `frontend/src/auth/RequireAuth.tsx`, `frontend/src/layout/navigation.ts` |
| طبقة بيانات تجريبية (mock-first) | IMPLEMENTED (مؤقت بطبيعته) | `frontend/src/mock/data.ts` (ADR-012) |

### 5.6 الحدود بين المكونات

- الحد الفعلي الأول: الواجهة (متصفح) ↔ الخادم (HTTP/JSON) — **عُبر في CH-0006** عبر `GET /api/health`. عقد الحدّ في القسم 10؛ التحقق على الحدّ عبر `ValidationPipe` عام.
- الحد الثاني: الخادم ↔ قاعدة البيانات (Prisma / pg) — **عُبر في CH-0007** عبر `PrismaService.ping()` (`SELECT 1`)؛ لا استعلامات أعمال بعد.
- الحدود المخطّطة: API ↔ قاعدة بيانات (عبر ORM)، API ↔ خدمات خارجية (دفع، إشعارات، بث).

### 5.7 الاختناقات المحتملة والقيود المؤكدة

| النوع | الوصف | الحالة |
|---|---|---|
| ~~قيد مؤكد~~ | ~~لا يمكن للواجهة استدعاء الخادم من أصل مختلف بسبب غياب CORS/proxy~~ | RESOLVED في CH-0006 (KI-007): proxy في التطوير + CORS بقائمة أصول من `CORS_ORIGIN` |
| ~~قيد مؤكد~~ | ~~لا يوجد تخزين دائم للبيانات~~ | RESOLVED في CH-0007: PostgreSQL 18 بمجلد Docker مسمّى (`postgres_data`). القيد الجديد: Docker Desktop يجب أن يعمل قبل الخادم وإلا أعاد `/api/health/ready` 503 `down` (14.6) |
| اختناق محتمل | نموذج "قاعدة بيانات لكل أكاديمية" يرفع كلفة التشغيل والترحيلات مع تزايد عدد الأكاديميات | RECOMMENDED-ANALYSIS (ADR-008) |
| اختناق محتمل | الدروس المباشرة/المسجلة تحتاج إلى بنية بث وتخزين خارجية | RECOMMENDED-ANALYSIS |

---

## 06. DATABASE DOCUMENTATION — توثيق قاعدة البيانات

### 6.1 الحالة العامة

**توجد قاعدة بيانات للتطوير منذ CH-0007، بلا أي كيان بعد.** تم التحقق (2026-10-29):

- PostgreSQL **18.6** (صورة `postgres:18` الرسمية، Debian) تعمل في Docker Desktop عبر `compose.yaml` الجذري؛ الحاوية `articode-academy-postgres-1`، المجلد المسمّى `articode-academy_postgres_data`، المنفذ منشور على `127.0.0.1:5432` فقط، الفحص الصحي `healthy`.
- Prisma 7.10.1 مثبّت وموصول (`backend/prisma/schema.prisma` بلا نماذج، `backend/src/prisma/`)؛ `prisma migrate status` اتصل بالقاعدة وأكد أنها غير مُدارة بعد (لا جدول `_prisma_migrations`)، وعدد الجداول خارج المخططات النظامية = 0.
- `GET /api/health/ready` ينفّذ `SELECT 1` عبر `PrismaService` ويُعيد `up` مع زمن الرحلة (TEST-005).
- المصادقة من المضيف متحقق منها بـ `pg`: كلمة المرور الصحيحة تتصل، والخاطئة تُرفض (`28P01`).
- **الأدوار (CH-0008، ADR-019):** `articode` (superuser، للإدارة فقط)، `articode_migrator` (مالك القاعدة والمخطط `public`، يشغّل `prisma migrate`، يحمل `CREATEDB` محلياً لأجل القاعدة الظلية لـ `migrate dev` — KI-027)، `articode_app` (`CONNECT` + `USAGE` على `public` + `SELECT/INSERT/UPDATE/DELETE` على الجداول و`USAGE/SELECT` على التسلسلات، مع امتيازات افتراضية لكل ما ينشئه migrator). `CONNECT` مسحوب من `PUBLIC`. تم التحقق (2026-10-29): `has_schema_privilege(app, CREATE) = false`، `CREATE TABLE` بدور app → `permission denied for schema public`، لا `TRUNCATE` للتطبيق، والخادم الحي يظهر في `pg_stat_activity` كـ `articode_app`. القاعدة بقيت على 0 جداول والمجلد لم يُمس.

| البند | القيمة |
|---|---|
| محرك قاعدة البيانات | PostgreSQL 18.6 (`postgres:18`) — IMPLEMENTED للتطوير المحلي (ADR-016)؛ الإنتاج `NOT YET DETERMINED` |
| معمارية الاتصال | `DATABASE_URL` (ENV-08؛ تُشتق من `DB_APP_*` + `POSTGRES_*` + `DB_HOST` عند عدم ضبطها صراحةً — CH-0008) → `PrismaService` → `PrismaClient` + `@prisma/adapter-pg` (مجمّع اتصالات `pg`)؛ مهلة الاتصال والفحص 5 ثوانٍ؛ عميل واحد لكل عملية |
| ORM | Prisma 7.10.1 (ADR-014، ADR-018) |
| الجداول/الكيانات الموجودة | **لا شيء** (المخطط فارغ عمداً حتى تصميم MOD-01/MOD-03) |
| الأعمدة والمفاتيح والعلاقات | **لا شيء** |
| الفهارس والقيود | **لا شيء** |
| الترحيلات | Prisma Migrate؛ **لا ترحيلات بعد**؛ المجلد `backend/prisma/migrations/` يُنشأ مع أول `prisma migrate dev` |
| اسم القاعدة / الأدوار | `POSTGRES_DB` (افتراضياً `articode_academy`) مملوكة لـ `DB_MIGRATOR_USER` (افتراضياً `articode_migrator`) منذ CH-0008؛ التطبيق يتصل بـ `DB_APP_USER` (افتراضياً `articode_app`)؛ `POSTGRES_USER` (افتراضياً `articode`) superuser للإدارة فقط (KI-024 RESOLVED) |
| المصادقة | `scram-sha-256` لكل اتصال من خارج الحاوية (قاعدة `host all all all scram-sha-256`)؛ الاتصالات من داخل الحاوية عبر socket أو loopback موثوقة (`trust`) بإعداد الصورة الافتراضي — لا تمس اتصالات المضيف |
| التخزين | مجلد Docker مسمّى `postgres_data` مُركَّب على `/var/lib/postgresql` (PGDATA = `/var/lib/postgresql/18/docker`)؛ data checksums مفعّلة (افتراضي PostgreSQL 18) |
| عزل البيانات | قاعدة مخصّصة لكل أكاديمية — `PLANNED` (REQ-02، ADR-008)؛ نموذج compose الحالي ينشئ قاعدة واحدة لكل مشروع compose (اسم المشروع يصبح معرّف الأكاديمية مستقبلاً — 14.11) |
| النسخ الاحتياطي والاستعادة | إجراء يدوي موثّق في 14.9؛ لا أتمتة |

### 6.2 مخطط الكيانات (ER Diagram)

**لا يوجد مخطط ER** لأنه لا توجد كيانات. سيُضاف هنا عند إدخال أول نموذج في `schema.prisma` (RULE 7). **يُمنع** إدراج كيانات تخطيطية هنا كما لو كانت موجودة.

### 6.3 قيود المخطط الحالية

لا ينطبق (لا مخطط). قيود البنية: ~~المستخدم الوحيد superuser (KI-024)؛ بيانات الاعتماد مكرّرة في ملفي `.env` (KI-023)~~ — حُلّا في CH-0008 (ADR-019). المتبقي: دور migrator يحمل `CREATEDB` محلياً فقط لأجل القاعدة الظلية لـ `prisma migrate dev` (KI-027)؛ `CONNECT` مسحوب من `PUBLIC` فلا يتصل بالقاعدة سوى الدورين والـ superuser.

### 6.4 إجراءات العمل على قاعدة البيانات (منذ CH-0007)

| الإجراء | الأمر (من `backend/` ما لم يُذكر) | ملاحظات |
|---|---|---|
| تشغيل القاعدة | `docker compose up -d` (من الجذر) | يقرأ `.env` الجذري؛ أول تشغيل ينشئ superuser والقاعدة ثم يشغّل `docker/postgres/initdb/10-roles.sh` لإنشاء دوري migrator وapp (CH-0008) |
| إنشاء/تحديث أدوار القاعدة على مجلد قائم | `docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-roles.sh` (من الجذر) | idempotent: ينشئ الدورين إن غابا ويُعيد تطبيق كلمتَي المرور من `.env` (الطريقة المعتمدة لتدوير كلمة مرور دور) والامتيازات؛ لا يمس البيانات (CH-0008) |
| إيقافها مع الإبقاء على البيانات | `docker compose down` (من الجذر) | `down -v` **يحذف** المجلد والبيانات نهائياً |
| إضافة/تعديل نموذج | تعديل `prisma/schema.prisma` ثم `npm run prisma:migrate -- --name <وصف>` | يتصل بدور migrator (`prisma.config.ts`)؛ يولّد ترحيلاً في `prisma/migrations/` ويطبّقه ويعيد توليد العميل؛ يُراجع ويُلتزم به |
| تطبيق الترحيلات في بيئة غير تطويرية | `npm run prisma:deploy` | لا يولّد ترحيلات؛ آمن للتشغيل المتكرر |
| حالة الترحيلات | `npm run prisma:status` | غير تدميري؛ يخرج بغير صفر ما دامت القاعدة غير مُدارة (الحالة الحالية) |
| إعادة توليد العميل | `npm run prisma:generate` | يعمل تلقائياً في `postinstall` و`build` |
| تصفّح البيانات | `npm run prisma:studio` أو `psql` داخل الحاوية (14.10) | |
| **ممنوع** | `prisma db push` و`prisma migrate reset` على قاعدة فيها بيانات يُعتدّ بها | مزامنة تدميرية (ADR-018) |

### 6.5 توصيات للتنفيذ المستقبلي (RECOMMENDED — غير معتمدة)

1. توحيد اصطلاح التسمية (`snake_case` للجداول والأعمدة عبر `@@map`/`@map`، مفاتيح أساسية UUID أو bigint) — مقترح في ADR-020 (PROPOSED) و6.6.
2. ~~دور تطبيق بصلاحيات محدودة بدل superuser، ودور منفصل للترحيلات (KI-024)~~ — أُنجز في CH-0008 (ADR-019).
3. تضمين `academy_id` أو ما يعادله فقط إذا تغيّر قرار العزل إلى قاعدة مشتركة؛ في نموذج "قاعدة لكل أكاديمية" لا حاجة له على مستوى الصفوف.
4. توثيق كل جدول هنا بجدول: الاسم، الأعمدة، الأنواع، المفاتيح، الفهارس، القيود، العلاقات، النموذج في `schema.prisma`، الترحيل المنشئ.

### 6.6 التصميم المقترح للمخطط الأول — `PROPOSED` (الاتجاه المعماري معتمد مبدئياً وD1/D4/D5 معتمدة بتاريخ 2026-10-29؛ لا نماذج ولا ترحيل بعد)

> **تنبيه (RULE 13):** كل ما في هذا البند **تصميم غير منفّذ**. لا شيء منه موجود في `schema.prisma` أو في القاعدة. **حالة الاعتماد (CH-0009، 2026-10-29):** المالك وافق مبدئياً على الاتجاه المعماري واعتمد القرارات D1 وD4 وD5 بصيغتها أدناه؛ **ثم اعتمد في CH-0012 (2026-10-29)** D2 وD3 وD6 وD7 وD8 (ومن 6.7.11: D11، D12، D13، D20 بشرط، D21، D22) والحزمة الاختيارية في 6.6.5 (ب)؛ D9 وD10 ما زالا `PROPOSED` ولا يمنعان الترحيل الأول. لا يُنشأ أي ترحيل قبل اعتماد التصميم النهائي. عند التنفيذ يُنقل كل جدول إلى 6.2/6.3 بصيغة `IMPLEMENTED` مع الترحيل المنشئ، وتتحول حالة ADR-020 إلى ACCEPTED.

**النطاق:** نواة Stage 2 (Identity & Academy): MOD-02 (هوية الأكاديمية وإعداداتها)، MOD-03 (المستخدمون والأدوار والصلاحيات وربط أولياء الأمور)، MOD-01 (رموز الجلسات والتحقق)، وسجل تدقيق أساسي. الدورات والفصول والجدولة وما بعدها (Stage 3+) **خارج** هذا الترحيل عمداً كي يبقى الترحيل الأول صغيراً وقابلاً للمراجعة.

**المبادئ (تفصيلها وبدائلها في ADR-020):**

| # | المبدأ | التفصيل |
|---|---|---|
| P1 | قاعدة = أكاديمية | وفق REQ-02/ADR-008 **لا عمود `academy_id`** في أي جدول؛ عزل البيانات على مستوى القاعدة. جدول `academy` يحمل صفاً واحداً (هوية النشر) ويُضمَن ذلك بفهرس فريد على ثابت يُضاف في SQL الترحيل |
| P2 | التسمية | نماذج Prisma بـ PascalCase مفرد، جداول وأعمدة `snake_case` جمع عبر `@@map`/`@map` |
| P3 | المفاتيح | `id uuid` مولَّد **داخل القاعدة** بـ `uuidv7()` (PostgreSQL 18، مرتّب زمنياً) — **معتمد (D4)**. تم التحقق 2026-10-29: `uuidv7()` أصلية في PostgreSQL 18.6 (`uuid_extract_version() = 7` مع طابع زمني مضمّن)، وPrisma 7.10.1 يقبل `@id @default(dbgenerated("uuidv7()")) @db.Uuid` ويولّد `"id" UUID NOT NULL DEFAULT uuidv7()` (عبر `prisma migrate diff` على مخطط تجريبي خارج المستودع). البديل عند الحاجة: `@default(uuid(7))` من Prisma (توليد في التطبيق) |
| P4 | الأزمنة | `created_at`/`updated_at` بنوع `timestamptz` في كل جدول؛ `deleted_at` (حذف منطقي) في `users` فقط |
| P5 | النصوص متعددة اللغات | حقول العناوين التي يكتبها المستخدم (اسم الأكاديمية، تسمية الدور المخصّص) بنوع `jsonb` بشكل `{ "ar": "...", "en": "...", "tr": "..." }` — **معتمد (D1)**: `ar` **إلزامية** (اللغة المرجعية)، `en` و`tr` اختياريتان؛ **ترتيب الإرجاع (fallback):** اللغة المطلوبة ← `academy.default_locale` ← `ar` ← أول قيمة متوفرة؛ التحقق بـ zod في طبقة الخدمة (نوع `LocalizedText` مشترك)، وقيد CHECK في SQL الترحيل: `jsonb_typeof(col) = 'object' AND col ? 'ar'`. اللغات المدعومة تعداد `Locale { ar, en, tr }` يُستخدم في `academy.default_locale` و`users.locale`. **أثر على الواجهة (مهمة لاحقة):** `frontend/src/i18n/language.ts` يعرّف `SUPPORTED_LANGUAGES = ['ar','en']` و`LocalizedText = Record<Language,string>` (كل اللغات إلزامية)؛ إضافة `tr` تستلزم قاموس `tr.ts` وترجمة antd `tr_TR` وتحويل النوع إلى `{ ar: string } & Partial<Record<Language,string>>` مع دالة fallback موحّدة |
| P6 | التعدادات | `enum` في Prisma (أنواع PostgreSQL) للمجموعات الصغيرة المستقرة (حالة المستخدم، غرض الرمز)؛ نص للمجموعات القابلة للتوسع (مفاتيح الصلاحيات) |
| P7 | الفهارس | فهرس صريح (`@@index`) على كل مفتاح أجنبي (Prisma لا ينشئه تلقائياً في PostgreSQL) وعلى أعمدة البحث |
| P8 | السلامة المرجعية | قيود FK فعلية في القاعدة (`relationMode` الافتراضي)؛ `onDelete: Restrict` افتراضياً، و`Cascade` فقط للجداول التابعة (رموز، ربط أدوار، ملفات تعريفية) |
| P9 | الأسرار | لا تُخزَّن كلمات المرور ولا الرموز بنصها: `password_hash` (argon2id) و`token_hash` (SHA-256) فقط |
| P10 | الصلاحيات | كل الجداول يملكها `articode_migrator`؛ `articode_app` يحصل على DML تلقائياً بالامتيازات الافتراضية (6.1). تم التحقق 2026-10-29 داخل معاملة مُلغاة: migrator ينفّذ `CREATE TABLE/TYPE/INDEX/FUNCTION/TRIGGER` و`ALTER TABLE` وفهارس جزئية، وapp يحصل على SELECT/INSERT/UPDATE/DELETE و`USAGE` على التعدادات دون `TRUNCATE`/`REFERENCES`/`TRIGGER` |
| P11 | سجل التدقيق — **معتمد (D5)** | `audit_logs` في الترحيل الأول، **إلحاقي فقط** عبر trigger `BEFORE UPDATE OR DELETE` يرفع خطأً (تم التحقق 2026-10-29: دور app يُدرج، ومحاولتا `UPDATE`/`DELETE` رُفضتا بـ `audit_logs is append-only`). **قواعد الأمان وحماية البيانات:** (1) الكتابة من طبقة الخدمة فقط ضمن معاملة الحدث؛ (2) `metadata` بلا أسرار ولا كلمات مرور ولا رموز ولا بيانات شخصية زائدة — معرّفات وقيم قبل/بعد للحقول غير الحساسة فقط؛ (3) `ip_address` و`user_agent` للتحقيق الأمني مع سياسة احتفاظ `NOT YET DETERMINED` (توصية: 365 يوماً ثم أرشفة)؛ (4) القراءة بصلاحية `audit.read` (لمدير الأكاديمية افتراضياً) مع تصدير للمالك؛ (5) `actor_user_id` بـ `SetNull` حتى لا يُفقد السجل عند حذف الفاعل؛ (6) تقسيم شهري (partitioning) عند تجاوز حجم محدد — لاحقاً؛ (7) الحد الأدنى من الأحداث في المرحلة الأولى: الدخول/الخروج/الفشل، تغيّر كلمات المرور، إنشاء/تعديل المستخدمين، تغيّر الأدوار والصلاحيات، تغيّر إعدادات الأكاديمية |

**الجداول المقترحة (12):**

| # | الجدول (نموذج Prisma) | الوحدة | الأعمدة الأساسية | المفاتيح والقيود | ملاحظات |
|---|---|---|---|---|---|
| 1 | `academy` (`Academy`) | MOD-02/14 | `id`, `platform_academy_id? uuid` (فريد — معرّف الأكاديمية في السجل المركزي 6.6.2)، `slug` (فريد)، `name jsonb` (D1)، `logo_url?`, `default_locale` enum `Locale { ar, en, tr }` (افتراضياً `ar`)، `timezone`, `currency`, `contact_email?`, `contact_phone?`, `settings jsonb` (إعدادات MOD-14 الأولية)، `created_at`, `updated_at` | PK `id`؛ فهرس فريد على `(true)` لضمان صف واحد (SQL يدوي)؛ CHECK `name ? 'ar'` | هوية النشر؛ القيم الافتراضية لـ `timezone`/`currency` `NOT YET DETERMINED` (تُحدَّد في البذر)؛ لا FK إلى القاعدة المركزية (قاعدتان مستقلتان) |
| 2 | `users` (`User`) | MOD-03/01 | `id`, `email` (فريد، يُخزَّن بأحرف صغيرة)، `phone?` (فريد، E.164)، `password_hash?`, `full_name`, `display_name?`, `avatar_url?`, `locale` enum `Locale`؛ `status` enum `UserStatus { invited, active, suspended, archived }`، `email_verified_at?`, `last_login_at?`, `created_at`, `updated_at`, `deleted_at?` | PK؛ unique `email`؛ unique `phone` | شخص واحد لكل صف أياً كان نوعه؛ النوع يُستنتج من الأدوار والملفات التعريفية؛ تعارض الفريدية مع الحذف المنطقي في 6.6.1 |
| 3 | `roles` (`Role`) | MOD-03 | `id`, `key` (فريد: `academy_admin`, `teacher`, `student`, `guardian`, `staff` أو مفتاح مخصّص)، `label jsonb`, `description jsonb?`, `is_system` (لا يُحذف)، `created_at`, `updated_at` | PK؛ unique `key` | ROLE-02..ROLE-07؛ Super Admin (ROLE-01) خارج قاعدة الأكاديمية (ADR-008) |
| 4 | `permissions` (`Permission`) | MOD-03 | `key` (PK نصي مثل `users.read`, `courses.manage`)، `module` (مثل `MOD-03`)، `description jsonb?`, `deprecated_at?` | PK `key` | كتالوج يُبذَر من الكود (مصدر الحقيقة) ليُعرض في واجهة الأدوار المخصّصة؛ المفاتيح المهملة تُعلَّم بـ `deprecated_at` ولا تُحذف ما دامت مرتبطة بأدوار (FK Restrict) |
| 5 | `role_permissions` (`RolePermission`) | MOD-03 | `role_id`, `permission_key`, `created_at` | PK مركّب؛ FK إلى 3 (Cascade) و4 (Restrict)؛ فهرس على `permission_key` | M:N |
| 6 | `user_roles` (`UserRole`) | MOD-03 | `user_id`, `role_id`, `assigned_by?` (FK إلى users، `SetNull`)، `assigned_at` | PK مركّب؛ FK إلى 2 و3 (Cascade)؛ فهرس على `role_id` | المستخدم قد يحمل أكثر من دور (معلم + موظف) |
| 7 | `student_profiles` (`StudentProfile`) | MOD-03 | `user_id` (PK/FK)، `student_number?` (فريد)، `date_of_birth?`, `enrolled_at?`, `notes?` | PK = FK إلى 2 (Cascade)؛ unique `student_number` | حقول الهوية الحساسة (رقم وطني…) مؤجّلة إلى قرار صريح |
| 8 | `teacher_profiles` (`TeacherProfile`) | MOD-03 | `user_id` (PK/FK)، `title?`, `specialization?`, `bio jsonb?`, `hired_at?` | PK = FK إلى 2 (Cascade) | |
| 9 | `guardian_students` (`GuardianStudent`) | MOD-03 | `guardian_user_id`, `student_user_id`, `relationship` enum `GuardianRelationship { father, mother, sibling, legal_guardian, other }`، `is_primary`, `created_at` | PK مركّب؛ FK إلى 2 مرتين (Cascade)؛ فهرس على `student_user_id`؛ قيد `guardian_user_id <> student_user_id` (SQL يدوي) | M:N بين أولياء الأمور والطلاب (ROLE-05) |
| 10 | `refresh_tokens` (`RefreshToken`) | MOD-01 | `id`, `user_id`, `token_hash` (فريد)، `expires_at`, `revoked_at?`, `replaced_by_id?`, `user_agent?`, `ip_address?`, `created_at` | PK؛ FK إلى 2 (Cascade)؛ unique `token_hash`؛ فهرس على `user_id` | تدوير الرموز وكشف إعادة الاستخدام؛ لا يُخزَّن الرمز نفسه |
| 11 | `verification_tokens` (`VerificationToken`) | MOD-01 | `id`, `user_id`, `purpose` enum `TokenPurpose { invitation, email_verification, password_reset }`، `token_hash` (فريد)، `metadata jsonb?` (مثل الأدوار المطلوبة في الدعوة)، `expires_at`, `consumed_at?`, `created_at` | PK؛ FK إلى 2 (Cascade)؛ unique `token_hash`؛ فهرس على `(user_id, purpose)` | دعوة المستخدمين الجدد، تأكيد البريد، استعادة كلمة المرور |
| 12 | `audit_logs` (`AuditLog`) — **معتمد (D5)** | عرضي (12.2) | `id`, `actor_user_id?` (FK، `SetNull`)، `action` (مثل `auth.login.succeeded`, `roles.permissions.changed`)، `entity_type?`, `entity_id? text` (نصي ليقبل مفاتيح غير UUID)، `metadata jsonb?`, `ip_address?`, `user_agent?`, `created_at` | PK؛ فهارس على `(entity_type, entity_id)` و`actor_user_id` و`created_at` | إلحاقي فقط (trigger متحقق منه)؛ قواعد الحماية في P11؛ يبدأ بأحداث الدخول والصلاحيات |

**مخطط العلاقات المقترح (PROPOSED — ليس ER الحالة الراهنة):**

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : has
    ROLES ||--o{ USER_ROLES : grants
    ROLES ||--o{ ROLE_PERMISSIONS : includes
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "listed in"
    USERS ||--o| STUDENT_PROFILES : "is student"
    USERS ||--o| TEACHER_PROFILES : "is teacher"
    USERS ||--o{ GUARDIAN_STUDENTS : "as guardian"
    USERS ||--o{ GUARDIAN_STUDENTS : "as student"
    USERS ||--o{ REFRESH_TOKENS : owns
    USERS ||--o{ VERIFICATION_TOKENS : receives
    USERS o|--o{ AUDIT_LOGS : "acts in"
    ACADEMY {
        uuid id PK
        text slug UK
        jsonb name
        text default_locale
        text timezone
        text currency
        jsonb settings
    }
    USERS {
        uuid id PK
        text email UK
        text phone UK
        text password_hash
        text full_name
        text locale
        UserStatus status
        timestamptz deleted_at
    }
    ROLES {
        uuid id PK
        text key UK
        jsonb label
        boolean is_system
    }
    PERMISSIONS {
        text key PK
        text module
    }
    ROLE_PERMISSIONS {
        uuid role_id FK
        text permission_key FK
    }
    USER_ROLES {
        uuid user_id FK
        uuid role_id FK
        uuid assigned_by FK
    }
    STUDENT_PROFILES {
        uuid user_id PK
        text student_number UK
        date date_of_birth
    }
    TEACHER_PROFILES {
        uuid user_id PK
        text specialization
    }
    GUARDIAN_STUDENTS {
        uuid guardian_user_id FK
        uuid student_user_id FK
        GuardianRelationship relationship
        boolean is_primary
    }
    REFRESH_TOKENS {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz expires_at
        timestamptz revoked_at
    }
    VERIFICATION_TOKENS {
        uuid id PK
        uuid user_id FK
        TokenPurpose purpose
        text token_hash UK
        timestamptz expires_at
    }
    AUDIT_LOGS {
        uuid id PK
        uuid actor_user_id FK
        text action
        text entity_type
        text entity_id
        jsonb metadata
    }
```

جدول `academy` بلا علاقة FK مع البقية عمداً (P1): القاعدة كلها تخصّه.

**القرارات (حالتها بعد مراجعة المالك في CH-0009، 2026-10-29):**

| # | القرار | التوصية / الصيغة | الحالة | الأسباب | الأثر على مستقبل النظام |
|---|---|---|---|---|---|
| D1 | تمثيل النصوص متعددة اللغات | `jsonb` بشكل `{ ar, en?, tr? }`؛ `ar` إلزامية؛ fallback: المطلوبة ← `default_locale` ← `ar` ← أول متوفرة (P5) | **معتمد** | يطابق `LocalizedText` في الواجهة؛ إضافة لغة لا تحتاج ترحيلاً؛ CHECK يضمن وجود `ar` | إضافة `tr` إلى الواجهة مهمة مستقلة (قاموس + antd + نوع اختياري)؛ الفرز/البحث داخل `jsonb` أثقل من الأعمدة (فهرس GIN أو عمود مولَّد عند الحاجة) |
| D2 | غياب `academy_id` نهائياً (P1) | نعم | **معتمد** (CH-0012) | قاعدة لكل أكاديمية (REQ-02، ADR-008) | يمنع بنيوياً أي استعلام عابر للأكاديميات؛ التحول إلى قاعدة مشتركة لاحقاً = ترحيل واسع لكل جدول |
| D3 | إعدادات الأكاديمية | `settings jsonb` + تحقق zod الآن | **معتمد** (CH-0012) | أبسط؛ لا جدول قبل الحاجة | عند الحاجة إلى تاريخ أو صلاحيات لكل مفتاح يُستخرج جدول `settings` بترحيل صغير |
| D4 | المفتاح الأساسي | `uuid` مولَّد **داخل PostgreSQL 18** بـ `uuidv7()` (P3) | **معتمد** (التوافق مع Prisma 7 متحقق منه) | مرتّب زمنياً (محلّية فهرس أفضل من v4)، غير قابل للتخمين، يُولَّد في القاعدة فيعمل من أي عميل أو سكربت | يربط المنصة بـ PostgreSQL ≥ 18؛ البديل `@default(uuid(7))` في Prisma إن لزم؛ المعرّفات تكشف تقريب وقت الإنشاء (مقبول) |
| D5 | `audit_logs` في الترحيل الأول | نعم، إلحاقي بـ trigger، مع قواعد الحماية في P11 | **معتمد** (الـ trigger متحقق منه) | أحداث الدخول والصلاحيات من اليوم الأول؛ متطلب 12.2 | نمو مستمر → سياسة احتفاظ وتقسيم شهري لاحقاً؛ صلاحية `audit.read` ضمن كتالوج الصلاحيات |
| D6 | اسم المستخدم | `full_name` + `display_name?` (+ `full_name_latin?` — D12) | **معتمد** (CH-0012) | الأسماء العربية مركّبة؛ الشهادات تحتاج الاسم كاملاً | لا فرز بـ "الاسم الأخير"؛ إضافة حقول اسمية لاحقاً ممكنة بلا كسر |
| D7 | الحذف المنطقي | `deleted_at` في `users` فقط؛ البقية حذف فعلي بـ `Restrict` | **معتمد** (CH-0012) | سجلات المستخدمين تُشار إليها تاريخياً (درجات، مدفوعات) | تعارض `email` الفريد مع إعادة التسجيل بعد الحذف (6.6.1، البند 1) |
| D8 | الصلاحيات | جدول `permissions` مبذور من الكود | **معتمد** (CH-0012) | سلامة مرجعية + واجهة الأدوار المخصّصة | البذر idempotent؛ المفاتيح المهملة تُعلَّم بـ `deprecated_at` |
| D9 | طوبولوجيا النشر (جديد) | (أ) حزمة مستقلة لكل أكاديمية (`api` + `web` + `db`) توفّرها المنصة المركزية — الافتراضي وفق REQ-01؛ (ب) API مشترك يوجّه حسب النطاق إلى قاعدة الأكاديمية (`PrismaClient` لكل مستأجر) | PROPOSED (توصية: أ الآن، مع إبقاء ب ممكناً بعزل الوصول للبيانات خلف `PrismaService`) | REQ-01 صريح؛ (أ) أبسط أمنياً وأسهل عزلاً ونسخاً | (أ) كلفة تشغيل تنمو خطّياً مع عدد الأكاديميات؛ (ب) يحتاج مجمّع اتصالات مُداراً وحدود موارد لكل مستأجر |
| D10 | القاعدة المركزية (جديد) | قاعدة PostgreSQL مستقلة `articode_platform` بمخطط Prisma وترحيلات مستقلة (6.6.2) | PROPOSED | تطلبها لوحة Super Admin والاشتراكات والدومينات؛ تفصل بيانات المنصة عن بيانات التعليم | لا FK عابرة بين القواعد؛ المعرّف المشترك `platform_academy_id`؛ أدوار وترحيلات مستقلة (`platform_app`/`platform_migrator`) |

#### 6.6.1 مراجعة سلامة النماذج (2026-10-29 — نتائج المراجعة، PROPOSED)

| # | النموذج | الملاحظة | المعالجة المقترحة |
|---|---|---|---|
| 1 | `users` | `@unique` على `email` يمنع إعادة تسجيل بريد لمستخدم محذوف منطقياً | **التوصية:** إبقاء `@unique` (أصلي في Prisma، لا انجراف) واعتماد مسار "استعادة الحساب" بدل إعادة التسجيل؛ البديل فهرس فريد جزئي `WHERE deleted_at IS NULL` بـ SQL يدوي |
| 2 | `users` ↔ الأدوار ↔ الملفات التعريفية | لا يوجد قيد قاعدة بيانات يضمن أن حامل دور `student` يملك `student_profiles` (والعكس) | تُنشأ الملفات التعريفية في نفس معاملة تعيين الدور في طبقة الخدمة؛ فحص اتساق دوري (تقرير) بدل trigger معقّد |
| 3 | `guardian_students` | `is_primary` قد يتكرر لطالب واحد | فهرس فريد جزئي `(student_user_id) WHERE is_primary` + قيد `guardian_user_id <> student_user_id` (SQL يدوي) |
| 4 | `roles` / `permissions` / `role_permissions` | البنية سليمة (M:N بـ PK مركّب، `is_system` يحمي الأدوار المبذورة)؛ حذف صلاحية مرتبطة ممنوع بـ Restrict | `deprecated_at` بدل الحذف؛ البذر يزامن الكتالوج من الكود ويُعلّم المهمل |
| 5 | `user_roles` | `assigned_by` إلى `users` بـ `SetNull` ✓؛ `role_id` مفهرس ✓ | — |
| 6 | `refresh_tokens` | `replaced_by_id` مرجع ذاتي بـ `SetNull`؛ كشف إعادة الاستخدام يبطل سلسلة الرموز كاملةً | فهرس `(user_id, expires_at)` لمهمة التنظيف؛ TTL للمهمة الدورية |
| 7 | `verification_tokens` | الدعوة تحتاج معرفة الأدوار المستهدفة | `metadata jsonb?` (أُضيف أعلاه)؛ تنظيف دوري للمستهلَك والمنتهي |
| 8 | `audit_logs` | `entity_id` يجب أن يقبل مفاتيح غير UUID (مثل `permissions.key`) | نوع `text` (أُضيف أعلاه)؛ الـ trigger يمنع التعديل حتى من دور app (متحقق) |
| 9 | كل الجداول | كل FK مفهرس (صراحةً أو كبادئة PK) ✓؛ `Cascade` محصور بالتابعين ✓ | — |
| 10 | كائنات خارج قدرة Prisma | الفهرس الفريد لصف `academy`، قيود CHECK، الفهارس الجزئية، الدالة والـ trigger | تُكتب في ملف الترحيل بعد `--create-only`؛ Prisma يتجاهل هذه الكائنات في الفروق فلا يُسقطها لاحقاً — **يُتحقق منه عملياً عند الترحيل الثاني** (`UNVERIFIED` حتى ذلك) |

#### 6.6.2 القاعدة المركزية (control plane) — `PROPOSED` (D10)

قاعدة PostgreSQL مستقلة (اسم مقترح `articode_platform`) تديرها المنصة لا الأكاديميات؛ **لا علاقات FK بينها وبين قواعد الأكاديميات**، والرابط الوحيد هو `academies.id` هنا = `academy.platform_academy_id` في قاعدة كل أكاديمية. مخطط Prisma وترحيلات وعميل مولَّد مستقلة (6.6.3)، وأدوار مستقلة بنفس نمط ADR-019 (`platform_migrator` مالك، `platform_app` بـ DML).

| # | الجدول | الأعمدة الأساسية | المفاتيح والقيود | ملاحظات |
|---|---|---|---|---|
| 1 | `academies` | `id`, `slug` (فريد)، `name jsonb`, `status` enum `AcademyStatus { provisioning, active, suspended, archived }`، `db_host`, `db_port`, `db_name`, `db_secret_ref` (مرجع في مخزن الأسرار — **لا كلمة مرور في القاعدة**)، `api_base_url?`, `schema_version?` (اسم آخر ترحيل مطبَّق)، `last_migrated_at?`, `created_at`, `updated_at` | PK؛ unique `slug` | سجل الأكاديميات ومكان قاعدتها |
| 2 | `plans` | `id`, `key` (فريد)، `name jsonb`, `limits jsonb` (طلاب، تخزين، …)، `is_active`, `created_at`, `updated_at` | PK؛ unique `key` | الأسعار والعملات `NOT YET DETERMINED` |
| 3 | `subscriptions` | `id`, `academy_id`, `plan_id`, `status` enum `SubscriptionStatus { trial, active, past_due, canceled, expired }`، `starts_at`, `ends_at?`, `trial_ends_at?`, `created_at`, `updated_at` | PK؛ FK إلى 1 (Cascade) و2 (Restrict)؛ فهرس `(academy_id, status)` | اشتراك نشط واحد لكل أكاديمية (فهرس جزئي) |
| 4 | `domains` | `id`, `academy_id`, `hostname` (فريد، أحرف صغيرة)، `kind` enum `DomainKind { platform_subdomain, custom }`، `is_primary`, `verification_token_hash?`, `verified_at?`, `tls_status?`, `created_at` | PK؛ FK إلى 1 (Cascade)؛ unique `hostname`؛ فهرس جزئي `(academy_id) WHERE is_primary` | التوجيه حسب النطاق في D9 (ب) أو إعداد الوكيل العكسي في D9 (أ) |
| 5 | `platform_users` | `id`, `email` (فريد)، `password_hash`, `full_name`, `role` enum `PlatformRole { super_admin, support }`، `status`, `last_login_at?`, `created_at`, `updated_at` | PK؛ unique `email` | ROLE-01 (Super Admin) يعيش هنا لا في قاعدة الأكاديمية؛ MFA لاحقاً |
| 6 | `academy_jobs` | `id`, `academy_id`, `kind` enum `JobKind { provision, migrate, backup, suspend, restore }`، `status` enum `JobStatus { pending, running, succeeded, failed }`، `payload jsonb?`, `log text?`, `triggered_by?` (FK إلى 5)، `started_at?`, `finished_at?`, `created_at` | PK؛ FK إلى 1 (Cascade)؛ فهرس `(academy_id, kind, created_at)` | سجل التوفير والترحيل والنسخ لكل أكاديمية (6.6.3) |
| 7 | `platform_audit_logs` | كما `audit_logs` في قاعدة الأكاديمية مع `actor_platform_user_id?` | إلحاقي بـ trigger | أحداث إدارة المنصة |

**الصيغة الموسّعة (PROPOSED — مقتبسة من مسودة جلسة Claude الموازية `articodeacademy-2e` بتاريخ 2026-10-29 ومدمجة هنا لتجنّب التكرار؛ تُحسم مع D10):**

| # | الجدول | الغرض | الفرق عن الصيغة الأساسية أعلاه |
|---|---|---|---|
| 8 | `academy_databases` | فصل بيانات الاتصال بقاعدة كل أكاديمية عن سجلها: `host`, `port`, `database_name`, `app_role`, `migrator_role`, `app_secret_enc bytea`, `migrator_secret_enc bytea`, `key_version`, `ssl_mode`, `pool_max`, `status` enum `DatabaseStatus { pending, migrating, ready, failed, offline, decommissioned }`، `schema_version`, `schema_checked_at`, `last_error` | بديل عن أعمدة `db_*` و`schema_version` في `academies` (1:1 الآن، 1:n عند إضافة نسخ قراءة)؛ **الأسرار مشفّرة في التطبيق (AES-256-GCM بمفتاح من البيئة مع رقم إصدار)** بدل مرجع إلى مخزن أسرار خارجي — القرار بين الخيارين `NOT YET DETERMINED` |
| 9 | `tenant_migration_runs` | مرآة `_prisma_migrations` لكل أكاديمية: `academy_id`, `migration_name`, `status`, `applied_at`, `duration_ms`, `job_id?`, `error?`؛ `UNIQUE(academy_id, migration_name)` | سجل تفصيلي لكل ترحيل بدل الاعتماد على `schema_version` وحده؛ يغذّي لوحة حالة الأسطول في 6.6.3 |
| 10 | `backup_records` | سجل النسخ الاحتياطية: `kind` enum `BackupKind { logical, physical, pitr_base }`، `storage_url`, `size_bytes`, `checksum`, `status`, `retention_until`, `restore_tested_at?` | يُنفّذ توصية 14.11 (نسخ مجدول مع اختبار استعادة) بسجل قابل للتدقيق |
| 11 | `support_access_grants` | وصول Super Admin مؤقت ومعلَّل إلى أكاديمية: `platform_user_id`, `granted_by`, `reason`, `scope jsonb`, `expires_at`, `revoked_at?` | يحكم وصول الدعم الفني ويُسجَّل في سجلَي التدقيق (المنصة والأكاديمية) |
| 12 | `platform_refresh_tokens` / `platform_verification_tokens` | جلسات ودعوات Super Admin بنفس شكل جدولَي الأكاديمية | فصل كامل لهوية المنصة عن هويات الأكاديميات |
| 13 | `platform_settings` | `key` PK، `value jsonb`, `updated_at` | إعدادات المنصة العامة |
| — | توسعة `academy_jobs.kind` | `{ create_database, migrate, seed, create_admin, backup, restore, suspend, resume, decommission }` مع `attempts` و`result jsonb` | طابور مهام أدقّ من التعداد الأساسي |

مخطط العلاقات أدناه يغطي الصيغة الأساسية (الجداول 1–7)؛ الصيغة الموسّعة ترتبط كلها بـ `academies` (1:1 لـ `academy_databases`، و1:n للبقية) وبـ `platform_users` للمهام والمنح.

```mermaid
erDiagram
    ACADEMIES ||--o{ SUBSCRIPTIONS : has
    PLANS ||--o{ SUBSCRIPTIONS : "priced by"
    ACADEMIES ||--o{ DOMAINS : "served at"
    ACADEMIES ||--o{ ACADEMY_JOBS : "operated by"
    PLATFORM_USERS o|--o{ ACADEMY_JOBS : triggers
    PLATFORM_USERS o|--o{ PLATFORM_AUDIT_LOGS : "acts in"
    ACADEMIES {
        uuid id PK
        text slug UK
        jsonb name
        AcademyStatus status
        text db_host
        text db_name
        text db_secret_ref
        text schema_version
    }
    PLANS {
        uuid id PK
        text key UK
        jsonb limits
    }
    SUBSCRIPTIONS {
        uuid id PK
        uuid academy_id FK
        uuid plan_id FK
        SubscriptionStatus status
        timestamptz ends_at
    }
    DOMAINS {
        uuid id PK
        uuid academy_id FK
        text hostname UK
        DomainKind kind
        boolean is_primary
        timestamptz verified_at
    }
    PLATFORM_USERS {
        uuid id PK
        text email UK
        PlatformRole role
    }
    ACADEMY_JOBS {
        uuid id PK
        uuid academy_id FK
        JobKind kind
        JobStatus status
        jsonb payload
    }
    PLATFORM_AUDIT_LOGS {
        uuid id PK
        uuid actor_platform_user_id FK
        text action
    }
```

**تدفق توفير أكاديمية جديدة (PROPOSED):** إنشاء صف `academies` بحالة `provisioning` → مهمة `provision`: إنشاء القاعدة ودورَيها على العنقود المستهدف (تعميم `10-roles.sh` بأسماء فريدة لكل أكاديمية لأن الأدوار في PostgreSQL على مستوى العنقود، مثل `app_<slug>`/`migrator_<slug>`، وحفظ كلمتَي المرور في مخزن الأسرار) → `prisma migrate deploy` على القاعدة الجديدة → بذر صف `academy` بـ `platform_academy_id` والأدوار النظامية وكتالوج الصلاحيات ودعوة المدير الأول → تسجيل النطاق الفرعي → `active`. موقع كود المنصة (وحدة في الخادم نفسه خلف متغير بيئة، أم تطبيق مستقل) `NOT YET DETERMINED` (ADR-021).

#### 6.6.3 إدارة ترحيلات Prisma عبر قواعد الأكاديميات المستقلة — `PROPOSED`

| البند | الآلية المقترحة |
|---|---|
| مصدر الحقيقة | مخطط واحد لكل **نوع** قاعدة: `backend/prisma/schema.prisma` (قاعدة الأكاديمية، الموجود) و`backend/prisma/platform/schema.prisma` (القاعدة المركزية) مع `prisma.platform.config.ts` ومجلد ترحيلات وعميل مولَّد مستقلين؛ تُشغَّل أوامر المنصة بـ `prisma ... --config prisma.platform.config.ts` (العلم متوفر في Prisma 7.10.1 — تم التحقق من `--help`) |
| التطوير المحلي | `prisma migrate dev` على قاعدة الأكاديمية المحلية بدور migrator (يملك `CREATEDB` للقاعدة الظلية — متحقق منه)؛ مراجعة SQL كل ترحيل والتزامه؛ لا `db push` ولا `reset` |
| حارس الانجراف في CI | `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` يفشل البناء إن اختلف المخطط عن الترحيلات؛ ثم `migrate deploy` على قاعدة فارغة مؤقتة |
| الإصدار | إصدار المخطط = اسم آخر ترحيل في المجلد (يُقرأ من `_prisma_migrations`)؛ يُخزَّن لكل أكاديمية في `academies.schema_version` |
| الطرح على الأكاديميات | منسّق في المنصة (مهمة `migrate` في `academy_jobs`) يمرّ على الأكاديميات **تسلسلياً**: نسخة احتياطية (`pg_dump -Fc`) → `prisma migrate deploy` بـ `MIGRATION_DATABASE_URL` لدور migrator الخاص بالأكاديمية → `prisma migrate status` نظيف → تحديث `schema_version` → التالية؛ التوقف عند أول فشل مع تسجيل `log`؛ أكاديمية كناري أولاً؛ نافذة صيانة اختيارية |
| توافق الكود والمخطط | الخادم عند الإقلاع يقرأ آخر ترحيل مطبَّق ويقارنه بالحد الأدنى المطلوب في الإصدار؛ عند التخلّف تُعيد الجاهزية `503` بسبب `schema_outdated` بدل العمل على مخطط قديم |
| بلا توقف | قاعدة "التوسيع ثم التقليص": ترحيلات إضافية أولاً، كود يدعم الشكلَين، ثم ترحيل الحذف في إصدار لاحق؛ لا `DROP`/إعادة تسمية في نفس إصدار الكود الذي يحتاجها |
| الأدوار في الإنتاج | `migrator_<slug>` بلا `CREATEDB` (لا قاعدة ظلية في `migrate deploy`)؛ `app_<slug>` بـ DML؛ superuser العنقود للتوفير فقط (KI-027، 14.11) |
| التراجع | لا ترحيلات تراجع آلية في Prisma؛ التراجع = استعادة النسخة الاحتياطية المأخوذة قبل الترحيل أو ترحيل تصحيحي للأمام |

#### 6.6.4 خطة التنفيذ المرحلية (بعد اعتماد التصميم النهائي؛ لا شيء منها منفَّذ)

| المرحلة | المحتوى | شرط البدء | المخرجات |
|---|---|---|---|
| 0 — الاعتماد | قرارات D2، D3، D6..D10؛ تحديد `timezone`/`currency` الافتراضيين وسياسة احتفاظ `audit_logs` | — | ADR-020 وADR-021 → ACCEPTED |
| 1 — مخطط الأكاديمية الأول | النماذج والتعدادات في `schema.prisma` → `prisma:validate` → `prisma:migrate -- --create-only --name init_identity_academy` → مراجعة SQL وإضافة الكائنات اليدوية (فهرس الصف الواحد، CHECK `ar`، فهارس جزئية، قيد الولي ≠ الطالب، دالة وtrigger الإلحاق) → `migrate dev` → `generate` → فحص امتيازات app على كل جدول → بذر idempotent (`prisma/seed.ts`: `academy`، الأدوار النظامية، كتالوج الصلاحيات، مدير أول من `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` الجديدَين في `env.schema.ts` و11.3) → توثيق 6.2/6.3 بحالة IMPLEMENTED | المرحلة 0 | الترحيل الأول + البذر + اختبارات تكامل على القاعدة الحية |
| 2 — خدمات الهوية | MOD-01 (argon2id، JWT وصول قصير + تحديث بتدوير، الدعوات، استعادة كلمة المرور، `audit_logs`)، MOD-03 (CRUD المستخدمين والأدوار، `RolesGuard`/صلاحيات دقيقة، ربط أولياء الأمور)، استبدال المصادقة التجريبية في الواجهة (KI-017) وإضافة `tr` إلى i18n | المرحلة 1 | أول نقاط نهاية محمية؛ تحديث 07 و10 و15 |
| 3 — المنصة المركزية | `prisma/platform` + `prisma.platform.config.ts` + أدوار `platform_*`؛ جداول 6.6.2؛ مهام التوفير والترحيل (6.6.3)؛ لوحة Super Admin الأولية | قرار D9/D10 | ADR-021 منفَّذ؛ توثيق قاعدة ثانية في 06 |
| 4 — التشغيل | CI (lint/test/build + حارس الانجراف)، نسخ احتياطي مجدول لكل أكاديمية، مراقبة، مهام تنظيف الرموز والاحتفاظ بسجل التدقيق، `compose.prod.yaml` | المرحلتان 1 و3 | 14.11 منفَّذ تدريجياً |

#### 6.6.5 فرز القرارات قبل الترحيل الأول وخطة تنفيذه (مراجعة ما قبل التنفيذ 2026-10-29 — CH-0011؛ التوصيات `PROPOSED` حتى اعتماد المالك)

> **الغرض:** حصر ما يحتاج قرار المالك **الآن** لإنشاء الجداول الـ12 في 6.6، وترك قرارات الوحدات اللاحقة كما هي، وتثبيت خطة تنفيذ الترحيل الأول واختباره والتراجع عنه. لا يعيد هذا البند كتابة 6.6/6.7؛ ما لم يُذكر هنا يبقى كما ورد فيهما. **لا شيء منه منفَّذ** (تم التحقق 2026-10-29 17:50: 0 جداول، لا ترحيل).

**تحديث (CH-0012، 2026-10-29):** اعتمد المالك القائمة (أ) كاملة — D20 بشرط أن يغطي `employee_profiles` المعلمين والموظفين دون تقييد تعدد الأدوار مع إمكانية إضافة البيانات التخصصية لاحقاً — والحزمة (ب) كاملة بشرط ضمان معرّف دخول فريد وآمن (`email` أو `username`) وعدم الاعتماد على الهاتف غير الفريد وحده، وقرّر أن `timezone` و`currency` **يُحدَّدان لكل أكاديمية** (معاملا بذر إلزاميان بلا قيمة افتراضية مرتبطة ببلد). القائمة (ج) تبقى `PROPOSED`. تنفيذ (و) يبدأ بعد هذا الاعتماد.

**(أ) القرارات التي تمنع إنشاء الجداول الـ12 — مطلوب اعتمادها الآن:**

| القرار | التوصية النهائية | لماذا لا يمكن تأجيله |
|---|---|---|
| D2 | نعم — لا عمود `academy_id` في أي جدول (P1) | يمسّ تعريف كل جدول |
| D3 | `academy.settings jsonb` + تحقق zod (لا جدول إعدادات الآن) | يحدد أعمدة `academy` |
| D6 | `full_name` + `display_name?` | يحدد أعمدة `users` |
| D7 | `deleted_at` في `users` فقط؛ `email` فريد بـ `@unique` بلا فهرس جزئي؛ مسار "استعادة الحساب" بدل إعادة التسجيل (6.6.1 البند 1) | قيود `users` |
| D8 | جدول `permissions` مبذور من الكود؛ `deprecated_at` بدل الحذف؛ FK من `role_permissions` بـ `Restrict` | يحدد الجدولين 4 و5 |
| D11 | حساب لكل أكاديمية في قاعدتها (ADR-022 الخيار ج) | البديل (هوية عالمية) ينقل `users` ورموزها إلى القاعدة المركزية ويغيّر الترحيل الأول كلياً |
| D20 | جدول واحد `employee_profiles` (`user_id` PK/FK، `employee_number?` فريد، `kind` enum `EmployeeKind { teacher, staff }`، `job_title?`, `specialization?`, `bio jsonb?`, `hired_on?`, `is_active`) **بدل** `teacher_profiles` | يغيّر اسم وأعمدة الجدول 8 قبل إنشائه؛ إعادة التسمية لاحقاً ترحيل مزعج بلا فائدة |
| D21 | `phone` **غير فريد** (فهرس عادي)؛ الدخول بالبريد (أو `username` إن اعتُمدت الحزمة ب) | قيد على `users` |
| D22 | `audit_logs.id uuid` بـ `uuidv7()` كبقية الجداول (D4) | نوع المفتاح الأساسي لجدول إلحاقي يصعب تغييره بعد تراكم الصفوف |

**(ب) حزمة اختيارية واحدة (نعم/لا) — أعمدة من 6.7 لا تحتاج جداول جديدة وتخدم MOD-01/MOD-03 مباشرة، فتوفّر ترحيلاً ثانياً قبل المصادقة:** `users.username? citext/text` فريد + `users.email` قابل لـ `NULL` مع `CHECK (email IS NOT NULL OR username IS NOT NULL)` (D13)؛ `users.full_name_latin?` (D12)؛ قيمة `pending` في `UserStatus`؛ `users.failed_login_count smallint DEFAULT 0`, `locked_until?`, `password_changed_at?`, `must_change_password bool DEFAULT false`؛ `roles.is_default_for_signup bool DEFAULT false`؛ `refresh_tokens.family_id uuid` (مفهرس). **التوصية: نعم للحزمة كاملة** (كلها `NULL`/افتراضي، بلا أثر على العلاقات)؛ إن رُفضت يبقى 6.6 كما هو.

**(ج) تبقى `PROPOSED` ولا تمنع البدء (قرارات وحدات لاحقة أو تشغيل):** D9 وD10 (الوضع `single` الحالي لا يحتاج القاعدة المركزية؛ `academy.platform_academy_id?` يبقى `NULL` بلا FK)، D14 (إضافة `user_roles.branch_id` لاحقاً تستلزم استبدال المفتاح المركّب بـ `id` + فهرس فريد `NULLS NOT DISTINCT` — ترحيل صغير بلا فقد بيانات، مقبول)، D15، D16، D17، D18، D19. **قيمتا `timezone`/`currency`** ليستا قرار مخطط بل معاملا بذر لكل أكاديمية (`SEED_ACADEMY_TIMEZONE`/`SEED_ACADEMY_CURRENCY`) — **قرار المالك (CH-0012):** قابلتان للتحديد لكل أكاديمية، إلزاميتان في البذر، وبلا قيمة افتراضية مرتبطة ببلد بعينه. سياسة احتفاظ `audit_logs` تبقى `NOT YET DETERMINED` (لا أثر على DDL).

**(د) تعديلات دقيقة من مراجعة المستخدمين/الأدوار/الصلاحيات/الملفات/التدقيق (تُطبَّق مع الترحيل الأول ما لم يعترض المالك):**

| # | البند | التعديل | السبب |
|---|---|---|---|
| 1 | `user_roles.role_id` | `Restrict` بدل `Cascade` (كما في 6.7.4) | حذف دور ما زال ممنوحاً يجب أن يفشل صراحةً لا أن يُسقط التعيينات بصمت؛ الأدوار النظامية لا تُحذف أصلاً |
| 2 | حماية `audit_logs` | الـ trigger المعتمد (D5) **وحده** في SQL الترحيل؛ `REVOKE UPDATE, DELETE … FROM <app role>` (6.7.6) يُنقل إلى خطوة التزويد/البذر لا إلى الترحيل | ملف الترحيل لا يجوز أن يحمل اسم دور (يختلف بين `articode_app` محلياً و`app_{slug}` في الوضع `multi`) |
| 3 | صف `academy` الواحد | عمود `singleton boolean NOT NULL DEFAULT true @unique` (كما في 6.7.4) + `CHECK (singleton)` يدوي، بدل فهرس فريد على تعبير ثابت | Prisma يعرف الفهرس الفريد فلا خطر انجراف؛ قيود CHECK يتجاهلها Prisma (موثّق) |
| 4 | `email` | يُخزَّن بأحرف صغيرة بتطبيع في طبقة الخدمة + `@unique`؛ **لا امتداد `citext`** في الترحيل الأول | يُبقي الترحيل الأول بلا امتدادات؛ `citext` يُقرَّر مع المرحلة B إن لزم |
| 5 | الفهرس الجزئي `guardian_students (student_user_id) WHERE is_primary` | الكائن اليدوي الوحيد الذي **قد** يقترح Prisma إسقاطه في الفرق التالي (`UNVERIFIED` — 6.6.1 البند 10) | يُتحقق منه في الخطوة 6 أدناه؛ البديل عند الفشل: فرض "ولي أساسي واحد" داخل معاملة الخدمة وحذف الفهرس |
| 6 | أسماء أنواع التعداد | `@@map` إلى `snake_case` (`user_status`, `token_purpose`, `guardian_relationship`, `locale`, `employee_kind`) | اتساق مع P2 وتقارير SQL |
| 7 | سلامة التصميم العامة | `users` مركز كل الوحدات اللاحقة (كل جداول 6.7 تشير إلى `users.id uuid`)؛ الملفات التعريفية 1:1 بـ PK = FK؛ M:N بمفاتيح مركّبة؛ `permissions.key` نصي يسمح بتوسيع الكتالوج بالبذر دون ترحيل؛ الرموز مجزّأة؛ `audit_logs.entity_id text` يقبل أي مفتاح | **النتيجة:** الجداول الـ12 (مع D20) تكفي كأساس لإضافة بقية جداول 6.7 (`branches`, `rooms`, `files`, `number_sequences`, `outbox_events`, …) بترحيلات إضافية لا تعدّل الجداول القائمة إلا في D14 أعلاه |

**(هـ) التوافق مع PostgreSQL 18 وPrisma 7 (تم التحقق 2026-10-29 17:50 على البيئة الحية، قراءة فقط):** PostgreSQL 18.6 (`postgres:18`)، `uuidv7()` تعمل، 0 جداول، `articode_academy` مملوكة لـ `articode_migrator` (`CREATEDB` للقاعدة الظلية)، `articode_app` بلا `CREATE` على `public`، الامتدادات `citext`/`pgcrypto`/`btree_gist`/`pg_trgm` متاحة وغير مثبّتة (غير مطلوبة للجداول الـ12)، `TimeZone = Etc/UTC`؛ Prisma CLI وعميل 7.10.1 على Node 22.20؛ `prisma migrate status` يتصل ويؤكد أن القاعدة غير مُدارة ولا مجلد ترحيلات. ما تحتاجه الجداول الـ12 من Prisma 7 مدعوم: `@id @default(dbgenerated("uuidv7()")) @db.Uuid` (متحقق في CH-0009)، `Json` → `jsonb`، `@db.Timestamptz(6)`، `enum`، `@@id` مركّب، علاقات ذاتية، `onDelete` بالقيم الثلاث، `@@map`/`@map`. **لا حاجة** إلى `NULLS NOT DISTINCT` ولا `EXCLUDE` ولا امتدادات في هذا الترحيل. **لا تعارض** بين مخطط الأكاديمية والقاعدة المركزية (6.6.2/6.7.3): قاعدتان مستقلتان، لا FK عابرة، الرابط `platform_academy_id?` بلا قيد، أدوار بأسماء مختلفة، عميلان مولَّدان بمسارَي إخراج مختلفَين، Super Admin خارج `users`/`roles`؛ التناقض الداخلي الوحيد (أعمدة `academies.db_*` مقابل `academy_databases`) محصور في D10 ولا يمسّ الجداول الـ12.

**(و) دليل تنفيذ الترحيل الأول (يُنفَّذ بعد اعتماد (أ) — ومعه (ب) إن وافق المالك — ولا شيء منه الآن):**

| # | الخطوة | الأمر / المعيار |
|---|---|---|
| 0 | شروط البدء | اعتماد (أ)؛ التزام الشجرة الحالية (ز) ليكون الترحيل commit مستقلاً؛ `docker compose ps` → `healthy`؛ `npm run prisma:status` → غير مُدارة؛ نسخة `pg_dump -Fc` وفق 14.9 (شكلية — القاعدة فارغة)؛ إيقاف كل `nest start --watch` قبل `prisma generate` |
| 1 | النماذج | كتابة النماذج والتعدادات الـ12 في `schema.prisma` (بـ `@@map`/`@map`) ← `npx prisma format` ← `npm run prisma:validate` |
| 2 | توليد SQL دون تطبيق | `npm run prisma:migrate -- --create-only --name init_identity_academy` (ينشئ قاعدة ظلية مؤقتة بدور migrator ويحذفها — KI-027) → `prisma/migrations/<ts>_init_identity_academy/migration.sql` |
| 3 | مراجعة SQL | قائمة تحقق: كل `id UUID NOT NULL DEFAULT uuidv7()`؛ أسماء `snake_case`؛ `ON DELETE` كما صُمّم (`CASCADE` للتابعين فقط، `SET NULL` لـ `actor_user_id`/`assigned_by`/`replaced_by_id`، `RESTRICT` للبقية)؛ فهرس لكل FK؛ القيود الفريدة (`email`, `slug`, `key`, `token_hash`, `student_number`, `employee_number`, `singleton`)؛ أنواع التعداد؛ **لا `DROP`، لا اسم دور، لا امتداد، لا سرّ**. ثم إلحاق كتلة SQL اليدوي في آخر الملف: `CHECK (jsonb_typeof(name) = 'object' AND name ? 'ar')` على `academy.name` و`roles.label`؛ `CHECK (singleton)`؛ `CHECK (guardian_user_id <> student_user_id)`؛ الفهرس الجزئي `is_primary`؛ دالة + trigger `audit_logs_append_only` (`BEFORE UPDATE OR DELETE` → `RAISE EXCEPTION 'audit_logs is append-only'`)؛ ومع الحزمة (ب) `CHECK (email IS NOT NULL OR username IS NOT NULL)` |
| 4 | التطبيق | `npm run prisma:migrate -- --name init_identity_academy` يطبّق الترحيل المعلّق ويولّد العميل. المتوقع: صف واحد في `_prisma_migrations`، 12 جدولاً |
| 5 | فحص الصلاحيات | بدور migrator (قراءة): `\dt`, `\dT`, `\di`, `pg_trigger`؛ لكل جدول `has_table_privilege('articode_app', t, 'SELECT/INSERT/UPDATE/DELETE') = true` و`TRUNCATE = false`؛ `has_type_privilege` = `USAGE` على التعدادات؛ `has_schema_privilege('articode_app','public','CREATE') = false` |
| 6 | حارس الانجراف | `npx prisma migrate diff --from-url "<عنوان migrator>" --to-schema prisma/schema.prisma --exit-code` → المتوقع "No difference detected" ورمز 0. إن اقترح `DROP INDEX` للفهرس الجزئي → تطبيق بديل (د) 5 قبل الالتزام |
| 7 | اختبارات تكامل (TEST-007 مقترح، تُتخطّى بلا قاعدة كما TEST-005) | ملف `backend/test/db.e2e-spec.ts` داخل معاملات تُلغى: (1) `uuid_extract_version(id) = 7` لصف جديد؛ (2) العلاقات: مستخدم + دور + تعيين → حذف المستخدم يُسقط `user_roles`/`refresh_tokens`/ملفه التعريفي؛ حذف دور ممنوح يفشل (Restrict)؛ حذف صلاحية مرتبطة يفشل؛ (3) القيود: صف `academy` ثانٍ يُرفض؛ `name` بلا `ar` يُرفض؛ ولي = طالب يُرفض؛ وليّان أساسيان لطالب يُرفضان؛ (4) التدقيق: `INSERT` ينجح و`UPDATE`/`DELETE` يرفعان `audit_logs is append-only`؛ (5) بدور app عبر `PrismaService`: `CREATE TABLE` → `permission denied`؛ (6) البذر مرتين = نفس العدّ (idempotent) |
| 8 | البذر | `prisma/seed.ts` عبر `migrations.seed` في `prisma.config.ts`: صف `academy` (slug/name/timezone/currency من متغيرات `SEED_ACADEMY_*`)، 5 أدوار نظامية، كتالوج الصلاحيات من ثابت في الكود، مصفوفة 6.7.8 الافتراضية. **المدير الأول يُؤجَّل إلى MOD-01** (يحتاج argon2id) بدل `SEED_ADMIN_*` في 6.6.4. المشغّل يحتاج `tsx` كاعتمادية تطوير (قرار المالك — CLAUDE.md يمنع إضافة اعتماديات دون طلب) |
| 9 | التوثيق | 6.2/6.3 (الجداول `IMPLEMENTED` مع الترحيل المنشئ وER فعلي)، 6.6 (الحالة)، ADR-020 → ACCEPTED، 11.3 (`SEED_ACADEMY_*`)، 13 (TEST-007)، 15 (FS-032)، 19 (CH)، `CLAUDE.md` |
| 10 | الالتزام | commit واحد: `schema.prisma` + مجلد الترحيل + البذر + الاختبارات + التوثيق |

**التراجع عند الفشل (بلا `migrate reset` وبلا حذف القاعدة أو المجلد):** (1) فشل أثناء الخطوة 4: Prisma يسجّل الترحيل `failed`؛ **يُرفض** أي عرض لإعادة التهيئة؛ `npx prisma migrate resolve --rolled-back init_identity_academy` ثم سكربت `rollback_init.sql` مُعدّ مسبقاً يُنفَّذ بدور migrator (`DROP TABLE IF EXISTS … CASCADE` للجداول الـ12، `DROP TYPE IF EXISTS` للتعدادات، `DROP FUNCTION IF EXISTS audit_logs_append_only`) — القاعدة بلا بيانات فيعود هذا بها إلى خط الأساس — ثم تصحيح `migration.sql` وإعادة الخطوة 4. يُتحقق بـ `\dt` بدل الافتراض أن فشل عبارة أعاد كل شيء (`UNVERIFIED`). (2) فشل الاختبارات بعد التطبيق وقبل الالتزام: ترحيل تصحيحي للأمام (المفضّل)، أو — على قاعدة التطوير الفارغة فقط — تنفيذ `rollback_init.sql` وحذف صف الترحيل من `_prisma_migrations` ومجلده وإعادة التوليد. (3) الملاذ الأخير: استعادة نسخة الخطوة 0 بـ `pg_restore --clean` (14.9) — لا يحذف القاعدة. **قاعدة دائمة:** بعد الالتزام ووجود بيانات لا تراجع إلا للأمام (6.6.3).

**(ز) حفظ التغييرات الحالية في Git دون كشف الأسرار (مراجعة 2026-10-29):** `git check-ignore` يؤكد تجاهل `.env` الجذري و`backend/.env`/`.env.local` و`frontend/.env.local` و`backend/src/generated/prisma`؛ مسح الملفات المرصودة وغير المرصودة لا يُظهر أي عنوان اتصال بكلمة مرور حقيقية (الإصابات الوحيدة قيم اختبار مثل `u:p@db` في `*.spec.ts` و`change-me` في القوالب)؛ `.env` الجذري يحمل 8 متغيرات بقيم حقيقية ويبقى محلياً؛ `backend/.env` تعليقات فقط. الشجرة: 13 ملفاً معدّلاً، 3 حذف مُدرج، 28 ملفاً جديداً؛ تحذيرات CRLF على `backend/oxlint.json`/`package.json`/`package-lock.json` يطبّعها `.gitattributes` عند الالتزام (لا إجراء). **التوصية:** تبسيط خطة CH-0008 الخماسية إلى ثلاثة التزامات: (1) `feat(backend+infra)`: `backend/**` + `compose.yaml` + `docker/` + `.env.example` + `.gitignore` + الحذف المُدرج؛ (2) `feat(frontend)`: `frontend/**`؛ (3) `docs`: `docs/PROJECT_DOCUMENTATION.md` + `CLAUDE.md`. قبل كل التزام: `git diff --cached --name-only | grep -iE '(^|/)\.env($|\.local$)'` يجب أن يكون فارغاً، و`git diff --cached | grep -nE 'postgres(ql)?://[^:/]+:[^@/]+@' | grep -v change-me` تُراجَع إصاباته (المتوقع: قيم الاختبار فقط). **لا commit ولا push إلا بطلب المالك.**

**(ح) ما قد يمنع البدء:** (1) اعتماد (أ) — المانع الوحيد الجوهري؛ (2) إضافة `tsx` (تطوير) للبذر — وقرار مماثل لـ `argon2` مع MOD-01؛ (3) الشجرة غير الملتزمة (يُستحسن الالتزام أولاً، غير مانع)؛ (4) عمليتا `nest start --watch` على الجهاز (CH-0008) تتعارضان مع `prisma generate`/`build` — تُوقَفان قبل الترحيل؛ (5) سلوك Prisma مع الفهرس الجزئي `UNVERIFIED` — تغطيه الخطوة 6؛ (6) KI-026 (سكربتات تثبيت Prisma الممنوعة بـ npm 11) — `migrate status` يعمل اليوم، وإن طلب `migrate dev` محرّكاً مفقوداً يُعاد `npm ci`.

### 6.7 التصميم المعماري المقترح لقاعدة البيانات — منصة مركزية وقاعدة مستقلة لكل أكاديمية (`PROPOSED` — بانتظار اعتماد المالك)

> **حالة هذا القسم:** `PROPOSED` بالكامل. لا جدول ولا ترحيل ولا نموذج Prisma منفّذ (تم التحقق 2026-10-29: 0 جداول في `articode_academy`). كُتب بطلب المالك (2026-10-29) للمراجعة والاعتماد قبل أي تنفيذ. **مصادر المتطلبات:** القسم 02 (REQ-01..REQ-14)، الوحدات MOD-01..MOD-15 (القسم 08)، الأدوار ROLE-01..ROLE-07 (7.2)، حقول وحالات البيانات التجريبية في `frontend/src/mock/data.ts` (كمؤشر على الشاشات، لا كمصدر حقيقة)، وبنية القاعدة الفعلية (6.1، ADR-016..ADR-019). كل ما لم يُحسم موسوم `NOT YET DETERMINED` ومجموع في 6.7.11. **العلاقة بالقسم 6.6:** القسم 6.6 يصف **الترحيل الأول** (12 جدولاً من المرحلة A) بقراراته D1..D10 وملاحقه 6.6.1–6.6.4؛ هذا القسم يصف **التصميم المستهدف الكامل** الذي يندرج فيه ذلك الترحيل، ويعتمد تسميات 6.6 حيث تتقاطعان (`academy`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `student_profiles`, `guardian_students`, `refresh_tokens`, `verification_tokens`, `audit_logs`)؛ الفروق المقصودة مجموعة في 6.7.0. القرارات المعمارية المقابلة في القسم 17 (`PROPOSED`).

#### 6.7.0 العلاقة بالقسم 6.6 والفروق المقصودة

| الكيان | في 6.6 (الترحيل الأول) | في 6.7 (التصميم المستهدف) | الموقف |
|---|---|---|---|
| `academy` | صف واحد مع `settings jsonb` (D3) و`platform_academy_id` | الاسم نفسه؛ أعمدة إضافية (`supported_locales`, `legal_name`, `address`, `tax_number`)؛ جدول `academy_settings` مفتاح/قيمة **اختياري لاحقاً** عند الحاجة إلى تاريخ أو صلاحية لكل مفتاح | متوافق؛ الإضافات تدخل مع المرحلة A أو لاحقاً |
| `users` | `email` فريد، `phone` فريد، `display_name`, `avatar_url`, أربع حالات | إضافات: `username` (طلاب بلا بريد — D13)، حالة `pending` (تسجيل ذاتي)، حقول القفل (`failed_login_count`, `locked_until`) و`must_change_password`، `full_name_latin` (D12)، `avatar_file_id → files`؛ `phone` **غير فريد** | فرق مقصود واحد: فرادة `phone` (D21) |
| `teacher_profiles` | جدول للمعلمين فقط | `employee_profiles` بعمود `kind` (teacher / staff) يغطي المعلمين والموظفين معاً | قرار المالك D20 |
| `user_roles` | PK مركّب `(user_id, role_id)` | + `branch_id` اختياري لنطاق الفرع (يستلزم `id` وفهرساً فريداً `NULLS NOT DISTINCT`) | إضافة؛ تدخل مع `branches` (D14) |
| `guardian_students` | `relationship` بخمس قيم، `is_primary` | + `grandparent`، وأعلام `is_financially_responsible`, `can_view_grades`, `can_view_attendance` | إضافة متوافقة |
| `refresh_tokens` | `replaced_by_id` لتتبع التدوير | + `family_id` (إبطال السلسلة كلها عند إعادة استخدام رمز مدوَّر)، `device_name`, `last_used_at` | إضافة متوافقة |
| `verification_tokens` | ثلاثة أغراض + `metadata jsonb` | + `phone_verification`, `login_otp` (لاحقاً) | إضافة متوافقة |
| `audit_logs` | `id uuid` (D4)، `entity_id text`، trigger إلحاق (D5/P11) | يعتمد D4/D5 كما هما؛ يقترح إضافةً `REVOKE UPDATE/DELETE` عن دور التطبيق فوق الـ trigger، ويطرح `id bigint identity` كخيار أداء للإلحاق الكثيف | قرار المالك D22 (الافتراضي `uuid` وفق D4) |
| `roles` | `label jsonb` | الاسم نفسه + `is_default_for_signup` | إضافة متوافقة |
| الجداول الـ 47 الأخرى | — | جديدة كلياً (المراحل B–D والقاعدة المركزية) | — |

#### 6.7.1 المبادئ والاصطلاحات المقترحة (تكمّل P1..P10 في 6.6 وADR-020)

| البند | المقترح | السبب |
|---|---|---|
| المحرك والإصدار | PostgreSQL 18 (الموجود فعلياً) | يوفّر `uuidv7()` أصلياً، `UNIQUE NULLS NOT DISTINCT`، وامتدادات موثوقة (`citext`, `pgcrypto`, `btree_gist`, `pg_trgm`) متاحة في الصورة (تم التحقق 2026-10-29 أنها متاحة وغير مثبّتة) |
| المفاتيح الأساسية | `uuid` مولَّد في القاعدة `DEFAULT uuidv7()` (Prisma: `@id @db.Uuid @default(dbgenerated("uuidv7()"))`) | UUIDv7 مرتّب زمنياً فيحافظ على محلية الفهرس (عكس v4)، وآمن للتوليد في أي قاعدة أكاديمية دون تنسيق مركزي، ولا يكشف العدّ. يطابق D4 **المعتمد** في 6.6 لكل الجداول؛ استثناء مطروح على المالك (D22): `bigint GENERATED ALWAYS AS IDENTITY` للجدول الإلحاقي `audit_logs` |
| التسمية | نماذج Prisma بـ `PascalCase`/`camelCase`، والقاعدة `snake_case` جمعاً للجداول عبر `@@map`/`@map`؛ الفهارس `ix_<table>_<cols>`، القيود `ck_`/`uq_`/`fk_`/`ex_` | اصطلاح PostgreSQL القياسي؛ استعلامات SQL وتقارير DBeaver مقروءة |
| الطوابع الزمنية | `timestamptz` دائماً (`@db.Timestamptz(6)`)؛ `created_at DEFAULT now()`، `updated_at` عبر `@updatedAt`؛ التواريخ المجرّدة `date`، أوقات الجدول الأسبوعي `time` | المنطقة الزمنية للأكاديمية تُطبَّق في العرض فقط؛ القاعدة بتوقيت UTC (الحالي `Etc/UTC`) |
| الحذف | حذف ناعم (`deleted_at`) للكيانات ذات التاريخ (مستخدمون، دورات، فصول، تقييمات)؛ حذف فعلي لجداول الربط والرموز المؤقتة؛ **لا حذف أبداً** للسجلات المالية وسجلات التدقيق والشهادات (إلغاء/إبطال بالحالة) | متطلبات التدقيق والمالية؛ إمكانية "إخفاء هوية" بدل الحذف (6.7.9) |
| النصوص متعددة اللغات | عمود `jsonb` باسم المفهوم مباشرة (مثل `name`, `title`) بالشكل `{"ar": "...", "en": "..."}`؛ قيد `CHECK (jsonb_typeof(col) = 'object')`؛ لغة الأكاديمية الافتراضية إلزامية بالتحقق في الخادم | REQ-13 لا يحصر اللغات في اثنتين؛ يطابق `LocalizedText` في الواجهة؛ أرخص من جداول ترجمة لكل كيان؛ يطابق D1 **المعتمد** في 6.6 (`{ ar, en?, tr? }` مع `ar` إلزامية وتعداد `Locale`). **أسماء الأشخاص** نص عادي (`full_name` — 6.6 D6) + `full_name_latin` اختياري للشهادات الإنجليزية (D12) |
| المال | `numeric(12,2)` + `currency char(3)` (ISO 4217) على كل مبلغ؛ **لا** `float`؛ عملة واحدة لكل أكاديمية في الإصدار الأول | دقة محاسبية؛ البيانات التجريبية تستخدم `SAR` |
| التعدادات | `enum` في Prisma (→ PostgreSQL enum) للحالات المستقرة؛ جداول مرجعية لما يديره المستخدم (الأدوار، الصلاحيات، المستويات، الفئات) | الحالات تتغير بترحيل مراجَع؛ ما يُدار من الواجهة لا يحتاج ترحيلاً |
| الفهرسة | **كل عمود مفتاح أجنبي يُفهرس صراحةً** (`@@index`) لأن Prisma لا يفهرس المفاتيح الأجنبية تلقائياً على PostgreSQL؛ فهارس مركّبة لاستعلامات القوائم؛ فهارس جزئية للحالات الساخنة؛ `pg_trgm` للبحث بالاسم | أداء الحذف المتسلسل والربط؛ تجنّب فحوص كاملة |
| ما لا تعبّر عنه Prisma | قيود `CHECK`، الفهارس الجزئية، `EXCLUDE` (تعارض الجدولة)، `UNIQUE NULLS NOT DISTINCT`، الامتدادات، `REVOKE` على جداول التدقيق — تُكتب يدوياً في ملف الترحيل المولَّد قبل الالتزام به (6.7.6) | Prisma Migrate يحتفظ بأي SQL يدوي في الترحيل؛ المخطط يبقى مصدر الحقيقة للنماذج، والترحيلات مصدر الحقيقة للقيود |
| البيانات الحساسة | `password_hash` بـ argon2id؛ الرموز تُخزَّن كتجزئة SHA-256 فقط؛ الهوية الوطنية والملاحظات الطبية في أعمدة `bytea` مشفّرة في طبقة التطبيق (AES-256-GCM بمفتاح من البيئة مع رقم إصدار) | NFR-05؛ تسريب نسخة احتياطية لا يكشف الحقول الحرجة |

**الأعمدة القياسية** (لا تُكرَّر في جداول 6.7.3/6.7.4؛ يُشار إليها بالرموز): `id` (المفتاح الأساسي أعلاه) — **[T]** = `created_at` + `updated_at` — **[SD]** = `deleted_at timestamptz NULL` — **[CB]** = `created_by uuid NULL → users.id (ON DELETE SET NULL)`.

#### 6.7.2 المعمارية: قاعدة منصة مركزية + قاعدة لكل أكاديمية (ADR-021)

```mermaid
flowchart TB
    subgraph Platform["المنصة (Control plane) — قاعدة واحدة: articode_platform"]
        PDB[("articode_platform\nacademies · academy_databases · domains\nplatform_users · academy_jobs\ntenant_migration_runs · backup_records\nsupport_access_grants · platform_audit_logs")]
        SA["Super Admin API\n(NestJS، نفس الكود، وحدة platform/)"]
        SA --> PDB
    end
    subgraph Tenants["قواعد الأكاديميات (Data plane) — قاعدة مستقلة لكل أكاديمية، مخطط Prisma واحد مشترك"]
        T1[("aca_demo\n~60 جدولاً")]
        T2[("aca_riyadh_coding")]
        T3[("aca_{slug}")]
    end
    subgraph API["واجهة الأكاديمية (NestJS)"]
        RES["Tenant resolver\n(host / X-Academy / JWT.aca)"] --> REG["TenantClientRegistry\nPrismaClient + pg pool لكل أكاديمية (LRU)"]
    end
    SA -. "تزويد: CREATE DATABASE + migrate deploy + seed" .-> T3
    SA -. "تقرأ بيانات الاتصال (مشفّرة)" .-> PDB
    REG --> T1
    REG --> T2
    REG --> T3
    REG -. "في وضع single: عميل واحد من DATABASE_URL (الوضع الحالي)" .-> T1
```

**المبدأ:** مخططان مستقلان تماماً (لا مفاتيح أجنبية عبر القواعد). كل ما تحتاجه أكاديمية للعمل اليومي يعيش في قاعدتها وحدها، فتبقى قابلة للنسخ والاستعادة والنقل بين الخوادم كوحدة واحدة (REQ-01/02، ADR-008). القاعدة المركزية **لا تحتوي بيانات طلاب أو مالية**؛ هي سجل الأكاديميات ومفاتيح الوصول إلى قواعدها وأدوات التشغيل (تزويد، ترحيل جماعي، نسخ احتياطي، دعم).

**وضعا النشر اللذان يدعمهما التصميم نفسه** (متغير بيئة مقترح `TENANCY_MODE`؛ الوضع `single` هو الخيار (أ) في D9 و`multi` هو الخيار (ب)، والقاعدة المركزية هي D10 — كلاهما في 6.6):

| الوضع | الوصف | متى |
|---|---|---|
| `single` (الحالي فعلياً) | نسخة API مستقلة لكل أكاديمية تتصل بقاعدة واحدة عبر `DATABASE_URL`؛ لا حاجة للقاعدة المركزية على الإطلاق | النشر المستقل الكامل (REQ-01)؛ التطوير المحلي؛ أكاديمية تطلب خادماً خاصاً |
| `multi` | نسخة API واحدة (أو مجموعة) تخدم عدة أكاديميات: تحدّد الأكاديمية من اسم المضيف (`domains`) أو ترويسة `X-Academy` (تطبيقات المحمول) أو مطالبة `aca` في JWT بعد الدخول، وتفتح عميل Prisma خاصاً بقاعدتها من سجل عملاء بحد أقصى واتصالات قليلة لكل قاعدة | تشغيل عشرات الأكاديميات الصغيرة على بنية مشتركة بكلفة أقل، مع بقاء العزل على مستوى القاعدة |

في كلا الوضعين يحقن كود الوحدات مزوّداً واحداً `TenantDb` (العميل المولَّد من مخطط الأكاديمية) ولا يعرف من أين جاء الاتصال؛ `PrismaService` الحالي يصبح تنفيذ الوضع `single`. **لا استعلام يعبر الأكاديميات أبداً** — التقارير العابرة (إن طُلبت يوماً) تُبنى من إحصاءات مجمَّعة تُدفع إلى القاعدة المركزية، لا بالاستعلام المباشر.

#### 6.7.3 القاعدة المركزية `articode_platform` — إحالة إلى 6.6.2

كتالوج جداول القاعدة المركزية موثّق في **6.6.2** بصيغتين: الأساسية (`academies`, `plans`, `subscriptions`, `domains`, `platform_users`, `academy_jobs`, `platform_audit_logs`) والموسّعة المقتبسة من هذا التصميم (`academy_databases` ببيانات اتصال مشفّرة، `tenant_migration_runs`, `backup_records`, `support_access_grants`, `platform_refresh_tokens`/`platform_verification_tokens`, `platform_settings`، وتوسعة `academy_jobs.kind`). لا يُكرَّر الكتالوج هنا؛ ما يضيفه هذا القسم: مخطط ER للصيغة الموسّعة أدناه، واستخدام هذه الجداول في التزويد (6.7.7) والتشغيل (6.7.9). **الفرق الوحيد المقصود:** تخزين أسرار الاتصال مشفّرة داخل `academy_databases` (AES-256-GCM بمفتاح من البيئة مع `key_version`) بدل مرجع إلى مخزن أسرار خارجي — مطروح في 6.6.2 كـ `NOT YET DETERMINED` ضمن D10.

```mermaid
erDiagram
    platform_users ||--o{ platform_refresh_tokens : has
    platform_users ||--o{ platform_verification_tokens : has
    platform_users ||--o{ academies : created
    platform_users ||--o{ academy_jobs : requested
    platform_users ||--o{ support_access_grants : receives
    academies ||--|| academy_databases : "stored in"
    academies ||--o{ domains : "reached via"
    academies ||--o{ academy_jobs : "operated by"
    academies ||--o{ tenant_migration_runs : "schema history"
    academies ||--o{ backup_records : "backed up"
    academies ||--o{ support_access_grants : "support access"
    academy_jobs ||--o{ tenant_migration_runs : produced
    academies {
        uuid id PK
        varchar slug UK
        jsonb name
        academy_status status
        char3 currency
        text timezone
    }
    academy_databases {
        uuid id PK
        uuid academy_id FK
        text host
        int port
        varchar database_name
        varchar app_role
        bytea app_secret_enc
        database_status status
        varchar schema_version
    }
    domains {
        uuid id PK
        uuid academy_id FK
        citext hostname UK
        bool is_primary
    }
    academy_jobs {
        uuid id PK
        uuid academy_id FK
        job_type type
        job_status status
        jsonb payload
    }
    platform_users {
        uuid id PK
        citext email UK
        text password_hash
        platform_user_status status
    }
```

#### 6.7.4 قاعدة الأكاديمية `aca_{slug}` — الجداول حسب المجال (59 جدولاً على 4 مراحل — 6.7.10؛ جداول 6.6 الاثنا عشر مجموعة فرعية من المرحلة A)

##### A. الهوية والوصول (MOD-01, MOD-03) — المرحلة A

**`users`** — كل الأشخاص (مدير، معلم، طالب، ولي أمر، موظف)؛ النوع يُستنتج من الأدوار والملفات الشخصية لا من عمود.

| العمود | النوع | القيود / ملاحظات |
|---|---|---|
| `email` | `citext NULL` | `UNIQUE`؛ `NULL` مسموح للطلاب الصغار بلا بريد؛ عند إخفاء الهوية يُستبدل بقيمة شاهدة فلا حاجة لفهرس جزئي |
| `username` | `citext NULL` | `UNIQUE`؛ معرّف دخول بديل (أطفال، أو أكاديميات بلا بريد) |
| `phone` | `varchar(32) NULL` | `ix`؛ غير فريد (قد يتشارك الأشقاء هاتف ولي الأمر)؛ E.164 |
| `password_hash` | `text NULL` | argon2id؛ `NULL` = حساب مدعو لم يُفعَّل أو يدخل عبر مزوّد خارجي |
| `full_name` | `text NOT NULL` | بلغة الأكاديمية |
| `full_name_latin` | `text NULL` | للشهادات/التقارير الإنجليزية (D12) |
| `avatar_file_id` | `uuid NULL → files` | `ON DELETE SET NULL` |
| `locale` | `varchar(10) NULL` | يغلب لغة الأكاديمية الافتراضية |
| `timezone` | `text NULL` | — |
| `status` | `enum user_status(invited, pending, active, suspended, archived)` | `ix(status)`؛ `pending` = تسجيل ذاتي بانتظار الاعتماد (يطابق الشاشة التجريبية) |
| `email_verified_at`, `phone_verified_at` | `timestamptz NULL` | — |
| `last_login_at` | `timestamptz NULL` | — |
| `failed_login_count` | `smallint DEFAULT 0` | قفل مؤقت بعد N محاولات |
| `locked_until` | `timestamptz NULL` | — |
| `password_changed_at` | `timestamptz NULL` | — |
| `must_change_password` | `bool DEFAULT false` | بعد إنشاء المدير للحساب بكلمة مؤقتة |
| [CB] [T] [SD] | | `CHECK (email IS NOT NULL OR username IS NOT NULL)`؛ فهرس `gin (full_name gin_trgm_ops)` للبحث (SQL) |

**`user_identities`** (المرحلة D / MOD-15) — ربط مزوّدي هوية خارجيين: `user_id → users (CASCADE)`, `provider enum identity_provider(google, microsoft, apple, platform_sso)`, `provider_subject text`, `email_at_provider citext NULL`, `linked_at`. `UNIQUE(provider, provider_subject)`, `ix(user_id)`.

**`refresh_tokens`** — جلسات التحديث (تدوير الرموز): `user_id → users (CASCADE)`, `token_hash char(64)` (SHA-256 للرمز؛ الرمز نفسه لا يُخزَّن), `family_id uuid` (سلسلة التدوير؛ إعادة استخدام رمز قديم تُبطل العائلة كلها), `device_name text NULL`, `ip inet NULL`, `user_agent text NULL`, `expires_at`, `revoked_at NULL`, `revoke_reason varchar(32) NULL`, `last_used_at`, `created_at`. `UNIQUE(token_hash)`, `ix(user_id, expires_at)`, `ix(family_id)`.

**`verification_tokens`** — رموز الاستخدام الواحد: `user_id → users (CASCADE)`, `purpose enum token_purpose(invitation, email_verification, password_reset, phone_verification, login_otp)`, `token_hash char(64)`, `expires_at`, `consumed_at NULL`, `metadata jsonb NULL`, [CB], `created_at`. `UNIQUE(token_hash)`, `ix(user_id, purpose)`.

**`roles`** — أدوار النظام والأدوار المخصّصة (ROLE-02..ROLE-07): `key varchar(64)` (`academy_admin`, `teacher`, `student`, `guardian`, `staff`, أو مخصّص), `label jsonb`, `description jsonb NULL`, `is_system bool DEFAULT false` (لا تُحذف ولا يُغيَّر مفتاحها), `is_default_for_signup bool DEFAULT false` (الدور الممنوح عند التسجيل الذاتي — عادة `student`), [T]. `UNIQUE(key)`.

**`permissions`** — كتالوج الصلاحيات (يُبذر من الكود؛ 6.7.8): `key varchar(100) PK` (مثل `courses.manage`), `module varchar(32)`, `description jsonb`, `deprecated_at timestamptz NULL` (6.6.1 — بدل الحذف), `created_at`. `ix(module)`.

**`role_permissions`**: `role_id → roles (CASCADE)`, `permission_key → permissions (CASCADE)`, `granted_at`. `PK(role_id, permission_key)`.

**`user_roles`** — يمكن للمستخدم حمل عدة أدوار (معلم + موظف): `user_id → users (CASCADE)`, `role_id → roles (RESTRICT)`, `branch_id → branches NULL` (نطاق الدور؛ `NULL` = الأكاديمية كلها), `assigned_by → users NULL`, `assigned_at`. `UNIQUE NULLS NOT DISTINCT (user_id, role_id, branch_id)` (SQL), `ix(role_id)`, `ix(branch_id)`.

**`student_profiles`** (1:1 مع `users`): `user_id PK → users (CASCADE)`, `student_number varchar(32)` (من `number_sequences`), `date_of_birth date NULL`, `gender enum gender(male, female) NULL`, `nationality char(2) NULL`, `national_id_enc bytea NULL` (مشفّر), `school_name text NULL`, `current_level_id → levels NULL`, `enrolled_on date NULL`, `emergency_contact jsonb NULL`, `medical_notes_enc bytea NULL`, `notes text NULL`, [T]. `UNIQUE(student_number)`, `ix(current_level_id)`.

**`employee_profiles`** (1:1؛ المعلمون والموظفون معاً): `user_id PK → users (CASCADE)`, `employee_number varchar(32)`, `kind enum employee_kind(teacher, staff)`, `job_title text NULL`, `department text NULL`, `specialization text NULL`, `bio jsonb NULL`, `hired_on date NULL`, `terminated_on date NULL`, `is_active bool DEFAULT true`, [T]. `UNIQUE(employee_number)`, `ix(kind)`.

**`guardian_students`** — ربط أولياء الأمور بالطلاب (n:m): `guardian_user_id → users (CASCADE)`, `student_user_id → users (CASCADE)`, `relationship enum relationship_type(father, mother, grandparent, sibling, legal_guardian, other)`, `is_primary bool DEFAULT false`, `is_financially_responsible bool DEFAULT true`, `can_view_grades bool DEFAULT true`, `can_view_attendance bool DEFAULT true`, `created_at`. `PK(guardian_user_id, student_user_id)`, `CHECK (guardian_user_id <> student_user_id)`, `ix(student_user_id)`, فهرس فريد جزئي `(student_user_id) WHERE is_primary` (SQL).

##### B. هيكل الأكاديمية (MOD-02, MOD-14) — المرحلة A

**`academy`** (صف واحد — جدول 6.6 نفسه مع أعمدة إضافية): `singleton bool DEFAULT true` (`UNIQUE` + `CHECK (singleton)`؛ يعادل فهرس 6.6 الفريد على ثابت), `platform_academy_id uuid NULL` (المعرّف في القاعدة المركزية — للمطابقة فقط، لا مفتاح أجنبي), `slug varchar(32)`, `name jsonb`, `legal_name text NULL`, `logo_file_id → files NULL`, `default_locale varchar(10) DEFAULT 'ar'`, `supported_locales text[] DEFAULT '{ar,en}'`, `timezone text`, `currency char(3)`, `contact_email citext NULL`, `contact_phone varchar(32) NULL`, `address jsonb NULL`, `tax_number text NULL`, `website text NULL`, `settings jsonb DEFAULT '{}'` (إعدادات MOD-14 الأولية — 6.6 D3), [T]. يقابل `mockAcademySettings` والشاشة `/settings`.

**`academy_settings`** (اختياري لاحقاً — بديل `academy.settings` عند الحاجة إلى تاريخ تغييرات أو صلاحية لكل مفتاح؛ 6.6 D3) — إعدادات مفتاح/قيمة: `namespace varchar(64)`, `key varchar(64)`, `value jsonb`, `description text NULL`, `updated_by → users NULL`, `updated_at`. `UNIQUE(namespace, key)`. أمثلة مقترحة: `enrollment.self_registration` (bool)، `enrollment.requires_approval`، `auth.password_min_length`، `auth.session_days`، `grading.default_scheme_id`، `notifications.default_channels`، `finance.invoice_prefix`.

**`branches`** (REQ-03 "فروع إن وُجدت"؛ D14): `code varchar(16)`, `name jsonb`, `address jsonb NULL`, `phone varchar(32) NULL`, `timezone text NULL`, `is_main bool DEFAULT false`, `is_active bool DEFAULT true`, [T] [SD]. `UNIQUE(code)`.

**`rooms`** — القاعات والمعامل والقاعات الافتراضية: `branch_id → branches NULL (RESTRICT)`, `code varchar(16)`, `name jsonb NULL`, `capacity smallint NULL CHECK (capacity > 0)`, `kind enum room_kind(classroom, lab, hall, virtual)`, `is_active bool DEFAULT true`, [T]. `UNIQUE NULLS NOT DISTINCT (branch_id, code)`, `ix(branch_id)`.

**`academic_terms`** — الفصول/الفترات الدراسية: `code varchar(16)`, `name jsonb`, `starts_on date`, `ends_on date`, `is_current bool DEFAULT false`, [T]. `UNIQUE(code)`, `CHECK (ends_on > starts_on)`, فهرس فريد جزئي `WHERE is_current` (SQL).

##### C. المحتوى الأكاديمي والجدولة (MOD-04..MOD-07) — المرحلة B

**`levels`** — تصنيف المستويات (مبتدئ/متوسط/متقدم): `code varchar(16)`, `name jsonb`, `description jsonb NULL`, `sort_order smallint`, `is_active bool DEFAULT true`, [T]. `UNIQUE(code)`, `UNIQUE(sort_order)`.

**`course_categories`** — شجرة فئات: `parent_id → course_categories NULL`, `slug varchar(64)`, `name jsonb`, `sort_order smallint`, `is_active`, [T]. `UNIQUE(slug)`, `ix(parent_id)`.

**`courses`** — الدورة كمنتج تعليمي (يقابل `mockCourses`): `code varchar(32)`, `name jsonb`, `summary jsonb NULL`, `description jsonb NULL`, `category_id → course_categories NULL`, `level_id → levels NULL`, `status enum course_status(draft, published, archived)`, `duration_hours numeric(6,1) NULL`, `sessions_count smallint NULL`, `default_price numeric(12,2) NULL`, `currency char(3) NULL`, `min_age smallint NULL`, `max_age smallint NULL`, `cover_file_id → files NULL`, [CB] [T] [SD]. `UNIQUE(code)`, `ix(status)`, `ix(category_id)`, `ix(level_id)`, `CHECK (max_age IS NULL OR min_age IS NULL OR max_age >= min_age)`.

**`course_prerequisites`**: `course_id → courses (CASCADE)`, `prerequisite_course_id → courses (RESTRICT)`. `PK(course_id, prerequisite_course_id)`, `CHECK (course_id <> prerequisite_course_id)`.

**`course_syllabus_items`** — المنهج (قالب الدروس): `course_id → courses (CASCADE)`, `sort_order smallint`, `title jsonb`, `description jsonb NULL`, `estimated_minutes smallint NULL`, [T]. `UNIQUE(course_id, sort_order)`.

**`classes`** — الفصل/المجموعة: تنفيذ دورة لمجموعة طلاب في فترة (يقابل `mockClasses`): `course_id → courses (RESTRICT)`, `term_id → academic_terms NULL`, `branch_id → branches NULL`, `code varchar(32)`, `name jsonb`, `capacity smallint CHECK (capacity > 0)`, `status enum class_status(planned, open, running, completed, cancelled)`, `starts_on date NULL`, `ends_on date NULL`, `default_room_id → rooms NULL`, `price_override numeric(12,2) NULL`, `enrollment_opens_at timestamptz NULL`, `enrollment_closes_at timestamptz NULL`, `notes text NULL`, [CB] [T] [SD]. `UNIQUE(code)`, `ix(course_id)`, `ix(term_id)`, `ix(branch_id)`, `ix(status)`, `ix(default_room_id)`. عدد المسجّلين (`enrolled`) يُحسب من `enrollments` لا يُخزَّن.

**`class_teachers`**: `class_id → classes (CASCADE)`, `teacher_user_id → users (RESTRICT)`, `role enum class_teacher_role(lead, assistant)`, `assigned_at`. `PK(class_id, teacher_user_id)`, `ix(teacher_user_id)`, فهرس فريد جزئي `(class_id) WHERE role = 'lead'` (SQL).

**`enrollments`** — تسجيل طالب في فصل: `class_id → classes (RESTRICT)`, `student_user_id → users (RESTRICT)`, `status enum enrollment_status(pending, active, completed, withdrawn, cancelled)`, `source enum enrollment_source(admin, self, import, transfer)`, `enrolled_at`, `activated_at NULL`, `completed_at NULL`, `withdrawn_at NULL`, `withdrawal_reason text NULL`, `final_score numeric(6,2) NULL`, `final_grade_label jsonb NULL`, `grade_scheme_id → grade_schemes NULL`, [CB] [T]. `UNIQUE(class_id, student_user_id)` (إعادة التسجيل = إعادة تفعيل الصف نفسه), `ix(student_user_id)`, `ix(status)`.

**`class_schedules`** — الفترات الأسبوعية المتكررة (يقابل `mockSchedule`): `class_id → classes (CASCADE)`, `weekday smallint CHECK (weekday BETWEEN 0 AND 6)` (0 = الأحد), `start_time time`, `end_time time`, `room_id → rooms NULL`, `teacher_user_id → users NULL`, `effective_from date`, `effective_to date NULL`, [T]. `CHECK (end_time > start_time)`, `ix(class_id)`, `ix(room_id, weekday)`, `ix(teacher_user_id, weekday)`. الدروس الفعلية تُولَّد منها (`lessons.schedule_id`).

**`lessons`** — الجلسة الفعلية بتاريخ ووقت (يقابل `mockLessons`؛ MOD-06): `class_id → classes (CASCADE)`, `syllabus_item_id → course_syllabus_items NULL (SET NULL)`, `schedule_id → class_schedules NULL (SET NULL)`, `title jsonb`, `description jsonb NULL`, `delivery_mode enum delivery_mode(in_person, live_online, recorded, hybrid)`, `starts_at timestamptz`, `ends_at timestamptz`, `room_id → rooms NULL`, `teacher_user_id → users NULL`, `status enum lesson_status(scheduled, in_progress, completed, cancelled)`, `meeting_provider varchar(32) NULL`, `meeting_url text NULL`, `meeting_external_id text NULL`, `cancellation_reason text NULL`, `attendance_taken_at timestamptz NULL`, [CB] [T]. `CHECK (ends_at > starts_at)`, `ix(class_id, starts_at)`, `ix(teacher_user_id, starts_at)`, `ix(room_id, starts_at)`, `ix(status, starts_at)`. **كشف التعارض في القاعدة:** `EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (room_id IS NOT NULL AND status <> 'cancelled')` ومثله للمعلم (`btree_gist`، SQL يدوي — 6.7.6).

**`lesson_recordings`**: `lesson_id → lessons (CASCADE)`, `file_id → files NULL`, `external_provider varchar(32) NULL`, `external_url text NULL`, `duration_seconds int NULL`, `status enum recording_status(processing, ready, failed)`, `visibility enum recording_visibility(enrolled_only, academy, public)`, `published_at NULL`, [T]. `ix(lesson_id)`, `CHECK (file_id IS NOT NULL OR external_url IS NOT NULL)`. مزوّد البث/التخزين `NOT YET DETERMINED` (MOD-15).

**`lesson_materials`**: `lesson_id → lessons (CASCADE)`, `file_id → files NULL (RESTRICT)`, `link_url text NULL`, `title jsonb`, `sort_order smallint`, `created_at`. `ix(lesson_id)`, `CHECK (file_id IS NOT NULL OR link_url IS NOT NULL)`.

**`attendance_records`**: `lesson_id → lessons (CASCADE)`, `student_user_id → users (RESTRICT)`, `status enum attendance_status(present, absent, late, excused)`, `minutes_late smallint NULL`, `note text NULL`, `recorded_by → users NULL`, `recorded_at`, `updated_at`. `UNIQUE(lesson_id, student_user_id)`, `ix(student_user_id)`.

##### D. التقييم (MOD-08, MOD-09) — المرحلة C

**`assignments`** (يقابل `mockAssignments`): `class_id → classes (CASCADE)`, `lesson_id → lessons NULL (SET NULL)`, `title jsonb`, `instructions jsonb NULL`, `max_score numeric(6,2) CHECK (max_score > 0)`, `weight numeric(5,2) NULL`, `status enum assignment_status(draft, open, closed, grading, graded)`, `published_at NULL`, `due_at timestamptz NULL`, `allow_late bool DEFAULT false`, `late_penalty_percent numeric(5,2) NULL`, `max_attempts smallint DEFAULT 1`, [CB] [T] [SD]. `ix(class_id, due_at)`, `ix(status)`.

**`assignment_submissions`**: `assignment_id → assignments (CASCADE)`, `student_user_id → users (RESTRICT)`, `attempt_no smallint DEFAULT 1`, `submitted_at`, `is_late bool`, `text_answer text NULL`, `status enum submission_status(submitted, graded, returned)`, `score numeric(6,2) NULL CHECK (score >= 0)`, `feedback text NULL`, `graded_by → users NULL`, `graded_at NULL`, [T]. `UNIQUE(assignment_id, student_user_id, attempt_no)`, `ix(student_user_id)`.

**`submission_files`**: `submission_id → assignment_submissions (CASCADE)`, `file_id → files (RESTRICT)`. `PK(submission_id, file_id)`.

**`question_banks`**: `course_id → courses NULL`, `name jsonb`, `description jsonb NULL`, [CB] [T] [SD]. `ix(course_id)`.

**`questions`**: `bank_id → question_banks (RESTRICT)`, `type enum question_type(single_choice, multiple_choice, true_false, short_answer, essay, code)`, `prompt jsonb`, `explanation jsonb NULL`, `default_points numeric(6,2) DEFAULT 1`, `difficulty enum difficulty(easy, medium, hard) NULL`, `tags text[] DEFAULT '{}'`, `metadata jsonb NULL` (لغة الكود، حدود…), [CB] [T] [SD]. `ix(bank_id)`, `ix(type)`, `gin(tags)`.

**`question_options`**: `question_id → questions (CASCADE)`, `text jsonb`, `is_correct bool`, `sort_order smallint`, `feedback jsonb NULL`. `UNIQUE(question_id, sort_order)`. (وجود خيار صحيح واحد على الأقل يُفرض في الخادم.)

**`exams`** (يقابل `mockExams`): `class_id → classes (CASCADE)`, `title jsonb`, `description jsonb NULL`, `type enum exam_type(quiz, midterm, final, placement, practice)`, `status enum exam_status(draft, scheduled, open, closed, grading, published)`, `opens_at timestamptz NULL`, `closes_at timestamptz NULL`, `duration_minutes smallint CHECK (duration_minutes > 0)`, `max_score numeric(6,2)`, `pass_score numeric(6,2) NULL`, `weight numeric(5,2) NULL`, `attempts_allowed smallint DEFAULT 1`, `shuffle_questions bool DEFAULT false`, `shuffle_options bool DEFAULT false`, `results_visibility enum results_visibility(immediately, after_close, manual)`, `settings jsonb NULL`, [CB] [T] [SD]. `CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)`, `ix(class_id, opens_at)`, `ix(status)`.

**`exam_questions`**: `exam_id → exams (CASCADE)`, `question_id → questions (RESTRICT)`, `sort_order smallint`, `points numeric(6,2)`. `PK(exam_id, question_id)`, `UNIQUE(exam_id, sort_order)`. تعديل سؤال بعد فتح الاختبار يُمنع في الخادم (أو يُنسخ كإصدار جديد) — `NOT YET DETERMINED`.

**`exam_attempts`**: `exam_id → exams (CASCADE)`, `student_user_id → users (RESTRICT)`, `attempt_no smallint`, `started_at`, `expires_at`, `submitted_at NULL`, `status enum attempt_status(in_progress, submitted, graded, expired, voided)`, `auto_score numeric(6,2) NULL`, `manual_score numeric(6,2) NULL`, `total_score numeric(6,2) NULL`, `graded_by → users NULL`, `graded_at NULL`, `ip inet NULL`, `user_agent text NULL`. `UNIQUE(exam_id, student_user_id, attempt_no)`, `ix(student_user_id)`, `ix(status)`.

**`exam_answers`**: `attempt_id → exam_attempts (CASCADE)`, `question_id → questions (RESTRICT)`, `selected_option_ids uuid[] NULL`, `answer_text text NULL`, `answer_json jsonb NULL`, `is_correct bool NULL`, `score numeric(6,2) NULL`, `grader_feedback text NULL`, `graded_by → users NULL`, `answered_at`. `UNIQUE(attempt_id, question_id)`.

**`grade_schemes`** و**`grade_scheme_bands`** — سلالم التقدير (ممتاز/جيد جداً… كما في `mockCertificates.grade`): `grade_schemes(name jsonb, is_default bool, [T])`؛ `grade_scheme_bands(scheme_id → grade_schemes (CASCADE), min_percent numeric(5,2), max_percent numeric(5,2), label jsonb, letter varchar(4) NULL, gpa_points numeric(3,2) NULL, is_pass bool)`. `UNIQUE(scheme_id, min_percent)`, `CHECK (min_percent >= 0 AND max_percent <= 100 AND max_percent >= min_percent)`، عدم التداخل: `EXCLUDE USING gist (scheme_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&)` (SQL).

**`gradebook_entries`** — دفتر الدرجات الموحّد لكل تسجيل (مصدر احتساب الدرجة النهائية — WF-08): `enrollment_id → enrollments (CASCADE)`, `source_type enum gradebook_source(assignment, exam, attendance, participation, manual)`, `source_id uuid NULL` (معرّف الواجب/الاختبار), `title jsonb`, `score numeric(6,2)`, `max_score numeric(6,2) CHECK (max_score > 0)`, `weight numeric(5,2) NULL`, `recorded_by → users NULL`, `recorded_at`, `updated_at`. `UNIQUE NULLS NOT DISTINCT (enrollment_id, source_type, source_id)`, `ix(enrollment_id)`. **معادلة الدرجة النهائية** (مقترح افتراضي، D17): المتوسط الموزون `Σ(score/max_score × weight) / Σ(weight)` مع أوزان المكوّنات من `assignments.weight`/`exams.weight`؛ تُحفظ النتيجة في `enrollments.final_score` وتُترجم إلى تقدير عبر سلم التقدير.

##### E. الشهادات والسجل الأكاديمي (MOD-10) — المرحلة C

**`certificate_templates`**: `name jsonb`, `serial_prefix varchar(16)` (مثل `ACA`), `layout jsonb` (حقول التصميم/القالب), `background_file_id → files NULL`, `is_active bool`, `is_default bool`, [T].

**`certificates`** (يقابل `mockCertificates`): `serial varchar(32)` (مثل `ACA-2026-0001` من `number_sequences`), `verification_code varchar(32)` (عشوائي للتحقق العام), `student_user_id → users (RESTRICT)`, `enrollment_id → enrollments NULL`, `course_id → courses (RESTRICT)`, `template_id → certificate_templates (RESTRICT)`, `status enum certificate_status(issued, revoked)`, `issued_at`, `issued_by → users NULL`, `final_score numeric(6,2) NULL`, `grade_label jsonb NULL`, `snapshot jsonb` (اسم الطالب والدورة والتقدير لحظة الإصدار — لا يتأثر بتعديلات لاحقة), `pdf_file_id → files NULL`, `revoked_at NULL`, `revoke_reason text NULL`, `created_at`. `UNIQUE(serial)`, `UNIQUE(verification_code)`, `UNIQUE(enrollment_id)`, `ix(student_user_id)`, `ix(course_id)`. **لا حذف**.

**السجل الأكاديمي (transcript):** لا جدول؛ **عرض** `v_student_transcript` يجمع `enrollments` + `gradebook_entries` + `attendance_records` + `certificates` لكل طالب (يُنشأ في ترحيل بـ SQL يدوي).

##### F. المالية (MOD-11) — المرحلة D

**`fee_plans`** — خطط الرسوم والأقساط: `name jsonb`, `course_id → courses NULL`, `class_id → classes NULL`, `total_amount numeric(12,2) CHECK (total_amount >= 0)`, `currency char(3)`, `installments_count smallint CHECK (installments_count >= 1)`, `is_active bool DEFAULT true`, [CB] [T]. `ix(course_id)`, `ix(class_id)`.

**`fee_plan_installments`**: `fee_plan_id → fee_plans (CASCADE)`, `seq smallint`, `amount numeric(12,2)`, `due_offset_days int` (من تاريخ إصدار الفاتورة). `UNIQUE(fee_plan_id, seq)`. (مطابقة مجموع الأقساط للإجمالي تُفرض في الخادم.)

**`invoices`** (يقابل `mockPayments.invoice`): `number varchar(32)` (مثل `INV-2026-0101`), `student_user_id → users (RESTRICT)`, `payer_user_id → users NULL` (ولي الأمر المسؤول مالياً), `enrollment_id → enrollments NULL`, `fee_plan_id → fee_plans NULL`, `status enum invoice_status(draft, issued, partially_paid, paid, overdue, cancelled, refunded)`, `currency char(3)`, `subtotal numeric(12,2)`, `discount_amount numeric(12,2) DEFAULT 0`, `tax_amount numeric(12,2) DEFAULT 0`, `total_amount numeric(12,2)`, `paid_amount numeric(12,2) DEFAULT 0`, `issued_at NULL`, `due_at date NULL`, `notes text NULL`, [CB] [T]. `UNIQUE(number)`, `CHECK (total_amount = subtotal - discount_amount + tax_amount)`, `CHECK (paid_amount >= 0 AND paid_amount <= total_amount)`, `ix(student_user_id)`, `ix(payer_user_id)`, `ix(status, due_at)`, `ix(enrollment_id)`. **لا حذف** (إلغاء بالحالة). الرصيد = `total_amount - paid_amount` يُحسب في الاستعلام.

**`invoice_lines`**: `invoice_id → invoices (CASCADE)`, `kind enum invoice_line_kind(tuition, registration, materials, exam_fee, certificate_fee, discount, other)`, `description jsonb`, `quantity numeric(10,2) DEFAULT 1`, `unit_price numeric(12,2)`, `amount numeric(12,2)`, `class_id → classes NULL`, `sort_order smallint`. `ix(invoice_id)`.

**`installments`** — أقساط الفاتورة الفعلية: `invoice_id → invoices (CASCADE)`, `seq smallint`, `amount numeric(12,2)`, `due_at date`, `paid_amount numeric(12,2) DEFAULT 0`, `status enum installment_status(pending, partially_paid, paid, overdue, waived)`, `paid_at NULL`, [T]. `UNIQUE(invoice_id, seq)`, `ix(status, due_at)`.

**`payments`** — الدفعات/الإيصالات (يقابل `mockPayments.method/status`): `number varchar(32)` (إيصال، مثل `RCPT-2026-0001`), `invoice_id → invoices (RESTRICT)`, `installment_id → installments NULL`, `payer_user_id → users NULL`, `amount numeric(12,2) CHECK (amount > 0)`, `currency char(3)`, `method enum payment_method(cash, bank_transfer, card, online_gateway, wallet, cheque, other)`, `status enum payment_status(pending, completed, failed, cancelled, refunded)`, `paid_at`, `reference_no text NULL`, `gateway varchar(32) NULL`, `gateway_payment_id text NULL`, `gateway_payload jsonb NULL`, `received_by → users NULL`, `notes text NULL`, [T]. `UNIQUE(number)`, فهرس فريد جزئي `(gateway, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL` (منع الازدواج من webhooks), `ix(invoice_id)`, `ix(installment_id)`, `ix(paid_at)`, `ix(status)`. تحديث `invoices.paid_amount`/`installments.paid_amount` يتم في نفس المعاملة (transaction) في الخادم. بوابة الدفع `NOT YET DETERMINED` (MOD-15).

**`refunds`**: `payment_id → payments (RESTRICT)`, `amount numeric(12,2) CHECK (amount > 0)`, `reason text`, `status enum refund_status(requested, approved, processed, rejected)`, `requested_by → users NULL`, `approved_by → users NULL`, `processed_at NULL`, `gateway_refund_id text NULL`, [T]. `ix(payment_id)`.

مؤجَّل إلى إصدار لاحق (`PLANNED`): الخصومات والقسائم، دفتر أستاذ مزدوج القيد، تعدد العملات، الرواتب.

##### G. الإشعارات (MOD-12) — المرحلة D

**`notification_templates`**: `key varchar(64)` (حدث، مثل `lesson.reminder`), `channel enum notification_channel(in_app, email, sms, push)`, `locale varchar(10)`, `subject text NULL`, `body text` (قالب بمتغيرات), `is_active bool`, `updated_at`. `UNIQUE(key, channel, locale)`.

**`notifications`** (يقابل `mockNotifications`؛ تُصيَّر بلغة المستلم لحظة الإنشاء): `recipient_user_id → users (CASCADE)`, `event_key varchar(64)`, `channel enum notification_channel`, `title text`, `body text`, `data jsonb NULL` (رابط عميق ومعرّفات), `status enum notification_status(queued, sent, delivered, failed, cancelled)`, `read_at NULL`, `sent_at NULL`, `failed_reason text NULL`, `provider_message_id text NULL`, `created_at`. `ix(recipient_user_id, created_at DESC)`, فهرس جزئي `(recipient_user_id) WHERE read_at IS NULL AND channel = 'in_app'` (عدّاد غير المقروء), فهرس جزئي `(created_at) WHERE status = 'queued'` (SQL). تقسيم شهري عند تجاوز عشرات الملايين (6.7.9).

**`notification_preferences`**: `user_id → users (CASCADE)`, `event_key varchar(64)`, `channel enum notification_channel`, `enabled bool`. `PK(user_id, event_key, channel)`.

**`device_tokens`** (push؛ MOD-15): `user_id → users (CASCADE)`, `platform enum device_platform(ios, android, web)`, `token text`, `last_seen_at`, `created_at`. `UNIQUE(token)`, `ix(user_id)`.

##### H. جداول مشتركة (كل الوحدات) — المرحلة A

**`files`** — فهرس الملفات (التخزين الفعلي خارج القاعدة: قرص محلي أو S3 متوافق — `NOT YET DETERMINED`): `owner_user_id → users NULL (SET NULL)`, `storage_provider varchar(16)`, `bucket varchar(128) NULL`, `object_key text`, `original_name text`, `mime_type varchar(128)`, `size_bytes bigint CHECK (size_bytes >= 0)`, `sha256 char(64) NULL`, `visibility enum file_visibility(private, academy, public)`, `created_at`, [SD]. `UNIQUE(object_key)`, `ix(owner_user_id)`, `ix(sha256)`.

**`audit_logs`** — إلحاقي فقط (NFR-05، 12.2): `id` (`uuid` وفق D4 المعتمد، أو `bigint GENERATED ALWAYS AS IDENTITY` إن اعتُمد D22), `actor_type enum actor_type(user, system, platform_admin)`, `actor_user_id → users NULL (SET NULL)`, `actor_platform_user_id uuid NULL` (من `support_access_grants`), `action varchar(64)` (مثل `users.create`, `grades.update`, `payments.record`), `entity_type varchar(64)`, `entity_id text NULL` (يقبل مفاتيح غير UUID — 6.6.1), `before jsonb NULL`, `after jsonb NULL`, `ip inet NULL`, `user_agent text NULL`, `request_id uuid NULL`, `created_at`. `ix(entity_type, entity_id)`, `ix(actor_user_id, created_at)`, `ix(created_at)`. trigger الإلحاق المعتمد (D5/P11) + **`REVOKE UPDATE, DELETE ON audit_logs FROM <app role>`** في الترحيل (SQL)؛ تقسيم شهري لاحقاً.

**`number_sequences`** — أرقام تسلسلية قابلة للقراءة (رقم الطالب، الفاتورة، الإيصال، الشهادة): `key varchar(32)`, `period varchar(8)` (`''` أو `2026` أو `2026-10`), `last_value bigint DEFAULT 0`. `PK(key, period)`؛ تُقرأ بـ `SELECT … FOR UPDATE` داخل معاملة الإنشاء.

**`outbox_events`** — صندوق صادر معاملاتي (موثوقية الإشعارات والتكاملات): `aggregate_type varchar(64)`, `aggregate_id uuid`, `event_type varchar(64)`, `payload jsonb`, `status enum outbox_status(pending, processing, processed, failed)`, `attempts smallint DEFAULT 0`, `available_at`, `processed_at NULL`, `last_error text NULL`, `created_at`. `ix(status, available_at)`. يُنظَّف دورياً بعد المعالجة.

#### 6.7.5 مخططات ER (Mermaid) — المفاتيح والحقول الرئيسة فقط

**(1) الهوية وهيكل الأكاديمية (المرحلة A):**

```mermaid
erDiagram
    users ||--o{ user_roles : holds
    roles ||--o{ user_roles : "granted as"
    roles ||--o{ role_permissions : grants
    permissions ||--o{ role_permissions : "granted by"
    users ||--o| student_profiles : "is student"
    users ||--o| employee_profiles : "is teacher/staff"
    users ||--o{ guardian_students : guardian
    users ||--o{ guardian_students : student
    users ||--o{ refresh_tokens : has
    users ||--o{ verification_tokens : has
    users ||--o{ user_identities : "linked to"
    branches ||--o{ rooms : contains
    branches ||--o{ user_roles : scopes
    users ||--o{ audit_logs : acts
    users ||--o{ files : owns
    users {
        uuid id PK
        citext email UK
        citext username UK
        text password_hash
        text full_name
        user_status status
        timestamptz deleted_at
    }
    roles {
        uuid id PK
        varchar key UK
        jsonb label
        bool is_system
    }
    permissions {
        varchar key PK
        varchar module
    }
    user_roles {
        uuid id PK
        uuid user_id FK
        uuid role_id FK
        uuid branch_id FK
    }
    student_profiles {
        uuid user_id PK
        varchar student_number UK
        date date_of_birth
        uuid current_level_id FK
    }
    employee_profiles {
        uuid user_id PK
        varchar employee_number UK
        employee_kind kind
    }
    guardian_students {
        uuid guardian_user_id PK
        uuid student_user_id PK
        relationship_type relationship
        bool is_primary
    }
    academy {
        uuid id PK
        bool singleton UK
        varchar slug
        jsonb name
        char3 currency
    }
    academy_settings {
        uuid id PK
        varchar namespace
        varchar key
        jsonb value
    }
    branches {
        uuid id PK
        varchar code UK
        jsonb name
    }
    rooms {
        uuid id PK
        uuid branch_id FK
        varchar code
        room_kind kind
    }
```

**(2) الأكاديمي والجدولة والتقييم (المرحلتان B وC):**

```mermaid
erDiagram
    levels ||--o{ courses : classifies
    course_categories ||--o{ courses : groups
    courses ||--o{ course_syllabus_items : "has syllabus"
    courses ||--o{ course_prerequisites : requires
    courses ||--o{ classes : "delivered as"
    academic_terms ||--o{ classes : "runs in"
    rooms ||--o{ classes : "default room"
    classes ||--o{ class_teachers : taught_by
    users ||--o{ class_teachers : teacher
    classes ||--o{ enrollments : enrolls
    users ||--o{ enrollments : student
    classes ||--o{ class_schedules : "weekly slots"
    classes ||--o{ lessons : sessions
    class_schedules ||--o{ lessons : generates
    course_syllabus_items ||--o{ lessons : covers
    rooms ||--o{ lessons : "held in"
    lessons ||--o{ lesson_recordings : recorded
    lessons ||--o{ lesson_materials : materials
    lessons ||--o{ attendance_records : attendance
    classes ||--o{ assignments : has
    assignments ||--o{ assignment_submissions : receives
    assignment_submissions ||--o{ submission_files : attaches
    question_banks ||--o{ questions : contains
    questions ||--o{ question_options : options
    classes ||--o{ exams : has
    exams ||--o{ exam_questions : includes
    questions ||--o{ exam_questions : "used in"
    exams ||--o{ exam_attempts : attempted
    exam_attempts ||--o{ exam_answers : answers
    enrollments ||--o{ gradebook_entries : gradebook
    grade_schemes ||--o{ grade_scheme_bands : bands
    grade_schemes ||--o{ enrollments : grades
    enrollments ||--o| certificates : "certified by"
    certificate_templates ||--o{ certificates : renders
    courses {
        uuid id PK
        varchar code UK
        jsonb name
        course_status status
        uuid level_id FK
    }
    classes {
        uuid id PK
        uuid course_id FK
        varchar code UK
        smallint capacity
        class_status status
    }
    enrollments {
        uuid id PK
        uuid class_id FK
        uuid student_user_id FK
        enrollment_status status
        numeric final_score
    }
    lessons {
        uuid id PK
        uuid class_id FK
        timestamptz starts_at
        timestamptz ends_at
        delivery_mode delivery_mode
        lesson_status status
        uuid room_id FK
        uuid teacher_user_id FK
    }
    assignments {
        uuid id PK
        uuid class_id FK
        numeric max_score
        timestamptz due_at
        assignment_status status
    }
    exams {
        uuid id PK
        uuid class_id FK
        exam_type type
        smallint duration_minutes
        numeric max_score
        exam_status status
    }
    exam_attempts {
        uuid id PK
        uuid exam_id FK
        uuid student_user_id FK
        smallint attempt_no
        attempt_status status
        numeric total_score
    }
    gradebook_entries {
        uuid id PK
        uuid enrollment_id FK
        gradebook_source source_type
        uuid source_id
        numeric score
        numeric max_score
        numeric weight
    }
    certificates {
        uuid id PK
        varchar serial UK
        varchar verification_code UK
        uuid student_user_id FK
        uuid enrollment_id FK
        certificate_status status
    }
```

**(3) المالية والإشعارات (المرحلة D):**

```mermaid
erDiagram
    fee_plans ||--o{ fee_plan_installments : "split into"
    courses ||--o{ fee_plans : prices
    classes ||--o{ fee_plans : prices
    users ||--o{ invoices : "billed student"
    users ||--o{ invoices : payer
    enrollments ||--o{ invoices : "charged for"
    fee_plans ||--o{ invoices : "based on"
    invoices ||--o{ invoice_lines : lines
    invoices ||--o{ installments : "due in"
    invoices ||--o{ payments : "paid by"
    installments ||--o{ payments : settles
    payments ||--o{ refunds : refunded
    users ||--o{ notifications : receives
    users ||--o{ notification_preferences : prefers
    users ||--o{ device_tokens : devices
    invoices {
        uuid id PK
        varchar number UK
        uuid student_user_id FK
        uuid payer_user_id FK
        invoice_status status
        numeric total_amount
        numeric paid_amount
        date due_at
    }
    installments {
        uuid id PK
        uuid invoice_id FK
        smallint seq
        numeric amount
        date due_at
        installment_status status
    }
    payments {
        uuid id PK
        varchar number UK
        uuid invoice_id FK
        uuid installment_id FK
        numeric amount
        payment_method method
        payment_status status
        timestamptz paid_at
    }
    refunds {
        uuid id PK
        uuid payment_id FK
        numeric amount
        refund_status status
    }
    notifications {
        uuid id PK
        uuid recipient_user_id FK
        varchar event_key
        notification_channel channel
        notification_status status
        timestamptz read_at
    }
    notification_templates {
        uuid id PK
        varchar key
        notification_channel channel
        varchar locale
    }
```

#### 6.7.6 ما يُكتب يدوياً في ملفات الترحيل (لا تعبّر عنه Prisma)

| العنصر | SQL (مختصر) | الجداول |
|---|---|---|
| الامتدادات (في أول ترحيل لكل قاعدة) | `CREATE EXTENSION IF NOT EXISTS citext; … pgcrypto; … btree_gist; … pg_trgm;` (كلها موثوقة — يستطيع مالك القاعدة `articode_migrator` إنشاءها بلا superuser) | — |
| قيود `CHECK` | كما وردت في 6.7.4 (`ALTER TABLE … ADD CONSTRAINT ck_… CHECK (…)`) | `users`, `rooms`, `academic_terms`, `courses`, `classes`, `class_schedules`, `lessons`, `assignments`, `exams`, `grade_scheme_bands`, `invoices`, `payments`, … |
| تعارض الجدولة | `ALTER TABLE lessons ADD CONSTRAINT ex_lessons_room EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (room_id IS NOT NULL AND status <> 'cancelled');` ومثله `ex_lessons_teacher` على `teacher_user_id` | `lessons` |
| عدم تداخل سلالم التقدير | `EXCLUDE USING gist (scheme_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&)` | `grade_scheme_bands` |
| فرادة مع `NULL` | `CREATE UNIQUE INDEX … ON user_roles (user_id, role_id, branch_id) NULLS NOT DISTINCT;` ومثله `rooms(branch_id, code)` و`gradebook_entries(enrollment_id, source_type, source_id)` | — |
| فهارس جزئية | `… WHERE is_primary`, `… WHERE is_current`, `… WHERE role = 'lead'`, `… WHERE read_at IS NULL AND channel = 'in_app'`, `… WHERE status = 'queued'`, `… WHERE gateway_payment_id IS NOT NULL` | `guardian_students`, `academic_terms`, `class_teachers`, `notifications`, `payments`, `domains` |
| البحث بالاسم | `CREATE INDEX ix_users_full_name_trgm ON users USING gin (full_name gin_trgm_ops);` | `users` |
| حماية التدقيق | `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM articode_app;` (اسم الدور من البيئة في وضع `multi`) | `audit_logs`, `platform_audit_logs` |
| العروض | `CREATE VIEW v_student_transcript …`, `v_student_balance …`, `v_class_occupancy …` | — |

**الإجراء:** `prisma migrate dev --create-only` → تحرير ملف `migration.sql` المولَّد بإضافة ما سبق → `prisma migrate dev` لتطبيقه → مراجعة → التزام. Prisma يحتفظ بـ SQL اليدوي ولا يعيد توليده؛ أي انحراف يظهر في `migrate status`/`migrate diff`.

#### 6.7.7 استراتيجية Prisma Migrations وإدارة قواعد الأكاديميات (ADR-021)

**ما يغطيه 6.6.3 لا يُكرَّر هنا** (مخططان وملفا إعداد مع `--config`، التطوير المحلي، حارس الانجراف في CI، إصدار المخطط، الطرح التسلسلي مع كناري، بوابة `schema_outdated`، expand/contract، أدوار الإنتاج، التراجع). الإضافات المقترحة:

**(أ) مخطط متعدد الملفات لكل مجال (اختياري):** بدل ملف `schema.prisma` واحد لقاعدة الأكاديمية، مجلد `prisma/tenant/` بملف لكل مجال (`identity.prisma`, `academy.prisma`, `academic.prisma`, `assessment.prisma`, `finance.prisma`, `notifications.prisma`, `shared.prisma`) مع `schema.prisma` للمولّد ومصدر البيانات؛ Prisma يدعم مجلد مخطط في `prisma.config.ts` (`schema: 'prisma/tenant'`). يُقرَّر عند المرحلة B حين يتجاوز المخطط نحو 30 نموذجاً.

**(ب) قاعدة المنصة محلياً:** سكربت initdb ثانٍ `docker/postgres/initdb/20-platform-db.sh` ينشئ `articode_platform` ودورَي `platform_migrator`/`platform_app` بنمط `10-roles.sh`، ويُشغَّل يدوياً مرة واحدة على المجلد القائم (**بلا** `down -v`)؛ متغيرات مقترحة `PLATFORM_DATABASE_URL`/`PLATFORM_MIGRATION_DATABASE_URL` و`TENANCY_MODE=single` افتراضياً (تُعلن في `env.schema.ts` و11.3 عند التنفيذ).

**(ج) تسلسل تزويد أكاديمية (WF-01) كوظيفة `academy_jobs` قابلة للاستئناف:**

```mermaid
sequenceDiagram
    participant SA as Super Admin UI
    participant P as Platform API (NestJS)
    participant PDB as articode_platform
    participant PG as PostgreSQL cluster (provisioner role)
    participant T as aca_{slug}
    SA->>P: POST /platform/academies {slug, name, owner, locale, tz, currency}
    P->>PDB: INSERT academies(status=provisioning) + academy_jobs(kind=create_database)
    P->>PG: CREATE ROLE app_{slug} LOGIN NOBYPASSRLS …; CREATE DATABASE aca_{slug} OWNER migrator
    P->>PG: REVOKE CONNECT FROM PUBLIC; GRANT CONNECT TO app_{slug}; default privileges (كما 10-roles.sh)
    P->>PDB: INSERT academy_databases(host, port, db, app_role, app_secret_enc, status=migrating)
    P->>T: prisma migrate deploy (مخطط الأكاديمية) بدور migrator
    P->>T: seed (الصلاحيات، أدوار النظام، صف academy بـ platform_academy_id، إعدادات افتراضية)
    P->>T: INSERT users(status=invited) + verification_tokens(invitation) لأول Academy Admin
    P->>PDB: tenant_migration_runs(…), academy_databases.status=ready, academies.status=active
    P-->>SA: 201 + رابط دعوة المدير (يُرسل بالبريد)
```

كل خطوة idempotent وتسجّل نتيجتها في `academy_jobs` (`result jsonb`, `attempts`)؛ الفشل يوقف الوظيفة بحالة `failed` مع إمكانية الإعادة من الخطوة الفاشلة. دور التزويد (`CREATEDB CREATEROLE`، بلا superuser) يُستخدم للتزويد فقط ولا يُستخدم في الطلبات العادية.

**(د) إضافات على الطرح:** بعد نجاح الكناري يمكن توازٍ محدود (3–5 قواعد) بدل التسلسل الصارم عند تجاوز عشرات الأكاديميات؛ كل تشغيل يُسجَّل في `tenant_migration_runs` لا في `schema_version` وحده؛ CI يطبّق كامل تاريخ الترحيلات على قاعدة فارغة، ويُختبر الترحيل على نسخة مجهولة الهوية من قاعدة أكاديمية حقيقية قبل الإنتاج.

**(هـ) البذر (seed):** `permissions` وأدوار النظام (`is_system`) وقوالب الإشعارات وسلم التقدير الافتراضي تُبذر بـ `upsert` بعد كل `deploy` (الكتالوج يتطور مع الكود؛ المهمل يُعلَّم `deprecated_at` ولا يُحذف — 6.6.1)؛ البذر لا يغيّر ما أنشأه المستخدمون (الأدوار المخصّصة، إعداداتهم). بيانات تجريبية (`mock/data.ts`) تُبذر في بيئة التطوير فقط بسكربت منفصل.

#### 6.7.8 المستخدمون والصلاحيات والتسجيل عبر الأكاديميات (ADR-022، ADR-023)

**نطاق الهوية (ADR-022):** الحساب يخص **أكاديمية واحدة** ويعيش في قاعدتها. الشخص نفسه في أكاديميتين = حسابان مستقلان (قد يحملان البريد نفسه)؛ لا هوية عالمية في الإصدار الأول. الدخول يجري دائماً في سياق أكاديمية محددة (نطاقها الفرعي، أو اختيارها في تطبيق المحمول) فيُبحث عن المستخدم في قاعدتها فقط. Super Admin حساب من نوع آخر (`platform_users`) لا يدخل إلى أكاديمية إلا عبر `support_access_grants` مؤقت ومعلَّل ومسجَّل في التدقيق على الجانبين. الاتحاد المستقبلي (دخول موحّد عبر الأكاديميات) ممكن لاحقاً عبر `user_identities(provider = platform_sso)` دون تغيير المخطط.

**نموذج الصلاحيات (ADR-023):** RBAC بكتالوج صلاحيات دقيقة + أدوار مخصّصة (ROLE-07):

- **كتالوج الصلاحيات** (`permissions.key`، يُبذر من ثابت في الكود — المصدر الوحيد): `academy.settings.read|manage`, `branches.manage`, `users.read|create|update|deactivate`, `users.roles.assign`, `roles.manage`, `guardians.link`, `courses.read|manage`, `classes.read|manage`, `classes.teachers.assign`, `enrollments.read|manage`, `enrollments.self_enroll`, `schedule.read|manage`, `lessons.read|manage`, `recordings.manage`, `attendance.read|record`, `assignments.read|manage|submit|grade`, `exams.read|manage|take|grade`, `questions.manage`, `grades.read_own|read_linked|read_all|manage`, `certificates.read_own|read_linked|read_all|issue|revoke`, `invoices.read_own|read_linked|read_all|manage`, `payments.record|refund`, `fee_plans.manage`, `notifications.send`, `notifications.templates.manage`, `reports.academic|financial|attendance.view`, `audit.read`.
- **النطاق:** اللاحقات `read_own` (بيانات المستخدم نفسه)، `read_linked` (طلاب ولي الأمر عبر `guardian_students` وأعلامها)، `read_all` (الأكاديمية كلها). نطاق المعلم ("فصولي") يُفرض بالانتماء إلى `class_teachers` داخل الخدمة، لا بمفتاح صلاحية. `user_roles.branch_id` يضيّق أي صلاحية إلى فرع.
- **الأدوار الافتراضية** (قابلة للتعديل من قبل Academy Admin عدا `academy_admin` الذي يملك كل المفاتيح دائماً):

| المجموعة | academy_admin | teacher | student | guardian | staff |
|---|---|---|---|---|---|
| الإعدادات والفروع والأدوار والتدقيق | الكل | — | — | — | — |
| المستخدمون | الكل | `users.read` | — | — | `users.read|create|update`, `guardians.link` |
| الدورات والفصول والجدولة | الكل | `*.read` | `courses.read`, `schedule.read` | `courses.read`, `schedule.read` | `*.read`, `classes.manage`, `enrollments.manage` |
| الدروس والحضور والتسجيلات | الكل | `lessons.manage`, `attendance.record`, `recordings.manage` | `lessons.read` | `attendance.read` | `lessons.read`, `attendance.read` |
| الواجبات والاختبارات | الكل | `*.manage`, `*.grade`, `questions.manage` | `*.read`, `assignments.submit`, `exams.take` | `*.read` | — |
| الدرجات والشهادات | الكل | `grades.read_all`, `grades.manage` | `grades.read_own`, `certificates.read_own` | `grades.read_linked`, `certificates.read_linked` | `certificates.issue` |
| المالية | الكل | — | `invoices.read_own` | `invoices.read_linked` | `invoices.manage`, `payments.record`, `fee_plans.manage` |
| الإشعارات والتقارير | الكل | `notifications.send` (لفصوله) | — | — | `reports.financial.view`, `reports.attendance.view` |

هذه المصفوفة تتسق مع مصفوفة الشاشات في 7.2 وتحلّ محلّها كمصدر للفرض عند التنفيذ (7.3)؛ الواجهة تخفي ما لا يملك المستخدم مفتاحه.

**الفرض في الخادم:** `AuthGuard` (JWT وصول قصير العمر 10–15 دقيقة؛ المطالبات `sub`, `aca`, `roles`, `pv` = إصدار الصلاحيات) + `PermissionsGuard` (`@RequirePermissions('courses.manage')`) + فحوص نطاق داخل الخدمات. تُحسب صلاحيات المستخدم من `user_roles → role_permissions` عند كل طلب (أو تُخزَّن مؤقتاً دقائق مع إبطال عند تغيير الأدوار). رمز التحديث (7–30 يوماً، من `academy_settings`) يُخزَّن تجزئةً في `refresh_tokens` ويُدوَّر عند كل استخدام؛ إعادة استخدام رمز مدوَّر تُبطل العائلة كلها. كلمات المرور argon2id بمعاملات OWASP الحالية؛ قفل مؤقت بعد محاولات فاشلة؛ تحديد معدل على مسارات الدخول (MOD-00).

**مسارات التسجيل (WF-02):**

| المسار | الخطوات | الجداول |
|---|---|---|
| دعوة من المدير/الموظف (الافتراضي) | إنشاء `users(status=invited)` + الملف الشخصي + الأدوار → `verification_tokens(invitation)` → بريد/رسالة → المدعو يضبط كلمة المرور → `active` | `users`, `*_profiles`, `user_roles`, `verification_tokens` |
| تسجيل ذاتي (إن فُعّل `enrollment.self_registration`) | نموذج عام في نطاق الأكاديمية → `users(status=pending)` + الدور `is_default_for_signup` → تحقق البريد → اعتماد المدير (إن `requires_approval`) → `active` | نفسها + `academy_settings` |
| طالب صغير بلا بريد | ينشئه المدير أو ولي الأمر (إن سُمح) بـ `username` وكلمة مرور؛ يُربط بولي الأمر | `users(username)`, `student_profiles`, `guardian_students` |
| ولي أمر | يُدعى ويُربط بطالب أو أكثر مع الأعلام (مالي، درجات، حضور) | `guardian_students` |
| استيراد جماعي | ملف CSV → `users(invited)` + ملفات + أدوار + دعوات؛ `enrollments.source = import` | — |
| الانتقال بين أكاديميات | لا نقل حسابات في الإصدار الأول؛ تصدير شهادات الطالب (PDF + رمز تحقق) يكفي للاعتراف خارجياً | `certificates` |

#### 6.7.9 قابلية التوسّع والأمان والنسخ الاحتياطي على المدى الطويل

| المجال | المقترح |
|---|---|
| **توزيع القواعد** | أكاديميات كثيرة صغيرة على عنقود PostgreSQL واحد (قاعدة لكل أكاديمية)؛ الأكاديمية الكبيرة تُنقل إلى عنقود خاص بتغيير `academy_databases.host` بعد `pg_dump/restore` — دون أي تغيير في الكود (الميزة الجوهرية لنموذج "قاعدة لكل أكاديمية") |
| **ميزانية الاتصالات** | في الوضع `multi`: (عدد الأكاديميات النشطة × `pool_max`) × عدد نسخ API ≤ `max_connections`؛ عند تجاوزها يُضاف PgBouncer (transaction mode) أمام العنقود، مع ضبط `pool_max` صغيراً (2–5) وإغلاق عملاء الأكاديميات الخاملة (LRU) |
| **الفهرسة والمراقبة** | `pg_stat_statements` مفعّل من اليوم الأول؛ مراجعة أبطأ 20 استعلاماً شهرياً؛ كل مفتاح أجنبي مفهرس؛ `EXPLAIN` في مراجعة الكود لأي استعلام قائمة جديد |
| **النمو** | الجداول الإلحاقية (`audit_logs`, `notifications`, `outbox_events`) تُقسَّم شهرياً (`PARTITION BY RANGE (created_at)`) عند تجاوز ~50 مليون صف، مع أرشفة الأقسام القديمة إلى تخزين بارد؛ البقية تبقى عادية (حجم أكاديمية واحدة محدود بطبيعته) |
| **القراءة** | نسخة قراءة (replica) للتقارير الثقيلة لاحقاً؛ `academy_databases` يتحوّل إلى 1:n مع `role = primary/replica` |
| **الأمان — الأدوار** | دور تطبيق **لكل قاعدة أكاديمية** (`app_{slug}`، `CONNECT` على قاعدتها فقط) بدل دور مشترك: تسريب بيانات اعتماد أكاديمية لا يصل إلى غيرها (D16)؛ دور الترحيلات مشترك ومالك للقواعد؛ دور تزويد بـ `CREATEDB CREATEROLE` للمنصة فقط؛ لا superuser في أي مسار تطبيقي (ADR-019) |
| **الأمان — الأسرار** | بيانات اتصال الأكاديميات في `academy_databases` مشفّرة AES-256-GCM بمفتاح `DATA_ENCRYPTION_KEY` (بيئة/Docker secret) مع `key_version` للتدوير؛ الحقول الشخصية الحرجة (`national_id_enc`, `medical_notes_enc`) بالآلية نفسها؛ لا أسرار في `payload` الوظائف ولا في السجلات ولا في هذه الوثيقة (RULE 16) |
| **الأمان — النقل** | TLS بين API والقاعدة في الإنتاج (`sslmode=verify-full`)؛ القاعدة لا تُنشر على شبكة عامة (كما اليوم loopback) |
| **الأمان — التكامل** | رموز الوصول قصيرة، التحديث مدوَّر ومجزّأ، كلمات المرور argon2id، `audit_logs` بلا تحديث/حذف للتطبيق، تحقق المدخلات (`ValidationPipe`)، معاملات ذرية للمالية (`paid_amount` مع `payments` في معاملة واحدة)، `SELECT … FOR UPDATE` للتسلسلات |
| **الخصوصية** | إخفاء هوية بدل الحذف الفعلي: استبدال `email/username/full_name/phone` بقيم شاهدة وتصفير الحقول المشفّرة مع إبقاء الصفوف المالية والأكاديمية سليمة؛ سياسة احتفاظ `NOT YET DETERMINED` |
| **النسخ الاحتياطي** | (1) منطقي: `pg_dump -Fc` **لكل قاعدة أكاديمية** يومياً (وقبل كل ترحيل) → تخزين كائنات خارج الخادم، مشفّر، احتفاظ 7 يومية + 4 أسبوعية + 12 شهرية؛ (2) فيزيائي: أرشفة WAL للعنقود (pgBackRest أو wal-g) لاستعادة إلى نقطة زمنية (PITR)؛ (3) سجل كل نسخة في `backup_records` مع `checksum`؛ (4) **اختبار استعادة شهري** لأكاديمية عشوائية في قاعدة مؤقتة مع مقارنة عدّ الصفوف؛ (5) استعادة أكاديمية واحدة لا تمس غيرها (استعادة القاعدة إلى اسم جديد ثم تبديل `academy_databases.database_name`)؛ (6) تصدير/إغلاق أكاديمية = نسختها المنطقية + ملفاتها. أهداف RPO/RTO `NOT YET DETERMINED` (D18). الإجراء اليدوي الحالي في 14.9 يبقى صالحاً للتطوير |
| **المسؤوليات التشغيلية** | وظائف `backup`/`restore`/`migrate` في `academy_jobs` تجعل كل عملية على أسطول القواعد **مسجَّلة وقابلة للإعادة**؛ تنبيه عند فشل نسخة أو ترحيل أو انقطاع قاعدة أكاديمية (جاهزية لكل أكاديمية) |

#### 6.7.10 مراحل التنفيذ المقترحة (تطابق 18.3)

| المرحلة | المحتوى | الجداول | يسبقها |
|---|---|---|---|
| **A — Identity & Academy** (Stage 2) | مخطط tenant: A + B + H (`users` → `outbox_events`)؛ مخطط platform وفق 6.6.2: الأساسية `academies`, `platform_users`, `academy_jobs`, `platform_audit_logs` + من الموسّعة `academy_databases`, `tenant_migration_runs`, `platform_settings` ورموز المنصة؛ البذر؛ MOD-01 (JWT) وMOD-03 وMOD-02/14 | 19 tenant + 9 platform | اعتماد هذا القسم؛ حسم D9 وD10 (6.6) وD11, D12, D13, D14, D16, D20, D21, D22 |
| **B — Academic core** (Stage 3) | C: `levels` → `attendance_records`؛ MOD-04..MOD-07؛ قيود التعارض | 13 | A |
| **C — Assessment** (Stage 4) | D + E: `assignments` → `certificates` + عرض السجل الأكاديمي؛ MOD-08..MOD-10 | 15 | B؛ حسم D17 |
| **D — Finance & Communication** (Stage 5) | F + G: `fee_plans` → `device_tokens`؛ MOD-11, MOD-12؛ في المنصة `domains`, `backup_records`, `support_access_grants` (+ `plans`/`subscriptions` إن اعتُمدت) | 12 tenant + 3–5 platform | A؛ حسم D15 |

كل مرحلة = ترحيل واحد أو أكثر مراجَع في `prisma/tenant/migrations/` (و`platform/`)، تحديث القسم 06 (الجداول الفعلية تنتقل من `PROPOSED` إلى `IMPLEMENTED` مع مسار النموذج والترحيل — RULE 7/13)، وتحديث 08/10/15/19.

#### 6.7.11 قرارات مطلوبة من المالك قبل التنفيذ (`NOT YET DETERMINED`؛ تكمل D1..D10 في 6.6 حيث يغطي D9 طوبولوجيا النشر وD10 القاعدة المركزية)

| المعرّف | القرار | التوصية |
|---|---|---|
| D11 | نطاق الهوية: حساب لكل أكاديمية (مستقل) أم هوية عالمية مشتركة بين الأكاديميات | حساب لكل أكاديمية (ADR-022)؛ الاتحاد لاحقاً عبر `user_identities` — **معتمد (CH-0012)** |
| D12 | أسماء الأشخاص: إضافة `full_name_latin` اختياري (للشهادات والتقارير الإنجليزية) إلى `full_name` المقترح في 6.6 D6 | نعم — **معتمد (CH-0012)** |
| D13 | دعم الطلاب بلا بريد (`username`) ودخول أولياء الأمور نيابةً عنهم | نعم (أكاديميات الأطفال) — **معتمد (CH-0012)** بشرط معرّف دخول فريد وآمن دائماً (`email` أو `username`؛ `CHECK` في القاعدة) وعدم الاعتماد على الهاتف غير الفريد وحده |
| D14 | الفروع (`branches`) في المرحلة A أم تأجيلها | إدراج الجدول في A (رخيص) وتفعيل الشاشة لاحقاً |
| D15 | عملة واحدة لكل أكاديمية (موصى به) أم تعدد عملات؛ وبوابة الدفع المستهدفة | عملة واحدة؛ البوابة تُحسم في MOD-15 |
| D16 | دور قاعدة بيانات لكل أكاديمية (`app_{slug}`) أم دور تطبيق مشترك | دور لكل أكاديمية |
| D17 | معادلة الدرجة النهائية: متوسط موزون بأوزان المكوّنات (موصى به) أم مجموع نقاط | متوسط موزون؛ قابل للضبط من الإعدادات |
| D18 | أهداف النسخ الاحتياطي (RPO/RTO) وموقع التخزين الخارجي | RPO ≤ 24 ساعة (منطقي) + PITR للعنقود؛ RTO ≤ 4 ساعات لأكاديمية |
| D19 | ترتيب الوحدات في المراحل B–D كما في 6.7.10 | كما هو (يطابق 18.3) |
| D20 | ملف المعلم: `teacher_profiles` (6.6) فقط ثم `staff_profiles` لاحقاً، أم جدول واحد `employee_profiles` بعمود `kind` للمعلمين والموظفين | جدول واحد `employee_profiles` — **معتمد (CH-0012) بشرط:** يغطي المعلمين والموظفين، لا يقيّد تعدد أدوار المستخدم (`kind` يصف فئة التوظيف؛ الأدوار من `user_roles` وحدها)، والبيانات التخصصية تُضاف لاحقاً بجداول 1:1 أو أعمدة إضافية |
| D21 | فرادة `users.phone`: فريد (6.6) أم غير فريد (الأشقاء يتشاركون هاتف ولي الأمر) | غير فريد؛ الدخول بالبريد أو `username` فقط — **معتمد (CH-0012)** |
| D22 | معرّف `audit_logs`: `uuid` كبقية الجداول وفق D4 المعتمد، أم `bigint identity` لكونه إلحاقياً كثيف الكتابة | `uuid` ما لم تُثبت القياسات الحاجة؛ يُحسم قبل الترحيل الأول — **معتمد `uuid` (CH-0012)** |

---

## 07. USER ROLES AND PERMISSIONS — الأدوار والصلاحيات

### 7.1 الحالة العامة

**لا توجد أدوار ولا صلاحيات منفّذة في الخادم.** لا `Guards`، لا ديكوريتور `@Roles`، لا جداول أدوار، لا مصادقة. في الواجهة توجد منذ CH-0005 مفاتيح أدوار (`frontend/src/auth/roles.ts`) ومصفوفة دور×شاشة (`frontend/src/layout/navigation.ts`) **للعرض والمعاينة فقط** (MOD-FE-01) — ليست فرضاً أمنياً. كل ما يلي عن الخادم **`PLANNED`** ومصدره موجز المالك مع توصيف مقترح يحتاج إلى اعتماد.

### 7.2 الأدوار المخطّطة

| المعرّف | الدور | المسؤوليات (مقترح — بانتظار التأكيد) | الوحدات المتاحة (مقترح) | الحالة |
|---|---|---|---|---|
| ROLE-01 | Super Admin | إدارة نشرات الأكاديميات، الإعدادات العامة للمنصة، إنشاء أكاديميات ومديريها | كل الوحدات على مستوى المنصة | PLANNED |
| ROLE-02 | Academy Admin | إدارة أكاديمية واحدة: المستخدمون، الدورات، الجداول، المالية، التقارير، الأدوار المخصّصة | كل وحدات الأكاديمية | PLANNED |
| ROLE-03 | Teacher | إدارة فصوله ودروسه وواجباته واختباراته ودرجاته | Courses, Classes, Lessons, Scheduling (قراءة), Assignments, Exams, Grading | PLANNED |
| ROLE-04 | Student | متابعة الدروس، تسليم الواجبات، أداء الاختبارات، الاطلاع على الدرجات والشهادات | Lessons, Assignments, Exams (تنفيذ), Certificates (قراءة), Payments (قراءة ذاتية) | PLANNED |
| ROLE-05 | Guardian | متابعة طلاب مرتبطين به: الحضور، الدرجات، المدفوعات، الإشعارات | قراءة فقط للطلاب المرتبطين + Payments | PLANNED |
| ROLE-06 | Staff | مهام إدارية محددة (تسجيل، تحصيل، دعم) حسب صلاحيات مخصّصة | يُحدَّد بالأدوار المخصّصة | PLANNED |
| ROLE-07 | Custom roles | أدوار يُنشئها Academy Admin بمجموعة صلاحيات مختارة | ديناميكي | PLANNED |

**تمثيل الأدوار في الواجهة (CH-0005، واجهة فقط):** `frontend/src/auth/roles.ts` يعرّف المفاتيح `admin`, `teacher`, `student`, `guardian`, `staff` المقابلة لـ ROLE-02 إلى ROLE-06. ROLE-01 (Super Admin) غائب عمداً لأنه على مستوى المنصة ويتوقف على ADR-008. ROLE-07 غير ممثَّل. مصفوفة الدور×الشاشة المنفّذة في `layout/navigation.ts` مأخوذة من عمود "الوحدات المتاحة (مقترح)" أعلاه وهي **مقترحة وغير معتمدة من المالك** (`UNVERIFIED` كمتطلب):

| الشاشة | admin | teacher | student | guardian | staff |
|---|---|---|---|---|---|
| لوحة التحكم، الجدول الزمني، الإشعارات | ✓ | ✓ | ✓ | ✓ | ✓ |
| المستخدمون | ✓ | | | | ✓ |
| الدورات والمستويات | ✓ | ✓ | ✓ | ✓ | |
| الفصول والمجموعات | ✓ | ✓ | | | ✓ |
| الدروس | ✓ | ✓ | ✓ | | |
| الواجبات، الاختبارات والدرجات | ✓ | ✓ | ✓ | ✓ | |
| الشهادات | ✓ | | ✓ | ✓ | |
| المدفوعات | ✓ | | ✓ | ✓ | ✓ |
| التقارير، الإعدادات | ✓ | | | | |

### 7.3 الإجراءات المسموحة والممنوعة

`NOT YET DETERMINED` — تُحدَّد مصفوفة الصلاحيات (Permission matrix) عند تصميم وحدة الصلاحيات (MOD-01/MOD-03). **يجب** توثيقها هنا جدولاً: الدور × الوحدة × الإجراء (create/read/update/delete/approve…).

**مقترح أولي (PROPOSED — CH-0010):** كتالوج الصلاحيات (~45 مفتاحاً بنطاق `own`/`linked`/`all`) والمصفوفة الافتراضية للأدوار الخمسة في 6.7.8، والنموذج في ADR-023؛ تُنقل إلى هنا بصيغة معتمدة عند تنفيذ MOD-03.

### 7.4 آلية فرض الصلاحيات

| الآلية | الحالة |
|---|---|
| مصادقة (JWT/Session) | PLANNED |
| `AuthGuard` + `RolesGuard` في NestJS | PLANNED |
| صلاحيات دقيقة (permission-based بدل role-based فقط) | RECOMMENDED لدعم ROLE-07 |
| فرض على مستوى الواجهة (إخفاء عناصر) | PARTIALLY_IMPLEMENTED (CH-0005): القائمة والمسارات تُرشَّح حسب الدور في `frontend/src/layout/navigation.ts` و`auth/RequireAuth.tsx` (صفحة 403 عند المسار المباشر) — لا يُعتبر فرضاً أمنياً، والدور قابل للتبديل من `RoleSwitcher` |

### 7.5 العلاقة بين الأدوار

تصور مقترح: Super Admin ⊃ Academy Admin ⊃ (Teacher | Staff) ⊃ Student؛ Guardian مرتبط بطلاب محددين وليس جزءاً من التسلسل. `NOT YET DETERMINED` رسمياً.

---

## 08. SYSTEM MODULES — وحدات النظام

### 8.0 ملخص الوحدات

| المعرّف | الوحدة | الحالة | الملفات |
|---|---|---|---|
| MOD-00 | App bootstrap, configuration & health (Backend root) | IMPLEMENTED (مهيأ منذ CH-0006) | `backend/src/main.ts`, `app.module.ts`, `app.setup.ts`, `config/env.schema.ts`, `health/*`, `common/package-info.ts` |
| MOD-FE-00 | Frontend shell (template) | REMOVED (CH-0005) | — (كانت: `frontend/src/App.tsx`, `App.css`, `assets/*`, `public/icons.svg`) |
| MOD-FE-01 | Frontend application shell (prototype) | IMPLEMENTED (نموذج أولي ببيانات محلية) | `frontend/src/app/*`, `layout/*`, `auth/*`, `components/*`, `i18n/*`, `mock/data.ts`, `pages/*`, `main.tsx`, `index.html` |
| MOD-01 | Authentication | PLANNED (شاشة دخول تجريبية فقط في الواجهة) | — |
| MOD-02 | Academy management | PLANNED | — |
| MOD-03 | User management & roles | PLANNED | — |
| MOD-04 | Courses & levels | PLANNED | — |
| MOD-05 | Classes & groups | PLANNED | — |
| MOD-06 | Lessons (live & recorded) | PLANNED | — |
| MOD-07 | Scheduling & timetables | PLANNED | — |
| MOD-08 | Assignments | PLANNED | — |
| MOD-09 | Exams & grading | PLANNED | — |
| MOD-10 | Certificates & academic records | PLANNED | — |
| MOD-11 | Payments & installments | PLANNED | — |
| MOD-12 | Notifications | PLANNED | — |
| MOD-13 | Reports | PLANNED | — |
| MOD-14 | Settings | PLANNED | — |
| MOD-15 | Integrations & mobile API | PLANNED | — |
| MOD-16 | Database infrastructure (Prisma + PostgreSQL) | IMPLEMENTED (بنية بلا نماذج) | `compose.yaml`, `docker/postgres/initdb/10-roles.sh`, `backend/prisma.config.ts`, `backend/prisma/schema.prisma`, `backend/src/prisma/*`, `backend/src/config/database-url.ts` |

### MOD-00 — App bootstrap, configuration & health (Backend root) — `IMPLEMENTED`

| البند | التفاصيل |
|---|---|
| الغرض التجاري | لا منطق أعمال؛ البنية التحتية التي تقف عليها كل الوحدات القادمة: إعداد مُتحقَّق منه، حدود HTTP آمنة، توثيق API، وفحص حي للتشغيل |
| حالة التطوير | IMPLEMENTED — هيكل مولَّد (CH-0001) ثم مهيأ في CH-0006. أُزيلت نقطة الهيكل `GET /` مع `AppController`/`AppService` |
| الملفات | `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/app.setup.ts`, `backend/src/config/env.schema.ts` (+ `.spec.ts`), `backend/src/health/{health.module, health.controller, health.service, health.dto}.ts` (+ `health.service.spec.ts`), `backend/src/common/package-info.ts`, `backend/test/app.e2e-spec.ts`, `backend/.env.example` |
| الوظيفة الرئيسية | (1) `ConfigModule` عام يحمّل `.env.local` ثم `.env` ويتحقق منهما بمخطط zod ويُفشل الإقلاع عند أي قيمة غير صالحة؛ (2) `configureApp()`: بادئة `API_PREFIX` (افتراضياً `api`)، تعطيل `X-Powered-By`، CORS بقائمة `CORS_ORIGIN` مع `credentials`، `ValidationPipe` عام، `enableShutdownHooks`، Swagger اختياري؛ (3) `GET /api/health` (حيوية) يُعيد هوية الخدمة وإصدارها وبيئتها ووقت التشغيل؛ (4) `GET /api/health/ready` (جاهزية، CH-0007) ينفّذ `SELECT 1` عبر `PrismaService.ping()` ويُعيد 200 أو 503 |
| قواعد الأعمال | لا شيء |
| الكيانات | لا شيء |
| نقاط النهاية | API-002 (`GET /api/health`)، API-003 (`GET /api/docs`, `GET /api/docs-json`)، API-004 (`GET /api/health/ready`). API-001 (`GET /`) REMOVED |
| الصلاحيات المطلوبة | لا شيء (كلها عامة؛ لا مصادقة بعد — SEC-R-01) |
| الاعتماديات | `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/config`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `zod` |
| قواعد التحقق | البيئة: `config/env.schema.ts` (انظر 11.3). المدخلات: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } })` — بلا DTO طلب بعد (KI-022) |
| القيود الحالية | لا إصدار API في المسار (ممكن عبر `API_PREFIX=api/v1`)؛ لا `helmet`؛ لا تحديد معدل؛ لا تسجيل مخصّص؛ `SWAGGER_ENABLED` افتراضياً `true` ويجب تعطيله في الإنتاج؛ البادئة `/api` مكرَّرة في الواجهة (KI-021) |
| الأخطاء المعروفة | لا شيء مرصود |
| التحسينات المستقبلية | `helmet`، `@nestjs/throttler`، إصدار API، تسجيل منظّم، توسيع الجاهزية لتشمل Redis عند إضافته |

### MOD-16 — Database infrastructure (Prisma + PostgreSQL) — `IMPLEMENTED` (بنية بلا نماذج)

| البند | التفاصيل |
|---|---|
| الغرض التجاري | لا منطق أعمال؛ طبقة الوصول إلى قاعدة البيانات التي ستستخدمها كل وحدات البيانات القادمة، وبيئة PostgreSQL محلية قابلة لإعادة الإنتاج |
| حالة التطوير | IMPLEMENTED في CH-0007 كبنية: الاتصال، الفحص، أوامر الترحيل. **لا نماذج ولا ترحيلات ولا استعلامات أعمال** |
| الملفات | `compose.yaml`, `.env.example` (جذري — مصدر إعدادات القاعدة)، `docker/postgres/initdb/10-roles.sh` (CH-0008)، `backend/prisma.config.ts`, `backend/prisma/schema.prisma`, `backend/src/prisma/prisma.module.ts`, `backend/src/prisma/prisma.service.ts`, `backend/src/config/database-url.ts` و`env-files.ts` (CH-0008)، `backend/src/generated/prisma/*` (مولَّد، غير مُلتزم)، `backend/.env.example` (تجاوزات اختيارية) |
| الوظيفة الرئيسية | (1) `PrismaModule` عام يصدّر `PrismaService`؛ (2) `PrismaService` ينشئ `PrismaClient` واحداً بمحوّل `PrismaPg` من `DATABASE_URL` (أو يعمل بلا عميل عندما يغيب المتغير خارج الإنتاج)، يوفّر `db` للوحدات و`ping()` للجاهزية ويغلق الاتصال عند الإيقاف؛ (3) `compose.yaml` يشغّل PostgreSQL 18 بمجلد دائم وفحص صحي؛ (4) `10-roles.sh` ينشئ دور الترحيلات (مالك القاعدة) ودور التطبيق (DML) ويُعيد تطبيق كلمات المرور والامتيازات عند إعادة تشغيله؛ (5) `database-url.ts` يشتق عناوين الاتصال للدورين من متغيرات `.env` الجذري (CH-0008) |
| قواعد الأعمال | لا شيء |
| الكيانات | لا شيء (القسم 06) |
| نقاط النهاية | لا شيء مباشر؛ يغذّي API-004 |
| الصلاحيات المطلوبة | لا ينطبق |
| الاعتماديات | `@prisma/client`, `@prisma/adapter-pg`, `pg`, `prisma` (dev), `dotenv` (dev، للـ CLI فقط)، `@nestjs/config` |
| قواعد التحقق | `DATABASE_URL` يبدأ بـ `postgresql://` أو `postgres://`؛ القيمة الفارغة تُعامل كغائبة؛ عند غيابه يُشتق من `DB_APP_PASSWORD` (إلزامي للاشتقاق) + `DB_APP_USER`/`DB_HOST`/`POSTGRES_PORT` (1–65535)/`POSTGRES_DB` بافتراضيات مشتركة مع compose؛ في الإنتاج يجب توفر أحدهما (ENV-08، ENV-13..ENV-18) |
| القيود الحالية | دور migrator يحمل `CREATEDB` محلياً (KI-027)؛ في التطوير يقرأ الخادم `.env` الجذري كاملاً (KI-028)؛ لا نسخ احتياطي آلي؛ Docker Desktop يجب أن يعمل قبل الخادم وإلا أعادت الجاهزية 503 `down` |
| الأخطاء المعروفة | لا شيء مرصود |
| التحسينات المستقبلية | أول مخطط وفق التصميم المقترح في 6.6 (بعد اعتماد المالك) + ترحيل + بذر؛ نسخ احتياطي مجدول؛ `compose.prod.yaml` بلا نشر منفذ مع خدمة الخادم ودور migrator بلا `CREATEDB`؛ Redis لاحقاً |

### MOD-FE-00 — Frontend shell (template) — `REMOVED` (CH-0005)

> **سجل تاريخي.** أُزيلت صفحة القالب وأصولها في CH-0005 (`App.tsx`, `App.css`, `assets/hero.png`, `assets/react.svg`, `assets/vite.svg`, `public/icons.svg`) وحلّ محلّها MOD-FE-01. بقي `public/favicon.svg` من القالب (KI-019). الوصف أدناه يصف الحالة قبل الإزالة ويُحتفظ به وفق RULE 9.

| البند | التفاصيل |
|---|---|
| الغرض التجاري | لا يوجد بعد؛ صفحة قالب Vite الافتراضية |
| حالة التطوير | REMOVED في CH-0005 (كانت IMPLEMENTED كقالب؛ لم تكن أي واجهة منتج) |
| الملفات | `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/index.css`, `frontend/public/*`, `frontend/src/assets/*` |
| الوظيفة الرئيسية | عرض صورة بطل (hero) وعدّاد `useState` وروابط إلى توثيق Vite/React وقنوات مجتمع Vite |
| الحالة (state) | `useState` محلي فقط |
| التوجيه | لا يوجد |
| الاتصال بالخادم | لا يوجد |
| i18n / RTL | لا يوجد؛ `lang="en"` |
| القيود | العنوان `<title>frontend</title>`؛ روابط خارجية غير متعلقة بالمنتج (KI-005) |
| التحسينات المستقبلية | إزالة محتوى القالب، إضافة توجيه، طبقة API، i18n مع RTL، نظام تصميم (أُنجز معظمها في MOD-FE-01 عدا طبقة API) |

### MOD-FE-01 — Frontend application shell (prototype) — `IMPLEMENTED` (نموذج أولي ببيانات محلية)

| البند | التفاصيل |
|---|---|
| الغرض التجاري | تمكين المالك من الدخول إلى شاشات المنتج والتنقل بينها ومعاينتها بكل دور قبل بناء الخادم (نهج "الواجهة أولاً ببيانات تجريبية" — ADR-012) |
| حالة التطوير | IMPLEMENTED كهيكل وشاشات تجريبية (CH-0005). **لا اتصال بالخادم، لا بيانات حقيقية، لا مصادقة حقيقية** |
| الملفات | `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/src/app/App.tsx`, `frontend/src/app/router.tsx`, `frontend/src/layout/{navigation.ts, AppLayout.tsx, AppLayout.css}`, `frontend/src/auth/{roles.ts, auth-context.ts, AuthProvider.tsx, RequireAuth.tsx}`, `frontend/src/components/{PageHeader, StatusTag, LanguageSwitcher, RoleSwitcher}.tsx`, `frontend/src/i18n/{language.ts, index.ts, ar.ts, en.ts, useLocalized.ts}`, `frontend/src/mock/data.ts`, `frontend/src/pages/*` (16 صفحة + `LoginPage.css`) |
| الوظيفة الرئيسية | (1) دخول تجريبي: أي بريد/كلمة مرور + اختيار دور → جلسة في `localStorage` (`aca.mockUser`)؛ (2) تخطيط عام: قائمة جانبية مُرشَّحة حسب الدور + ترويسة (شارة "بيانات تجريبية"، مبدّل الدور "عرض كـ"، مبدّل اللغة، قائمة المستخدم/خروج)؛ (3) 13 شاشة وحدة ببيانات محلية ثنائية اللغة (جداول، إحصاءات، قوائم، نموذج إعدادات)؛ (4) صفحتا 404 و403 |
| التوجيه | `react-router` 7 (`createBrowserRouter`): `/login` عام؛ `/` وما تحته داخل `RequireAuth` → `AppLayout` (Outlet)؛ كل شاشة داخل `RequireRole(navKey)`. المسارات: `/`, `/users`, `/courses`, `/classes`, `/schedule`, `/lessons`, `/assignments`, `/exams`, `/certificates`, `/payments`, `/notifications`, `/reports`, `/settings`, و`*` → 404 |
| الحالة (state) | React state + Context (`AuthContext`) فقط؛ لا مكتبة إدارة حالة |
| i18n / RTL | `i18next` + `react-i18next`؛ العربية افتراضياً مع `dir="rtl"`، الإنجليزية ثانوية؛ `ConfigProvider` في antd يتلقى `direction` و`locale` (`ar_EG` / `en_US`)؛ الاختيار محفوظ في `localStorage` (`aca.language`)؛ `document.documentElement.lang/dir` يُحدَّثان عند التبديل. قاموس `en` مُلزَم بنوع قاموس `ar` (`Translation`) فيفشل `tsc` عند أي مفتاح ناقص |
| الأدوار (واجهة فقط) | `auth/roles.ts`: `admin, teacher, student, guardian, staff` (ROLE-02..ROLE-06). مصفوفة الدور×الشاشة في `layout/navigation.ts` (انظر 7.2؛ مقترحة وغير معتمدة). `RoleSwitcher` يسمح بالمعاينة بأي دور — أداة نمذجة، ليست حماية (KI-017) |
| الاتصال بالخادم | لا يوجد. كل البيانات من `mock/data.ts` (مستخدمون، دورات، فصول، جدول، دروس، واجبات، اختبارات، شهادات، مدفوعات، إشعارات، تقارير، إعدادات الأكاديمية) |
| الاعتماديات | `antd` 6.6.8، `@ant-design/icons` 6.3.4، `react-router` 7.18.5، `i18next` 26.5.11، `react-i18next` 17.1.9 |
| القيود الحالية | أزرار "إضافة/تسجيل/إنشاء" تعرض رسالة "غير منفّذ"؛ النموذجان الوحيدان (الدخول، الإعدادات) محليان؛ حجم الحزمة الإنتاجية 1,306 kB قبل الضغط (KI-016)؛ لا اختبارات آلية (13.5)؛ favicon قالب Vite (KI-019)؛ العرض المرئي في متصفح لم يُتحقق منه آلياً في الجلسة (الملحق B) |
| الأخطاء المعروفة | لا شيء مرصود |
| التحسينات المستقبلية | طبقة API (FS-031) تستبدل `mock/data.ts` وحدةً وحدة؛ مصادقة حقيقية (MOD-01) تستبدل `AuthProvider`؛ تقسيم الحزمة بالمسارات (`React.lazy`)؛ اختبارات Vitest + Testing Library؛ هوية بصرية (شعار، favicon، ألوان) |

### MOD-01 — Authentication — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | تسجيل الدخول/الخروج، إدارة الجلسات أو الرموز، استعادة كلمة المرور، ربط المستخدم بدوره |
| الملفات | لا شيء |
| الكيانات | `NOT YET DETERMINED` (متوقع: users, credentials/sessions, refresh tokens)؛ تصميم مقترح تفصيلي في 6.6 (`refresh_tokens`, `verification_tokens`) — PROPOSED |
| نقاط النهاية | لا شيء |
| الاعتماديات المتوقعة | MOD-03 (المستخدمون)، MOD-02 (سياق الأكاديمية) |
| قواعد مقترحة | تجزئة كلمات المرور (bcrypt/argon2)، رموز JWT قصيرة العمر + تحديث، حد لمحاولات الدخول |
| القيود/المخاطر | أي نقطة نهاية تُضاف قبل هذه الوحدة ستكون عامة |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/LoginPage.tsx` + `frontend/src/auth/AuthProvider.tsx` — المسار `/login`؛ أي بريد/كلمة مرور يُقبلان ويُختار الدور للمعاينة. **ليست مصادقة** (KI-017)؛ تُستبدل عند تنفيذ هذه الوحدة |

### MOD-02 — Academy management — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إنشاء الأكاديمية وتهيئة نشرها وقاعدة بياناتها وإعداداتها وهويتها |
| الكيانات | `NOT YET DETERMINED` (متوقع: academy, academy_settings, branches?)؛ تصميم مقترح تفصيلي في 6.6 (جدول `academy`) و6.6.2 (السجل المركزي) — PROPOSED |
| الاعتماديات | ADR-008 (نموذج العزل)، MOD-14 |
| ملاحظة | في نموذج "نشر مستقل" قد تعيش بيانات الأكاديمية في قاعدتها الخاصة، بينما تحتاج لوحة Super Admin إلى سجل مركزي للأكاديميات — `NOT YET DETERMINED`؛ **مقترح:** سجل مركزي في `articode_platform` (6.6.2: `academies`, `academy_databases`) وصف `academy` واحد في قاعدة كل أكاديمية (6.6، 6.7.4-B) — D10/ADR-021 |

### MOD-03 — User management & roles — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إدارة المستخدمين بأنواعهم (معلم/طالب/ولي أمر/موظف)، الملفات الشخصية، الأدوار والصلاحيات المخصّصة، ربط أولياء الأمور بالطلاب |
| الكيانات | `NOT YET DETERMINED` (متوقع: users, roles, permissions, role_permissions, user_roles, guardian_students)؛ تصميم مقترح تفصيلي في 6.6 مع مراجعة السلامة في 6.6.1 — PROPOSED |
| الاعتماديات | MOD-01 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/UsersPage.tsx` — المسار `/users`؛ جدول ببيانات محلية (`mockUsers`)؛ زر الإضافة يعرض "غير منفّذ". مفاتيح الأدوار في `frontend/src/auth/roles.ts`. لا منطق خادم |

### MOD-04 — Courses & levels — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | تعريف الدورات ومستوياتها ومحتواها ومتطلباتها |
| الكيانات | `NOT YET DETERMINED` (متوقع: courses, levels, course_levels) |
| الاعتماديات | MOD-02, MOD-03 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/CoursesPage.tsx` — المسار `/courses`؛ جدول (رمز، اسم، مستوى، معلم، طلاب، حالة) من `mockCourses`. لا منطق خادم |

### MOD-05 — Classes & groups — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إنشاء الفصول/المجموعات لدورة ومستوى محددين، تعيين المعلمين، تسجيل الطلاب |
| الكيانات | `NOT YET DETERMINED` (متوقع: classes, groups, enrollments, class_teachers) |
| الاعتماديات | MOD-03, MOD-04 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/ClassesPage.tsx` — المسار `/classes`؛ جدول مع شريط إشغال (مسجّلون/سعة) من `mockClasses`. لا منطق خادم |

### MOD-06 — Lessons (live & recorded) — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | الدروس المباشرة (تكامل بث) والمسجلة (تخزين وتشغيل)، الحضور |
| الكيانات | `NOT YET DETERMINED` (متوقع: lessons, lesson_recordings, attendance) |
| الاعتماديات | MOD-05, MOD-07, MOD-15 (مزود بث/تخزين) |
| ملاحظة | مزوّد البث والتخزين `NOT YET DETERMINED` |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/LessonsPage.tsx` — المسار `/lessons`؛ جدول (عنوان، دورة، نوع مباشر/مسجّل، تاريخ، مدة، حالة) من `mockLessons`. لا تشغيل فيديو ولا بث |

### MOD-07 — Scheduling & timetables — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | الجداول الزمنية للفصول والمعلمين والقاعات، كشف التعارضات |
| الكيانات | `NOT YET DETERMINED` (متوقع: timetables, time_slots, rooms?) |
| الاعتماديات | MOD-05 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/SchedulePage.tsx` — المسار `/schedule`؛ جدول أسبوعي مرتّب باليوم ثم الوقت من `mockSchedule`. لا كشف تعارضات |

### MOD-08 — Assignments — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إنشاء الواجبات، التسليم، التصحيح، التغذية الراجعة |
| الكيانات | `NOT YET DETERMINED` (متوقع: assignments, submissions, submission_files) |
| الاعتماديات | MOD-05, MOD-09 (الدرجات) |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/AssignmentsPage.tsx` — المسار `/assignments`؛ جدول (عنوان، دورة، آخر موعد، تسليمات، حالة) من `mockAssignments`. لا تسليم ولا تصحيح |

### MOD-09 — Exams & grading — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | بنوك الأسئلة، إنشاء الاختبارات، الأداء، التصحيح الآلي/اليدوي، احتساب الدرجات النهائية |
| الكيانات | `NOT YET DETERMINED` (متوقع: exams, questions, exam_attempts, answers, grades, grade_schemes) |
| قواعد الأعمال | معادلات احتساب الدرجات `NOT YET DETERMINED` |
| الاعتماديات | MOD-05, MOD-08 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/ExamsPage.tsx` — المسار `/exams`؛ جدول (عنوان، دورة، تاريخ، مدة، درجة كاملة، متوسط، حالة) من `mockExams`. لا أداء اختبار ولا تصحيح |

### MOD-10 — Certificates & academic records — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إصدار الشهادات (قوالب، ترقيم، تحقق)، السجل الأكاديمي للطالب |
| الكيانات | `NOT YET DETERMINED` (متوقع: certificates, certificate_templates, academic_records) |
| الاعتماديات | MOD-09 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/CertificatesPage.tsx` — المسار `/certificates`؛ جدول (رقم تسلسلي، طالب، دورة، تاريخ إصدار، تقدير) من `mockCertificates`. لا إصدار ولا تحقق |

### MOD-11 — Payments & installments — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | الرسوم، خطط الأقساط، تسجيل المدفوعات، الأرصدة، الإيصالات، التكامل مع بوابات دفع |
| الكيانات | `NOT YET DETERMINED` (متوقع: fees, invoices, installments, payments, receipts) |
| الاعتماديات | MOD-03, MOD-05, MOD-15 |
| ملاحظة | بوابة الدفع والعملات `NOT YET DETERMINED` |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/PaymentsPage.tsx` — المسار `/payments`؛ إحصاءا "المحصّل/المتبقي" وجدول فواتير من `mockPayments` (العملة التجريبية `SAR` من `mockAcademySettings`). لا تسجيل دفعات ولا بوابة |

### MOD-12 — Notifications — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إشعارات داخل التطبيق وبريد/رسائل/دفع (push) للأحداث المهمة |
| الكيانات | `NOT YET DETERMINED` (متوقع: notifications, notification_preferences) |
| الاعتماديات | MOD-03, MOD-15 (مزودي البريد/الرسائل) |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/NotificationsPage.tsx` — المسار `/notifications`؛ قائمة مع مؤشر غير مقروء ووسم القناة وزر "تعيين الكل كمقروء" (حالة محلية فقط) من `mockNotifications`. لا إرسال |

### MOD-13 — Reports — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | تقارير أكاديمية ومالية وتشغيلية قابلة للتصدير |
| الاعتماديات | معظم الوحدات |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/ReportsPage.tsx` — المسار `/reports`؛ بطاقات التقارير المتاحة من `mockReports`؛ زر "إنشاء التقرير" يعرض "غير منفّذ". لا توليد ولا تصدير |

### MOD-14 — Settings — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | إعدادات الأكاديمية والنظام، اللغة الافتراضية، المنطقة الزمنية، العملة، العلامة التجارية |
| الاعتماديات | MOD-02 |
| واجهة تجريبية (CH-0005) | `frontend/src/pages/SettingsPage.tsx` — المسار `/settings`؛ نموذج (اسم الأكاديمية عربي/إنجليزي، اللغة الافتراضية، المنطقة الزمنية، العملة) بقيم `mockAcademySettings`؛ "حفظ" يعرض رسالة نجاح محلية ولا يرسل شيئاً |

### MOD-15 — Integrations & mobile API — `PLANNED`

| البند | التفاصيل |
|---|---|
| الغرض | واجهات للتطبيقات المحمولة، تكاملات خارجية (بث، دفع، بريد، تخزين) |
| ملاحظة | لا تكاملات حالياً؛ قائمة المزودين `NOT YET DETERMINED` |

---

## 09. USER WORKFLOWS — رحلات المستخدم

**لا توجد أي رحلة مستخدم تشغيلية حالياً.** الرحلة الوحيدة القابلة للتنفيذ على الخادم هي: تشغيله واستدعاء `GET /` (تقنية وليست رحلة منتج).

منذ CH-0005 توجد في الواجهة رحلة **معاينة** (ليست رحلة منتج لأنها لا تلمس الخادم ولا بيانات حقيقية): `/login` (أي بيانات + اختيار دور) → `/` لوحة التحكم → التنقل بين شاشات الوحدات حسب الدور → تبديل الدور أو اللغة من الترويسة → تسجيل الخروج. تُوثَّق كرحلة منتج (WF-02 وما بعدها) عند ربطها بالمصادقة الحقيقية (MOD-01).

| المعرّف | الرحلة | الحالة | الوحدات المعنية | ملاحظات |
|---|---|---|---|---|
| WF-01 | إنشاء أكاديمية | PLANNED | MOD-02, MOD-14, MOD-01 | يشمل تهيئة قاعدة بيانات مخصّصة |
| WF-02 | تسجيل مستخدم | PLANNED | MOD-01, MOD-03 | دعوة من المدير أو تسجيل ذاتي — `NOT YET DETERMINED` |
| WF-03 | تعيين معلم لفصل | PLANNED | MOD-03, MOD-05 | |
| WF-04 | تسجيل طالب في دورة/فصل | PLANNED | MOD-03, MOD-05, MOD-11 | قد يرتبط بخطة دفع |
| WF-05 | إنشاء دورة ومستوياتها | PLANNED | MOD-04 | |
| WF-06 | جدولة درس | PLANNED | MOD-06, MOD-07 | كشف التعارضات |
| WF-07 | إنشاء اختبار وأداؤه | PLANNED | MOD-09 | |
| WF-08 | احتساب الدرجات | PLANNED | MOD-08, MOD-09 | المعادلة `NOT YET DETERMINED` |
| WF-09 | إصدار شهادة | PLANNED | MOD-10 | |
| WF-10 | تسجيل دفعة/قسط | PLANNED | MOD-11 | |

عند تنفيذ أي رحلة، يُوثَّق هنا: الخطوات، الأدوار، نقاط النهاية المستدعاة، الكيانات المتأثرة، حالات الفشل.

---

## 10. API DOCUMENTATION — توثيق واجهات البرمجة

### 10.1 الإعدادات العامة لواجهة البرمجة (الحالة الفعلية)

| البند | القيمة |
|---|---|
| العنوان الأساسي | `http://localhost:${PORT:-3000}/${API_PREFIX:-api}` (منذ CH-0006). في التطوير تصل الواجهة إليه عبر `http://localhost:5173/api` (proxy) |
| بادئة عامة | `API_PREFIX` (افتراضياً `api`) عبر `setGlobalPrefix` في `backend/src/app.setup.ts` |
| إصدار API | لا يوجد في المسار؛ ممكن لاحقاً عبر `API_PREFIX=api/v1` أو `enableVersioning` — `NOT YET DETERMINED` |
| المصادقة | لا يوجد (كل النقاط عامة — SEC-R-01) |
| CORS | قائمة أصول من `CORS_ORIGIN` مع `credentials: true`؛ الأصل غير المدرج لا يحصل على رأس `Access-Control-Allow-Origin` (متحقق منه في e2e) |
| التحقق من المدخلات | `ValidationPipe` عام: الحقول غير المعلنة في DTO تُرفض بـ `400` (`forbidNonWhitelisted`)؛ التحويل الضمني للأنواع مفعّل. لم يُختبر بعد على DTO فعلي (KI-022) |
| تنسيق الأخطاء | افتراضي NestJS، لم يُخصَّص. تحت البادئة: `404` مع `{"message":"Cannot GET /api/nope","error":"Not Found","statusCode":404}`. **خارج البادئة** (مثل `GET /`) يُعيد Express صفحة HTML `404` افتراضية (متحقق منه في CH-0006) |
| الرؤوس | لا `X-Powered-By` (معطَّل). لا `helmet` بعد |
| OpenAPI/Swagger | API-003: UI على `/api/docs` وJSON على `/api/docs-json` عندما `SWAGGER_ENABLED=true` (الافتراضي). العنوان "ArtiCode Academy API"، الإصدار من `package.json` |

### 10.2 نقاط النهاية الموجودة فعلاً

#### API-001 — `GET /` — `REMOVED` (CH-0006)

> **سجل تاريخي.** أُزيلت مع `AppController`/`AppService` في CH-0006. المسار يُعيد الآن `404` HTML من Express. العقد أدناه كما كان قبل الإزالة (RULE 9).

| البند | القيمة |
|---|---|
| الطريقة | `GET` |
| المسار | `/` |
| الغرض | نقطة نهاية الهيكل الافتراضية؛ تُثبت أن الخادم يعمل |
| المصادقة | غير مطلوبة |
| الصلاحيات | لا شيء |
| معاملات الطلب | لا شيء |
| جسم الطلب | لا شيء |
| الاستجابة | `200`، `Content-Type: text/html; charset=utf-8`، الجسم `Hello World!` (متحقق منه في CH-0003) |
| سلوك الأخطاء | لا توجد حالات خطأ متوقعة |
| المتحكم/الخدمة | `AppController.getHello()` → `AppService.getHello()` (`backend/src/app.controller.ts`, `backend/src/app.service.ts`) |
| الاختبارات | `backend/src/app.controller.spec.ts` (وحدة)، `backend/test/app.e2e-spec.ts` (شامل). كلاهما ناجح في CH-0003 |

#### API-002 — `GET /api/health` — `IMPLEMENTED` (CH-0006)

| البند | القيمة |
|---|---|
| الطريقة | `GET` |
| المسار | `/${API_PREFIX}/health` → افتراضياً `/api/health` |
| الغرض | فحص حيوية (liveness): هوية الخدمة، الإصدار، البيئة، وقت الخادم، مدة التشغيل. تستخدمه بطاقة "الاتصال بالخادم" في لوحة التحكم |
| المصادقة | غير مطلوبة (عام) |
| الصلاحيات | لا شيء |
| معاملات الطلب | لا شيء |
| جسم الطلب | لا شيء |
| الاستجابة | `200`، `Content-Type: application/json; charset=utf-8`، الجسم `HealthResponseDto`: `{ "status": "ok", "service": "articode-academy-api", "version": "<package.json version>", "environment": "development \| test \| production", "timestamp": "<ISO 8601 UTC>", "uptimeSeconds": <integer> }`. مثال متحقق منه: `{"status":"ok","service":"articode-academy-api","version":"0.0.1","environment":"development","timestamp":"2026-10-29T12:30:32.255Z","uptimeSeconds":55}` |
| سلوك الأخطاء | لا حالات خطأ متوقعة. لا يفحص قاعدة بيانات (لا توجد)؛ فحص الجاهزية (readiness) PLANNED |
| المتحكم/الخدمة | `HealthController.check()` → `HealthService.check()` (`backend/src/health/health.controller.ts`, `health.service.ts`)؛ النوع في `health.dto.ts` |
| الواجهة | `frontend/src/api/health.ts` (`fetchHealth`)، `api/useHealth.ts`، `components/ServerStatusCard.tsx` |
| الاختبارات | TEST-004 (`health.service.spec.ts`)، TEST-005 (`test/app.e2e-spec.ts`). ناجحة في CH-0006 |

#### API-003 — `GET /api/docs`, `GET /api/docs-json` — `IMPLEMENTED` (CH-0006)

| البند | القيمة |
|---|---|
| الطريقة | `GET` |
| المسار | `/${API_PREFIX}/docs` (Swagger UI) و`/${API_PREFIX}/docs-json` (وثيقة OpenAPI 3) |
| الغرض | توثيق تفاعلي مولَّد من الديكوريتورات (`@ApiTags`, `@ApiOperation`, `@ApiProperty`) |
| المصادقة | غير مطلوبة. **يجب** ضبط `SWAGGER_ENABLED=false` في الإنتاج أو حمايته لاحقاً (SEC-R-05) |
| الاستجابة | `200` HTML (UI) أو JSON يحوي `openapi: "3.x"` و`paths["/api/health"]` (متحقق منه في e2e) |
| المصدر | `SwaggerModule.createDocument` + `SwaggerModule.setup` في `backend/src/app.setup.ts`؛ يُعطَّل بالكامل عندما `SWAGGER_ENABLED=false` |
| الاختبارات | TEST-005 (`serves the OpenAPI document under the prefix`) |

#### API-004 — `GET /api/health/ready` — `IMPLEMENTED` (CH-0007)

| البند | القيمة |
|---|---|
| الطريقة | `GET` |
| المسار | `/${API_PREFIX}/health/ready` → افتراضياً `/api/health/ready` |
| الغرض | فحص جاهزية (readiness): هل تستجيب قاعدة البيانات؟ تستخدمه بطاقة "الاتصال بالخادم"، ومستقبلاً موازن الأحمال أو المنسّق |
| المصادقة | غير مطلوبة (عام) |
| الصلاحيات | لا شيء |
| معاملات الطلب | لا شيء |
| جسم الطلب | لا شيء |
| الاستجابة | `ReadinessResponseDto`: `{ "status": "ready" \| "not_ready", "checks": { "database": { "status": "up" \| "down" \| "not_configured", "latencyMs"?: <ms>, "error"?: "<driver message>" } }, "timestamp": "<ISO 8601>" }`. **`200`** عندما `ready`، **`503`** عندما `not_ready` (الجسم نفسه). مثال متحقق منه: `{"status":"ready","checks":{"database":{"status":"up","latencyMs":3}},"timestamp":"2026-10-29T13:18:08.911Z"}` |
| سلوك الأخطاء | لا يرمي استثناءات: تعطّل القاعدة أو تجاوز مهلة 5 ثوانٍ → `503` مع `database.status = "down"` ورسالة السائق (بلا سلسلة اتصال)؛ غياب `DATABASE_URL` → `503` مع `"not_configured"` |
| المتحكم/الخدمة | `HealthController.ready()` → `HealthService.readiness()` → `PrismaService.ping()` (`SELECT 1`) — `backend/src/health/*`, `backend/src/prisma/prisma.service.ts` |
| الواجهة | `frontend/src/api/health.ts` (`fetchReadiness`؛ يُعيد الجسم حتى مع 503)، `api/useHealth.ts` (`useReadiness`)، `components/ServerStatusCard.tsx` (سطر "قاعدة البيانات") |
| الاختبارات | TEST-004 (ثلاث حالات: up / down / not_configured)، TEST-005 (يقبل 200 أو 503 حسب البيئة ويتحقق من اتساق الجسم) |

### 10.3 نقاط النهاية المخطّطة

لا تُوثَّق نقاط نهاية مخطّطة هنا حتى تُنفَّذ (RULE 13 و RULE 14). تُسجَّل عند التنفيذ بالصيغة أعلاه مع معرّف `API-nnn` متسلسل.

---

## 11. CONFIGURATION AND ENVIRONMENT — الإعداد والبيئة

### 11.1 البرمجيات المطلوبة

| البرنامج | الإصدار الموصى به | ملاحظة |
|---|---|---|
| Node.js | 22.22.3 أو أحدث، أو 24.15 أو أحدث | يعمل المشروع على 22.20.0، لكن أدوات `@nestjs/cli` تطلب 22.22.3 أو أحدث وتُظهر تحذيرات `EBADENGINE` (KI-012). لا يوجد حقل `engines` (KI-008) |
| npm | 11.x موصى به للخادم | npm 10.9.3 يتعطل عند `npm install` بدون ملف قفل (KI-015). بعد وجود ملف القفل يعمل `npm ci` مع npm 10 |
| Git + Git Bash | أي إصدار حديث | مطلوب لخطّافات Claude Code على Windows |
| PostgreSQL | 18 (صورة `postgres:18`؛ المثبّت فعلياً 18.6) | يعمل داخل Docker عبر `compose.yaml` منذ CH-0007 (ADR-016)؛ لا تثبيت على Windows ولا `psql` محلي (يُستخدم عبر `docker compose exec`) |
| Docker Desktop | إصدار حديث مع WSL 2 (المتحقق منه: محرك 29.9.2، Compose v5.6.1) | مثبّت ويعمل منذ CH-0007؛ يجب أن يكون قيد التشغيل قبل `docker compose up` وقبل `npm run start:dev` (وإلا تُعيد الجاهزية 503) |

### 11.2 التثبيت

```bash
# الخادم: التثبيت من ملف القفل الموجود (يعمل مع npm 10 و 11)
cd backend
npm ci

# الخادم: إضافة أو تحديث اعتماديات (npm 10 يتعطل هنا، استخدم npm 11)
npx -y npm@11 install <package>

# الواجهة (يحترم package-lock.json الموجود)
cd frontend
npm ci

# الواجهة: إضافة اعتماديات (npm 10 يعمل هنا بلا مشكلة — تم التحقق في CH-0005)
npm install <package>
```

> **تنبيه:** كل أمر يجب تشغيله من داخل مجلد التطبيق الصحيح. أوامر `test` و`test:e2e` و`start:dev` موجودة في `backend/` فقط، وتشغيلها من `frontend/` يعطي `Missing script`.

### 11.3 متغيرات البيئة

| المعرّف | الاسم | الإلزامية | الافتراضي | أين تُقرأ | الوصف |
|---|---|---|---|---|---|
| ENV-01 | `PORT` | اختياري | `3000` | `backend/src/config/env.schema.ts` → `app.setup.ts` | منفذ استماع الخادم (عدد صحيح 1–65535) |
| ENV-02 | `NODE_ENV` | اختياري | `development` | `backend/src/config/env.schema.ts`؛ يظهر في `GET /api/health` | أحد `development`, `test`, `production`. Vitest يضبطه `test` |
| ENV-03 | `API_PREFIX` | اختياري | `api` | `backend/src/app.setup.ts` | البادئة العامة للمسارات بلا شرطات مائلة طرفية (مثل `api` أو `api/v1`). الواجهة تفترض `api` (KI-021) |
| ENV-04 | `CORS_ORIGIN` | اختياري | `http://localhost:5173` | `backend/src/app.setup.ts` | قائمة أصول مفصولة بفواصل يُسمح لها بـ CORS |
| ENV-05 | `SWAGGER_ENABLED` | اختياري | `true` | `backend/src/app.setup.ts` | `true`/`false`؛ يعرض Swagger على `/api/docs`. يُنصح بـ `false` في الإنتاج |
| ENV-06 | `VITE_API_BASE_URL` | اختياري | فارغ (نفس الأصل) | `frontend/src/api/client.ts` (يُدمج في حزمة المتصفح) | عنوان أساس للاستدعاءات عندما لا يكون الخادم على نفس الأصل |
| ENV-07 | `API_PROXY_TARGET` | اختياري | `http://localhost:3000` | `frontend/vite.config.ts` فقط (لا يصل إلى المتصفح) | وجهة proxy خادم Vite لمسارات `/api/*` في التطوير |
| ENV-08 | `DATABASE_URL` | اختياري في development/test؛ في production يلزم هو **أو** `DB_APP_PASSWORD` | — (يُشتق عند غيابه) | `backend/src/config/env.schema.ts` → `src/prisma/prisma.service.ts` | سلسلة اتصال **دور التطبيق** `postgresql://user:password@host:port/db`. منذ CH-0008 تُشتق تلقائياً من `DB_APP_USER`/`DB_APP_PASSWORD`/`DB_HOST`/`POSTGRES_PORT`/`POSTGRES_DB` (مع ترميز percent للكلمة) فلا حاجة لضبطها محلياً؛ تُضبط صراحةً عندما تكون القاعدة في مكان آخر (داخل Compose: المضيف `postgres`). القيمة الفارغة تُعامل كغائبة |
| ENV-09 | `POSTGRES_USER` | إلزامي لـ compose | — | `compose.yaml` (من `.env` الجذري) | اسم superuser الذي تنشئه الصورة عند أول تشغيل؛ **للإدارة فقط** منذ CH-0008 — لا يستخدمه التطبيق ولا الترحيلات (KI-024 RESOLVED) |
| ENV-10 | `POSTGRES_PASSWORD` | إلزامي لـ compose | — | `compose.yaml` | كلمة مرور superuser — **سر**؛ لا تُسجَّل قيمتها أبداً |
| ENV-11 | `POSTGRES_DB` | اختياري | `articode_academy` | `compose.yaml`؛ `env.schema.ts` و`prisma.config.ts` للاشتقاق | اسم القاعدة المُنشأة عند أول تشغيل؛ يملكها دور migrator منذ CH-0008 |
| ENV-12 | `POSTGRES_PORT` | اختياري | `5432` | `compose.yaml`؛ `env.schema.ts` و`prisma.config.ts` للاشتقاق | منفذ المضيف المنشور على `127.0.0.1` فقط؛ الخادم وPrisma CLI يتصلان به تلقائياً (لا تكرار) |
| ENV-13 | `DB_MIGRATOR_USER` | اختياري | `articode_migrator` | `compose.yaml` → `10-roles.sh`؛ `backend/prisma.config.ts` | اسم دور الترحيلات (مالك القاعدة والمخطط) — CH-0008 |
| ENV-14 | `DB_MIGRATOR_PASSWORD` | إلزامي لـ compose؛ مطلوب لأوامر Prisma التي تتصل بالقاعدة | — | `compose.yaml` → `10-roles.sh`؛ `backend/prisma.config.ts` | كلمة مرور دور الترحيلات — **سر**. تغييرها = تعديل `.env` ثم إعادة تشغيل `10-roles.sh` |
| ENV-15 | `DB_APP_USER` | اختياري | `articode_app` | `compose.yaml` → `10-roles.sh`؛ `env.schema.ts` | اسم دور التطبيق (DML فقط) — CH-0008 |
| ENV-16 | `DB_APP_PASSWORD` | إلزامي لـ compose؛ في الخادم اختياري خارج الإنتاج (بدونه لا يُشتق `DATABASE_URL` → `not_configured`) | — | `compose.yaml` → `10-roles.sh`؛ `env.schema.ts` | كلمة مرور دور التطبيق — **سر**. تغييرها = تعديل `.env` ثم إعادة تشغيل `10-roles.sh` ثم إعادة تشغيل الخادم |
| ENV-17 | `DB_HOST` | اختياري | `127.0.0.1` | `env.schema.ts`؛ `prisma.config.ts` | مضيف القاعدة الذي يتصل به الخادم وPrisma CLI (لا `localhost` لتجنّب IPv6)؛ داخل Compose يُفضَّل ضبط العنوانين صراحةً بدل تغييره |
| ENV-18 | `MIGRATION_DATABASE_URL` | اختياري | — (يُشتق من `DB_MIGRATOR_*`؛ وإلا `DATABASE_URL`) | `backend/prisma.config.ts` فقط | سلسلة اتصال **دور الترحيلات** لأوامر Prisma؛ تُضبط صراحةً في CI/الإنتاج |

- القوالب: `.env.example` (جذري — **المصدر الوحيد لإعدادات القاعدة** منذ CH-0008: `POSTGRES_*`، `DB_MIGRATOR_*`، `DB_APP_*`، `DB_HOST`)، `backend/.env.example` (إعدادات HTTP وتجاوزات اختيارية)، `frontend/.env.example` — أسماء وافتراضيات وقيم وهمية فقط. تُنسخ إلى `.env`، `backend/.env` (اختياري)، `frontend/.env.local` المتجاهَلة في Git (تم التحقق في CH-0007 وCH-0008 أن `git ls-files` لا يرصد أياً منها وأن كلمات المرور الحقيقية الثلاث لا تظهر في أي ملف مرصود). ~~بيانات اعتماد القاعدة تتكرر في ملفين~~ (KI-023 RESOLVED).
- الخادم يحمّل `backend/.env.local` ثم `backend/.env` ثم `../.env` الجذري (`src/config/env-files.ts`؛ الأول يغلب لكل متغير، ومتغيرات العملية تغلب الملفات) ثم يتحقق بمخطط zod؛ أي قيمة غير صالحة تُفشل الإقلاع برسالة تسمّي المتغير. المتغيرات غير المعلنة في المخطط تُسقَط من `ConfigService` (لكنها تبقى في `process.env` — KI-028). Prisma CLI يحمّل `backend/.env` ثم `../.env` بـ dotenv بالترتيب نفسه.
- مفاتيح `localStorage` في الواجهة (ليست متغيرات بيئة، لكنها حالة محلية موثّقة منذ CH-0005): `aca.language` (اللغة المختارة: `ar` أو `en`)، `aca.mockUser` (الجلسة التجريبية — KI-017).
- **لا تُسجَّل أبداً قيم سرية في هذه الوثيقة** (RULE 16). تُسجَّل الأسماء والأوصاف فقط.

### 11.4 إعداد قاعدة البيانات (منذ CH-0007، ADR-016)

1. شغّل Docker Desktop (WSL 2) وتأكد من `docker info`.
2. من الجذر: `cp .env.example .env` ثم استبدل القيم الثلاث `change-me` (`POSTGRES_PASSWORD`، `DB_MIGRATOR_PASSWORD`، `DB_APP_PASSWORD`) بقيم عشوائية قوية (مثلاً `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`). هذا الملف هو المصدر الوحيد لإعدادات القاعدة؛ **لا حاجة** إلى `backend/.env` إلا لتجاوز إعدادات HTTP.
3. من الجذر: `docker compose up -d --wait` (نحو 15 ثانية في أول تشغيل: إنشاء superuser والقاعدة ثم تشغيل `docker/postgres/initdb/10-roles.sh` الذي ينشئ دوري `articode_migrator` و`articode_app`). **مجلد قائم من قبل CH-0008:** السكربت لا يعمل آلياً، فشغّله مرة واحدة: `docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-roles.sh`.
4. في `backend/`: `npm run prisma:status` للتأكد من اتصال دور الترحيلات (يخرج بغير صفر مع "not managed by Prisma Migrate" ما دام لا ترحيلات — متوقع؛ سطر `Datasource "db"` يثبت الاتصال).
5. `npm run start:dev` ثم `curl http://localhost:3000/api/health/ready` → `"database":{"status":"up"}` (الخادم يتصل بدور التطبيق بعنوان مشتق من `.env` الجذري).

تغيير كلمات المرور **بعد** أول تشغيل: كلمة superuser (`POSTGRES_PASSWORD`) لا تتغير في مجلد قائم إلا بـ `ALTER USER <user> PASSWORD '<new>'` داخل الحاوية (أو بإعادة إنشاء المجلد بـ `docker compose down -v` الذي يفقد كل البيانات)؛ كلمتا الدورين تُغيَّران بتعديل `.env` ثم إعادة تشغيل `10-roles.sh` (idempotent) ثم إعادة تشغيل الخادم. الأوامر اليومية في 6.4 و11.5، والأعطال الشائعة في 14.10.

### 11.5 أوامر التطوير

**الخادم (`backend/`):**

| الأمر | ما يفعله |
|---|---|
| `npm run start` | `nest start` — تشغيل عادي |
| `npm run start:dev` | `nest start --watch` — مع إعادة التحميل؛ يطبع عند الجاهزية `API ready at http://localhost:3000/api` و`Swagger UI at http://localhost:3000/api/docs` (CH-0006) |
| `npm run start:debug` | `nest start --debug --watch` |
| `npm run start:prod` | `node dist/main` — يتطلب بناءً مسبقاً |
| `npm run build` | `prisma generate && nest build` → `dist/` (منذ CH-0007). **لا تشغّله بالتوازي مع `start:dev`**: `deleteOutDir` يحذف `dist/` أثناء إعادة تشغيل المراقب فيتعطّل |
| `npm run lint` | `oxlint src/ test/` |
| `npm run format` | `prettier --write "src/**/*.ts" "test/**/*.ts"` |
| `npm run test` | `vitest run` — اختبارات الوحدة (`**/*.spec.ts`) |
| `npm run test:watch` | `vitest` |
| `npm run test:cov` | `vitest run --coverage` |
| `npm run test:debug` | `vitest --inspect-brk --no-file-parallelism` |
| `npm run test:e2e` | `vitest run --config ./vitest.config.e2e.ts` |
| ~~`npm run deploy`~~ | أُزيل في CH-0006 مع `@nestjs/mau` |
| `postinstall` (تلقائي) | `prisma generate` بعد `npm ci`/`npm install` — يولّد العميل المتجاهَل في Git (CH-0007) |
| `npm run prisma:generate` | `prisma generate` — توليد العميل في `src/generated/prisma` |
| `npm run prisma:validate` | `prisma validate` — صحة `schema.prisma` |
| `npm run prisma:status` | `prisma migrate status` — حالة الترحيلات مقابل القاعدة (غير تدميري)؛ يتصل بدور migrator كبقية أوامر Prisma التي تلمس القاعدة (CH-0008) |
| `npm run prisma:migrate` | `prisma migrate dev` — إنشاء وتطبيق ترحيل في التطوير (`-- --name <وصف>`) |
| `npm run prisma:deploy` | `prisma migrate deploy` — تطبيق الترحيلات الملتزمة فقط (البيئات غير التطويرية) |
| `npm run prisma:studio` | `prisma studio` — متصفح بيانات رسومي |

**قاعدة البيانات (من جذر المستودع، منذ CH-0007):**

| الأمر | ما يفعله |
|---|---|
| `docker compose up -d` | تشغيل PostgreSQL في الخلفية (أول مرة: إنشاء المجلد والمستخدم والقاعدة) |
| `docker compose ps` | الحالة والفحص الصحي |
| `docker compose logs -f postgres` | سجل الخادم |
| `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` | جلسة SQL داخل الحاوية (المتغيرات متاحة داخلها) |
| `docker compose down` | إيقاف وحذف الحاوية مع **الإبقاء** على البيانات |
| `docker compose down -v` | إيقاف **وحذف البيانات** نهائياً (لا تراجع) |
| `docker compose config --quiet` | التحقق من الملف بلا طباعة الأسرار |
| `docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-roles.sh` | إنشاء/تحديث دوري القاعدة (migrator/app) على مجلد قائم وإعادة تطبيق كلمتَي المرور من `.env`؛ idempotent وغير تدميري (CH-0008) |

**الواجهة (`frontend/`):**

| الأمر | ما يفعله | حالة التحقق (2026-10-28) |
|---|---|---|
| `npm run dev` | خادم Vite للتطوير (افتراضياً `http://localhost:5173`، وينتقل تلقائياً إلى المنفذ التالي إن كان مشغولاً)؛ يمرّر `/api/*` إلى الخادم (CH-0006) | شغّله المستخدم بنجاح في 2026-10-28 على `5175` لأن `5173` و`5174` كانا مشغولين؛ على `5173` في CH-0005/CH-0006 |
| `npm run build` | `tsc -b && vite build` → `dist/` | ناجح في CH-0005 وCH-0006 (حزمة 1,318 kB — KI-016) |
| `npm run lint` | `oxlint` | نجح بلا تحذيرات |
| `npm run preview` | معاينة مخرجات البناء | لم يُشغَّل |

### 11.6 البناء والنشر

انظر [القسم 14](#14-deployment-and-operations--النشر-والتشغيل). لا يوجد إعداد نشر.

---

## 12. SECURITY ARCHITECTURE — المعمارية الأمنية

### 12.1 الحمايات المؤكدة في الكود (CONFIRMED)

| الحماية | الحالة | الدليل |
|---|---|---|
| TypeScript strict في الخادم | IMPLEMENTED | `backend/tsconfig.json` → `strict: true` |
| فحوص TypeScript صارمة في الواجهة | IMPLEMENTED (افتراضياً) | تم التحقق أن TS 7.0.2 يفرض `noImplicitAny` و`strictNullChecks` بلا إعلان صريح |
| `react/rules-of-hooks` كخطأ | IMPLEMENTED | `frontend/.oxlintrc.json` |
| عدم وجود أسرار في المستودع | CONFIRMED | لا ملفات `.env` (متجاهَلة في Git)؛ `.env.example` بالأسماء والافتراضيات فقط؛ لا متغير سري بعد |
| التحقق من متغيرات البيئة عند الإقلاع | IMPLEMENTED (CH-0006) | `backend/src/config/env.schema.ts` (zod) عبر `ConfigModule.forRoot({ validate })`؛ TEST-003 |
| CORS بقائمة أصول | IMPLEMENTED (CH-0006) | `backend/src/app.setup.ts` → `enableCors({ origin: CORS_ORIGIN, credentials: true })`؛ TEST-005 يتحقق من رفض أصل غير مدرج |
| `ValidationPipe` عام (`whitelist`, `forbidNonWhitelisted`, `transform`) | IMPLEMENTED (CH-0006) — غير مُختبَر على DTO بعد (KI-022) | `backend/src/app.setup.ts` |
| إخفاء `X-Powered-By` | IMPLEMENTED (CH-0006) | `app.disable('x-powered-by')` في `app.setup.ts`؛ TEST-005 يتحقق من غياب الرأس |
| قاعدة البيانات غير معرّضة للشبكة | IMPLEMENTED (CH-0007) | `compose.yaml` ينشر المنفذ على `127.0.0.1` فقط (متحقق منه بـ `netstat`: `127.0.0.1:5432 LISTENING`)؛ لا `0.0.0.0` |
| مصادقة قاعدة البيانات بكلمة مرور | IMPLEMENTED (CH-0007) | `scram-sha-256` لكل اتصال من خارج الحاوية؛ اختبار `pg` من المضيف: كلمة خاطئة → `28P01` |
| أسرار قاعدة البيانات خارج Git | CONFIRMED (CH-0007) | `.env` الجذري و`backend/.env` متجاهَلان (`git ls-files` لا يرصدهما)؛ القوالب `.env.example` بقيم وهمية؛ `compose.yaml` بلا قيم |
| رسائل الجاهزية بلا أسرار | IMPLEMENTED (CH-0007) | `PrismaService.ping()` يُعيد رسالة السائق فقط (لا سلسلة اتصال) |
| التطبيق يتصل بدور محدود (DML فقط) وفصل الترحيلات عن superuser | IMPLEMENTED (CH-0008) | `docker/postgres/initdb/10-roles.sh`؛ تحقق 2026-10-29: `has_schema_privilege(articode_app, public, CREATE) = false`، `CREATE TABLE` بدور app → `permission denied for schema public`، لا `TRUNCATE`؛ `pg_stat_activity` يُظهر الخادم كـ `articode_app`؛ `CONNECT` مسحوب من `PUBLIC` |
| إعدادات القاعدة في ملف واحد خارج Git وبيانات الاعتماد لا تتكرر | CONFIRMED (CH-0008) | `.env` الجذري فقط؛ `backend/.env` بلا بيانات اعتماد؛ فحص نصي لكلمات المرور الثلاث الحقيقية على كل الملفات المرصودة = لا تطابق |

**لا مصادقة ولا تفويض بعد.** الخادم يقدّم نقاط نهاية عامة فقط (health، Swagger) بلا بيانات حساسة.

### 12.2 الفجوات الحالية (مؤكدة من الكود) والتوصيات

| المجال | الحالة الفعلية | التوصية (RECOMMENDED) | الأولوية |
|---|---|---|---|
| المصادقة | غير موجودة | JWT (وصول قصير + تحديث) أو جلسات؛ `@nestjs/passport` | عالية قبل أي بيانات حقيقية |
| التفويض | غير موجود | `RolesGuard` + صلاحيات دقيقة؛ فرض على مستوى الخدمة لا المتحكم فقط | عالية |
| مصادقة الواجهة (CH-0005) | تجريبية: أي بيانات تُقبل، الجلسة والدور في `localStorage` (`frontend/src/auth/AuthProvider.tsx`) | تُستبدل بعميل MOD-01 (رمز JWT قصير العمر في الذاكرة + تحديث)؛ **لا تُعتبر حماية** (KI-017) | عالية قبل أي بيانات حقيقية |
| تفويض الواجهة (CH-0005) | إخفاء الشاشات حسب الدور فقط (`RequireRole`, `navigation.ts`) | الفرض الحقيقي في الخادم؛ الواجهة تبقى طبقة تجربة مستخدم فقط | — |
| كلمات المرور | غير موجودة | argon2id أو bcrypt بكلفة مناسبة؛ سياسة قوة؛ لا تُسجَّل في السجلات | عالية |
| التحقق من المدخلات | `ValidationPipe` عام مفعّل (CH-0006) بلا DTO طلب بعد | كل DTO طلب قادم يحمل قواعد `class-validator`؛ اختبار e2e لرفض الحقول الزائدة مع أول DTO (KI-022) | متوسطة |
| CORS | مفعّل بقائمة من `CORS_ORIGIN` (CH-0006) | مراجعة القائمة لكل بيئة نشر؛ عدم استخدام `*` مع `credentials` | منخفضة |
| Swagger في الإنتاج | مفعّل افتراضياً (`SWAGGER_ENABLED=true`) | ضبطه `false` في الإنتاج أو حمايته بمصادقة (SEC-R-05) | متوسطة عند النشر |
| رؤوس الأمان | لا شيء | `helmet` | متوسطة |
| تحديد المعدل | لا شيء | `@nestjs/throttler` خاصة على مسارات الدخول | متوسطة |
| عزل البيانات | قاعدة تطوير واحدة بلا بيانات (CH-0007) | قاعدة لكل أكاديمية (ADR-008)؛ منع أي استعلام عابر للأكاديميات | عالية عند التنفيذ |
| صلاحيات مستخدم قاعدة البيانات | **منفّذ (CH-0008):** التطبيق `articode_app` (DML)، الترحيلات `articode_migrator` (مالك القاعدة)، superuser للإدارة فقط | في الإنتاج: دور migrator بلا `CREATEDB` (KI-027)، حقن العنوانين مباشرة، تدوير كلمات المرور؛ منع `UPDATE/DELETE` على `audit_logs` بـ trigger (6.6) | متوسطة عند النشر |
| النسخ الاحتياطي | يدوي فقط (14.9) | نسخ مجدول مشفّر خارج الخادم مع اختبار استعادة (14.11) | عالية عند النشر |
| التعامل مع المعلومات الحساسة | لا شيء | تشفير الحقول الحساسة عند الحاجة؛ إخفاء في السجلات | متوسطة |
| سجلات التدقيق | لا شيء | جدول `audit_logs` للأحداث الحساسة (دخول، صلاحيات، مالية، درجات) | متوسطة |
| الإعداد الآمن | `@nestjs/config` + zod مع فشل مبكر (CH-0006) | إضافة كل متغير جديد إلى المخطط؛ لا قيم افتراضية للأسرار (مثل مفاتيح JWT) عند إضافتها | منخفضة |
| الاعتماديات | `npm audit`: 0 ثغرات في الخادم والواجهة بعد إزالة `@nestjs/mau` (CH-0006) | تشغيل `npm audit` دورياً؛ مراجعة حزمة القياس `@scarf/scarf` (KI-020) | منخفضة |
| رأس `X-Powered-By` | معطَّل (CH-0006، KI-014 RESOLVED) | `helmet` لبقية رؤوس الأمان | منخفضة |

### 12.3 المخاطر الأمنية المرصودة في الكود الحالي

| المعرّف | الخطر | الشدة الحالية | ملاحظة |
|---|---|---|---|
| SEC-R-01 | أي نقطة نهاية جديدة ستكون عامة افتراضياً حتى تُنفَّذ MOD-01 | منخفضة الآن، عالية لاحقاً | يجب تنفيذ المصادقة قبل أي بيانات حقيقية |
| SEC-R-02 | غياب التحقق من المدخلات | مخفَّف: `ValidationPipe` عام منذ CH-0006 | يبقى الخطر لأي DTO يُكتب بلا ديكوريتورات `class-validator` (مع `whitelist` تُحذف حقوله كلها بصمت) — KI-022 |
| SEC-R-05 | Swagger UI ووثيقة OpenAPI عامان بلا مصادقة (CH-0006) | منخفضة الآن (لا نقاط حساسة)، متوسطة عند النشر | `SWAGGER_ENABLED=false` في الإنتاج (ENV-05) |
| SEC-R-06 | التطبيق والترحيلات يتصلان بـ PostgreSQL بحساب superuser (CH-0007) | RESOLVED (CH-0008) | دور `articode_app` للتطبيق ودور `articode_migrator` للترحيلات (ADR-019، KI-024 RESOLVED)؛ يبقى KI-027 (`CREATEDB` محلياً) وKI-028 |
| SEC-R-07 | `docker compose down -v` أو حذف المجلد `postgres_data` يفقد كل البيانات بلا تراجع | منخفضة الآن | نسخة احتياطية قبل أي عملية على المجلد (14.9)؛ لا يُنفَّذ الأمر إلا بطلب صريح |
| SEC-R-03 | الواجهة تحتوي روابط خارجية بـ `target="_blank"` بلا `rel="noopener"` | RESOLVED (CH-0005) | أُزيل محتوى القالب بالكامل؛ لا روابط خارجية في الواجهة الحالية |
| SEC-R-04 | الجلسة التجريبية والدور في `localStorage` قابلان للتعديل من أدوات المطور (CH-0005) | لا أثر الآن (لا بيانات حقيقية ولا خادم)؛ **حرجة إن وصلت للإنتاج** | آلية نمذجة مؤقتة (ADR-012، KI-017)؛ يجب ألا تُنشر أي نسخة تعتمد عليها |

---

## 13. TESTING AND QUALITY ASSURANCE — الاختبار وضمان الجودة

### 13.1 الأطر

| التطبيق | الإطار | الحالة |
|---|---|---|
| Backend | Vitest 4 + `@nestjs/testing` + supertest | مُستخدم: ثلاثة ملفات وحدة + ملف شامل (28 اختباراً) منذ CH-0008؛ الاختبار الشامل للجاهزية يتكيّف مع وجود القاعدة ولا يتطلبها |
| Frontend | لا شيء | PLANNED (مقترح: Vitest + Testing Library، و Playwright للشامل) — لم يُعتمد بعد؛ هيكل CH-0005 بلا اختبارات آلية |

### 13.2 الاختبارات الموجودة

| المعرّف | الملف | النوع | ما يختبره | الحالة |
|---|---|---|---|---|
| TEST-001 | `backend/src/app.controller.spec.ts` | وحدة | `AppController.getHello()` يُعيد `"Hello World!"` | REMOVED في CH-0006 مع الملف |
| TEST-002 | `backend/test/app.e2e-spec.ts` (النسخة القديمة) | شامل | `GET /` → `200` و`"Hello World!"` | REMOVED في CH-0006 (استُبدل بـ TEST-005) |
| TEST-003 | `backend/src/config/env.schema.spec.ts` | وحدة (11) | الافتراضيات؛ تحويل `PORT` وقائمة CORS وعلم Swagger؛ رفض القيم غير الصالحة باسم المتغير؛ إسقاط المتغيرات غير المعلنة؛ `DATABASE_URL` اختياري/فارغ/صالح؛ رفض غير `postgresql://`؛ إلزامي في الإنتاج؛ **CH-0008:** اشتقاق `DATABASE_URL` من `DB_APP_*`/`POSTGRES_*`/`DB_HOST` مع ترميز الكلمة وإخفاء المدخلات من الناتج؛ أولوية العنوان الصريح؛ لا اشتقاق بلا كلمة مرور والفراغ = افتراضي؛ قبول المشتق في الإنتاج ورفض `POSTGRES_PORT` غير الصالح | ناجح (CH-0008) |
| TEST-004 | `backend/src/health/health.service.spec.ts` | وحدة (4) | `check()` يُعيد `ok` والإصدار والبيئة؛ `readiness()` مع `PrismaService` وهمي: up / down (مع رسالة السائق) / not_configured | ناجح (CH-0007) |
| TEST-005 | `backend/test/app.e2e-spec.ts` | شامل (7) | `GET /api/health` JSON؛ غياب `X-Powered-By`؛ `404` JSON تحت البادئة؛ `GET /` → `404` HTML؛ CORS للأصل المسموح فقط؛ `GET /api/health/ready` (200/up مع قاعدة حية، وإلا 503 بجسم متسق)؛ `/api/docs-json` يحوي المسارين | ناجح (CH-0007، CH-0008 — مع القاعدة حية بدور app) |
| TEST-006 | `backend/src/config/database-url.spec.ts` | وحدة (6) | `buildPostgresUrl()`: التجميع والترميز percent للكلمة والمستخدم واسم القاعدة، وبقاء الكلمات الآمنة كما هي؛ `postgresUrlFromEnv()`: undefined بلا كلمة مرور الدور، الافتراضيات المشتركة، متغيرات الدور والمضيف/المنفذ/القاعدة، رفض منفذ غير صالح | ناجح (CH-0008) |

### 13.3 أوامر الاختبار

انظر [11.5](#115-أوامر-التطوير). الوحدة: `npm run test`؛ الشامل: `npm run test:e2e`؛ التغطية: `npm run test:cov`.

### 13.4 الفحوص التي أُجريت فعلاً بتاريخ 2026-10-28 و2026-10-29

| الفحص | النتيجة |
|---|---|
| `frontend`: `npx tsc -b` | نجح (exit 0) |
| `frontend`: `npm run lint` (oxlint) | نجح بلا مخرجات |
| `backend`: اختبارات | لم تُشغَّل في CH-0002 لعدم وجود الاعتماديات |
| خطّاف التوثيق `.claude/hooks/doc-sync-check.mjs` | 17 سيناريو اختبار نجحت على نسخة مؤقتة من المشروع (انظر 14.7) |
| `backend`: `npm run test` (CH-0003) | نجح: ملف واحد، اختبار واحد، Vitest 4.1.12 |
| `backend`: `npm run test:e2e` (CH-0003) | نجح: ملف واحد، اختبار واحد |
| `backend`: `npm run lint` (CH-0003) | نجح بلا مخرجات |
| `backend`: `npm run build` (CH-0003) | نجح، والمخرجات في `backend/dist/` |
| `backend`: تشغيل `node dist/main.js` + curl (CH-0003) | `GET /` أعاد `200`، ومسار غير موجود أعاد `404` بصيغة JSON الافتراضية |
| `backend`: `npm audit` (CH-0003) | 5 ثغرات (2 منخفضة، 1 متوسطة، 2 عالية) كلها في شجرة `@nestjs/mau` (KI-011) |
| Git: `git ls-files` بعد CH-0004 | 42 ملفاً مرصوداً؛ لا `node_modules` ولا `dist` ولا `*.tsbuildinfo`؛ `git status` نظيف بعد commit `127cb1d` |
| `frontend`: `npm install` للحزم الخمس (CH-0005) | +73 حزمة، 0 ثغرات (`npm audit`) |
| `frontend`: `npx tsc -b` (CH-0005) | نجح (exit 0) على الهيكل الجديد كاملاً |
| `frontend`: `npm run lint` (CH-0005) | نجح بلا مخرجات (0 تحذيرات) |
| `frontend`: `npx vite build` (CH-0005) | نجح في 3.7 ثانية؛ 3,166 وحدة؛ `index-*.js` بحجم 1,306 kB (gzip 416 kB) مع تحذير حجم > 500 kB (KI-016) |
| `frontend`: خادم التطوير (CH-0005) | `GET /` و8 وحدات مصدرية جديدة (`main.tsx`, `app/App.tsx`, `app/router.tsx`, `layout/AppLayout.tsx`, `pages/DashboardPage.tsx`, `pages/LoginPage.tsx`, `i18n/index.ts`, `mock/data.ts`) أعادت `200`؛ HTML المُقدَّم يحمل `lang="ar" dir="rtl"` و`<title>ArtiCode Academy</title>`؛ سجل Vite بلا أخطاء بعد إعادة تحسين الاعتماديات |
| `backend`: `GET /` أثناء CH-0005 | ما زال يُعيد `Hello World!` (الخادم لم يُمس) — سجل تاريخي؛ المسار أُزيل في CH-0006 |
| العرض المرئي في متصفح (CH-0005) | **لم يُتحقق منه آلياً** — لا أداة متصفح في الجلسة. `UNVERIFIED` حتى يفتحه المالك على http://localhost:5173 |
| `backend`: `npm run lint` (CH-0006) | نجح بلا مخرجات |
| `backend`: `npm run test` (CH-0006) | ملفان، 5 اختبارات ناجحة |
| `backend`: `npm run test:e2e` (CH-0006) | ملف واحد، 6 اختبارات ناجحة (فشل اختبار واحد في المحاولة الأولى لأن `GET /` خارج البادئة يُعيد HTML لا JSON؛ صُحّح التوقع ليطابق سلوك Express الفعلي) |
| `backend`: `npm run build` (CH-0006) | نجح؛ `dist/` يحوي `app.setup`, `common/`, `config/`, `health/` |
| `backend`: `npm audit` (CH-0006) | 0 ثغرات بعد إزالة `@nestjs/mau` |
| `backend`: الخادم الحي عبر curl (CH-0006) | `GET /api/health` → `200` JSON؛ رؤوس `Access-Control-Allow-Origin: http://localhost:5173` و`Access-Control-Allow-Credentials: true`؛ لا `X-Powered-By`؛ `GET /` → `404` HTML؛ `/api` و`/api/nope` و`/api/docs/nope` → `404` JSON؛ `/api/docs` و`/api/docs-json` → `200` |
| `frontend`: `npx tsc -b` + `npm run lint` + `npx vite build` (CH-0006) | نجحت؛ تحذير `react(set-state-in-effect)` ظهر ثم أُصلح في `useHealth.ts`؛ الحزمة 1,318 kB (KI-016) |
| الواجهة ↔ الخادم عبر proxy (CH-0006) | `curl http://localhost:5173/api/health` → `200` بنفس JSON الخادم |
| العرض المرئي لبطاقة "الاتصال بالخادم" (CH-0006) | **لم يُتحقق منه في متصفح** — `UNVERIFIED` |
| Docker (CH-0007) | `docker info`: محرك 29.9.2، Compose v5.6.1، 12 CPU، ~8 GB للآلة الافتراضية، السياق `desktop-linux`؛ `docker ps -a`: حاوية `hello-world` قديمة خارج المشروع (لم تُمس)؛ لا مجلدات ولا مشاريع compose سابقة؛ المنفذ 5432 حرّ |
| `docker compose config --quiet` (CH-0007) | صالح؛ لم تُطبع الأسرار |
| `docker compose up -d` (CH-0007) | الحاوية `articode-academy-postgres-1` صحية بعد ~15 ثانية؛ `127.0.0.1:5432->5432/tcp`؛ المجلد `articode-academy_postgres_data`؛ PGDATA `/var/lib/postgresql/18/docker` (47 MB) |
| PostgreSQL داخل الحاوية (CH-0007) | `select version()` → 18.6 (Debian)؛ `current_user=articode`، `current_database=articode_academy`، `data_checksums=on` |
| مصادقة من المضيف بـ `pg` (CH-0007) | كلمة المرور الصحيحة: متصل (العميل يُرى من بوابة Docker `172.18.0.1`)؛ الخاطئة: `28P01 password authentication failed`. (اختبار كلمة خاطئة من داخل الحاوية نجح زوراً لأن loopback داخلها `trust` — لا يعكس اتصالات المضيف) |
| `npx prisma validate` / `prisma generate` (CH-0007) | صالح؛ العميل وُلّد في ~30 ms بلا تنزيل محركات رغم أن npm 11 منع سكربتات تثبيت `prisma` و`@prisma/engines` (KI-026) |
| `npm run prisma:status` (CH-0007) | اتصل بـ `127.0.0.1:5432` (سطر `Datasource "db"`)؛ "No migration found"، القاعدة غير مُدارة بعد (خروج 1 متوقع)؛ عدد الجداول خارج المخططات النظامية بعده = 0 |
| `backend`: `lint` / `test` / `build` (CH-0007) | نظيف / 11 ناجحاً (بعد تصحيح اختبار كان يستخدم `NODE_ENV=production` بلا `DATABASE_URL`) / ناجح، `dist/` يحوي `prisma/` و`generated/prisma/` |
| `backend`: `test:e2e` مع القاعدة حية (CH-0007) | 7/7 ناجحة |
| `frontend`: `tsc -b` / `lint` / `vite build` (CH-0007) | نجحت؛ الحزمة 1,319 kB |
| الخادم الحي (CH-0007) | `GET /api/health/ready` مباشرة → `200` `{"status":"ready","checks":{"database":{"status":"up","latencyMs":120}}}` (أول اتصال يفتح المجمّع)، وعبر proxy Vite → `200` بـ `latencyMs: 3`؛ `/api/docs-json` يحوي `/api/health` و`/api/health/ready` |
| حادثة أثناء التحقق (CH-0007) | خادم المراقبة تعطّل مرة واحدة لأن `npm run build` (يحذف `dist/`) شُغّل بالتوازي مع إعادة ترجمته؛ أُعيد تشغيله. **لا تشغّل `build` و`start:dev` معاً** (11.5) |
| العرض المرئي لسطر "قاعدة البيانات" في البطاقة (CH-0007) | **لم يُتحقق منه في متصفح** — `UNVERIFIED` |
| `backend`: `lint` / `test` (CH-0008) | نظيف / 21 اختباراً ناجحاً في 3 ملفات (+10 عن CH-0007) |
| `npx prisma validate` (CH-0008) | صالح؛ `prisma.config.ts` الجديد حُمّل مع استيراده من `src/config/database-url.ts` |
| `docker compose config --quiet` ثم `up -d --wait` (CH-0008) | صالح؛ الحاوية أُعيد إنشاؤها بالبيئة الجديدة وتركيب `initdb` وصارت `healthy`؛ المجلد `articode-academy_postgres_data` نفسه (طابع الإنشاء 13:06:16Z لم يتغير)؛ القاعدة `articode_academy` بـ 0 جداول قبل وبعد |
| تشغيل `10-roles.sh` على القاعدة القائمة (CH-0008) | `CREATE ROLE` ×2، `ALTER ROLE` ×2، `ALTER DATABASE OWNER`، `REVOKE/GRANT`، `ALTER DEFAULT PRIVILEGES` ×2 — كلها ناجحة |
| تحقق الامتيازات داخل الحاوية (CH-0008) | `\du`: `articode` superuser، `articode_migrator` (Create DB)، `articode_app` (بلا سمات)؛ مالك القاعدة `articode_migrator`؛ `has_database_privilege(CONNECT)` = t للدورين؛ `has_schema_privilege(app, USAGE)=t`، `(app, CREATE)=f`، `(migrator, CREATE)=t`؛ `pg_default_acl`: `articode_app=arwd` على الجداول و`rU` على التسلسلات من `articode_migrator`؛ جدول تجريبي أنشأه migrator داخل معاملة مُلغاة: app يملك SELECT/INSERT ولا يملك TRUNCATE؛ `CREATE TABLE` بدور app → `ERROR: permission denied for schema public` |
| `backend`: `test:e2e` بعد إزالة `DATABASE_URL` من `backend/.env` (CH-0008) | 7/7 ناجحة مع القاعدة حية (العنوان مشتق من `.env` الجذري) |
| `npm run prisma:status` (CH-0008) | اتصل بـ `127.0.0.1:5432` بدور migrator (سطر `Datasource "db"`)؛ "No migration found" (متوقع) |
| نسخة مؤقتة من `dist/main` على المنفذ 3999 (CH-0008) | `GET /api/health/ready` → `200` `up` (214 ms أول اتصال)؛ `pg_stat_activity` أظهر الاتصال بـ `usename = articode_app` من بوابة Docker؛ أُوقفت بعد الفحص. لم يُشغَّل `npm run build` لأن `start:dev` كان يعمل (dist مُحدَّث بواسطة المراقب) |
| فحص الأسرار قبل الالتزام (CH-0008) | `git ls-files` بلا أي `.env`؛ بحث نصي عن كلمات المرور الحقيقية الثلاث في كل الملفات التي سيضيفها `git add -A` = لا تطابق؛ أنماط `password|secret|token|postgres://` في الملفات المرصودة = قوالب (`change-me`، `u:p`) ونصوص واجهة فقط |
| `uuidv7()` في PostgreSQL 18.6 (CH-0009، D4) | `select uuidv7()` نجح؛ `uuid_extract_version() = 7` و`uuid_extract_timestamp()` يُعيد الوقت الحالي |
| توافق Prisma 7.10.1 مع `uuidv7()` (CH-0009، D4) | مخطط تجريبي خارج المستودع (`scratchpad/uuidv7-probe.prisma`) بـ `@id @default(dbgenerated("uuidv7()")) @db.Uuid` + `Json @db.JsonB` + `enum` + `@@map`: `prisma validate` صالح، و`prisma migrate diff --from-empty --to-schema --script` (قراءة فقط، بلا قاعدة) ولّد `"id" UUID NOT NULL DEFAULT uuidv7()` و`JSONB` و`CREATE TYPE ... AS ENUM` والفهارس وقيود FK |
| دورة DDL لدور migrator (CH-0009، البند 7) | داخل معاملة مُلغاة بـ `SET LOCAL ROLE articode_migrator`: `CREATE TABLE _prisma_migrations`، `CREATE TYPE` enum، `CREATE TABLE` بـ `DEFAULT uuidv7()`، `CREATE UNIQUE INDEX` (كامل وجزئي)، `ALTER TABLE ADD COLUMN`، `CREATE FUNCTION` plpgsql، `CREATE TRIGGER`، `INSERT ... RETURNING` (أعاد UUID إصدار 7)، `DROP TABLE/TYPE` — كلها نجحت؛ `rolcreatedb = t` للقاعدة الظلية؛ 0 جداول بعد التراجع |
| امتيازات app على كائنات migrator (CH-0009) | `has_table_privilege`: SELECT/INSERT/UPDATE/DELETE = t، TRUNCATE/REFERENCES/TRIGGER = f؛ `has_type_privilege(enum, USAGE)` = t؛ `CREATE TYPE` بدور app → `permission denied for schema public`؛ `rolcreatedb = f` |
| trigger الإلحاق لـ `audit_logs` (CH-0009، D5) | داخل معاملة مُلغاة: migrator ينشئ الجدول والدالة والـ trigger ويُدرج صفاً؛ دور app يُدرج صفاً ثم `UPDATE` و`DELETE` → `ERROR: audit_logs is append-only` في الحالتين؛ الصفان بقيا؛ 0 جداول بعد التراجع |
| `prisma migrate diff --help` / `prisma --help` (CH-0009، 6.6.3) | العلمان `--config` و`--exit-code` و`--from-migrations`/`--to-schema` متوفرة في 7.10.1 (أساس حارس الانجراف وتشغيل مخطط المنصة بإعداد منفصل) |

### 13.5 فجوات الاختبار الحالية

- لا اختبارات للواجهة، بما فيها هيكل CH-0005: التوجيه، i18n (تطابق المفاتيح يحميه `tsc` فقط)، بوابات الأدوار، المصادقة التجريبية.
- اختبارات الخادم تغطي البيئة والفحص الحي والجاهزية والحدود (CORS / 404 / Swagger / الرؤوس) فقط؛ `ValidationPipe` غير مُختبَر على DTO فعلي (KI-022).
- حالة "القاعدة متوقفة" للجاهزية مُختبَرة على مستوى الوحدة فقط (TEST-004 بـ `PrismaService` وهمي)؛ الاختبار الشامل يتكيّف مع البيئة ولا يفرض الحالتين. لا اختبارات تكامل تستخدم قاعدة مؤقتة (testcontainers) بعد.
- لا تغطية مقاسة.
- لا تكامل مستمر (CI).

### 13.6 الاختبارات الفاشلة المعروفة

لا شيء معروف (ولا شيء تم تشغيله في الخادم).

---

## 14. DEPLOYMENT AND OPERATIONS — النشر والتشغيل

### 14.1 البيئات

| البيئة | الحالة |
|---|---|
| Development (محلي) | الوحيدة الموجودة: Docker Compose لقاعدة البيانات (CH-0007) + `npm run start:dev` و`npm run dev` يدوياً على Windows |
| Staging | `NOT YET DETERMINED` |
| Production | `NOT YET DETERMINED` |

### 14.2 عملية البناء

- الخادم: `npm run build` = `prisma generate && nest build` → `backend/dist/` (JavaScript ESM + خرائط مصدر + تعريفات، ويشمل `generated/prisma/`). التشغيل: `node dist/main` مع `DATABASE_URL` في البيئة (إلزامي عندما `NODE_ENV=production`).
- الواجهة: `npm run build` → `frontend/dist/` (أصول ثابتة).

### 14.3 عملية النشر

**لا نشر للإنتاج بعد.** لا Dockerfile للتطبيقين ولا CI/CD. `compose.yaml` الجذري يشغّل قاعدة البيانات للتطوير فقط (14.8). سكربت `nest deploy` (Mau) أُزيل في CH-0006. خارطة النشر السحابي في 14.11.

### 14.4 افتراضات الاستضافة

`NOT YET DETERMINED`. نموذج "نشر مستقل لكل أكاديمية" يقترح مشروع Docker Compose لكل أكاديمية (حاويات + قاعدة PostgreSQL + مجلد مستقل) على VPS (RECOMMENDED — التفصيل في 14.11).

### 14.5 الترحيلات، السجلات، المراقبة، النسخ الاحتياطي، التراجع

| البند | الحالة |
|---|---|
| ترحيلات قاعدة البيانات | Prisma Migrate جاهز (`prisma:migrate` للتطوير، `prisma:deploy` لغيره)؛ **لا ترحيلات بعد** (CH-0007)؛ تُنفَّذ بدور migrator (`MIGRATION_DATABASE_URL` أو المشتق من `DB_MIGRATOR_*` — CH-0008)؛ في الإنتاج تُطبَّق بـ `prisma migrate deploy` قبل تشغيل النسخة الجديدة (14.11) |
| التسجيل (Logging) | مسجّل NestJS الافتراضي فقط؛ تحذير عند غياب `DATABASE_URL` |
| المراقبة | لا شيء؛ `GET /api/health` و`GET /api/health/ready` جاهزان للربط بأي مراقب |
| النسخ الاحتياطي/الاستعادة | يدوي عبر `pg_dump`/`pg_restore` داخل الحاوية (14.9)؛ لا جدولة |
| استراتيجية التراجع | Git متوفر منذ CH-0004 (commit الأساس `127cb1d` على `main`)؛ سياسة الفروع والإصدارات `NOT YET DETERMINED`؛ لا remote |

### 14.6 القيود التشغيلية

- المستودع تحت Git منذ CH-0004 (KI-002 RESOLVED)؛ لا remote ولا نسخة خارج جهاز التطوير بعد.
- تثبيت الخادم أصبح قابلاً لإعادة الإنتاج عبر `npm ci` منذ CH-0003 (ويولّد عميل Prisma في `postinstall` منذ CH-0007). إضافة اعتماديات جديدة تحتاج npm 11 (KI-015).
- قاعدة البيانات تعمل فقط عندما يعمل Docker Desktop؛ `restart: unless-stopped` يعيدها مع Docker لا مع Windows وحده. بدونها يعمل الخادم ويُعيد `/api/health/ready` 503 `down`.
- أوامر `docker` تظهر في PATH للجلسات التي بدأت بعد تثبيت Docker Desktop فقط (KI-025).
- `npm run build` يحذف `dist/`؛ لا يُشغَّل بالتوازي مع `start:dev`.

### 14.7 آلية التحقق من مزامنة التوثيق (Documentation sync guard) — `IMPLEMENTED`

**الملفات:** `.claude/settings.json`, `.claude/hooks/doc-sync-check.mjs`, حالة في `.claude/.doc-sync/` (متجاهَلة ذاتياً عبر `.gitignore`).

**المبدأ:** مقارنة بصمات (SHA-1) لملفات الكود بين بداية الجلسة ونهاية كل دور (turn) لـ Claude Code. لا يعتمد على Git.

```mermaid
stateDiagram-v2
    [*] --> Baseline: SessionStart (startup|resume|clear|fork)
    Baseline --> Compare: Stop
    Compare --> Allow: no code change
    Compare --> Allow: code changed AND docs/PROJECT_DOCUMENTATION.md changed
    Compare --> Block: code changed, master doc unchanged, stop_hook_active=false
    Compare --> WarnAllow: code changed, master doc unchanged, stop_hook_active=true
    Block --> Compare: Claude updates docs then stops again
    Allow --> Baseline: refresh baseline
    WarnAllow --> Baseline: refresh baseline + systemMessage to user
```

**السلوك التفصيلي:**

| الحالة عند `Stop` | النتيجة |
|---|---|
| لا تغيير في ملفات الكود المراقبة | يسمح بالإنهاء ويحدّث الخط الأساسي |
| تغيّر كود **و**تغيّرت `docs/PROJECT_DOCUMENTATION.md` | يسمح ويحدّث الخط الأساسي |
| تغيّر كود ولم تتغير الوثيقة، و`stop_hook_active=false` | **يمنع الإنهاء مرة واحدة** ويُعيد لـ Claude قائمة الملفات المتغيرة وقائمة تحقق RULE 18 |
| نفس السابق مع `stop_hook_active=true` | يسمح (منع الحلقات اللانهائية) ويعرض تحذيراً للمستخدم عبر `systemMessage` |
| لا يوجد خط أساسي للجلسة | ينشئ واحداً ويسمح (fail-open) |
| أي خطأ داخلي | يُطبع إلى stderr ويسمح (fail-open) |

**الملفات المراقبة:** كل الملفات تحت جذر المشروع بامتدادات `.ts .tsx .js .jsx .mjs .cjs .json .html .css .scss .sass .less .sql .prisma .graphql .gql .yml .yaml .toml` و`.env.example` و`Dockerfile` و`.prettierrc` و`.editorconfig`، **باستثناء** `docs/`, `.claude/`, `CLAUDE.md`, ملفات `*.md`, ملفات القفل، `.env*`, `*.log`, `*.tsbuildinfo`، والمجلدات `node_modules dist build coverage out .git .vite .tmp .turbo .next .cache .idea .vscode`.

**الاختبار (2026-10-28):** 17 سيناريو نجحت على نسخة مؤقتة من المشروع (إنشاء الخط الأساسي، السماح بلا تغيير، المنع عند تغيير الكود، السماح بعد تحديث الوثيقة، منع الحلقة عبر `stop_hook_active`، تجاهل `node_modules`/`.md`/`.env`، إضافة/حذف ملفات، الحفاظ على الخط الأساسي عند `compact`، تعقيم معرّف الجلسة، تنفيذ الأمر الفعلي عبر Git Bash مع استبدال `${CLAUDE_PROJECT_DIR}`). مسح المشروع الحقيقي (25 ملفاً) استغرق ~90ms.

**الحدود المعروفة (KI-010):**

1. يتحقق من أن الوثيقة **لُمست**، لا من **صحة** التحديث. قائمة التحقق في `CLAUDE.md` تبقى إلزامية.
2. يحسب أي تغيير في الكود — حتى التنسيق فقط — تغييراً يستلزم توثيقاً؛ يمكن لـ Claude أن يصرّح بأن لا حاجة لتوثيق وينهي مجدداً (منع مرة واحدة فقط لكل دور).
3. تعديلات يجريها المستخدم يدوياً أثناء الجلسة ستُحسب أيضاً عند `Stop` التالي.
4. الخطّافات المُضافة أثناء جلسة جارية قد لا تُفعَّل حتى تلتقطها مراقبة الملفات أو تُستأنف الجلسة؛ كما لا تعمل الخطّافات في مجلد غير موثوق (workspace trust) في Claude Code.
5. يحمي Claude Code نفسه بحد أقصى 8 استمرارات متتالية من خطّافات `Stop` (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`)؛ هذا الخطّاف يمنع مرة واحدة فقط.
6. يتطلب `node` على `PATH` في بيئة الخطّاف.

### 14.8 معمارية Docker للتطوير المحلي (CH-0007، ADR-016)

```mermaid
flowchart LR
    subgraph WIN["Windows 11 (host)"]
        FE["frontend: npm run dev\n:5173"]
        BE["backend: npm run start:dev\n:3000 (role articode_app)"]
        CLI["backend: prisma CLI\nmigrate (role articode_migrator)"]
        ENVR[".env (root)\nPOSTGRES_* · DB_MIGRATOR_* · DB_APP_*"]
        ENVB["backend/.env (optional)\nHTTP overrides only"]
        INIT["docker/postgres/initdb/10-roles.sh"]
    end
    subgraph DD["Docker Desktop (WSL 2 VM)"]
        subgraph CP["compose project: articode-academy"]
            PG["service postgres\npostgres:18 (18.6)\nhealthcheck: pg_isready"]
            VOL[("volume postgres_data\n/var/lib/postgresql")]
            PG --- VOL
        end
    end
    ENVR -. "variable interpolation" .-> PG
    ENVR -. "derived DATABASE_URL" .-> BE
    ENVR -. "derived migration URL" .-> CLI
    ENVB -. "optional overrides" .-> BE
    INIT -. "mounted read-only; runs on first init" .-> PG
    FE -->|"/api proxy"| BE
    BE -->|"127.0.0.1:5432 → 5432 (loopback only)"| PG
    CLI -->|"127.0.0.1:5432"| PG
```

| العنصر | القيمة |
|---|---|
| ملف التعريف | `compose.yaml` في الجذر (Compose v2، بلا حقل `version`) |
| اسم المشروع | `articode-academy` (حقل `name`) → الحاوية `articode-academy-postgres-1`، المجلد `articode-academy_postgres_data`، الشبكة `articode-academy_default` |
| الصورة | `postgres:18` (Debian، 650 MB؛ المثبّت 18.6) |
| المنفذ | `127.0.0.1:${POSTGRES_PORT:-5432}:5432` — غير مرئي من الشبكة |
| البيانات | مجلد مسمّى على `/var/lib/postgresql` (صورة 18 تضع PGDATA في `/var/lib/postgresql/18/docker` لتسهيل `pg_upgrade`؛ تركيب `.../data` القديم لا يصلح) |
| الصحة | `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` كل 10 ثوانٍ، 5 محاولات، فترة بدء 15 ثانية |
| إعادة التشغيل | `unless-stopped` — تعود مع Docker Desktop ما لم تُوقَف يدوياً |
| الأسرار | `.env` الجذري وحده (متجاهَل): كلمات مرور superuser والدورين؛ `compose.yaml` لا يحوي قيماً؛ `docker compose config --quiet` للتحقق بلا طباعة (CH-0008) |
| الأدوار | `articode` (superuser، إدارة)، `articode_migrator` (مالك القاعدة، ترحيلات)، `articode_app` (DML) — ينشئها `docker/postgres/initdb/10-roles.sh` المركَّب على `/docker-entrypoint-initdb.d` للقراءة فقط (CH-0008، 6.1) |
| التطبيقات | تعمل على Windows مباشرة (ليست في حاويات بعد)؛ عند تحويلها إلى حاويات يصبح مضيف القاعدة `postgres` عبر شبكة compose ولا حاجة لنشر المنفذ |

### 14.9 النسخ الاحتياطي والاستعادة (إجراء يدوي — لا أتمتة بعد)

**متى:** قبل أي `docker compose down -v`، أو تغيير إصدار PostgreSQL، أو ترحيل حساس. **في الإنتاج (PLANNED):** نسخ يومي مشفّر خارج الخادم مع اختبار استعادة دوري (14.11).

```bash
# من جذر المستودع (Git Bash). نسخة منطقية بصيغة custom (قابلة للاستعادة الانتقائية):
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-$(date +%Y%m%d-%H%M).dump

# الاستعادة (--clean يحذف الكائنات الموجودة أولاً):
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backup-YYYYMMDD-HHMM.dump

# بديل فيزيائي: أرشفة المجلد كاملاً والقاعدة متوقفة
docker compose stop postgres
docker run --rm -v articode-academy_postgres_data:/data -v "$PWD":/backup alpine tar czf /backup/postgres_data-$(date +%Y%m%d).tgz -C /data .
docker compose start postgres
```

ملفات النسخ (`backup-*.dump`، `postgres_data-*.tgz`) متجاهَلة في `.gitignore` الجذري منذ CH-0007 ويجب حفظها خارج جهاز التطوير.

### 14.10 استكشاف الأخطاء (أوامر جاهزة)

| العرض | الفحص / العلاج |
|---|---|
| `docker: command not found` في طرفية فُتحت قبل التثبيت | افتح طرفية جديدة، أو أضف `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` إلى PATH الجلسة (KI-025) |
| `error getting credentials - docker-credential-desktop` | السبب نفسه: مجلد Docker ليس في PATH الجلسة (الأداة المساعدة تقع فيه) |
| `docker compose up` يفشل: `Set POSTGRES_USER in .env` | أنشئ `.env` الجذري من `.env.example` |
| `docker compose up` يفشل: `Set DB_MIGRATOR_PASSWORD in .env` أو `Set DB_APP_PASSWORD in .env` | ملف `.env` من قبل CH-0008: أضف `DB_MIGRATOR_USER/PASSWORD` و`DB_APP_USER/PASSWORD` (انظر `.env.example`) ثم `up -d` ثم شغّل `10-roles.sh` مرة واحدة |
| `28P01 password authentication failed for user "articode_app"` (أو `articode_migrator`) | الدور غير موجود أو كلمة المرور في `.env` لا تطابق القاعدة: `docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-roles.sh` يُعيد تطبيقها، ثم أعد تشغيل الخادم |
| `permission denied for schema public` أو `must be owner of table` من التطبيق | التطبيق يحاول DDL بدور `articode_app` (ممنوع عمداً)؛ الترحيلات تُشغَّل بأوامر Prisma فقط (دور migrator) |
| `prisma migrate dev` يفشل في إنشاء القاعدة الظلية (`permission denied to create database`) | دور migrator بلا `CREATEDB`: أعد تشغيل `10-roles.sh` (يمنحها محلياً)، أو اضبط `shadowDatabaseUrl` في `prisma.config.ts` |
| الخادم يعمل بعد تغيير `.env` لكن الجاهزية ما زالت تعكس القيم القديمة | ملفات env تُقرأ عند الإقلاع فقط؛ أعد تشغيل `start:dev` (المراقب يعيد التشغيل عند تغيّر `src/` لا `.env`) |
| المنفذ 5432 مشغول | `netstat -ano \| findstr :5432` ثم غيّر `POSTGRES_PORT` و`DATABASE_URL` |
| الحاوية `unhealthy` أو تعيد التشغيل | `docker compose logs postgres`؛ غالباً مجلد من إصدار أقدم، أو كلمة مرور تغيّرت بعد أول تشغيل |
| `/api/health/ready` → 503 `down` مع `ECONNREFUSED` | القاعدة متوقفة (`docker compose ps` ثم `up -d`)، أو `DATABASE_URL` يشير إلى مضيف/منفذ خاطئ (`localhost` قد يُحلّ إلى IPv6 `::1` — استخدم `127.0.0.1`) |
| `/api/health/ready` → 503 `not_configured` | `backend/.env` بلا `DATABASE_URL` (أو فارغ) |
| `28P01 password authentication failed` لـ superuser | كلمة `POSTGRES_PASSWORD` في `.env` الجذري لا تطابق التي أُنشئ بها المجلد؛ `ALTER USER <user> PASSWORD '...'` داخل الحاوية أو إعادة إنشاء المجلد (مع نسخة احتياطية) |
| `prisma migrate status` يخرج بـ 1 | متوقع ما دام لا ترحيلات ("not managed by Prisma Migrate")؛ الاتصال ناجح إذا ظهر سطر `Datasource "db"` |
| `Cannot find module './generated/prisma/client.js'` | `npm run prisma:generate` (أو `npm ci` الذي يشغّله في `postinstall`) |
| خادم المراقبة يتعطّل بـ `ERR_MODULE_NOT_FOUND` داخل `dist/` | شُغّل `npm run build` أثناء `start:dev`؛ أعد تشغيل `start:dev` |
| فحص سريع من داخل الحاوية | `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'` |
| قائمة الجداول وأحجامها | `\dt+` و`\l+` داخل `psql`؛ أو `npm run prisma:studio` |

### 14.11 اعتبارات النشر على VPS سحابي (RECOMMENDED — غير منفَّذة)

الهدف: الوصول إلى "نشر مستقل لكل أكاديمية" (REQ-01/02، ADR-008) بنفس أدوات التطوير.

| البند | التوصية |
|---|---|
| تكوين الملفات | `compose.yaml` (الأساس) + `compose.prod.yaml` (تجاوزات الإنتاج): حذف نشر منفذ القاعدة كلياً؛ إضافة خدمة `api` (Dockerfile متعدد المراحل: `npm ci` → `prisma generate` → `nest build` → صورة تشغيل بلا devDependencies مع `SWAGGER_ENABLED=false`) وخدمة `web` (بناء Vite يخدمه وكيل عكسي) |
| الوكيل العكسي وTLS | Caddy أو Traefik أمام `api` و`web` مع شهادات تلقائية؛ `CORS_ORIGIN` = نطاق الأكاديمية |
| أكاديمية لكل نشر | مشروع compose مستقل لكل أكاديمية (`docker compose -p academy-<slug> --env-file .env.<slug>`) → حاويات ومجلد وشبكة وقاعدة مستقلة؛ أو خادم PostgreSQL واحد بقاعدة لكل أكاديمية إن حُسم ADR-008 كذلك |
| الأسرار | ملف env لكل بيئة خارج Git أو Docker secrets؛ أدوار القاعدة المحدودة منفّذة محلياً (CH-0008) وتُنقل كما هي: `DATABASE_URL` (دور app) لخدمة `api`، و`MIGRATION_DATABASE_URL` (دور migrator بلا `CREATEDB`) لحاوية الترحيل، وكلمة superuser لحاوية القاعدة فقط؛ تدوير كلمات المرور بإعادة تشغيل `10-roles.sh` |
| الترحيلات الآلية | خطوة `prisma migrate deploy` في CI/CD، أو حاوية `migrate` لمرة واحدة قبل تحديث `api` (`depends_on` بشرط `service_completed_successfully`)؛ تتصل بدور migrator عبر `MIGRATION_DATABASE_URL`؛ لا `migrate dev` ولا `db push` في الإنتاج |
| البيئات | staging وproduction بملفات env منفصلة ونفس الصور؛ لا بيانات حقيقية في staging |
| النسخ الاحتياطي | `pg_dump -Fc` مجدول (cron أو حاوية) إلى تخزين كائنات خارج الخادم، تشفير، احتفاظ 7–30 يوماً، اختبار استعادة شهري |
| المراقبة | `postgres-exporter` + Prometheus/Grafana أو بديل مُدار؛ تنبيه على فشل `/api/health/ready`؛ سجلات مركزية |
| Redis (لاحقاً) | خدمة `redis` في compose للجلسات/الطوابير/التخزين المؤقت؛ تُضاف إلى الجاهزية؛ `REDIS_URL` في `env.schema.ts` |
| الموارد | ضبط `shared_buffers`/`work_mem` حسب ذاكرة الخادم؛ `shm_size` للحاوية عند الاستعلامات الثقيلة |

---

## 15. FEATURE STATUS MATRIX — مصفوفة حالة الميزات

| المعرّف | الميزة | الوحدة | الحالة | الملفات ذات الصلة | ملاحظات |
|---|---|---|---|---|---|
| FS-001 | تشغيل خادم HTTP مع `GET /` | MOD-00 | REMOVED | — | نقطة الهيكل أُزيلت في CH-0006؛ الخادم نفسه يعمل ضمن FS-036 |
| FS-002 | قالب واجهة React يعمل | MOD-FE-00 | REMOVED | — | قالب Vite الافتراضي أُزيل في CH-0005 وحلّ محلّه FS-034 |
| FS-003 | اختبارات الخادم (وحدة + شامل) | MOD-00 | IMPLEMENTED | `backend/src/config/env.schema.spec.ts`, `backend/src/health/health.service.spec.ts`, `backend/test/app.e2e-spec.ts` | 11 اختباراً ناجحاً (CH-0006)؛ TEST-003..TEST-005 |
| FS-004 | نظام التوثيق المستمر (وثيقة رئيسية + CLAUDE.md + خطّاف) | Tooling | IMPLEMENTED | `docs/PROJECT_DOCUMENTATION.md`, `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/doc-sync-check.mjs` | CH-0002 |
| FS-010 | المصادقة | MOD-01 | PLANNED | — | شاشة دخول تجريبية فقط (`frontend/src/pages/LoginPage.tsx`, `auth/AuthProvider.tsx`) لا تستدعي خادماً — ليست مصادقة (KI-017) |
| FS-011 | إدارة الأكاديمية | MOD-02 | PLANNED | — | |
| FS-012 | النشر المستقل لكل أكاديمية | MOD-02 / Ops | PLANNED | — | ADR-008 |
| FS-013 | قاعدة بيانات مخصّصة لكل أكاديمية | MOD-02 / DB | PLANNED | — | ADR-014 (Prisma + PostgreSQL)، ADR-008 |
| FS-014 | إدارة المستخدمين (معلم/طالب/ولي أمر/موظف) | MOD-03 | PLANNED | — | شاشة تجريبية ببيانات محلية: `frontend/src/pages/UsersPage.tsx` (CH-0005) |
| FS-015 | الأدوار والصلاحيات المخصّصة | MOD-03 | PLANNED | — | بوابة واجهة فقط حسب الدور (`frontend/src/layout/navigation.ts`, `auth/RequireAuth.tsx`)؛ لا فرض في الخادم؛ لا أدوار مخصّصة |
| FS-016 | الدورات والمستويات | MOD-04 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/CoursesPage.tsx` (CH-0005) |
| FS-017 | الفصول والمجموعات | MOD-05 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/ClassesPage.tsx` (CH-0005) |
| FS-018 | الدروس المباشرة | MOD-06 | PLANNED | — | مزود البث غير محدد؛ شاشة تجريبية مشتركة: `frontend/src/pages/LessonsPage.tsx` (CH-0005) |
| FS-019 | الدروس المسجّلة | MOD-06 | PLANNED | — | التخزين غير محدد؛ شاشة تجريبية مشتركة: `frontend/src/pages/LessonsPage.tsx` (CH-0005) |
| FS-020 | الجداول الزمنية والجدولة | MOD-07 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/SchedulePage.tsx` (CH-0005) |
| FS-021 | الواجبات | MOD-08 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/AssignmentsPage.tsx` (CH-0005) |
| FS-022 | الاختبارات والدرجات | MOD-09 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/ExamsPage.tsx` (CH-0005) |
| FS-023 | الشهادات والسجلات الأكاديمية | MOD-10 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/CertificatesPage.tsx` (CH-0005) |
| FS-024 | المدفوعات والأقساط والمتابعة المالية | MOD-11 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/PaymentsPage.tsx` (CH-0005) |
| FS-025 | الإشعارات | MOD-12 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/NotificationsPage.tsx` (CH-0005) |
| FS-026 | التقارير | MOD-13 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/ReportsPage.tsx` (CH-0005) |
| FS-027 | الإعدادات | MOD-14 | PLANNED | — | شاشة تجريبية: `frontend/src/pages/SettingsPage.tsx` (CH-0005) |
| FS-028 | تعدد اللغات + RTL | MOD-FE-01 / MOD-14 | PARTIALLY_IMPLEMENTED | `frontend/src/i18n/*`, `frontend/src/app/App.tsx` | الواجهة: ar (افتراضي، RTL) + en مع تبديل فوري وحفظ الاختيار (CH-0005، ADR-010). الخادم: لا شيء. لغة الأكاديمية الافتراضية من الإعدادات: PLANNED |
| FS-029 | التكاملات الخارجية | MOD-15 | PLANNED | — | |
| FS-030 | واجهات للتطبيقات المحمولة | MOD-15 | PLANNED | — | |
| FS-031 | تكامل الواجهة مع الخادم (CORS/proxy/HTTP client) | MOD-00 / MOD-FE-01 | IMPLEMENTED | `backend/src/app.setup.ts`, `frontend/vite.config.ts`, `frontend/src/api/*`, `frontend/src/components/ServerStatusCard.tsx` | CH-0006 (KI-007 RESOLVED). مستخدم في `GET /api/health` فقط؛ شاشات الوحدات ما زالت على `mock/data.ts` |
| FS-032 | قاعدة بيانات + ORM + ترحيلات | MOD-16 | PARTIALLY_IMPLEMENTED | `compose.yaml`, `backend/prisma/schema.prisma`, `backend/prisma.config.ts`, `backend/src/prisma/*` | CH-0007: PostgreSQL 18 محلية + Prisma 7 موصول وجاهزية تفحصه؛ CH-0008: الأدوار المحدودة ومصدر الإعدادات الواحد؛ **لا نماذج ولا ترحيلات بعد** — التصميم الأول مقترح في 6.6 (ADR-014، ADR-016، ADR-018، ADR-020) |
| FS-033 | إعداد النشر (Docker/CI) | Ops | PARTIALLY_IMPLEMENTED | `compose.yaml` | Docker Compose للتطوير المحلي فقط (CH-0007)؛ لا Dockerfile للتطبيقين ولا CI (14.11) |
| FS-034 | هيكل واجهة المنتج: تنقل، تخطيط، دخول تجريبي، معاينة الأدوار، 13 شاشة وحدة ببيانات محلية، 404/403 | MOD-FE-01 | IMPLEMENTED (نموذج أولي) | `frontend/src/app/*`, `layout/*`, `auth/*`, `components/*`, `i18n/*`, `mock/data.ts`, `pages/*` | CH-0005؛ ADR-009..ADR-012. بيانات محلية فقط؛ تُستبدل بطبقة API (FS-031) |
| FS-035 | التحكم بالإصدارات: مستودع Git + تجاهل الملفات + تطبيع LF | Tooling | IMPLEMENTED | `.git/`, `.gitignore`, `.gitattributes` | CH-0004؛ commit الأساس `127cb1d` على `main`؛ لا remote (ADR-013) |
| FS-036 | تهيئة الخادم: تحقق البيئة (zod)، `ValidationPipe` عام، CORS، بادئة `/api`، Swagger، `GET /api/health`، إخفاء `X-Powered-By` | MOD-00 | IMPLEMENTED | `backend/src/app.setup.ts`, `backend/src/config/env.schema.ts`, `backend/src/health/*`, `backend/.env.example` | CH-0006؛ ADR-015. API-002, API-003 |
| FS-037 | فحص الجاهزية `GET /api/health/ready` (قاعدة البيانات) مع عرض حالتها في بطاقة الواجهة | MOD-00 / MOD-16 / MOD-FE-01 | IMPLEMENTED | `backend/src/health/*`, `backend/src/prisma/prisma.service.ts`, `frontend/src/api/health.ts`, `frontend/src/components/ServerStatusCard.tsx` | CH-0007؛ API-004؛ ADR-017 |
| FS-038 | بيئة PostgreSQL محلية قابلة لإعادة الإنتاج: Docker Compose، مجلد دائم، فحص صحي، loopback فقط، أسرار خارج Git | MOD-16 / Ops | IMPLEMENTED | `compose.yaml`, `.env.example` | CH-0007؛ ADR-016 |
| FS-039 | أدوار قاعدة بيانات محدودة الصلاحيات (`articode_app` للتطبيق، `articode_migrator` للترحيلات، superuser للإدارة فقط) + مصدر واحد لإعدادات القاعدة (`.env` الجذري) مع اشتقاق عناوين الاتصال | MOD-16 / Ops / Security | IMPLEMENTED | `docker/postgres/initdb/10-roles.sh`, `compose.yaml`, `.env.example`, `backend/src/config/database-url.ts`, `backend/src/config/env-files.ts`, `backend/src/config/env.schema.ts`, `backend/prisma.config.ts` | CH-0008؛ ADR-019؛ KI-023 وKI-024 RESOLVED |

---

## 16. KNOWN ISSUES AND TECHNICAL DEBT — المشكلات المعروفة والدين التقني

| المعرّف | الوصف | الوحدة | الشدة | الدليل | الحل المقترح | الحالة |
|---|---|---|---|---|---|---|
| KI-001 | اعتماديات الخادم غير مثبّتة ولا يوجد ملف قفل؛ لا يمكن إعادة إنتاج التثبيت ولا التحقق من الاختبارات | Backend | متوسطة | لا `backend/node_modules`، لا `backend/package-lock.json` (تم التحقق 2026-10-28) | تثبيت الاعتماديات وإنشاء ملف القفل | RESOLVED (CH-0003) |
| KI-002 | المستودع ليس تحت Git؛ لا تاريخ، لا تراجع، لا مراجعة | Repo | عالية (عملياتياً) | لا مجلد `.git` في الجذر أو الفرعيات | `git init` في الجذر + `.gitignore` جذري + أول commit | RESOLVED (CH-0004: `git init -b main`، commit `127cb1d`) |
| KI-003 | لا يوجد `backend/.gitignore`؛ عند تفعيل Git سيُضاف `node_modules`/`dist` للمستودع | Backend | متوسطة | `ls -la backend` لا يُظهر `.gitignore` | إضافة `.gitignore` (node_modules, dist, coverage, .env*) أو `.gitignore` جذري | RESOLVED (CH-0004: `.gitignore` جذري؛ تم التحقق أن `git ls-files` لا يرصد `node_modules`/`dist`/`*.tsbuildinfo`) |
| KI-004 | تباين الإصدارات والأدوات بين التطبيقين: TypeScript `^6.0.2` مقابل `~7.0.2`؛ oxlint `^1.58.0` مقابل `^1.89.0`؛ Prettier في الخادم فقط | Tooling | منخفضة | `backend/package.json`, `frontend/package.json` | توحيد الإصدارات واعتماد Prettier في الواجهة؛ النظر في workspaces | OPEN |
| KI-005 | الواجهة ما زالت قالب Vite الافتراضي (العنوان `frontend`، `lang="en"`، روابط مجتمع Vite) | Frontend | منخفضة | `frontend/src/App.tsx`, `frontend/index.html` | استبدال القالب بواجهة المنتج عند بدء التطوير | RESOLVED (CH-0005: أُزيل القالب؛ العنوان "ArtiCode Academy"، `lang="ar" dir="rtl"`). بقي favicon القالب (KI-019) |
| KI-006 | ملفا README افتراضيان من الأطر لا يصفان المشروع | Docs | منخفضة | `backend/README.md`, `frontend/README.md` | استبدالهما بإشارة مختصرة إلى هذه الوثيقة | OPEN |
| KI-007 | لا CORS في الخادم ولا proxy في Vite؛ الواجهة لا تستطيع الاتصال بالخادم | Integration | متوسطة (عند بدء التكامل) | `backend/src/main.ts`, `frontend/vite.config.ts` | `enableCors` بإعدادات من البيئة و/أو `server.proxy` في Vite | RESOLVED (CH-0006: كلاهما — `CORS_ORIGIN` في `app.setup.ts` وproxy `/api` في Vite) |
| KI-008 | لا حقل `engines` في `package.json`؛ `@types/node@24` بينما التشغيل Node 22 | Tooling | منخفضة | `backend/package.json`, `frontend/package.json`, `node --version` | إضافة `engines.node` و`.nvmrc`؛ مواءمة `@types/node` مع إصدار التشغيل | OPEN |
| KI-009 | `frontend/tsconfig.app.json` لا يُعلن `strict` صراحةً (يعتمد على افتراضي TS 7) | Frontend | منخفضة | الملف نفسه؛ التحقق التجريبي 2026-10-28 | إضافة `"strict": true` صراحةً للوضوح والحماية من تغيّر الافتراضيات | OPEN |
| KI-010 | خطّاف التوثيق يتحقق من لمس الوثيقة لا من صحة محتواها؛ ويحسب تغييرات التنسيق والتعديلات اليدوية | Tooling | منخفضة | `.claude/hooks/doc-sync-check.mjs` | الاعتماد على قائمة تحقق `CLAUDE.md`؛ مراجعة بشرية دورية | ACCEPTED (قيد تصميمي) |
| KI-011 | `npm audit` في الخادم يُظهر 5 ثغرات (2 عالية) كلها عبر `@nestjs/mau` غير المستخدمة، من خلال `tmp` و`undici` و`inquirer` | Backend / Security | متوسطة (أداة تطوير فقط، لا تُشحن للإنتاج) | `npm audit` في CH-0003 | إزالة `@nestjs/mau` وسكربت `deploy` إن لم تُعتمد منصة Mau. `npm audit fix --force` يخفّض الحزمة إلى 0.0.6 وهو تغيير كاسر | RESOLVED (CH-0006: أُزيلت الحزمة والسكربت؛ `npm audit` = 0 ثغرات) |
| KI-012 | Node 22.20.0 أقدم من متطلبات `@angular-devkit/*` (اعتمادية `@nestjs/cli`) التي تطلب 22.22.3 أو أحدث، فتظهر تحذيرات `EBADENGINE` | Tooling | منخفضة | مخرجات `npm install` في CH-0003. البناء والاختبارات تعمل رغم التحذير | ترقية Node إلى 22.22.3 أو أحدث، أو 24 LTS، ثم تثبيت الإصدار في `engines` و`.nvmrc` (مرتبط بـ KI-008) | OPEN |
| KI-013 | Vitest يُظهر تحذيراً بأن `vite-tsconfig-paths` لم يعد ضرورياً لأن Vite يدعم `resolve.tsconfigPaths` أصلياً | Backend / Tests | منخفضة | مخرجات `npm run test` في CH-0003 (وما زال يظهر في CH-0006) | إزالة الإضافة من `vitest.config*.ts` واستخدام `resolve.tsconfigPaths: true` | OPEN |
| KI-014 | الخادم يرسل رأس `X-Powered-By: Express` الذي يكشف التقنية المستخدمة | Backend / Security | منخفضة | استجابة curl في CH-0003 | `app.disable('x-powered-by')` أو `helmet` | RESOLVED (CH-0006: `app.disable('x-powered-by')` في `app.setup.ts`؛ TEST-005 يتحقق) |
| KI-015 | `npm install` بإصدار npm 10.9.3 يتعطل في الخادم بالخطأ `Cannot read properties of null (reading 'edgesOut')` داخل `#loadPeerSet`، بسبب كثرة الاعتماديات النظيرة الاختيارية في NestJS 12 | Tooling | متوسطة | سجل npm بتاريخ 2026-10-28 12:04 UTC. السبب الدقيق داخل npm غير مؤكد | استخدام npm 11 (`npx -y npm@11 install`) أو `--legacy-peer-deps`. بعد وجود ملف القفل يعمل `npm ci` مع npm 10 | WORKAROUND (لا يصيب `frontend/` — تم التحقق في CH-0005) |
| KI-016 | حزمة الواجهة الإنتاجية ملف واحد بحجم 1,318 kB قبل الضغط (419 kB gzip، بعد CH-0006) بسبب antd والأيقونات؛ Vite يحذّر (> 500 kB) | Frontend / Performance | منخفضة الآن (نموذج أولي) | مخرجات `vite build` في CH-0005 | تقسيم الكود بالمسارات (`React.lazy` + `Suspense`) و`build.rolldownOptions.output.codeSplitting`؛ مراجعة استيراد الأيقونات | OPEN |
| KI-017 | المصادقة في الواجهة تجريبية: أي بيانات تُقبل، والجلسة والدور في `localStorage` (`aca.mockUser`) قابلان للتعديل من أدوات المطور؛ `RoleSwitcher` يبدّل الدور بلا تحقق | Frontend / Security | لا أثر الآن (لا بيانات ولا خادم)؛ **حرجة إن وصلت للإنتاج** | `frontend/src/auth/AuthProvider.tsx`, `components/RoleSwitcher.tsx` | استبدالها بعميل MOD-01 (JWT) وفرض الصلاحيات في الخادم؛ إزالة `RoleSwitcher` أو حصره بوضع التطوير؛ يجب ألا تُنشر هذه النسخة | ACCEPTED-TEMPORARY (أداة نمذجة — ADR-012) |
| KI-018 | هوية Git على جهاز التطوير (`git config --global user.email`) عنوان محلي باسم الجهاز وليس بريداً حقيقياً؛ commit الأساس `127cb1d` يحمل هذه الهوية | Repo | منخفضة | `git log -1 --format='%an <%ae>'` | ضبط `user.name`/`user.email` (محلياً للمستودع أو عالمياً) قبل الالتزامات القادمة؛ **لا يُعاد كتابة التاريخ** | RESOLVED (تم التحقق في CH-0008: `user.email` مضبوط محلياً للمستودع، وcommit `88a21cb` (CH-0005) يحمل الهوية الصحيحة؛ commit الأساس بقي كما هو عمداً) |
| KI-019 | `frontend/public/favicon.svg` ما زال أيقونة قالب Vite؛ لا شعار ولا هوية بصرية للمنتج | Frontend | منخفضة | الملف نفسه | استبداله بهوية المنتج عند توفرها (مرتبط بـ KI-005) | OPEN |
| KI-020 | `@nestjs/swagger` يجلب `swagger-ui-dist` ومعه حزمة القياس `@scarf/scarf` (سكربت `postinstall` يرسل بيانات تثبيت)؛ npm 11 منع تشغيل السكربت لعدم إدراجه في `allowScripts` | Backend / Privacy | منخفضة | تحذير `npm warn install-scripts` في CH-0006 | ضبط `SCARF_ANALYTICS=false` في بيئات التثبيت أو `.npmrc`؛ لا حاجة لاعتماد السكربت | OPEN |
| KI-021 | الواجهة تكرّر البادئة `/api` في مساراتها (`frontend/src/api/health.ts`, `vite.config.ts`) بينما الخادم يقرأها من `API_PREFIX`؛ تغيير أحدهما دون الآخر يقطع الاتصال | Integration | منخفضة | الملفات المذكورة | قراءة البادئة من `VITE_API_BASE_URL` كاملاً أو ثابت واحد مشترك عند توليد عميل من OpenAPI | OPEN (مقبول في النموذج الأولي) |
| KI-022 | `ValidationPipe` العام مفعّل لكن لا يوجد DTO طلب يحمل قواعد `class-validator`، فسلوك الرفض/التحويل غير مُختبَر؛ DTO بلا ديكوريتورات مع `whitelist` يُفرَّغ بصمت | Backend / Tests | متوسطة عند أول نقطة نهاية تستقبل بيانات | `backend/src/app.setup.ts`؛ لا DTO طلب في الكود | مع أول DTO طلب: ديكوريتورات كاملة + اختبار e2e لحقل زائد (`400`) وتحويل نوع | OPEN |
| KI-023 | بيانات اعتماد قاعدة البيانات مكرّرة في ملفين: `.env` الجذري (لـ compose) و`backend/.env` (`DATABASE_URL`)؛ تغيير أحدهما دون الآخر يكسر الاتصال | Config | منخفضة | 11.3 | توليد `DATABASE_URL` من `POSTGRES_*` في `env.schema.ts` عند غيابه، أو ملف env واحد يُمرَّر لـ compose بـ `--env-file` | RESOLVED (CH-0008، ADR-019): `.env` الجذري هو المصدر الوحيد؛ الخادم يقرأه عبر `env-files.ts` ويشتق `DATABASE_URL`، وPrisma CLI يشتق عنوان الترحيلات؛ `backend/.env` بلا بيانات اعتماد |
| KI-024 | التطبيق والترحيلات تتصل بـ PostgreSQL بحساب superuser (`POSTGRES_USER`) | Backend / Security | منخفضة الآن، عالية قبل الإنتاج | `compose.yaml`, `backend/.env.example` | دور `app` بصلاحيات DML فقط ودور ترحيلات منفصل؛ سكربت تهيئة في `docker-entrypoint-initdb.d` (SEC-R-06) | RESOLVED (CH-0008، ADR-019): `docker/postgres/initdb/10-roles.sh` ينشئ `articode_migrator` (مالك القاعدة) و`articode_app` (DML)؛ التطبيق لا يستطيع DDL (متحقق)؛ يبقى KI-027 |
| KI-025 | واجهة أوامر Docker مثبّتة لكل مستخدم (`%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin`) وتظهر في PATH للجلسات الجديدة فقط؛ الجلسات الأقدم من التثبيت ترى `command not found` وتفشل `docker compose` بـ `docker-credential-desktop` مفقودة | Dev env | منخفضة | CH-0007 | فتح طرفية جديدة بعد التثبيت أو إضافة المجلد إلى PATH الجلسة | WORKAROUND |
| KI-026 | وسم `latest` لحزمة `prisma` على npm كان إصداراً مرشّحاً (`8.0.0-rc.28`) بينما `@prisma/client` مستقر على 7.10.1؛ `npm install prisma` بلا إصدار قد يجلب RC غير متوافق. كما منع npm 11 سكربتات تثبيت `prisma`/`@prisma/engines` (`allowScripts`) ومع ذلك عمل `generate` و`migrate status` | Tooling | منخفضة | `npm view prisma dist-tags` وتحذيرات `install-scripts` في CH-0007 | الإبقاء على `^7` حتى استقرار 8 ومراجعة دليل الترقية؛ مراقبة الحاجة لاعتماد السكربتات عند أول `migrate dev` | OPEN |
| KI-027 | دور الترحيلات `articode_migrator` يحمل سمة `CREATEDB` محلياً لأن `prisma migrate dev` ينشئ قاعدة ظلية مؤقتة؛ في الإنتاج لا يحتاجها (`migrate deploy` فقط) | DB / Security | منخفضة (تطوير فقط) | `docker/postgres/initdb/10-roles.sh` | إنشاء دور الإنتاج بلا `CREATEDB` (إجراء منفصل في 14.11)، أو `shadowDatabaseUrl` إلى قاعدة ظلية مُعدّة مسبقاً | ACCEPTED (قيد تطوير مقصود — CH-0008) |
| KI-028 | في التطوير يقرأ الخادم `.env` الجذري كاملاً (ليشتق `DATABASE_URL`)، فتصل `POSTGRES_PASSWORD` (superuser) و`DB_MIGRATOR_PASSWORD` إلى `process.env` لعملية الخادم رغم أن `validateEnv` تُسقطهما من `ConfigService` | Config / Security | منخفضة (جهاز المطور نفسه؛ الملف مقروء له أصلاً) | `backend/src/config/env-files.ts`؛ `@nestjs/config` (`assignVariablesToProcess`) | في الإنتاج تُحقن `DATABASE_URL` مباشرة بلا ملفات؛ محلياً يمكن نقل كلمتَي superuser/migrator إلى ملف يقرؤه compose فقط إن لزم | ACCEPTED (CH-0008) |

---

## 17. ARCHITECTURAL DECISION LOG — سجل القرارات المعمارية

> القاعدة: لا تُختلق أسباب تاريخية. حيث لا يوجد سبب مسجَّل يُكتب "غير مسجَّل".

### ADR-001 — اعتماد NestJS على Node.js/TypeScript للخادم

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-27 (تاريخ توليد الهيكل، مستنتج من طوابع الملفات؛ لا يوجد Git) |
| السياق | الحاجة إلى إطار خادم منظّم بوحدات لمنصة كبيرة طويلة الأمد |
| الخيارات المدروسة | غير مسجَّلة |
| الخيار المعتمد | NestJS 12 (ESM) مع Express |
| السبب | ذُكر NestJS في النقاشات المعمارية السابقة وفق موجز المالك؛ **التفصيل غير مسجَّل في المستودع** |
| النتائج | معمارية وحدات، حقن اعتماديات، نظام ديكوريتورات؛ اصطلاح ESM مع لاحقة `.js` |
| الحالة | ACCEPTED (دليل: `backend/`) |
| المكونات المتأثرة | `backend/*` |

### ADR-002 — اعتماد React 19 + Vite 8 + TypeScript 7 للواجهة

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-27 (مستنتج من طوابع الملفات) |
| السياق | الحاجة إلى واجهة ويب حديثة |
| الخيارات المدروسة | غير مسجَّلة |
| الخيار المعتمد | React + Vite (قالب `react-ts` الرسمي مع oxlint) |
| السبب | غير مسجَّل |
| النتائج | بناء سريع، HMR؛ لا يوجد بعدُ توجيه أو إدارة حالة أو i18n (تُقرَّر لاحقاً) |
| الحالة | ACCEPTED (دليل: `frontend/`) |
| المكونات المتأثرة | `frontend/*` |

### ADR-003 — PostgreSQL كمحرك قاعدة بيانات، واختيار ORM

| البند | التفاصيل |
|---|---|
| التاريخ | PROPOSED — بلا تاريخ قرار |
| السياق | المنصة تحتاج تخزيناً علائقياً قوياً مع عزل لكل أكاديمية |
| الخيارات المدروسة | PostgreSQL ذُكر في النقاشات السابقة (موجز المالك). ORM: لم تُدرس خيارات بعد |
| الخيار المعتمد | **PostgreSQL + Prisma** — اعتمده المالك بتاريخ 2026-10-29؛ التفاصيل والنتائج في ADR-014 |
| الحالة | ACCEPTED (2026-10-29) — البنية منفّذة في CH-0007 (ADR-016، ADR-018)؛ النماذج والترحيلات PLANNED |
| المكونات المتأثرة | `backend/` (مستقبلاً) |

### ADR-004 — فصل الخادم والواجهة في مجلدين مستقلين بلا أداة monorepo

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-27 (مستنتج) |
| الخيار المعتمد | `backend/` و`frontend/` بحزم npm مستقلة؛ لا `package.json` جذري ولا workspaces |
| السبب | غير مسجَّل (قد يكون نتيجة توليد كل هيكل على حدة) |
| النتائج | تباين الأدوات والإصدارات (KI-004)؛ أوامر منفصلة لكل تطبيق |
| الحالة | ACCEPTED de facto؛ يُنصح بإعادة التقييم (workspaces) قبل توسّع المشروع |
| المكونات المتأثرة | الجذر |

### ADR-005 — Vitest كإطار اختبار للخادم

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-27 (مستنتج) |
| الخيار المعتمد | Vitest 4 (وحدة + شامل بملفي إعداد) |
| السبب | هو الافتراضي في `@nestjs/cli` 12؛ **لا دليل على قرار متعمّد** |
| الحالة | ACCEPTED de facto |
| المكونات المتأثرة | `backend/vitest.config*.ts`, `backend/tsconfig.json` (`types: vitest/globals`) |

### ADR-006 — oxlint كأداة فحص ثابت في التطبيقين

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-27 (مستنتج) |
| الخيار المعتمد | oxlint (إعداد منفصل لكل تطبيق) |
| السبب | افتراضي القوالب؛ غير مسجَّل |
| النتائج | فحص سريع؛ لا قواعد type-aware مفعّلة |
| الحالة | ACCEPTED de facto |

### ADR-007 — نظام التوثيق المستمر (وثيقة رئيسية + CLAUDE.md + خطّاف تحقق)

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-28 |
| السياق | المشروع طويل الأمد ويُطوَّر بمساعدة Claude Code؛ الحاجة إلى مرجع واحد يبقى متزامناً مع الكود |
| الخيارات المدروسة | (أ) README فقط؛ (ب) وثيقة رئيسية + قواعد في `CLAUDE.md` بلا تحقق آلي؛ (ج) الخيار (ب) + خطّاف `Stop` يتحقق من مزامنة التوثيق |
| الخيار المعتمد | (ج) |
| السبب | طلب المالك الصريح؛ الخطّاف يقلّل الانجراف بتكلفة ضئيلة (~90ms) وبدون اعتماد على Git |
| النتائج | كل تغيير كود يستلزم تحديث الوثيقة في نفس المهمة؛ منع إنهاء مرة واحدة إن لم يحدث؛ القيود في KI-010 |
| الحالة | ACCEPTED |
| المكونات المتأثرة | `docs/`, `CLAUDE.md`, `.claude/` |

### ADR-008 — نموذج عزل بيانات الأكاديميات (قاعدة بيانات لكل أكاديمية)

| البند | التفاصيل |
|---|---|
| التاريخ | PROPOSED — بلا تاريخ قرار |
| السياق | المالك يشترط نشراً مستقلاً وقاعدة بيانات مخصّصة لكل أكاديمية (REQ-01, REQ-02) |
| الخيارات (تحليل هندسي، غير مسجَّل تاريخياً) | (أ) قاعدة لكل أكاديمية (المطلوب)؛ (ب) مخطط (schema) لكل أكاديمية في قاعدة واحدة؛ (ج) صفوف مشتركة بـ `academy_id` |
| الخيار المعتمد | **(أ) كمتطلب؛ تفاصيل التنفيذ (إدارة الاتصالات، الترحيلات الجماعية، سجل مركزي للأكاديميات) لم تُحسم** |
| النتائج المتوقعة | عزل قوي وسهولة نسخ احتياطي لكل أكاديمية؛ كلفة تشغيل أعلى وترحيلات متعددة |
| الحالة | PROPOSED — السجل المركزي وطوبولوجيا النشر وتنسيق الترحيلات مقترحة تفصيلياً في ADR-021 و6.6.2/6.6.3 (2026-10-29) |
| المكونات المتأثرة | MOD-02, DB, Ops |

### ADR-009 — Ant Design 6 كمكتبة مكوّنات للواجهة

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | الحاجة إلى شاشات إدارية (جداول، نماذج، قوائم، إحصاءات) بسرعة مع دعم RTL أصلي، كي يستطيع المالك معاينة المنتج مبكراً |
| الخيارات المدروسة | (أ) Ant Design؛ (ب) MUI (Material UI)؛ (ج) Tailwind CSS فقط؛ (د) بلا مكتبة (CSS يدوي). عُرضت الأربعة على المالك مع توصية بـ (أ) |
| الخيار المعتمد | (أ) `antd` 6.6.8 + `@ant-design/icons` 6.3.4 — **اختيار المالك بتاريخ 2026-10-29** |
| السبب | مكوّنات إدارية جاهزة؛ RTL عبر `ConfigProvider direction="rtl"` بلا إضافات؛ ترجمات المكوّنات (`antd/locale/ar_EG`)؛ دعم React 19 أصلي في الإصدار 6 |
| النتائج | حجم حزمة أكبر (KI-016)؛ الثيم عبر tokens في `ConfigProvider` (`frontend/src/app/App.tsx`)؛ الشاشات تعتمد على `Table`/`Form`/`Card`/`Statistic`/`List`/`Result` |
| الحالة | ACCEPTED (دليل: `frontend/package.json`, `frontend/src/app/App.tsx`) |
| المكونات المتأثرة | `frontend/src/**` |

### ADR-010 — i18n في الواجهة: i18next، العربية افتراضياً مع RTL، الإنجليزية ثانوية

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | REQ-13 وNFR-07، والأولوية 4 في 18.4 ("i18n/RTL قبل أي شاشة منتج") |
| الخيارات المدروسة | (أ) `i18next` + `react-i18next`؛ (ب) `react-intl` (FormatJS)؛ (ج) Context يدوي بقواميس محلية. اللغة الافتراضية: عربية / إنجليزية / عربية فقط — عُرضت على المالك |
| الخيار المعتمد | (أ)، مع **العربية افتراضياً + الإنجليزية ثانوية** (اختيار المالك 2026-10-29). القواميس ملفات TypeScript: `ar.ts` مرجعي يصدّر النوع `Translation`، و`en.ts` مُلزَم به. النصوص داخل البيانات بنوع `LocalizedText { ar, en }` |
| السبب | الأكثر انتشاراً ونضجاً؛ تبديل فوري بلا إعادة تحميل؛ interpolation؛ النوع المشترك يكشف المفاتيح الناقصة عند `tsc` |
| النتائج | كل نص ظاهر عبر `t()`؛ `document.documentElement.lang/dir` و`ConfigProvider direction/locale` يتبعان اللغة؛ إضافة لغة = قاموس + `SUPPORTED_LANGUAGES` + ترجمة antd؛ الاختيار في `localStorage` (`aca.language`)؛ الخادم ما زال بلا i18n |
| الحالة | ACCEPTED (دليل: `frontend/src/i18n/*`) |
| المكونات المتأثرة | `frontend/src/i18n/*`, `frontend/src/app/App.tsx`, كل الصفحات |

### ADR-011 — react-router 7 للتوجيه مع تثبيت الإصدار الرئيسي

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | لا توجيه في الواجهة؛ أحدث إصدار على npm وقت التنفيذ هو `react-router` 8.5.1 |
| الخيارات المدروسة | (أ) `react-router` 8 (الأحدث)؛ (ب) `react-router` 7؛ (ج) TanStack Router |
| الخيار المعتمد | (ب) `react-router@7` (7.18.5) بـ `createBrowserRouter` + `RouterProvider` |
| السبب | واجهة برمجية مستقرة ومعروفة؛ التغييرات الكاسرة في الإصدار 8 **لم تُراجَع** في هذه المهمة، فأُرجئت الترقية إلى تقييم لاحق بدل المخاطرة في نموذج أولي |
| النتائج | `"react-router": "^7.18.5"` يمنع الانتقال التلقائي إلى 8؛ الحارسان `RequireAuth`/`RequireRole` مكوّنات تغليف (لا loaders)؛ المسارات في `router.tsx` تُطابق `NAV_ITEMS` يدوياً |
| الحالة | ACCEPTED؛ إعادة تقييم (الترقية إلى 8) `NOT YET DETERMINED` |
| المكونات المتأثرة | `frontend/src/app/router.tsx`, `frontend/src/auth/RequireAuth.tsx`, `frontend/src/layout/AppLayout.tsx` |

### ADR-012 — نهج "الواجهة أولاً ببيانات تجريبية" (mock-first) لنمذجة المنتج

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | المالك يريد الدخول إلى الواجهات ومعاينتها، بينما لا توجد قاعدة بيانات ولا مصادقة ولا أي نقطة نهاية منتج |
| الخيارات المدروسة | (أ) الخادم أولاً ثم الواجهة؛ (ب) الواجهة ببيانات محلية ثم الربط وحدةً وحدة؛ (ج) خادم وهمي (MSW / json-server) |
| الخيار المعتمد | (ب): `frontend/src/mock/data.ts` كطبقة بيانات محلية، و`auth/AuthProvider.tsx` كمصادقة تجريبية، و`RoleSwitcher` لمعاينة الأدوار |
| السبب | أسرع طريق لرؤية المنتج والحصول على ملاحظات المالك على الشاشات والأدوار قبل تثبيت نموذج البيانات؛ لا يضيف اعتماديات خادم وهمي |
| النتائج | خطر انحراف البيانات التجريبية عن النموذج الحقيقي؛ وجوب وسم كل شاشة "بيانات تجريبية" (منفّذ: شارة في الترويسة وتنبيه في اللوحة والدخول)؛ KI-017 وSEC-R-04؛ كل وحدة تُربط بالخادم تحذف بياناتها من `mock/data.ts` |
| الحالة | ACCEPTED (مؤقت بطبيعته؛ ينتهي باكتمال FS-031 وMOD-01) |
| المكونات المتأثرة | `frontend/src/mock/`, `frontend/src/auth/`, `frontend/src/pages/*` |

### ADR-013 — اعتماد Git بفرع `main` وتطبيع نهايات الأسطر إلى LF

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | KI-002 وKI-003؛ أول `git add` على Windows أظهر تحذيرات تحويل LF إلى CRLF لكل الملفات النصية |
| الخيارات المدروسة | (أ) Git بلا `.gitattributes` (نهايات أسطر حسب إعداد كل جهاز)؛ (ب) `.gitattributes` بـ `* text=auto eol=lf`؛ (ج) تأجيل Git |
| الخيار المعتمد | (ب): `git init -b main`؛ `.gitignore` جذري؛ `.gitattributes` بتطبيع LF ووسم الثنائيات؛ commit أساس يلتقط حالة Stage 0 قبل أي تعديل |
| السبب | طلب المالك؛ تاريخ قابل للاستشهاد قبل أول تغيير كبير (CH-0005)؛ LF موحّد يمنع فروقات زائفة بين الأنظمة ويطابق الملفات المكتوبة أصلاً بـ LF |
| النتائج | الملفات تبقى LF في المستودع وعند الاستخراج؛ سياسة الفروع والالتزامات والـ remote `NOT YET DETERMINED`؛ هوية المؤلف تحتاج ضبطاً (KI-018) |
| الحالة | ACCEPTED (دليل: `.git/`, `.gitignore`, `.gitattributes`) |
| المكونات المتأثرة | الجذر |

### ADR-014 — Prisma كـ ORM، وPostgreSQL داخل Docker Desktop للتطوير

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 (قرار المالك؛ التنفيذ لم يبدأ) |
| السياق | ADR-003 كان PROPOSED؛ لا Docker ولا PostgreSQL على جهاز التطوير (تم التحقق 2026-10-29)؛ المرحلة 3 تحتاج قاعدة بيانات ومصادقة |
| الخيارات المدروسة | ORM: Prisma، TypeORM، Drizzle. تشغيل PostgreSQL للتطوير: Docker Desktop، تثبيت مباشر على Windows، قاعدة سحابية (Neon / Supabase). عُرضت كلها على المالك مع توصية بـ Prisma وDocker Desktop |
| الخيار المعتمد | **Prisma + PostgreSQL**؛ PostgreSQL للتطوير داخل **Docker Desktop** (يثبّته المالك) مع ملف compose يُضاف عند التنفيذ |
| السبب | توصية هندسية اختارها المالك: أنواع آمنة مولَّدة، ترحيلات مدمجة، مخطط واحد واضح (`schema.prisma`)، دعم قوي لـ PostgreSQL؛ Docker أقرب إلى نموذج النشر لكل أكاديمية (ADR-008) |
| النتائج | إضافة `prisma` و`@prisma/client` في المرحلة 3؛ `DATABASE_URL` يُضاف إلى `config/env.schema.ts` بلا قيمة افتراضية للإنتاج؛ `schema.prisma` يصبح مصدر الحقيقة لنموذج البيانات ويُوثَّق في القسم 06؛ فحص جاهزية يشمل القاعدة؛ نموذج "قاعدة لكل أكاديمية" يُحسم في ADR-008 |
| الحالة | ACCEPTED — بدأ التنفيذ في CH-0007 (Prisma مثبّت وموصول، PostgreSQL 18 في Docker Desktop)؛ النماذج والترحيلات PLANNED |
| المكونات المتأثرة | `backend/` (`prisma/`, `src/config`, وحدات البيانات)، Ops (compose) |

### ADR-015 — اصطلاحات واجهة البرمجة: بادئة `/api`، JSON، تحقق عام، بيئة مُتحقَّق منها، Swagger، إعداد مشترك

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | قبل أول نقطة نهاية حقيقية كان لا بد من تثبيت الحدود المشتركة التي ستقف عليها كل الوحدات القادمة |
| الخيارات المدروسة | (أ) إعداد مباشر في `main.ts` كما في الهيكل؛ (ب) دالة `configureApp()` مشتركة بين الإقلاع والاختبارات الشاملة. التحقق من البيئة: Joi / zod / بلا تحقق. التوثيق: Swagger بالديكوريتورات / بلا توثيق |
| الخيار المعتمد | (ب) `backend/src/app.setup.ts`؛ zod لمخطط البيئة (`config/env.schema.ts`)؛ بادئة من `API_PREFIX` (افتراضياً `api`)؛ `ValidationPipe` عام بـ `whitelist` + `forbidNonWhitelisted` + `transform`؛ CORS من `CORS_ORIGIN` مع `credentials`؛ Swagger تحت البادئة مع مفتاح `SWAGGER_ENABLED`؛ تعطيل `X-Powered-By`؛ `enableShutdownHooks` |
| السبب | الاختبارات الشاملة تختبر الإعداد الفعلي لا نسخة منه؛ zod مكتبة واحدة للتحقق في الخادم مع أنواع مستنتجة (`Env`)؛ البادئة تفصل API عن أي أصول ثابتة مستقبلية؛ الرفض الصريح للحقول الزائدة يمنع التسريب الصامت |
| النتائج | المسار `/` لم يعد لـ API (404 HTML من Express)؛ أي متغير بيئة جديد يُعلن في المخطط؛ كل DTO يحمل `@ApiProperty`؛ الواجهة تكرّر البادئة `/api` (KI-021)؛ أي نقطة نهاية جديدة تُوثَّق في القسم 10 بصيغة API-002؛ DTO بلا ديكوريتورات يُفرَّغ بصمت (KI-022) |
| الحالة | ACCEPTED (دليل: `backend/src/app.setup.ts`, `backend/src/config/env.schema.ts`) |
| المكونات المتأثرة | `backend/src/*`, `frontend/src/api/*`, `frontend/vite.config.ts` |

### ADR-016 — Docker Compose لتشغيل PostgreSQL 18 محلياً (loopback فقط، مجلد مسمّى، أسرار في `.env`)

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | ADR-014 اعتمد PostgreSQL في Docker Desktop؛ المالك ثبّت Docker Desktop (WSL 2) وطلب بيئة محلية احترافية قابلة لإعادة الإنتاج بلا تعريض القاعدة |
| الخيارات المدروسة | (أ) `compose.yaml` جذري بخدمة PostgreSQL واحدة؛ (ب) تثبيت PostgreSQL مباشرة على Windows؛ (ج) قاعدة سحابية. الإصدار: 18 (أحدث) أو 16/17. المنفذ: `0.0.0.0` أو `127.0.0.1` |
| الخيار المعتمد | (أ): `compose.yaml` في الجذر، `postgres:18`، النشر على `127.0.0.1:${POSTGRES_PORT:-5432}` فقط، مجلد مسمّى `postgres_data` على `/var/lib/postgresql` (مسار صورة 18)، فحص صحي `pg_isready`، `restart: unless-stopped`، كل القيم من `.env` الجذري المتجاهَل في Git مع `.env.example` بقيم وهمية |
| السبب | يطابق نموذج النشر لكل أكاديمية (مشروع compose = أكاديمية)؛ loopback يمنع أي وصول من الشبكة؛ المجلد المسمّى أسرع وأكثر أماناً من bind mount على Windows/WSL 2؛ الإصدار 18 أحدث مستقر وطلبه المالك، ومساره الجديد لـ PGDATA يسهّل `pg_upgrade` لاحقاً |
| النتائج | `docker compose up -d` هو الخطوة الأولى لأي تطوير؛ `down -v` يفقد البيانات (SEC-R-07)؛ بيانات الاعتماد مكرّرة في ملفين (KI-023) والمستخدم superuser (KI-024) — **عولجا في ADR-019 (CH-0008)**؛ `docker compose config --quiet` للتحقق بلا طباعة أسرار؛ إنتاجياً يلزم `compose.prod.yaml` بلا نشر منفذ (14.11) |
| الحالة | ACCEPTED (دليل: `compose.yaml`, `.env.example`) |
| المكونات المتأثرة | الجذر، Ops، 11.4، 14.8–14.11 |

### ADR-017 — `DATABASE_URL` اختياري خارج الإنتاج، وفصل فحص الحيوية عن الجاهزية

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | ربط Prisma يطرح سؤالاً: هل يرفض الخادم الإقلاع بلا قاعدة؟ الاختبارات الشاملة وCI المستقبلي قد لا يملكان قاعدة، ولا توجد بعد أي وحدة تحتاجها فعلاً |
| الخيارات المدروسة | (أ) `DATABASE_URL` إلزامي دائماً و`$connect()` عند الإقلاع (الاختبارات تحتاج قاعدة أو testcontainers)؛ (ب) اختياري خارج الإنتاج، إلزامي في الإنتاج، اتصال كسول، ونقطة جاهزية تقول الحقيقة؛ (ج) محاكاة Prisma في الاختبارات دائماً |
| الخيار المعتمد | (ب): `DATABASE_URL` اختياري عندما `NODE_ENV` ≠ `production` (zod `superRefine`)؛ `PrismaService` يعمل بلا عميل عند غيابه؛ `GET /api/health` (حيوية) لا يلمس القاعدة؛ `GET /api/health/ready` (جاهزية) ينفّذ `SELECT 1` بمهلة 5 ثوانٍ ويُعيد 200 أو 503 بحالات `up` / `down` / `not_configured` |
| السبب | الإقلاع بلا قاعدة يبقي الاختبارات والتطوير الجزئي ممكنين دون إخفاء الحقيقة (الجاهزية تكشف أي عطل)؛ الإنتاج محمي بالإلزام؛ الفصل بين الحيوية والجاهزية هو النمط القياسي للمنسّقات وموازنات الأحمال |
| النتائج | أي وحدة بيانات قادمة تستخدم `prisma.db` الذي يرمي 503 عند غياب الإعداد؛ عندما تُضاف وحدات تعتمد على القاعدة يُعاد تقييم استراتيجية اختبارات التكامل (testcontainers أو compose في CI)؛ الاختبار الشامل للجاهزية يتكيّف مع البيئة (13.5) |
| الحالة | ACCEPTED (دليل: `backend/src/config/env.schema.ts`, `backend/src/prisma/prisma.service.ts`, `backend/src/health/*`) |
| المكونات المتأثرة | MOD-00, MOD-16, MOD-FE-01 (بطاقة الحالة) |

### ADR-018 — إعداد Prisma 7: مولّد `prisma-client` إلى `src/generated` (غير مُلتزم)، محوّل `pg`، إعداد CLI عبر `prisma.config.ts`، لا مزامنة تدميرية

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | Prisma 7 بلا محركات Rust يتطلب محوّل سائق، ويولّد عميلاً من ملفات TypeScript، ويقرأ إعداداته من `prisma.config.ts`؛ الخادم ESM/NodeNext |
| الخيارات المدروسة | موقع العميل المولَّد: داخل `src/` (يُترجم مع البناء) أو خارجه (يحتاج `assets`/`rootDir` خاصة). الالتزام بالعميل في Git أو توليده عند التثبيت. مصدر `DATABASE_URL`: `prisma.config.ts` فقط أو `ConfigService` فقط أو كلاهما |
| الخيار المعتمد | `generator client { provider = "prisma-client", output = "../src/generated/prisma", moduleFormat = "esm", importFileExtension = "js" }`؛ المجلد متجاهَل في Git ويُولَّد في `postinstall` و`build`؛ `PrismaClient({ adapter: new PrismaPg({ connectionString }) })` داخل `PrismaService` وحيد؛ `prisma.config.ts` يحمّل `backend/.env` بـ dotenv للـ CLI بينما يقرأ التطبيق `DATABASE_URL` من `ConfigService` (نفس الاسم، مصدران — منذ ADR-019 يحمّل كلاهما `.env` الجذري أيضاً ويتصل CLI بدور migrator)؛ **ممنوع** `prisma db push` و`migrate reset` في بيئة مشتركة؛ الترحيلات تُراجع وتُلتزم؛ تثبيت الإصدار الرئيسي 7 (KI-026) |
| السبب | الإخراج داخل `src/` يجعل `nest build` يترجمه بلا إعدادات إضافية (ملفات TypeScript خالصة، بلا ثنائيات)؛ عدم الالتزام بالمولَّد يمنع فروقات ضخمة؛ المحوّل الرسمي `pg` هو المسار المدعوم في Prisma 7 |
| النتائج | `npm ci` يولّد العميل تلقائياً؛ `oxlint` وPrettier يتجاهلان `src/generated`؛ حذف `node_modules` دون `postinstall` يكسر `tsc` حتى `prisma:generate`؛ أي تغيير في المخطط يستلزم `generate` (تلقائي مع `migrate dev`) |
| الحالة | ACCEPTED (دليل: `backend/prisma/schema.prisma`, `backend/prisma.config.ts`, `backend/package.json`) |
| المكونات المتأثرة | `backend/prisma/*`, `backend/src/prisma/*`, `backend/src/generated/*`, `backend/package.json`, `backend/oxlint.json`, `backend/.prettierignore` |

### ADR-019 — أدوار قاعدة بيانات محدودة الصلاحيات (app / migrator / superuser) ومصدر واحد لإعدادات القاعدة في `.env` الجذري

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 |
| السياق | KI-023 (بيانات الاعتماد مكرّرة في `.env` الجذري و`backend/.env`) وKI-024 (التطبيق والترحيلات بحساب superuser)؛ طلب المالك معالجتهما قبل أول مخطط دون كسر الاتصال القائم ودون حذف أي قاعدة أو مجلد أو بيانات |
| الخيارات المدروسة | **للأدوار:** (أ) دوران فقط (تطبيق + superuser يشغّل الترحيلات)؛ (ب) ثلاثة أدوار: superuser للإدارة، `migrator` مالك القاعدة للترحيلات، `app` بـ DML فقط؛ (ج) تأجيل الأمر إلى الإنتاج. **للإعدادات:** (1) توليد `DATABASE_URL` من متغيرات `.env` الجذري في `env.schema.ts`؛ (2) ملف env واحد يُمرَّر لـ compose بـ `--env-file`؛ (3) ترك التكرار موثّقاً. **لمكان إنشاء الأدوار:** سكربت `docker-entrypoint-initdb.d` (أول تشغيل) قابل لإعادة التشغيل يدوياً على مجلد قائم، أو ترحيل Prisma (مرفوض: الترحيلات تجري بدور بلا `CREATEROLE`)، أو أوامر يدوية موثّقة فقط |
| الخيار المعتمد | (ب) + (1) معاً: الخادم يقرأ `backend/.env.local` ← `backend/.env` ← `../.env` الجذري (`src/config/env-files.ts`) ويشتق `DATABASE_URL` لدور التطبيق من `DB_APP_*` + `POSTGRES_PORT`/`POSTGRES_DB` + `DB_HOST` عندما لا تُضبط صراحةً (`src/config/database-url.ts`، ترميز percent)؛ Prisma CLI يشتق عنوان دور الترحيلات من `DB_MIGRATOR_*` بالدالة نفسها (أو `MIGRATION_DATABASE_URL`، أو `DATABASE_URL` كخيار أخير لبيئات الدور الواحد)؛ `docker/postgres/initdb/10-roles.sh` (idempotent، يقرأ المتغيرات من compose) ينشئ الدورين، يجعل migrator مالك القاعدة، يسحب `CONNECT` من `PUBLIC`، ويمنح app `USAGE` + DML + امتيازات افتراضية على ما ينشئه migrator؛ migrator يحمل `CREATEDB` محلياً فقط (قاعدة ظلية) |
| السبب | الفصل الثلاثي هو النمط القياسي لأقل الصلاحيات ويطابق نموذج "قاعدة لكل أكاديمية" (migrator يملك كل قاعدة أكاديمية، superuser ينشئ القواعد فقط)؛ الاشتقاق يجعل `.env` الجذري مصدراً واحداً تقرؤه الأدوات الثلاث بلا تكرار، ويبقي `DATABASE_URL` الصريح يعمل كما كان (لا كسر)؛ السكربت في `initdb` يعمل آلياً للمجلدات الجديدة ويُعاد تشغيله للمجلدات القائمة بلا أي حذف |
| النتائج | التطبيق لا يستطيع DDL (متحقق: `permission denied for schema public`) ولا `TRUNCATE`؛ كل ترحيل يجري بدور migrator فتحصل الجداول الجديدة على امتيازات app تلقائياً؛ ستة متغيرات جديدة (ENV-13..ENV-18)؛ `backend/.env` اختياري بلا بيانات اعتماد؛ تدوير كلمة مرور دور = تعديل `.env` + إعادة تشغيل السكربت + إعادة تشغيل الخادم؛ قيدان مقبولان: KI-027 (`CREATEDB` محلياً) وKI-028 (كلمات مرور الإدارة تصل إلى `process.env` للخادم في التطوير)؛ في الإنتاج تُحقن العناوين مباشرة ولا يُقرأ ملف (14.11) |
| الحالة | ACCEPTED (دليل: `docker/postgres/initdb/10-roles.sh`, `compose.yaml`, `backend/src/config/database-url.ts`, `backend/src/config/env-files.ts`, `backend/src/config/env.schema.ts`, `backend/prisma.config.ts`) |
| المكونات المتأثرة | MOD-16, MOD-00 (ConfigModule), Ops (compose), 6.1, 11.3–11.5, 12, 14.8–14.11 |

### ADR-020 — اصطلاحات المخطط الأول (قاعدة لكل أكاديمية بلا `academy_id`، UUIDv7، snake_case، jsonb للنصوص متعددة اللغات)

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 (اقتراح؛ بلا قرار بعد) |
| السياق | المالك طلب خطة واضحة لأول مخطط بيانات تراعي أن كل أكاديمية ستملك قاعدة مستقلة، وأن يُعرض تصميم الجداول قبل أي ترحيل (6.6) |
| الخيارات المدروسة | **العزل:** قاعدة لكل أكاديمية بلا `academy_id` (المطلوب — REQ-02/ADR-008) مقابل عمود `academy_id` احتياطي في كل جدول. **المفتاح الأساسي:** `uuidv7()` (PostgreSQL 18، مرتّب زمنياً) / `gen_random_uuid()` (v4) / `bigint identity`. **النصوص متعددة اللغات:** `jsonb {ar,en}` مطابق لـ `LocalizedText` في الواجهة / عمودان لكل حقل / جدول ترجمات. **التعدادات:** `enum` PostgreSQL / نص + CHECK. **الحذف:** منطقي (`deleted_at`) في كل الجداول / في `users` فقط / فعلي دائماً. **الصلاحيات:** جدول `permissions` مبذور من الكود / كتالوج في الكود فقط |
| الخيار المقترح | قاعدة لكل أكاديمية **بلا** `academy_id`؛ `uuid` بـ `uuidv7()`؛ Prisma PascalCase + `@@map`/`@map` إلى `snake_case` جمع؛ `jsonb` للنصوص متعددة اللغات التي يكتبها المستخدم؛ `enum` Prisma للمجموعات الصغيرة المستقرة ونص للمفاتيح القابلة للتوسع؛ `deleted_at` في `users` فقط و`Restrict` افتراضياً؛ جدول `permissions` مبذور من الكود؛ `timestamptz` لكل الأزمنة؛ فهرس صريح لكل FK؛ ما لا يعبّر عنه Prisma (فهرس الصف الواحد لـ `academy`، قيد `guardian <> student`، trigger إلحاق `audit_logs`) يُضاف يدوياً في SQL الترحيل بعد `--create-only` |
| السبب | عزل القاعدة يلغي الحاجة إلى تصفية كل استعلام بـ `academy_id` ويقلّل خطر التسريب بين الأكاديميات؛ UUIDv7 يعطي مفاتيح غير قابلة للتخمين مع محلّية فهرس جيدة؛ `snake_case` اصطلاح PostgreSQL؛ `jsonb` يطابق نوع الواجهة ويتوسع للغات جديدة بلا ترحيل؛ الحذف المنطقي محصور في المستخدمين لأن سجلاتهم تُشار إليها تاريخياً (درجات، مدفوعات) |
| النتائج المتوقعة | ارتباط بـ PostgreSQL ≥ 18 (`uuidv7()`)؛ الاستعلام داخل `jsonb` أثقل قليلاً من الأعمدة؛ تعديل `enum` يحتاج ترحيلاً؛ إضافة `academy_id` لاحقاً (إن تغيّر القرار) ترحيل واسع؛ كل ترحيل يُراجع يدوياً قبل الالتزام |
| الحالة | **PROPOSED — معتمد جزئياً (CH-0009، 2026-10-29):** D1 (`jsonb` بلغات `ar`/`en`/`tr` مع fallback)، D4 (`uuidv7()` داخل PostgreSQL 18 — توافقه مع Prisma 7.10.1 متحقق منه)، D5 (`audit_logs` إلحاقي مع قواعد حماية) معتمدة من المالك؛ D2، D3، D6..D8 بانتظاره؛ D9/D10 في ADR-021؛ يتحول إلى ACCEPTED مع إدخال CH الذي ينشئ الترحيل الأول |
| المكونات المتأثرة | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`, MOD-01, MOD-02, MOD-03, MOD-14, القسم 06 |

### ADR-021 — قاعدة مركزية للمنصة (control plane) مستقلة عن قواعد الأكاديميات، وتنسيق ترحيلات Prisma عبر قواعد متعددة

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 (اقتراح؛ بلا قرار بعد) |
| السياق | المالك طلب مراجعة تصميم "قاعدة مستقلة لكل أكاديمية مع قاعدة مركزية لإدارة الأكاديميات والاشتراكات والدومينات" وتوضيح إدارة ترحيلات Prisma على القواعد المستقلة (CH-0009)؛ ADR-008 ترك السجل المركزي `NOT YET DETERMINED` |
| الخيارات المدروسة | **مكان بيانات المنصة:** (أ) قاعدة مركزية مستقلة بمخطط Prisma خاص؛ (ب) جداول منصة داخل قاعدة "الأكاديمية الأولى"؛ (ج) خدمة خارجية (SaaS للفوترة) بلا قاعدة محلية. **طوبولوجيا النشر (D9):** حزمة مستقلة لكل أكاديمية توفّرها المنصة / API مشترك يوجّه حسب النطاق. **الترحيلات:** `migrate deploy` تسلسلي من منسّق مركزي مع تسجيل الإصدار لكل أكاديمية / ترحيل عند إقلاع كل خادم أكاديمية / يدوي |
| الخيار المقترح | (أ): قاعدة `articode_platform` بمخطط `backend/prisma/platform/schema.prisma` وإعداد `prisma.platform.config.ts` وعميل مولَّد مستقل، وأدوار `platform_migrator`/`platform_app` بنمط ADR-019؛ جداول 6.6.2 (`academies`, `plans`, `subscriptions`, `domains`, `platform_users`, `academy_jobs`, `platform_audit_logs`)؛ لا FK عابرة، والرابط `academy.platform_academy_id`؛ الترحيلات تُطرح تسلسلياً من منسّق المنصة بعد نسخة احتياطية مع تسجيل `schema_version` وفحص توافق عند إقلاع خادم الأكاديمية (6.6.3)؛ طوبولوجيا النشر الافتراضية حزمة لكل أكاديمية وفق REQ-01 مع إبقاء التوجيه بالنطاق ممكناً |
| السبب | فصل بيانات المنصة (تجارية/تشغيلية) عن بيانات التعليم يحافظ على عزل REQ-02 ويسمح بنسخ وصلاحيات مستقلة؛ المنسّق المركزي هو الوحيد الذي يعرف كل القواعد ويملك سجل الإصدارات؛ الترحيل عند الإقلاع مرفوض لأنه يمنح دور التطبيق DDL ويخفي الفشل |
| النتائج المتوقعة | مخططان ومجلدا ترحيلات في المستودع؛ أدوار لكل أكاديمية بأسماء فريدة على العنقود؛ حاجة إلى مخزن أسرار لكلمات مرور القواعد؛ موقع كود المنصة (وحدة خلف متغير بيئة أم تطبيق مستقل) `NOT YET DETERMINED`؛ اعتماد D9/D10 يحسم هذا الـ ADR |
| الحالة | **PROPOSED** (بانتظار قرارات المالك D9 وD10 في 6.6) |
| المكونات المتأثرة | `backend/prisma/platform/*`, `backend/prisma.platform.config.ts`, MOD-02, MOD-15, Ops (14.11)، ADR-008 |

### ADR-022 — نطاق هوية المستخدم: حساب لكل أكاديمية في قاعدتها (لا هوية عالمية في الإصدار الأول)

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 (اقتراح؛ بلا قرار بعد) |
| السياق | WF-02 و7.2: كيف يُسجَّل المستخدم ويدخل عبر أكاديميات متعددة؟ وأين يعيش حساب Super Admin (ROLE-01)؟ طلب المالك (2026-10-29) تحديد طريقة إدارة المستخدمين والتسجيل عبر الأكاديميات (6.7.8) |
| الخيارات المدروسة | **(أ)** حساب لكل أكاديمية في قاعدتها؛ الدخول دائماً في سياق أكاديمية؛ Super Admin في `platform_users` بالقاعدة المركزية ويصل إلى أكاديمية عبر منحة دعم مؤقتة مسجَّلة (`support_access_grants`)؛ **(ب)** هوية عالمية في القاعدة المركزية + عضوية في كل أكاديمية (دخول موحّد، لكن القاعدة المركزية تدخل في مسار كل عملية دخول ولا يمكن ربطها بمفاتيح أجنبية مع قواعد الأكاديميات)؛ **(ج)** الخيار (أ) الآن مع ترك باب الاتحاد لاحقاً عبر `user_identities(provider = platform_sso)` بلا تغيير في المخطط |
| الخيار المقترح | (ج) |
| السبب | عزل كامل يطابق نموذج النشر المستقل (REQ-01/02)؛ لا اعتماد على مكوّن مركزي عند الدخول (الوضع `single` يعمل بلا قاعدة مركزية)؛ تعقيد أقل في الترحيل الأول (6.6)؛ تكرار حساب الشخص نفسه في أكاديميتين حالة نادرة ومقبولة |
| النتائج المتوقعة | البريد/اسم المستخدم فريدان داخل الأكاديمية لا عبر المنصة؛ تطبيقات المحمول تختار الأكاديمية قبل الدخول؛ كل استخدام لمنحة دعم يُسجَّل في سجلَي التدقيق (المركزي وقاعدة الأكاديمية)؛ لا نقل حسابات بين الأكاديميات في الإصدار الأول |
| الحالة | **ACCEPTED** (CH-0012، 2026-10-29) — اعتمد المالك D11 (6.7.11): حساب لكل أكاديمية في قاعدتها |
| المكونات المتأثرة | MOD-01، MOD-03، MOD-15، 6.7.8 |

### ADR-023 — نموذج الصلاحيات: RBAC بكتالوج صلاحيات دقيقة مبذور من الكود، أدوار مخصّصة، نطاق `own`/`linked`/`all`، وفرض في الخادم

| البند | التفاصيل |
|---|---|
| التاريخ | 2026-10-29 (اقتراح؛ بلا قرار بعد) |
| السياق | REQ-12 (أدوار وصلاحيات مخصّصة)، ROLE-07؛ 7.3 و7.4 `NOT YET DETERMINED`؛ مصفوفة الشاشات في 7.2 مقترحة وغير معتمدة؛ جداول `roles`/`permissions`/`role_permissions`/`user_roles` مقترحة في 6.6 بلا تحديد لدلالة المفاتيح ولا للنطاق |
| الخيارات المدروسة | **(أ)** أدوار ثابتة فقط (`RolesGuard` بأسماء الأدوار)؛ **(ب)** RBAC + كتالوج صلاحيات `module.action` في جدول مبذور من الكود + `role_permissions` + أدوار مخصّصة، مع لواحق نطاق `read_own`/`read_linked`/`read_all` وفحوص نطاق داخل الخدمات (ملكية الفصل للمعلم عبر `class_teachers`، ربط ولي الأمر عبر `guardian_students`)؛ **(ج)** ABAC/محرك سياسات خارجي (OPA / Casbin) |
| الخيار المقترح | (ب)؛ يتسق مع جداول 6.6 (6.6 D8: جدول مبذور من الكود) ويضيف `user_roles.branch_id` اختيارياً لنطاق الفرع. الكتالوج (~45 مفتاحاً) والمصفوفة الافتراضية للأدوار الخمسة في 6.7.8 |
| السبب | يحقق الأدوار المخصّصة بلا محرك سياسات خارجي؛ المصفوفة الافتراضية مشتقة من 7.2 فتبقى الواجهة متسقة؛ الفرض بمفاتيح صلاحية (لا بأسماء أدوار) يبقي الواجهة طبقة تجربة مستخدم فقط (12.2) ويسمح بتعديل الأدوار بلا تغيير كود |
| النتائج المتوقعة | `AuthGuard` + `PermissionsGuard` + ديكوريتور `@RequirePermissions`؛ حساب الصلاحيات من `user_roles → role_permissions` عند كل طلب أو بتخزين مؤقت قصير مع إبطال عند تغيير الأدوار؛ كل نقطة نهاية جديدة تُعلن مفتاحها وتُوثَّق في القسم 10؛ البذر يحدّث الكتالوج مع كل نشر (idempotent)؛ 7.3 يُستبدل بالمصفوفة عند التنفيذ |
| الحالة | **PROPOSED** |
| المكونات المتأثرة | MOD-01، MOD-03، كل وحدات الأعمال، 7.3، 7.4، القسم 10 |

---

## 18. DEVELOPMENT ROADMAP — خارطة طريق التطوير

### 18.1 المرحلة الحالية

**Stage 1 — Foundation (جارية منذ 2026-10-29).** Git مُفعّل (CH-0004)؛ الواجهة هيكل منتج تجريبي ببيانات محلية (CH-0005، سبق جدول Stage 2 لغرض المعاينة — ADR-012)؛ الخادم مهيأ (إعدادات مُتحقَّق منها، `ValidationPipe`، CORS، `/api`، Swagger، `health`) ومربوط بالواجهة (CH-0006)؛ PostgreSQL 18 في Docker موصولة بـ Prisma 7 مع فحص جاهزية (CH-0007)؛ أدوار قاعدة بيانات محدودة الصلاحيات ومصدر واحد لإعدادات القاعدة (CH-0008). المتبقي: `engines`، أول مخطط بيانات وترحيل (التصميم المقترح في 6.6 بانتظار اعتماد المالك)، CI.

### 18.2 المتطلبات المتبقية

كل متطلبات [القسم 02](#02-product-requirements--متطلبات-المنتج) (REQ-01 … REQ-14) ما زالت `PLANNED`.

### 18.3 التسلسل المقترح (RECOMMENDED — يحتاج إلى اعتماد المالك)

| المرحلة | المحتوى | الاعتماديات | الحالة |
|---|---|---|---|
| Stage 1 — Foundation | ~~`git init` + `.gitignore`~~ (CH-0004)؛ ~~تثبيت اعتماديات الخادم وملف القفل~~ (CH-0003)؛ ~~`@nestjs/config` + تحقق البيئة؛ `ValidationPipe`؛ CORS؛ بادئة `/api`؛ Swagger~~ (CH-0006)؛ ~~اختيار ORM~~ (ADR-014: Prisma)؛ ~~Docker Compose لـ PostgreSQL + ربط Prisma + فحص الجاهزية~~ (CH-0007)؛ ~~أدوار قاعدة بيانات محدودة + مصدر إعدادات واحد~~ (CH-0008)؛ **المتبقي:** `engines`؛ أول مخطط Prisma + ترحيل (6.6 بانتظار الاعتماد)؛ CI أساسي (lint/test/build) | KI-012 | PARTIALLY_IMPLEMENTED (المتبقي: المخطط الأول وCI) |
| Stage 1b — UI prototype (خارج التسلسل الأصلي) | هيكل واجهة المنتج: Ant Design، توجيه، i18n/RTL، دخول تجريبي، معاينة الأدوار، 13 شاشة ببيانات محلية (MOD-FE-01، ADR-009..ADR-012) | — | IMPLEMENTED (CH-0005)؛ أول ربط حقيقي بالخادم عبر `GET /api/health` في CH-0006؛ استبدال بيانات الوحدات في Stage 2 وما بعدها |
| Stage 2 — Identity & Academy | MOD-01 المصادقة؛ MOD-03 المستخدمون والأدوار؛ MOD-02 الأكاديمية؛ MOD-14 الإعدادات؛ حسم ADR-008 | Stage 1 | PLANNED |
| Stage 3 — Academic core | MOD-04 الدورات؛ MOD-05 الفصول؛ MOD-07 الجدولة؛ MOD-06 الدروس | Stage 2 | PLANNED |
| Stage 4 — Assessment | MOD-08 الواجبات؛ MOD-09 الاختبارات والدرجات؛ MOD-10 الشهادات | Stage 3 | PLANNED |
| Stage 5 — Finance & Communication | MOD-11 المدفوعات؛ MOD-12 الإشعارات؛ MOD-13 التقارير | Stage 2–4 | PLANNED |
| Stage 6 — Scale & Reach | i18n + RTL (يُفضَّل مبكراً في الواجهة)؛ MOD-15 التكاملات وواجهات المحمول؛ مراقبة ونسخ احتياطي لكل أكاديمية | كل ما سبق | PLANNED |

### 18.4 الأولويات التقنية الفورية (RECOMMENDED)

1. ~~وضع المستودع تحت Git (KI-002)~~ — أُنجز في CH-0004. ~~ضبط هوية Git (KI-018)~~ — مضبوطة محلياً منذ CH-0005 (تم التحقق في CH-0008). المتبقي: تنفيذ خطة الالتزامات المقترحة في CH-0008، وتحديد سياسة الفروع، وإضافة remote.
2. ترقية Node إلى 22.22.3 أو أحدث وإزالة `@nestjs/mau` غير المستخدمة (KI-012, KI-011). ملف القفل واختبارا الهيكل أُنجزا في CH-0003.
3. ~~حسم ADR-003~~ (أُنجز: ADR-014 — Prisma + PostgreSQL) — يبقى حسم ADR-008 (نموذج العزل) قبل كتابة أول كيان.
4. ~~إدخال i18n/RTL في الواجهة قبل أي شاشة منتج~~ — أُنجز في CH-0005 (ADR-010).
5. ~~ربط الواجهة بالخادم (FS-031)~~ — أُنجز في CH-0006 (ADR-015).
6. اعتماد إطار اختبار للواجهة (Vitest + Testing Library) قبل تراكم الشاشات (13.5).
7. ~~تثبيت Docker Desktop وربط Prisma + PostgreSQL~~ — أُنجز في CH-0007 (ADR-016..ADR-018). ~~دور قاعدة بيانات محدود للتطبيق (KI-024)~~ — أُنجز في CH-0008 (ADR-019). التالي: اعتمد المالك D1/D4/D5 (CH-0009)؛ المتبقي قرارات D2، D3، D6..D10 في 6.6 وD11..D22 في 6.7.11 — **المانع منها للترحيل الأول فقط D2, D3, D6, D7, D8, D11, D20, D21, D22 مع توصيات نهائية ودليل تنفيذ في 6.6.5 (CH-0011)**، ثم `schema.prisma` + أول ترحيل + بذر (6.6.4 المرحلة 1 / 6.6.5 و)، ثم MOD-01 (JWT) لاستبدال المصادقة التجريبية في الواجهة (KI-017).

### 18.5 التحسينات المستقبلية

انظر "التحسينات المستقبلية" في كل وحدة بـ [القسم 08](#08-system-modules--وحدات-النظام) و[القسم 12](#12-security-architecture--المعمارية-الأمنية).

---

## 19. PROJECT CHANGE HISTORY — سجل تغييرات المشروع

> **قواعد السجل:** يُضاف فقط (append-only). لا يُحذف أو يُعاد كتابة أي إدخال. المعرّف `CH-nnnn` متسلسل. التواريخ بصيغة `YYYY-MM-DD` والأوقات بالتوقيت المحلي (UTC+03:00) عند توفرها. لا تُختلق طوابع زمنية؛ حيث لا يوجد Git يُذكر مصدر التاريخ.
>
> أنواع التغيير: `ADDED` `MODIFIED` `FIXED` `REMOVED` `REFACTORED` `SECURITY` `DATABASE` `CONFIGURATION` `DEPRECATED`

### CH-0001 — توليد هياكل الخادم والواجهة

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-27 16:42 (backend)، 2026-10-27 16:45 (frontend) — **مصدر التاريخ: طوابع تعديل الملفات في نظام الملفات؛ لا يوجد Git** |
| النوع | ADDED |
| الوحدة | MOD-00, MOD-FE-00 |
| الوصف | توليد هيكل NestJS 12 (ESM، Vitest، oxlint، Prettier) في `backend/`، وهيكل Vite 8 + React 19 + TypeScript 7 (قالب `react-ts` مع oxlint) في `frontend/` |
| السبب | بدء المشروع (مستنتج؛ غير مسجَّل) |
| الملفات | كل ملفات `backend/` و`frontend/` المذكورة في [4.1](#41-الشجرة-الفعلية-بتاريخ-2026-10-28-بدون-مجلدات-الاعتماديات) |
| أثر قاعدة البيانات | لا شيء |
| أثر API | إضافة `GET /` (API-001) |
| أثر الصلاحيات | لا شيء |
| الاختبارات | اختبارا هيكل مولَّدان (TEST-001, TEST-002)؛ تشغيلهما غير متحقق |
| النتيجة | هياكل قابلة للتشغيل (الواجهة متحققة بـ `tsc -b` و`lint` بتاريخ 2026-10-28؛ الخادم غير متحقق لعدم تثبيت الاعتماديات) |
| تغييرات كاسرة | لا ينطبق |
| ملاحظة | المنفّذ غير مسجَّل |

### CH-0002 — تأسيس نظام التوثيق المستمر

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-28 (بين 14:46 و 15:10 بالتوقيت المحلي تقريباً؛ أوقات الملفات موثوقة، الوقت الإجمالي تقريبي) |
| النوع | ADDED, CONFIGURATION |
| الوحدة | Tooling / Docs (FS-004) |
| الوصف | (1) تحليل كامل للمستودع؛ (2) إنشاء `docs/PROJECT_DOCUMENTATION.md` (هذه الوثيقة، إصدار 1.0.0)؛ (3) إنشاء `CLAUDE.md` بقواعد التشغيل الدائمة (RULE 1–20) وسير العمل العشر خطوات؛ (4) إنشاء `.claude/settings.json` بخطّافي `SessionStart` و`Stop`؛ (5) إنشاء `.claude/hooks/doc-sync-check.mjs` واختباره بـ 17 سيناريو |
| السبب | طلب مالك المشروع إنشاء مرجع تقني واحد يبقى متزامناً مع الكود عبر جلسات Claude Code المستقبلية (ADR-007) |
| الملفات | `docs/PROJECT_DOCUMENTATION.md` (جديد)، `CLAUDE.md` (جديد)، `.claude/settings.json` (جديد)، `.claude/hooks/doc-sync-check.mjs` (جديد)، `.claude/.doc-sync/.gitignore` (يُنشأ تلقائياً) |
| أثر قاعدة البيانات | لا شيء |
| أثر API | لا شيء |
| أثر الصلاحيات | لا شيء |
| الاختبارات | خطّاف: 17/17 نجحت على نسخة مؤقتة؛ الواجهة: `tsc -b` و`oxlint` نجحا؛ الخادم: لم يُشغَّل |
| النتيجة | نجاح. **لم يُعدَّل أي ملف من ملفات التطبيق** في `backend/` أو `frontend/` (تم التحقق بمقارنة طوابع التعديل) |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0003 — تثبيت اعتماديات الخادم والتحقق من تشغيله

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-28، بين 15:04 و 15:08 (UTC+03:00). المصدر: سجل npm وطوابع مخرجات الاختبارات |
| النوع | CONFIGURATION |
| الوحدة | MOD-00 / Tooling |
| الوصف | فشل `npm install` في `backend/` مع npm 10.9.3 بالخطأ `edgesOut` (KI-015). جُرّب الحلّان على نسخة مؤقتة خارج المشروع، ثم ثُبّتت الاعتماديات فعلياً بالأمر `npx -y npm@11 install`، فأُضيفت 342 حزمة. بعدها شُغّلت الاختبارات والفحص والبناء والتشغيل الفعلي |
| السبب | طلب المستخدم اختبار المشروع، وكان ذلك متعذراً لأن الأوامر `vitest` و`nest` غير موجودة دون تثبيت (حل KI-001) |
| الملفات | `backend/package-lock.json` (جديد)، `backend/node_modules/` (جديد، غير مُتتبَّع)، `backend/dist/` (مخرجات بناء، غير مُتتبَّع). `backend/package.json` لم يتغير. لم يُعدَّل أي ملف مصدري |
| أثر قاعدة البيانات | لا شيء |
| أثر API | لا شيء. تم التحقق من سلوك API-001 الموجود وتوثيق نوع المحتوى وصيغة خطأ 404 |
| أثر الصلاحيات | لا شيء |
| الاختبارات | `test` نجح (1/1)، `test:e2e` نجح (1/1)، `lint` نجح، `build` نجح، `GET /` أعاد `200`. `npm audit` أظهر 5 ثغرات في `@nestjs/mau` (KI-011) |
| النتيجة | نجاح. FS-003 أصبح IMPLEMENTED، وKI-001 أصبح RESOLVED. أُضيفت KI-011 إلى KI-015 |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Opus 5.5) بطلب من مالك المشروع |

### CH-0004 — وضع المستودع تحت Git

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، قبل 14:46 (UTC+03:00)؛ الطابع الدقيق محفوظ في Git (commit `127cb1d` على `main`) |
| النوع | CONFIGURATION |
| الوحدة | Repo / Tooling (FS-035) |
| الوصف | (1) إنشاء `.gitignore` جذري (node_modules، dist، coverage، `*.tsbuildinfo`، `.env*` مع استثناء `.env.example`، `.claude/settings.local.json`، ملفات المحرّرات)؛ (2) إنشاء `.gitattributes` (`* text=auto eol=lf` + وسم الثنائيات) بعد ظهور تحذيرات CRLF؛ (3) `git init -b main`؛ (4) commit الأساس `127cb1d` بـ 42 ملفاً يلتقط حالة Stage 0 **قبل أي تعديل على الواجهة**. تم التحقق أن `node_modules` و`dist` و`*.tsbuildinfo` غير مرصودة، وأن `.claude/.doc-sync/` يرصد `.gitignore` الخاص به فقط |
| السبب | طلب المالك (2026-10-29) وضع المشروع تحت Git قبل بناء الواجهات؛ الأولوية 1 في 18.4 (KI-002) |
| الملفات | `.gitignore` (جديد)، `.gitattributes` (جديد)، `.git/` (جديد). لم يُعدَّل أي ملف تطبيق |
| أثر قاعدة البيانات | لا شيء |
| أثر API | لا شيء |
| أثر الصلاحيات | لا شيء |
| الاختبارات | `git ls-files \| wc -l` = 42؛ `git ls-files \| grep -c 'node_modules\|/dist/\|tsbuildinfo'` = 0؛ `git status` نظيف بعد الالتزام |
| النتيجة | نجاح. KI-002 وKI-003 → RESOLVED. KI-018 جديد (هوية Git على الجهاز بريد محلي). ADR-013 |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0005 — هيكل واجهة المنتج التجريبي (MOD-FE-01)

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 14:40 و14:46 تقريباً (UTC+03:00)؛ المصدر: سجل خادم Vite وأمر `date`. حالة الالتزام في Git: انظر `git log` (كانت غير ملتزمة عند كتابة هذا الإدخال) |
| النوع | ADDED, REMOVED, CONFIGURATION |
| الوحدة | MOD-FE-01 (جديد)، MOD-FE-00 (REMOVED)، FS-034، FS-028، FS-002 |
| الوصف | (1) إضافة الاعتماديات `antd`، `@ant-design/icons`، `react-router@7`، `i18next`، `react-i18next` (+73 حزمة، 0 ثغرات) بعد اعتماد المالك لـ Ant Design والعربية افتراضياً؛ (2) i18n ar/en مع RTL وحفظ الاختيار؛ (3) مصادقة تجريبية (`AuthProvider`) وحارسا مسارات (`RequireAuth`, `RequireRole`) ومبدّل دور للمعاينة؛ (4) تخطيط عام (قائمة جانبية حسب الدور + ترويسة)؛ (5) 13 شاشة وحدة ببيانات محلية ثنائية اللغة + 404/403؛ (6) حذف صفحة القالب وأصولها؛ (7) `index.html` → `lang="ar" dir="rtl"` والعنوان "ArtiCode Academy"؛ (8) استبدال `index.css` بأنماط عامة بالحد الأدنى |
| السبب | طلب المالك "أريد أن أدخل إلى الواجهات" (2026-10-29) مع قراراته: Ant Design، العربية افتراضياً + الإنجليزية، وGit أولاً. نهج mock-first (ADR-012) يتيح المعاينة قبل الخادم |
| الملفات | **جديدة (34):** `frontend/src/app/App.tsx`, `app/router.tsx`, `auth/roles.ts`, `auth/auth-context.ts`, `auth/AuthProvider.tsx`, `auth/RequireAuth.tsx`, `components/PageHeader.tsx`, `components/StatusTag.tsx`, `components/LanguageSwitcher.tsx`, `components/RoleSwitcher.tsx`, `i18n/language.ts`, `i18n/index.ts`, `i18n/ar.ts`, `i18n/en.ts`, `i18n/useLocalized.ts`, `layout/navigation.ts`, `layout/AppLayout.tsx`, `layout/AppLayout.css`, `mock/data.ts`, `pages/LoginPage.tsx`, `pages/LoginPage.css`, `pages/DashboardPage.tsx`, `pages/UsersPage.tsx`, `pages/CoursesPage.tsx`, `pages/ClassesPage.tsx`, `pages/SchedulePage.tsx`, `pages/LessonsPage.tsx`, `pages/AssignmentsPage.tsx`, `pages/ExamsPage.tsx`, `pages/CertificatesPage.tsx`, `pages/PaymentsPage.tsx`, `pages/NotificationsPage.tsx`, `pages/ReportsPage.tsx`, `pages/SettingsPage.tsx`, `pages/NotFoundPage.tsx`, `pages/ForbiddenPage.tsx`. **معدّلة (5):** `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/package.json`, `frontend/package-lock.json`. **محذوفة (6):** `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/assets/hero.png`, `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg`, `frontend/public/icons.svg`. **الخادم لم يُمس** |
| أثر قاعدة البيانات | لا شيء |
| أثر API | لا شيء؛ الواجهة لا تستدعي أي نقطة نهاية (بيانات محلية) |
| أثر الصلاحيات | مصفوفة دور×شاشة في الواجهة فقط (7.2)، مقترحة وغير معتمدة؛ ليست فرضاً أمنياً (KI-017, SEC-R-04) |
| الاختبارات | `npx tsc -b` نجح؛ `npm run lint` (oxlint) بلا مخرجات؛ `npx vite build` نجح (1,306 kB، تحذير حجم — KI-016)؛ خادم التطوير أعاد `200` لـ `/` و8 وحدات جديدة، وHTML المُقدَّم يحمل `lang="ar" dir="rtl"`؛ `GET /` في الخادم ما زال يعمل. **لا اختبارات آلية للواجهة** (13.5)، و**العرض المرئي لم يُتحقق منه في متصفح** (الملحق B) |
| النتيجة | نجاح. FS-034 → IMPLEMENTED (نموذج أولي)؛ FS-002 → REMOVED؛ FS-028 → PARTIALLY_IMPLEMENTED؛ MOD-FE-00 → REMOVED؛ KI-005 → RESOLVED؛ جديد: KI-016، KI-017، KI-019، SEC-R-04؛ SEC-R-03 → RESOLVED؛ ADR-009..ADR-012 |
| تغييرات كاسرة | إزالة صفحة القالب (لا مستهلكين لها) |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0006 — تهيئة الخادم وأول ربط حقيقي بين الواجهة والخادم

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 15:05 و15:32 تقريباً (UTC+03:00)؛ المصدر: مخرجات vitest (15:30) وأمر `date`. حالة الالتزام في Git: انظر `git log` (كانت غير ملتزمة عند كتابة هذا الإدخال) |
| النوع | ADDED, MODIFIED, REMOVED, CONFIGURATION, SECURITY |
| الوحدة | MOD-00 (تهيئة + health)، MOD-FE-01 (عميل HTTP وبطاقة الحالة)، FS-031، FS-036 |
| الوصف | **الخادم:** (1) إضافة `@nestjs/config`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `zod` بـ npm 11، وإزالة `@nestjs/mau` وسكربت `deploy`؛ (2) مخطط بيئة zod (`config/env.schema.ts`) مع `validateEnv` مربوط بـ `ConfigModule.forRoot`؛ (3) `app.setup.ts` بدالة `configureApp()`: بادئة `API_PREFIX`، تعطيل `X-Powered-By`، CORS من `CORS_ORIGIN`، `ValidationPipe` عام، `enableShutdownHooks`، Swagger اختياري؛ (4) وحدة `health` (`GET /api/health`) مع DTO موثّق؛ (5) `main.ts` يستخدم `configureApp` ويطبع العناوين؛ (6) حذف `AppController`/`AppService`/spec (نهاية `GET /`)؛ (7) اختبارات: 4 للبيئة، 1 للخدمة، 6 شاملة؛ (8) `.env.example`. **الواجهة:** (9) proxy `/api` في `vite.config.ts` مع `loadEnv`؛ (10) `src/api/{client,health,useHealth}.ts` و`vite-env.d.ts`؛ (11) `ServerStatusCard` في لوحة التحكم؛ (12) مفاتيح ترجمة `server.*` وتحديث نص التنبيه التجريبي؛ (13) `.env.example` |
| السبب | المرحلة 2 من الخطة التي اعتمدها المالك 2026-10-29: أول ربط حقيقي بين الواجهة والخادم قبل قاعدة البيانات، وتثبيت اصطلاحات API (ADR-015)؛ إغلاق KI-007 وKI-011 وKI-014. في الجلسة نفسها اعتمد المالك Prisma + PostgreSQL في Docker Desktop (ADR-014) دون تنفيذ |
| الملفات | **الخادم — جديدة (10):** `backend/.env.example`, `src/app.setup.ts`, `src/common/package-info.ts`, `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`, `src/health/health.module.ts`, `src/health/health.controller.ts`, `src/health/health.service.ts`, `src/health/health.dto.ts`, `src/health/health.service.spec.ts`. **معدّلة (5):** `src/main.ts`, `src/app.module.ts`, `test/app.e2e-spec.ts`, `package.json`, `package-lock.json`. **محذوفة (3):** `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`. **الواجهة — جديدة (6):** `frontend/.env.example`, `src/vite-env.d.ts`, `src/api/client.ts`, `src/api/health.ts`, `src/api/useHealth.ts`, `src/components/ServerStatusCard.tsx`. **معدّلة (4):** `vite.config.ts`, `src/pages/DashboardPage.tsx`, `src/i18n/ar.ts`, `src/i18n/en.ts`. **أخرى:** `CLAUDE.md` (حقائق المشروع) |
| أثر قاعدة البيانات | لا شيء (قرار ADR-014 مسجَّل بلا تنفيذ) |
| أثر API | **كاسر:** إزالة API-001 (`GET /`) وإضافة بادئة عامة `/api`. جديد: API-002 `GET /api/health`، API-003 `/api/docs` و`/api/docs-json`. تنسيق 404: JSON تحت البادئة، HTML من Express خارجها |
| أثر الصلاحيات | لا شيء (كل النقاط عامة) |
| الاختبارات | الخادم: lint نظيف؛ وحدة 5/5؛ شامل 6/6 (فشل اختبار واحد في المحاولة الأولى لأن `GET /` يُعيد HTML لا JSON خارج البادئة، فصُحّح التوقع ليطابق السلوك الفعلي)؛ build ناجح؛ `npm audit` = 0. الواجهة: tsc، lint (بعد إصلاح تحذير `set-state-in-effect` في `useHealth.ts`)، build. حي: curl مباشر وعبر proxy → `200` JSON؛ رؤوس CORS صحيحة؛ Swagger `200`. العرض المرئي للبطاقة `UNVERIFIED` |
| النتيجة | نجاح. FS-031 → IMPLEMENTED؛ FS-036 جديد IMPLEMENTED؛ FS-001 → REMOVED؛ FS-003 محدَّث؛ KI-007، KI-011، KI-014 → RESOLVED؛ جديد: KI-020، KI-021، KI-022، SEC-R-05؛ SEC-R-02 مخفَّف؛ ADR-003 → ACCEPTED؛ ADR-014، ADR-015 جديدان |
| تغييرات كاسرة | `GET /` لم يعد موجوداً؛ كل المسارات تحت `/api`. لا مستهلكين خارجيين بعد |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0007 — PostgreSQL 18 في Docker Compose وربط Prisma 7 وفحص الجاهزية

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 15:45 و16:18 تقريباً (UTC+03:00)؛ المصدر: طوابع ملفات `prisma init` (15:55)، سجل خادم Nest (16:12)، وطابع استجابة الجاهزية (13:18Z). حالة الالتزام في Git: انظر `git log` (كانت غير ملتزمة عند كتابة هذا الإدخال، مع تغييرات CH-0006 غير الملتزمة أيضاً) |
| النوع | ADDED, CONFIGURATION, DATABASE, SECURITY |
| الوحدة | MOD-16 (جديد)، MOD-00 (جاهزية)، MOD-FE-01 (بطاقة الحالة)، FS-032، FS-033، FS-037، FS-038 |
| الوصف | **الفحص:** Docker Desktop مثبّت لكل مستخدم (`%LOCALAPPDATA%\Programs\DockerDesktop`)، المحرك 29.9.2 يعمل، لا حاويات/مجلدات سابقة سوى `hello-world` (تُركت)، المنفذ 5432 حرّ، لا ORM في المشروع. **Docker:** `compose.yaml` جذري بخدمة `postgres:18` (loopback فقط، مجلد `postgres_data` على `/var/lib/postgresql`، فحص صحي)، و`.env.example` جذري، و`.env` محلي بكلمة مرور عشوائية (متجاهَل). **الخادم:** تثبيت `@prisma/client` `@prisma/adapter-pg` `pg` (+ `prisma` `@types/pg` `dotenv` للتطوير) على الإصدار الرئيسي 7؛ `prisma init` ثم إعادة تسمية إعداده إلى `prisma.config.ts` وإزالة مجلدي `.claude`/`.windsurf` الفارغين اللذين خلّفهما؛ `schema.prisma` بمولّد `prisma-client` إلى `src/generated/prisma` (متجاهَل، يُولَّد في `postinstall`/`build`) بلا نماذج؛ `PrismaModule` عام و`PrismaService` (عميل واحد بمحوّل `pg`، `db`، `ping()`، إغلاق عند الإيقاف، يعمل بلا `DATABASE_URL` خارج الإنتاج)؛ `DATABASE_URL` في `env.schema.ts` (اختياري/إلزامي في الإنتاج، فارغ = غائب)؛ `GET /api/health/ready` (API-004) بـ DTOs موثّقة و200/503؛ سكربتات `prisma:*`؛ `oxlint` و`.prettierignore` يتجاهلان المولَّد؛ `.env.example` + `DATABASE_URL`. **الواجهة:** `fetchReadiness` (يُعيد جسم 503)، `useEndpoint`/`useReadiness`، سطر "قاعدة البيانات" في `ServerStatusCard`، مفاتيح `server.db_*`. **اختبارات:** +3 للبيئة، +3 للجاهزية (وحدة)، +1 شامل |
| السبب | طلب المالك (2026-10-29) دمج Docker وإعداد PostgreSQL محلية احترافية وربطها بالخادم بعد تثبيت Docker Desktop؛ تنفيذ ADR-014؛ تحضير النشر لكل أكاديمية (14.11) |
| الملفات | **جديدة (12):** `compose.yaml`, `.env.example`, `backend/.gitignore`, `backend/.prettierignore`, `backend/prisma.config.ts`, `backend/prisma/schema.prisma`, `backend/src/prisma/prisma.module.ts`, `backend/src/prisma/prisma.service.ts`؛ **محلية غير ملتزمة:** `.env`, `backend/.env`؛ **مولَّدة غير ملتزمة:** `backend/src/generated/prisma/*`. **معدّلة (15):** `.gitignore` (أنماط النسخ الاحتياطي)، `backend/package.json`, `backend/package-lock.json`, `backend/oxlint.json`, `backend/.env.example`, `backend/src/app.module.ts`, `backend/src/config/env.schema.ts`, `backend/src/config/env.schema.spec.ts`, `backend/src/health/health.dto.ts`, `backend/src/health/health.service.ts`, `backend/src/health/health.controller.ts`, `backend/src/health/health.service.spec.ts`, `backend/test/app.e2e-spec.ts`, `frontend/src/api/health.ts`, `frontend/src/api/useHealth.ts`, `frontend/src/components/ServerStatusCard.tsx`, `frontend/src/i18n/ar.ts`, `frontend/src/i18n/en.ts`, `CLAUDE.md` |
| أثر قاعدة البيانات | **إنشاء قاعدة التطوير** `articode_academy` بمستخدم `articode` (superuser) على PostgreSQL 18.6 في مجلد Docker؛ لا جداول ولا ترحيلات ولا تغيير على أي قاعدة أخرى؛ لم يُحذف أي حاوية/مجلد/صورة |
| أثر API | جديد: API-004 `GET /api/health/ready` (200/503). لا تغيير على API-002/003 |
| أثر الصلاحيات | لا شيء |
| الاختبارات | Docker: `config --quiet` صالح، الحاوية `healthy`، psql داخلها (18.6، checksums on)، مصادقة من المضيف بـ `pg` (صحيحة تمر، خاطئة `28P01`)، `netstat` يؤكد loopback. Prisma: `validate`/`generate` ناجحان، `migrate status` اتصل (لا ترحيلات؛ 0 جداول بعده). الخادم: lint نظيف، وحدة 11/11 (بعد تصحيح اختبار واحد)، شامل 7/7 مع القاعدة حية، build ناجح. الواجهة: tsc/lint/build. حي: `/api/health/ready` → 200 `up` مباشرة وعبر proxy. **حادثة:** خادم المراقبة تعطّل بسبب `build` متزامن، أُعيد تشغيله. العرض المرئي `UNVERIFIED` |
| النتيجة | نجاح. MOD-16 IMPLEMENTED (بنية)؛ FS-037، FS-038 IMPLEMENTED؛ FS-032، FS-033 PARTIALLY_IMPLEMENTED؛ ADR-016..ADR-018 جديدة، ADR-003/ADR-014 محدَّثتا الحالة؛ KI-023..KI-026، SEC-R-06/07 جديدة |
| تغييرات كاسرة | لا شيء في API؛ `npm run build` أصبح يشغّل `prisma generate` أولاً ويتطلب `prisma` (devDependency) |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0008 — مراجعة ما قبل المخطط الأول: أدوار قاعدة بيانات محدودة الصلاحيات (KI-024)، مصدر واحد لإعدادات القاعدة (KI-023)، فحص الأسرار، وخطة المخطط والالتزامات

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 16:30 و17:00 تقريباً (UTC+03:00)؛ المصدر: طوابع تشغيل الاختبارات (16:48 وحدة، 16:51 شامل) وسجل الخادم المؤقت (16:51). حالة Git: غير ملتزم عند كتابة الإدخال (مع CH-0006 وCH-0007)؛ خطة الالتزامات المقترحة أدناه لم تُنفَّذ |
| النوع | SECURITY, CONFIGURATION, DATABASE, ADDED |
| الوحدة | MOD-16، MOD-00 (ConfigModule)، Ops (compose)، Docs |
| الوصف | **(1) مراجعة الملفات غير الملتزمة** (44 مساراً بعد هذا التغيير: 13 معدّلاً، 28 جديداً، 3 محذوفة مُدرجة في index) وتصنيفها بالمرحلة: CH-0006 (تهيئة الخادم + ربط الواجهة)، CH-0007 (Docker + Prisma + جاهزية)، CH-0008 (هذا الإدخال)، مع وثيقة واحدة تجمعها. **(2) فحص الأسرار:** `git ls-files` بلا `.env`؛ كلمات المرور الحقيقية الثلاث غائبة من كل الملفات المرصودة؛ القوالب بقيم وهمية فقط. **(3) KI-023:** `src/config/env-files.ts` (ترتيب الملفات حتى `.env` الجذري)، `src/config/database-url.ts` (`buildPostgresUrl`/`postgresUrlFromEnv` + افتراضيات مشتركة)، `env.schema.ts` يشتق `DATABASE_URL` من `DB_APP_*` بتحويل zod مع إخفاء المدخلات، `prisma.config.ts` يحمّل الملفين ويشتق عنوان migrator؛ `backend/.env.example` بلا `DATABASE_URL` افتراضي؛ `.env.example` الجذري أُعيدت كتابته كمصدر وحيد. **(4) KI-024:** `docker/postgres/initdb/10-roles.sh` (idempotent) + تركيبه في `compose.yaml` مع 4 متغيرات؛ أُعيد إنشاء الحاوية بالبيئة الجديدة (المجلد نفسه) وشُغّل السكربت على القاعدة القائمة فأنشأ `articode_migrator` (مالك القاعدة، `CREATEDB`) و`articode_app` (DML)، وسُحب `CONNECT` من `PUBLIC`. **(5) الملفات المحلية (غير ملتزمة):** أُضيفت `DB_MIGRATOR_*`/`DB_APP_*` بقيم عشوائية إلى `.env` الجذري؛ أُزيلت `DATABASE_URL` (superuser) من `backend/.env` فصار تعليقاً فقط. **(6) اختبارات:** +4 في TEST-003، TEST-006 جديد (6)؛ TEST-005 بلا تغيير. **(7) خطة المخطط الأول:** 6.6 وADR-020 (PROPOSED). **(8) خطة الالتزامات:** 5 التزامات مقترحة (بنية تحتية، خادم، واجهة، أمن القاعدة، توثيق) — **لم يُنفَّذ أي commit أو push** بانتظار المالك |
| السبب | طلب المالك (2026-10-29) مرحلة مراجعة وتحسين قبل تطوير جداول الأكاديمية: معالجة KI-023 وKI-024 بلا كسر الاتصال وبلا حذف بيانات، والتأكد من خلو ما سيُرفع إلى GitHub من الأسرار، وتجهيز تصميم المخطط للمراجعة قبل أي ترحيل |
| الملفات | **جديدة (4):** `docker/postgres/initdb/10-roles.sh`, `backend/src/config/database-url.ts`, `backend/src/config/database-url.spec.ts`, `backend/src/config/env-files.ts`؛ **معدّلة (9):** `compose.yaml`, `.env.example`, `backend/.env.example`, `backend/prisma.config.ts`, `backend/src/app.module.ts`, `backend/src/config/env.schema.ts`, `backend/src/config/env.schema.spec.ts`, `CLAUDE.md`, `docs/PROJECT_DOCUMENTATION.md`؛ **محلية غير ملتزمة:** `.env` (4 متغيرات جديدة)، `backend/.env` (بلا بيانات اعتماد) |
| أثر قاعدة البيانات | **لا حذف ولا فقد بيانات:** المجلد `articode-academy_postgres_data` نفسه (طابع الإنشاء لم يتغير)، القاعدة `articode_academy` بـ 0 جداول قبل وبعد. تغييرات بيانات وصفية فقط: دوران جديدان، نقل ملكية القاعدة إلى `articode_migrator`، `REVOKE ALL ON DATABASE FROM PUBLIC` + `GRANT CONNECT` للدورين، `GRANT USAGE/DML` و`ALTER DEFAULT PRIVILEGES` لدور app. الحاوية أُعيد إنشاؤها (تركيب جديد + متغيرات) |
| أثر API | لا شيء (API-002..API-004 بلا تغيير؛ TEST-005 7/7) |
| أثر الصلاحيات | على مستوى قاعدة البيانات: التطبيق لم يعد superuser — DML فقط، لا DDL ولا TRUNCATE؛ الترحيلات بدور مالك منفصل. لا أثر على صلاحيات التطبيق (لا مصادقة بعد) |
| الاختبارات | `lint` نظيف؛ وحدة 21/21 (3 ملفات)؛ `prisma validate` ناجح مع الإعداد الجديد؛ `docker compose config --quiet` صالح؛ `up -d --wait` → `healthy`؛ تحقق الامتيازات بـ `has_*_privilege` و`pg_default_acl` وجدول تجريبي داخل معاملة مُلغاة (app: SELECT/INSERT نعم، TRUNCATE لا، CREATE TABLE → `permission denied`)؛ `test:e2e` 7/7 بعد إزالة `DATABASE_URL` الصريح؛ `prisma migrate status` اتصل بدور migrator؛ نسخة مؤقتة من `dist/main` على 3999: `/api/health/ready` → 200 `up` و`pg_stat_activity` يُظهر `articode_app`. **لم يُشغَّل `npm run build`** لأن `start:dev` كان يعمل (المراقب حدّث `dist/` تلقائياً). الواجهة لم تُمس فلم تُعاد فحوصها. العرض المرئي `UNVERIFIED` |
| النتيجة | نجاح. KI-023، KI-024، KI-018 RESOLVED؛ SEC-R-06 RESOLVED؛ KI-027، KI-028 جديدتان (ACCEPTED)؛ FS-039 IMPLEMENTED؛ ADR-019 ACCEPTED، ADR-020 PROPOSED؛ ENV-13..ENV-18؛ TEST-006. **ملاحظة تشغيلية:** خادم `start:dev` الحي أُعيد تشغيله آلياً عند تعديل `src/` قبل إزالة `DATABASE_URL` من `backend/.env`، فيلزم إعادة تشغيله يدوياً ليتصل بدور app؛ لوحظ أيضاً وجود عمليتَي `nest start --watch` تعملان معاً على الجهاز (يُستحسن إبقاء واحدة) |
| تغييرات كاسرة | لا شيء في API أو في `DATABASE_URL` الصريح (ما زال يغلب). **تشغيلياً:** `docker compose up` يرفض الآن `.env` بلا `DB_MIGRATOR_PASSWORD`/`DB_APP_PASSWORD` (رسالة واضحة)؛ المجلدات القائمة تحتاج تشغيل `10-roles.sh` مرة واحدة |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0009 — مراجعة تصميم المخطط الأول: اعتماد D1/D4/D5، مراجعة النماذج، القاعدة المركزية، وإدارة الترحيلات متعددة القواعد (توثيق وتحقق فقط)

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 17:15 و17:45 تقريباً (UTC+03:00)؛ المصدر: طوابع استعلامات PostgreSQL (`uuid_extract_timestamp` أعاد 14:19Z) وأوقات تشغيل أوامر Prisma. حالة Git: غير ملتزم (مع CH-0006..CH-0008) |
| النوع | MODIFIED (توثيق)، DATABASE (تصميم وتحقق — بلا تغيير على القاعدة) |
| الوحدة | Docs، MOD-16 (تحقق)، MOD-01/02/03 (تصميم مقترح) |
| الوصف | ردّاً على مراجعة المالك لتقرير CH-0008: **(1)** تسجيل اعتماد D1 (`jsonb` بلغات `ar`/`en`/`tr` مع fallback وCHECK على `ar`)، D4 (`uuidv7()` داخل PostgreSQL 18)، D5 (`audit_logs` إلحاقي مع 7 قواعد حماية) في 6.6 وADR-020، مع إبقاء D2، D3، D6..D8 `PROPOSED` وإضافة D9 (طوبولوجيا النشر) وD10 (القاعدة المركزية). **(2)** تحقق فعلي من D4 وD5 والبند 7 (دورة Prisma Migrate لدور migrator) دون إنشاء أي كائن دائم (13.4). **(3)** 6.6.1 مراجعة سلامة النماذج (10 ملاحظات ومعالجاتها: فريدية البريد مع الحذف المنطقي، اتساق الأدوار والملفات التعريفية، الولي الأساسي الواحد، `deprecated_at` للصلاحيات، `metadata` للدعوات، `entity_id` نصي). **(4)** 6.6.2 تصميم القاعدة المركزية (7 جداول + ERD + تدفق التوفير). **(5)** 6.6.3 إدارة ترحيلات Prisma عبر قواعد الأكاديميات (مخططان وإعدادان، حارس انجراف في CI، طرح تسلسلي بنسخة احتياطية وتسجيل الإصدار، فحص توافق عند الإقلاع، توسيع ثم تقليص). **(6)** 6.6.4 خطة تنفيذ من 5 مراحل. **(7)** ADR-021 (PROPOSED) وتحديث حالة ADR-008 وADR-020. **(8)** تنسيق مع جلسة Claude أخرى (`articodeacademy-2e`) تعمل على التوثيق: إشعار قبل التعديل وبعده لمنع الكتابة المتزامنة، وتقسيم الملكية (هذه الجلسة: 6.6/6.6.1–6.6.4 وADR-020/ADR-021؛ الجلسة الأخرى: قسم 6.7 للتصميم المستهدف الكامل بمعرّفات تبدأ من D11 وADR-022 وCH-0010). **(9)** دمج الجداول الإضافية للقاعدة المركزية من مسودة تلك الجلسة في 6.6.2 ("الصيغة الموسّعة") بدل تكرارها. **لا تغيير في الكود، ولا جداول، ولا ترحيلات، ولا commit** |
| السبب | طلب المالك (2026-10-29) عرض القرارات الثمانية وتأثيرها، ومراجعة تصميم القاعدة المركزية والنماذج، وتوضيح إدارة الترحيلات، مع تحديث التوثيق بالقرارات المعتمدة فقط |
| الملفات | **معدّلة (2):** `docs/PROJECT_DOCUMENTATION.md`, `CLAUDE.md`. **مؤقتة خارج المستودع (حُذفت الحاجة إليها):** `scratchpad/uuidv7-probe.prisma` (مخطط تجريبي لـ `prisma validate`/`migrate diff` فقط) |
| أثر قاعدة البيانات | **لا شيء دائم:** كل عبارات DDL/DML التجريبية جرت داخل معاملات أُلغيت (`ROLLBACK`)؛ عدد الجداول 0 قبل وبعد؛ لا تغيير على الأدوار |
| أثر API | لا شيء |
| أثر الصلاحيات | لا شيء (تأكيد أن دور app لا يملك DDL ولا TRUNCATE ولا CREATEDB، وأن migrator يملك ما تحتاجه دورة Prisma Migrate) |
| الاختبارات | انظر صفوف CH-0009 في 13.4: `uuidv7()`، `prisma validate` و`migrate diff` على المخطط التجريبي، دورة DDL لدور migrator، امتيازات app، trigger الإلحاق، أعلام Prisma CLI. لم تُشغَّل اختبارات التطبيق لعدم تغيّر الكود |
| النتيجة | نجاح. D1/D4/D5 معتمدة وموثقة؛ D2، D3، D6..D10 `PROPOSED`؛ ADR-021 جديد (PROPOSED)؛ ADR-020 معتمد جزئياً؛ 13.4 +7 صفوف؛ MOD-01/02/03 تشير إلى 6.6 |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Fable 5.1) بطلب من مالك المشروع |

### CH-0010 — التصميم المستهدف الكامل لقاعدة البيانات (6.7): كتالوج جداول كل الوحدات، ERD، SQL اليدوي، الهوية والصلاحيات والتسجيل، التوسّع والنسخ الاحتياطي (PROPOSED — توثيق فقط)

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 17:00 و 17:40 تقريباً (UTC+03:00)؛ المصدر: طوابع ملفات المسودة في مجلد الجلسة المؤقت وطابع حفظ هذه الوثيقة. حالة Git: غير ملتزم (مع CH-0006..CH-0009) |
| النوع | ADDED (توثيق وقرارات مقترحة فقط — **لا تغيير في الكود ولا في قاعدة البيانات**) |
| الوحدة | Docs / DB design (MOD-16 تخطيطاً؛ يمسّ MOD-01..MOD-15 كمتطلبات) |
| الوصف | بطلب المالك (2026-10-29) "الانتقال إلى مرحلة تصميم قاعدة البيانات" أُضيف القسم 6.7 (`PROPOSED`) مكمّلاً لـ 6.6 (الترحيل الأول) و6.6.2/6.6.3 (القاعدة المركزية والترحيلات متعددة القواعد): (1) 6.7.0 مطابقة صريحة مع 6.6 وفروقه المقصودة؛ (2) 6.7.1 اصطلاحات تكمّل P1..P10/ADR-020 (المال `numeric`، لا حذف للمالية والتدقيق والشهادات، الامتدادات، ما يُكتب يدوياً في SQL)؛ (3) 6.7.2 ربط وضعَي النشر `single`/`multi` بـ D9 والقاعدة المركزية بـ D10 عبر مزوّد `TenantDb` واحد؛ (4) 6.7.3 إحالة إلى كتالوج 6.6.2 مع ERD للصيغة الموسّعة؛ (5) 6.7.4 قاعدة الأكاديمية: 59 جدولاً في 8 مجالات (الهوية والوصول، هيكل الأكاديمية، المحتوى الأكاديمي والجدولة، التقييم، الشهادات، المالية، الإشعارات، المشترك) بالأعمدة والأنواع والمفاتيح الأجنبية وسلوك الحذف والفهارس والقيود؛ (6) 6.7.5 ثلاثة مخططات ER (Mermaid)؛ (7) 6.7.6 قائمة SQL اليدوي (امتدادات، `CHECK`، `EXCLUDE` لتعارض القاعة/المعلم، `NULLS NOT DISTINCT`، فهارس جزئية، `REVOKE` على التدقيق، عروض)؛ (8) 6.7.7 إضافات على 6.6.3: مخطط متعدد الملفات اختياري، قاعدة المنصة محلياً بسكربت initdb ثانٍ، تسلسل تزويد أكاديمية، توازٍ محدود بعد الكناري، البذر؛ (9) 6.7.8 نطاق الهوية لكل أكاديمية، كتالوج ~45 صلاحية بنطاق own/linked/all، مصفوفة افتراضية للأدوار الخمسة، JWT/تحديث، ستة مسارات تسجيل؛ (10) 6.7.9 التوسّع والأمان والنسخ الاحتياطي؛ (11) 6.7.10 أربع مراحل تطابق Stages 2–5؛ (12) 6.7.11 قرارات المالك D11..D22. أُضيف ADR-022 (نطاق الهوية) وADR-023 (نموذج الصلاحيات) بحالة PROPOSED، ومؤشرات في 5.2 و7.3 وMOD-02 و18.4 والترويسة. **نُسّق العمل مع جلسة Claude Code موازية** (`articodeacademy-12`) كتبت 6.6/6.6.1–6.6.4 وADR-020/ADR-021 وCH-0008/CH-0009 في الوقت نفسه: اعتُمدت تسمياتها ومعرّفاتها، ودُمجت جداول المنصة من هذه المسودة في 6.6.2 ("الصيغة الموسّعة")، ولم تُكرَّر موضوعاتها هنا |
| السبب | طلب المالك تصميماً تفصيلياً لمراجعته واعتماده قبل أي جدول أو ترحيل، يغطي معمارية مركزية لإدارة الأكاديميات وقاعدة مستقلة لكل أكاديمية (REQ-01/02، ADR-008) واحتياجات المستخدمين والمعلمين والطلاب والدورات والدروس والاختبارات والمدفوعات والصلاحيات |
| الملفات | **معدّل (1):** `docs/PROJECT_DOCUMENTATION.md` فقط. لا ملف كود ولا إعداد ولا `schema.prisma` |
| أثر قاعدة البيانات | **لا شيء** — تم التحقق قبل الكتابة: 0 جداول في `articode_academy`؛ لا ترحيل؛ لا تغيير في الأدوار أو المجلد. استُعلم للقراءة فقط عن: الإصدار (18.6)، الأدوار الثلاثة، مالك القاعدة، الامتدادات المتاحة (`citext`, `pgcrypto`, `btree_gist`, `pg_trgm`, `uuid-ossp`, `pg_stat_statements` — متاحة وغير مثبّتة)، الترميز والمنطقة الزمنية |
| أثر API | لا شيء |
| أثر الصلاحيات | لا شيء منفّذ؛ نموذج الصلاحيات المقترح في 6.7.8/ADR-023 |
| الاختبارات | لا تغيير في الكود؛ للتحقق من حالة الشجرة قبل التصميم: `npm run lint` نظيف و`npm test` 21/21 في `backend/` (2026-10-29 17:03). لم يُشغَّل `build` ولا `test:e2e` (لا حاجة) |
| النتيجة | نجاح. القسم 6.7 وADR-022/ADR-023 بحالة PROPOSED بانتظار قرارات المالك D11..D22 (وD2، D3، D6..D10 في 6.6)؛ لا تغيير في مصفوفة الميزات (كل الوحدات ما زالت PLANNED) |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Fable 5.1، الجلسة `articodeacademy-2e`) بطلب من مالك المشروع |

### CH-0011 — مراجعة ما قبل التنفيذ: فرز القرارات D1..D22 المانعة للترحيل الأول، مراجعة تصميم الهوية والصلاحيات والتدقيق، التحقق من التوافق مع PostgreSQL 18/Prisma 7، فحص Git والأسرار، ودليل تنفيذ الترحيل الأول والتراجع عنه (توثيق فقط)

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، بين 17:40 و17:55 تقريباً (UTC+03:00)؛ المصدر: طابع حفظ هذه الوثيقة وطوابع أوامر التحقق. حالة Git: غير ملتزم (مع CH-0006..CH-0010) |
| النوع | ADDED (توثيق وتوصيات فقط — **لا تغيير في الكود ولا في قاعدة البيانات**) |
| الوحدة | Docs / DB design (MOD-16 تخطيطاً؛ MOD-01، MOD-02، MOD-03 كمتطلبات) |
| الوصف | بطلب المالك (2026-10-29) "الانتقال من التخطيط إلى التنفيذ بأقل تعقيد" أُضيف البند 6.6.5: **(أ)** فرز D1..D22: المعتمدة D1/D4/D5؛ المانعة للجداول الـ12 وتحتاج اعتماداً الآن D2, D3, D6, D7, D8, D11, D20, D21, D22 مع توصية نهائية لكل منها؛ **(ب)** حزمة اختيارية واحدة من أعمدة 6.7 الإضافية (D12، D13، القفل، `family_id`، `is_default_for_signup`) بنعم/لا؛ **(ج)** D9, D10, D14..D19 تبقى PROPOSED لأنها لا تمسّ DDL الجداول الـ12؛ **(د)** 7 تعديلات دقيقة من مراجعة المستخدمين/الأدوار/الصلاحيات/الملفات التعريفية/التدقيق (أبرزها `user_roles.role_id` → `Restrict`، الـ trigger وحده يحمي `audit_logs` في SQL الترحيل بلا اسم دور، عمود `singleton` بدل فهرس التعبير، لا `citext` في الترحيل الأول) وتأكيد أن الجداول الـ12 تكفي أساساً لبقية جداول 6.7؛ **(هـ)** نتائج التحقق الحي من PostgreSQL 18.6/Prisma 7.10.1 وغياب التعارض بين قاعدة الأكاديمية والقاعدة المركزية؛ **(و)** دليل تنفيذ الترحيل الأول في 10 خطوات (توليد بـ `--create-only`، قائمة مراجعة SQL، فحص صلاحيات app، حارس انجراف، TEST-007 مقترح، بذر بلا مدير أول) وإجراء تراجع بلا `migrate reset` وبلا حذف القاعدة؛ **(ز)** فحص Git والأسرار وخطة ثلاثة التزامات بديلة عن خماسية CH-0008 مع أوامر حراسة؛ **(ح)** قائمة ما قد يمنع البدء. حُدّثت الترويسة و18.4 بمؤشرات |
| السبب | إنهاء مرحلة التخطيط: حصر ما يحتاج قرار المالك فعلاً قبل أول ترحيل بدل انتظار حسم D1..D22 كلها، وتجهيز دليل تنفيذ قابل للمراجعة والتراجع |
| الملفات | **معدّل (1):** `docs/PROJECT_DOCUMENTATION.md` فقط. لا ملف كود ولا إعداد ولا `schema.prisma`؛ `CLAUDE.md` لم يُمس (يشير إلى 6.6 ويبقى صحيحاً) |
| أثر قاعدة البيانات | **لا شيء** — استعلامات قراءة فقط عبر `docker compose exec postgres psql` (الإصدار، `uuidv7()`، عدد الجداول = 0، الأدوار وسماتها، مالك القاعدة، الامتدادات المتاحة، `TimeZone`، `has_schema_privilege`) و`npm run prisma:status` (غير مُدارة) |
| أثر API | لا شيء |
| أثر الصلاحيات | لا شيء منفّذ؛ توصية (د) 1 تغيّر سلوك FK مقترحاً فقط |
| الاختبارات | لا تغيير في الكود فلم تُشغَّل الاختبارات؛ `npx prisma --version` (7.10.1) و`prisma migrate status` للتحقق من البيئة |
| النتيجة | نجاح. قرارات بانتظار المالك: (أ) 9 قرارات و(ب) حزمة واحدة؛ لا تغيير في مصفوفة الميزات ولا في حالات ADR |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Fable 5.1، الجلسة `articodeacademy-ad`) بطلب من مالك المشروع |

### CH-0012 — اعتماد المالك لقرارات الترحيل الأول (D2, D3, D6, D7, D8, D11, D12, D13, D20, D21, D22 والحزمة الاختيارية) وحفظ أعمال CH-0006..CH-0011 في Git محلياً

| البند | التفاصيل |
|---|---|
| التاريخ والوقت | 2026-10-29، نحو 18:00–18:10 (UTC+03:00)؛ المصدر: طلب المالك في جلسة Claude Code وطوابع الالتزامات في `git log` |
| النوع | CONFIGURATION (قرارات) — توثيق فقط؛ **لا تغيير في الكود ولا في قاعدة البيانات** |
| الوحدة | Docs / DB design؛ Repo |
| الوصف | **(1) القرارات:** اعتمد المالك قائمة 6.6.5 (أ) كاملة وفق توصياتها: D2، D3، D6، D7، D8، D11، D21، D22؛ وD20 بشرط أن يغطي `employee_profiles` المعلمين والموظفين دون تقييد تعدد أدوار المستخدم مع إمكانية إضافة البيانات التخصصية لاحقاً؛ والحزمة (ب) كاملة (D12، D13، حالة `pending`، أعمدة القفل، `family_id`، `is_default_for_signup`) بشرط معرّف دخول فريد وآمن (`email` أو `username`) وعدم الاعتماد على الهاتف غير الفريد وحده؛ و`timezone`/`currency` يُحدَّدان لكل أكاديمية (معاملا بذر إلزاميان بلا افتراضي قُطري). D9، D10، D14..D19 تبقى `PROPOSED`. حُدّثت جداول القرارات في 6.6 و6.7.11 و6.6.5، وADR-022 → ACCEPTED. **(2) Git:** بعد فحص الأسرار (لا ملف `.env` في الفهرس؛ قيم كلمات المرور الثلاث الحقيقية غائبة من الفهرس؛ عناوين الاتصال ذات كلمات مرور موجودة فقط في `*.spec.ts` كقيم اختبار وفي القوالب كـ `change-me`) أُنشئ التزامان محليان بلا push: `feat(backend)` (الخادم + البنية التحتية: CH-0006..CH-0008) و`feat(frontend)` (CH-0006)؛ والالتزام الثالث `docs` يضم هذه الوثيقة و`CLAUDE.md` (CH-0009..CH-0012). **(3) تشغيلياً:** أُوقفت عمليتا `nest start --watch` المكرّرتان (مع غلافَي `cmd.exe`) تمهيداً للترحيل (CH-0008 لاحظ تكرارهما)؛ بقيت نسختا `vite` خارج نطاق الطلب |
| السبب | طلب المالك (2026-10-29) الانتقال إلى تنفيذ أول ترحيل بعد اعتماد القرارات، وحفظ العمل الحالي محلياً بالتزامات منظمة دون كشف الأسرار |
| الملفات | **معدّل (1):** `docs/PROJECT_DOCUMENTATION.md`. لا ملف كود |
| أثر قاعدة البيانات | لا شيء |
| أثر API | لا شيء |
| أثر الصلاحيات | لا شيء |
| الاختبارات | لا تغيير في الكود |
| النتيجة | نجاح. القرارات المانعة للترحيل الأول كلها معتمدة؛ التنفيذ في CH-0013 |
| تغييرات كاسرة | لا شيء |
| المنفّذ | Claude Code (Fable 5.1، الجلسة `articodeacademy-ad`) بطلب من مالك المشروع |

---

## 20. DOCUMENTATION MAINTENANCE — صيانة التوثيق

### 20.1 الملكية

- **المالك:** فريق تطوير ArtiCode Academy. كل مطور (بشري أو Claude Code) يعدّل الكود مسؤول عن تحديث هذه الوثيقة **في نفس المهمة**.
- **المرجع التشغيلي للأتمتة:** `CLAUDE.md` في جذر المستودع (RULE 1–20).

### 20.2 متطلبات التحديث (متى يجب تحديث ماذا)

| نوع التغيير | الأقسام الواجب تحديثها |
|---|---|
| وحدة جديدة | 04 (الهيكل)، 05 (العلاقات)، 08 (الوحدة)، 15 (المصفوفة)، 19 (السجل)؛ و06/07/10 حسب الحاجة |
| كيان/ترحيل/فهرس/علاقة | 06 (كاملاً بما فيه ER)، 08 (الوحدة)، 19 |
| نقطة نهاية جديدة/معدّلة/محذوفة | 10، 08، 07 (إن تغيّرت الصلاحيات)، 19 |
| متغير بيئة/إعداد/أمر | 11، 14 عند الحاجة، 19 |
| إصلاح خطأ | 16 (تحديث حالة KI أو إضافة)، 19 (النوع FIXED مع السبب المؤكد والاختبار) |
| قرار معماري | 17 (ADR جديد)، 05 إن تأثرت المعمارية، 19 |
| تغيير أمني | 12، 19 (النوع SECURITY) |
| حذف ميزة | 15 (الحالة REMOVED)، كل أقسام الحالة الراهنة المتأثرة، 19 (النوع REMOVED). **لا يُحذف تاريخها** |
| تغيير حالة ميزة | 15، 19 |
| تحديث اعتماديات | 03، 16 إن ظهرت مشكلات، 19 |

### 20.3 قواعد مصدر الحقيقة (Source of truth)

1. **الكود هو مصدر الحقيقة للسلوك**؛ هذه الوثيقة مصدر الحقيقة للسياق والقرارات والتاريخ والحالة.
2. عند تعارض الوثيقة مع الكود: يُحقَّق في السبب، ثم تُصحَّح الوثيقة (أو الكود إن كان الانحراف خطأً)، ويُسجَّل ذلك في القسم 19.
3. لا تُنشأ وثائق موازية تكرر محتوى هذه الوثيقة. ملفات README الفرعية (إن أُبقيت) تُشير إلى هنا فقط.
4. لا تُوثَّق ميزة كـ `IMPLEMENTED` إلا بدليل من الكود (مسار ملف قابل للتحقق).

### 20.4 الإصدار (Versioning)

- **إصدار الوثيقة** في الجدول العلوي يتبع نمطاً شبيهاً بـ SemVer: `MAJOR` لإعادة هيكلة الأقسام، `MINOR` لإضافة وحدات/أقسام، `PATCH` لتحديثات ضمن الأقسام.
- يُحدَّث **"تاريخ آخر مزامنة"** و**"آخر معرّف تغيير"** مع كل إدخال في القسم 19.
- المعرّفات (`CH-`, `KI-`, `ADR-`, `FS-`, `MOD-`, `API-`, `REQ-`, `NFR-`, `ROLE-`, `WF-`, `ENV-`, `TEST-`) **لا يُعاد استخدامها** بعد حذف ما تشير إليه.

### 20.5 إجراءات المراجعة

- **مع كل مهمة كود:** قائمة تحقق RULE 18 في `CLAUDE.md` + خطّاف `Stop`.
- **مراجعة دورية (موصى بها شهرياً أو عند كل إصدار):** مطابقة القسم 15 مع الكود؛ مراجعة القسم 16؛ التأكد من أن القسم 10 يطابق المتحكمات الفعلية؛ التأكد من أن القسم 06 يطابق الكيانات والترحيلات.
- **عند الانضمام/التسليم:** قراءة الأقسام 01، 03، 04، 05، 11 أولاً ثم 08 و15.

### 20.6 الحفاظ على القرارات التاريخية

- القسمان 17 و19 **إلحاقيان فقط**. تغيّر قرار = ADR جديد يشير إلى القديم ويغيّر حالته إلى `SUPERSEDED`.
- حذف ميزة = حالة `REMOVED` في القسم 15 + إدخال في 19؛ تبقى إدخالاتها السابقة كما هي.

### 20.7 كشف انجراف التوثيق (Drift detection)

| الآلية | النوع | ما تكشفه |
|---|---|---|
| خطّاف `Stop` (`doc-sync-check.mjs`) | آلي، لكل دور | تغيّر كود بلا لمس للوثيقة |
| قائمة تحقق RULE 18 | إجرائي | صحة محتوى التحديث |
| مطابقة يدوية | دوري | تغيّرات أجراها بشر خارج Claude Code؛ دقة المصفوفة والـ API |
| أوامر التحقق (`lint`, `tsc -b`, `test`) | آلي عند التشغيل | صحة الكود التي تستند إليها الوثيقة |

مؤشرات الانجراف التي يجب البحث عنها: ملفات `*.controller.ts` لا تقابلها إدخالات `API-`؛ ملفات كيانات/ترحيلات لا تقابلها جداول في القسم 06؛ متغيرات `process.env.*` أو `import.meta.env.*` غير مدرجة في 11.3؛ وحدات في `AppModule.imports` غير مدرجة في 08.

---

## الملحق A — اصطلاحات المعرّفات

| البادئة | المعنى | القسم |
|---|---|---|
| `REQ-nn` | متطلب منتج | 02 |
| `NFR-nn` | متطلب غير وظيفي | 02 |
| `MOD-nn` / `MOD-FE-nn` | وحدة خادم / واجهة | 08 |
| `ROLE-nn` | دور مستخدم | 07 |
| `WF-nn` | رحلة مستخدم | 09 |
| `API-nnn` | نقطة نهاية | 10 |
| `ENV-nn` | متغير بيئة | 11 |
| `SEC-R-nn` | خطر أمني مرصود | 12 |
| `TEST-nnn` | اختبار | 13 |
| `FS-nnn` | صف في مصفوفة الميزات | 15 |
| `KI-nnn` | مشكلة معروفة/دين تقني | 16 |
| `ADR-nnn` | قرار معماري | 17 |
| `CH-nnnn` | إدخال في سجل التغييرات | 19 |

## الملحق B — سجل التحقق من الكود

ما تم فحصه فعلياً لإنتاج الإصدار 1.0.0 بتاريخ 2026-10-28:

- قراءة كاملة لكل ملف مصدري وإعدادي في `backend/` و`frontend/` (34 ملفاً بخلاف `node_modules`).
- قراءة `frontend/package-lock.json` لاستخراج الإصدارات المثبّتة.
- التحقق من عدم وجود: `.git`، ملفات `.env*`، `docs/`، `CLAUDE.md`، `.claude/`، `backend/node_modules`، `backend/package-lock.json`.
- تشغيل: `node --version`, `npm --version`, `npx tsc -b` و`npm run lint` في `frontend/`، واختبار تجريبي لصرامة TypeScript 7.
- التحقق من إصدار Claude Code (2.1.312) ومخطط إعداداته (`claude-code-settings.schema.json`) وتوثيق الخطّافات الرسمي لتصميم آلية التحقق.
- اختبار خطّاف التوثيق بـ 17 سيناريو على نسخة مؤقتة خارج المستودع.
- **لم يُشغَّل** `npm install` في `backend/` ولم يُعدَّل أي ملف تطبيق.

تحديث الإصدار 1.0.1 (CH-0003): تثبيت اعتماديات الخادم، وقراءة الإصدارات من `backend/package-lock.json`، وتشغيل `test` و`test:e2e` و`lint` و`build` و`npm audit`، والتحقق من استجابة HTTP الفعلية بتشغيل `dist/main.js` مؤقتاً على المنفذ 3999 ثم إيقافه.

تحديث الإصدار 1.1.0 (CH-0004, CH-0005) بتاريخ 2026-10-29: التحقق من `git --version` وإعدادات الهوية العامة؛ `git init` ثم مراجعة قائمة الملفات المرصودة (42) قبل commit الأساس؛ قراءة كل ملفات الواجهة الأصلية (`App.tsx`, `main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.app.json`, `.oxlintrc.json`, `index.css`) قبل استبدالها؛ الاستعلام عن أحدث إصدارات الحزم الخمس من npm وتثبيتها وقراءة الإصدارات المثبّتة من `node_modules/*/package.json`؛ التحقق قبل الكتابة من وجود `antd/locale/ar_EG` و`en_US` و19 أيقونة و30 تصديراً من antd؛ تشغيل `npx tsc -b` و`npm run lint` و`npx vite build` في `frontend/`؛ التحقق من استجابة خادم التطوير (`200`) لـ 9 مسارات ومن `lang`/`dir`/`title` في HTML المُقدَّم ومن خلو سجل Vite من الأخطاء؛ التحقق من استمرار `GET /` في الخادم. **لم يُفتح متصفح فعلي** (لا أداة متصفح في الجلسة)، فالعرض المرئي للشاشات `UNVERIFIED` حتى يفتحه المالك.

تحديث الإصدار 1.2.0 (CH-0006) بتاريخ 2026-10-29: قراءة كل ملفات الخادم المصدرية والإعدادية قبل التعديل؛ التحقق من غياب Docker وPostgreSQL على الجهاز (`docker --version`, `psql --version`)؛ تثبيت 5 حزم بـ npm 11 وقراءة إصداراتها المثبّتة؛ تشغيل `lint` و`test` و`test:e2e` و`build` و`npm audit` في `backend/`؛ تشغيل `tsc -b` و`lint` و`vite build` في `frontend/`؛ فحص الخادم الحي بـ curl (المسارات `/`, `/api`, `/api/nope`, `/api/docs/nope`, `/api/health`, `/api/docs`, `/api/docs-json`) مع فحص الرؤوس (`Content-Type`, `Access-Control-*`, غياب `X-Powered-By`)؛ فحص `GET /api/health` عبر proxy Vite على المنفذ 5173. العرض المرئي لبطاقة الاتصال في المتصفح `UNVERIFIED`.

تحديث الإصدار 1.3.0 (CH-0007) بتاريخ 2026-10-29: `docker info` / `ps -a` / `volume ls` / `compose ls` / `context ls` بالمسار الكامل لواجهة Docker بعد اكتشاف غيابها من PATH الجلسة؛ `wsl -l -v`؛ فحص المنفذ 5432؛ `npm view` لوسوم Prisma؛ قراءة العميل المولَّد للتأكد من توافق ESM؛ `docker compose config --quiet`؛ `up -d` ومراقبة `inspect .State.Health`؛ `psql` داخل الحاوية (الإصدار، المستخدم، checksums، `pg_hba.conf`)؛ اختبار مصادقة من المضيف بسكربت `pg` مؤقت (حُذف بعده)؛ `netstat` لعنوان الربط؛ `prisma validate` / `generate` / `migrate status` وعدّ الجداول بعده؛ `lint` / `test` / `test:e2e` / `build` في `backend/` و`tsc -b` / `lint` / `vite build` في `frontend/`؛ فحص الخادم الحي مباشرة وعبر proxy وقراءة `docs-json`؛ `git ls-files` و`git status` للتأكد من عدم رصد أي ملف `.env`. **لم يُفتح متصفح** — العرض المرئي `UNVERIFIED`.

تحديث الإصدار 1.4.0 (CH-0008) بتاريخ 2026-10-29: قراءة كل الملفات غير الملتزمة وفروق Git للملفات المعدّلة وتصنيفها بالمرحلة؛ فحص الأسرار (أسماء المتغيرات فقط دون قيم، مطابقة كلمات المرور الحقيقية ضد كل ملف مرصود، `git check-ignore`، `git ls-files`)؛ فحص أدوار PostgreSQL وملكية القاعدة والمخطط وعدد الجداول قبل التغيير وبعده؛ قراءة مصدر `@nestjs/config` (ترتيب `envFilePath` و`assignVariablesToProcess`) وإصدار `dotenv` ومحمّل `@prisma/config` (c12) قبل التصميم؛ `lint`/`test` (21)/`prisma validate`/`docker compose config --quiet`/`up -d --wait`/تشغيل `10-roles.sh`/استعلامات `has_*_privilege`/`test:e2e` (7)/`prisma migrate status`/خادم مؤقت على 3999 مع `pg_stat_activity`؛ التحقق من نهايات الأسطر LF للملفات الجديدة وصحة bash للسكربت. **لم يُنفَّذ** `npm run build` (خادم `start:dev` يعمل)، ولا أي commit/push، ولا أي ترحيل؛ **لم يُفتح متصفح** — العرض المرئي `UNVERIFIED`.

تحديث الإصدار 1.5.0 (CH-0009) بتاريخ 2026-10-29: قراءة القسم 6.6 كاملاً قبل التعديل؛ `select uuidv7()` و`uuid_extract_version/timestamp` على PostgreSQL 18.6؛ `prisma validate` و`prisma migrate diff --from-empty --to-schema --script` على مخطط تجريبي خارج المستودع (بلا اتصال بالقاعدة)؛ دورة DDL كاملة بدور `articode_migrator` وفحوص `has_table_privilege`/`has_type_privilege` لدور `articode_app` واختبار trigger الإلحاق — كلها داخل معاملات أُلغيت، وعدد الجداول 0 قبل وبعد؛ `prisma migrate diff --help` و`prisma --help` للأعلام؛ قراءة `frontend/src/i18n/language.ts` و`index.ts` لتقدير أثر إضافة `tr`؛ `ListAgents` وتبادل رسائل تنسيق مع جلسة `articodeacademy-2e`؛ مقارنة طابع تعديل الوثيقة وبحث عن معرّفات غريبة (`ADR-021`, `CH-0009`) قبل الكتابة للتأكد من غياب تعديلات متزامنة. **لم يُغيَّر أي كود**، ولا جداول، ولا ترحيلات، ولا commit/push.

تحديث الإصدار 1.6.1 (CH-0011) بتاريخ 2026-10-29 (توثيق فقط): قراءة `CLAUDE.md` والقسمين 6.6 (مع 6.6.1–6.6.4) و6.7 كاملَين وADR-008/ADR-019..ADR-023 والأقسام 07 و15 و16 و18 وCH-0008..CH-0010؛ قراءة `backend/prisma/schema.prisma`، `prisma.config.ts`، `src/config/*`، `src/prisma/*`، `package.json`، `test/app.e2e-spec.ts`، `compose.yaml`، `docker/postgres/initdb/10-roles.sh`، قوالب `.env.example` الثلاثة و`frontend/src/i18n/language.ts`؛ `git status`/`diff --stat`/`diff --cached --stat`/`check-ignore` ومسح كل الملفات المرصودة وغير المرصودة عن عناوين اتصال بكلمات مرور (أسماء متغيرات `.env` فقط دون قيم)؛ `docker compose ps` واستعلامات قراءة فقط على القاعدة الحية (18.6، `uuidv7()`، 0 جداول، الأدوار، المالك، الامتدادات، `TimeZone`، `has_schema_privilege`)؛ `npx prisma --version` و`npm run prisma:status`؛ `ListAgents` وطابع تعديل الوثيقة (17:39) قبل الكتابة للتأكد من غياب تعديل متزامن. **لم يُعدَّل أي ملف كود**، ولا نموذج ولا ترحيل ولا commit/push.

تحديث الإصدار 1.6.0 (CH-0010) بتاريخ 2026-10-29 (توثيق فقط): قراءة كاملة للأقسام 01–20 من هذه الوثيقة بعد تحديثات CH-0008 وCH-0009، وقراءة `backend/prisma/schema.prisma`، `backend/prisma.config.ts`، `backend/src/prisma/*`، `backend/src/config/*`، `backend/src/app.module.ts`، `backend/src/health/health.service.ts`، `compose.yaml`، `docker/postgres/initdb/10-roles.sh`، قوالب `.env.example` الثلاثة (أسماء المتغيرات فقط)، و`frontend/src/mock/data.ts` و`frontend/src/auth/*` و`frontend/src/layout/navigation.ts` و`frontend/src/i18n/ar.ts` لاستخراج الحقول والحالات والأدوار؛ استعلامات قراءة فقط على القاعدة الحية عبر `docker compose exec postgres psql` (الإصدار 18.6، الأدوار `articode`/`articode_app`/`articode_migrator`، مالك `articode_academy` = `articode_migrator`، 0 جداول، الامتدادات المتاحة وغير المثبّتة، `server_encoding = UTF8`، `timezone = Etc/UTC`)؛ `npm run lint` و`npm test` (21/21) في `backend/` للتأكد من سلامة الشجرة قبل التصميم. **لم يُعدَّل أي ملف كود**، ولم يُنشأ أي نموذج أو ترحيل، ولم يُنفَّذ أي أمر يغيّر القاعدة. نُسّق العمل مع جلسة Claude Code موازية عبر الرسائل بين الجلسات لتجنّب الكتابة المتزامنة في هذه الوثيقة.
