// MOD-09 phase 2 (roadmap §4r — OEX-T07): the online settings of an exam and the «الأسئلة» tab of the exam drawer.
// English in ../en/examOnline.ts with the same keys (`Translation = typeof ar`).
// i18next plurals (CH-0297): a counted Arabic string carries the six forms (`_one`, `_two`, `_few`, `_many`, `_other`
// and the plain key for 0), and `count` is always a number. A number that only follows a colon or sits in brackets is
// named `value`/`attempts`/…, never `count` — i18next reads `count` as the plural selector.

export const examOnline = {
  tab: 'الأسئلة',

  // «طريقة الأداء» in the create and edit forms, the list's filter and tag.
  delivery: {
    label: 'طريقة الأداء',
    manual: 'يدوي — يسجّل المعلم النتائج',
    online: 'إلكتروني — يؤدّيه الطلاب على المنصة',
    tag: 'إلكتروني',
    hint: 'يمكن تغيير طريقة الأداء ما دام الاختبار مسودة.',
    draftOnly: 'لا تتغيّر طريقة الأداء إلا والاختبار مسودة.',
    filter: 'كل طرق الأداء',
    short: {
      manual: 'يدوي',
      online: 'إلكتروني',
    },
  },

  // The form fields of an online exam: the exam date becomes the opening of the window and the duration one attempt's limit.
  fields: {
    opensDate: 'يفتح في (التاريخ)',
    opensTime: 'يفتح في (الوقت)',
    closesDate: 'يُغلق في (التاريخ)',
    closesTime: 'يُغلق في (الوقت)',
    attemptDuration: 'مدة المحاولة الواحدة (بالدقائق)',
    attemptsAllowed: 'المحاولات المسموحة لكل طالب',
    resultsRelease: 'متى يرى الطالب نتيجته',
    revealAnswers: 'إظهار الإجابات الصحيحة للطالب بعد إغلاق الاختبار',
  },
  release: {
    on_publish: 'عند نشر النتائج',
    on_submit: 'فور تسليم المحاولة',
  },
  hints: {
    window:
      'يبدأ الطالب الاختبار في أي وقت بين موعدَي الفتح والإغلاق، وتستمر محاولته مدتها كاملة ما لم يحِن موعد الإغلاق قبل انتهائها. الوقت يُحسب بساعة الخادم لا بساعة جهاز الطالب.',
    opens: 'موعد فتح الاختبار للطلاب؛ يلزم قبل إتاحته',
    closes: 'بعد موعد الفتح؛ يلزم قبل إتاحة الاختبار',
    duration: 'عدد صحيح من 1 إلى {{max}}؛ يلزم قبل إتاحة الاختبار',
    attemptsAllowed: 'من 1 إلى {{max}}؛ تُحتسب للطالب أعلى محاولاته المنتهية درجةً',
    resultsRelease: 'عند النشر: يرى الطلاب نتائجهم حين تنشرها أنت. فور التسليم: يرى كل طالب درجته حال انتهاء محاولته.',
    revealAnswers: 'تظهر الإجابات الصحيحة وتفسيرها في مراجعة الطالب لمحاولته، بعد أن تُغلق نافذة الاختبار وتظهر له نتيجته.',
    maxScoreFrozen: 'أُتيح الاختبار للطلاب، فدرجته القصوى مثبّتة مع نقاط أسئلته.',
    visible: 'الاختبار متاح للطلاب: يمكن تعديل موعدَي الفتح والإغلاق ومدة المحاولة، ولا يمكن تفريغها.',
    started: 'بدأ بعض الطلاب هذا الاختبار: موعد الفتح ومدة المحاولة ثابتان، وموعد الإغلاق يتأخر ولا يتقدّم، وعدد المحاولات يزيد ولا ينقص.',
  },
  validation: {
    closesDateRequired: 'أدخل تاريخ الإغلاق مع وقته',
    closesTimeRequired: 'أدخل وقت الإغلاق مع تاريخه',
    windowInvalid: 'موعد الإغلاق يجب أن يكون بعد موعد الفتح',
    attemptsRequired: 'أدخل عدد المحاولات',
    attemptsAllowed: 'عدد المحاولات عدد صحيح من 1 إلى {{max}}',
    opensRequired: 'لا يُفرَّغ موعد الفتح بعد إتاحة الاختبار للطلاب',
    closesRequired: 'لا يُفرَّغ موعد الإغلاق بعد إتاحة الاختبار للطلاب',
    durationRequired: 'لا تُفرَّغ مدة المحاولة بعد إتاحة الاختبار للطلاب',
    closesOnlyLater: 'بدأ بعض الطلاب الاختبار: موعد الإغلاق يتأخر ولا يتقدّم',
    attemptsOnlyRise: 'بدأ بعض الطلاب الاختبار: عدد المحاولات يزيد ولا ينقص (الحالي {{current}})',
  },
  // `exam_locked { fields }`: why the server refused each field (its stored value is put back).
  locked: {
    delivery: 'لا تتغيّر طريقة الأداء إلا والاختبار مسودة؛ أُعيدت قيمتها المحفوظة',
    maxScore: 'مثبّتة مع نقاط الأسئلة منذ أُتيح الاختبار؛ أُعيدت قيمتها المحفوظة',
    clearedOnceVisible: 'لا يُفرَّغ بعد إتاحة الاختبار للطلاب؛ أُعيدت قيمته المحفوظة',
    fixedOnceStarted: 'لا يتغيّر بعد أن بدأ أحد الطلاب الاختبار؛ أُعيدت قيمته المحفوظة',
    closesOnlyLater: 'بعد أن بدأ أحد الطلاب الاختبار يتأخر موعد الإغلاق ولا يتقدّم ولا يُفرَّغ؛ أُعيدت قيمته المحفوظة',
    attemptsOnlyRise: 'بعد أن بدأ أحد الطلاب الاختبار يزيد عدد المحاولات ولا ينقص؛ أُعيدت قيمته المحفوظة',
  },
  patchFields: {
    delivery: 'طريقة الأداء',
    closesAt: 'موعد الإغلاق',
    attemptsAllowed: 'عدد المحاولات',
    resultsRelease: 'ظهور النتيجة',
    revealAnswers: 'إظهار الإجابات الصحيحة',
  },

  // Questions the edit form asks before a save.
  toManual: {
    title: 'جعل الاختبار يدوياً؟',
    content: 'يعود الاختبار يدوياً يسجّل المعلم نتائجه: تُحذف إعداداته الإلكترونية (موعد الإغلاق وعدد المحاولات وسياسة النتائج).',
    questions: 'وتُفكّ عنه أسئلته المرتبطة (عددها {{value}})؛ الأسئلة نفسها تبقى في بنوكها.',
    ok: 'نعم، اجعله يدوياً',
    cancel: 'تراجع',
  },
  reopen: {
    title: 'تمديد اختبار أُغلق وهو يُظهر الإجابات؟',
    content:
      'نافذة هذا الاختبار أُغلقت، وهو يُظهر الإجابات الصحيحة بعد الإغلاق: مَن أنهوا محاولاتهم ربما رأوها. تأخير موعد الإغلاق يفتح الاختبار من جديد، فيستطيع مَن بقيت له محاولة أن يستفيد منها.',
    ok: 'مدِّد على أي حال',
    cancel: 'تراجع',
  },

  // The details pane of an online exam.
  details: {
    delivery: 'طريقة الأداء',
    opensAt: 'يفتح في',
    closesAt: 'يُغلق في',
    notSet: 'لم يُحدَّد بعد',
    attemptDuration: 'مدة المحاولة الواحدة',
    attemptsAllowed: 'المحاولات المسموحة',
    // `count` = attemptsAllowed (1..20).
    attemptsAllowedValue: '{{count}} محاولة لكل طالب',
    attemptsAllowedValue_one: 'محاولة واحدة لكل طالب',
    attemptsAllowedValue_two: 'محاولتان لكل طالب',
    attemptsAllowedValue_few: '{{count}} محاولات لكل طالب',
    attemptsAllowedValue_many: '{{count}} محاولة لكل طالب',
    attemptsAllowedValue_other: '{{count}} محاولة لكل طالب',
    resultsRelease: 'ظهور النتيجة للطالب',
    revealAnswers: 'الإجابات الصحيحة',
    revealYes: 'تظهر للطالب بعد إغلاق الاختبار',
    revealNo: 'لا تظهر للطالب',
    questions: 'الأسئلة',
    // `count` = the linked questions.
    questionCount: 'لا أسئلة بعد',
    questionCount_one: 'سؤال واحد',
    questionCount_two: 'سؤالان',
    questionCount_few: '{{count}} أسئلة',
    questionCount_many: '{{count}} سؤالاً',
    questionCount_other: '{{count}} سؤال',
    points: 'مجموع نقاطها {{total}} من {{max}}',
    pointsMatch: 'يساوي الدرجة القصوى',
    pointsMismatch: 'لا يساوي الدرجة القصوى',
    attempts: 'أداء الطلاب',
    // `count` = students with at least one attempt.
    startedBy: 'لم يبدأه أحد بعد',
    startedBy_one: 'بدأه طالب واحد',
    startedBy_two: 'بدأه طالبان',
    startedBy_few: 'بدأه {{count}} طلاب',
    startedBy_many: 'بدأه {{count}} طالباً',
    startedBy_other: 'بدأه {{count}} طالب',
    inProgress: 'محاولات جارية: {{value}}',
    finished: 'محاولات منتهية: {{value}}',
  },

  // What keeps an online draft from being made available (`exam.online.problems` — the server's list, at its clock).
  readiness: {
    title: 'ما يمنع إتاحة الاختبار الآن',
    ready: 'الاختبار جاهز: اختر «جدولة» من إجراءات الاختبار ليُتاح للطلاب في نافذته.',
    problems: {
      no_questions: 'لا أسئلة مرتبطة بالاختبار',
      questions_not_ready: 'بعض الأسئلة المرتبطة ليست جاهزة في بنكها',
      points_mismatch: 'مجموع نقاط الأسئلة ({{total}}) لا يساوي الدرجة القصوى ({{max}})',
      points_mismatch_plain: 'مجموع نقاط الأسئلة لا يساوي الدرجة القصوى',
      window_missing: 'لم يُحدَّد موعدا الفتح والإغلاق',
      duration_missing: 'لم تُحدَّد مدة المحاولة',
      window_closed: 'موعد الإغلاق قد مضى',
    },
    fix: {
      questions: 'يُعالَج في تبويب «الأسئلة»',
      settings: 'يُعالَج من «تعديل»',
    },
    openQuestions: 'افتح تبويب الأسئلة',
    openEdit: 'عدّل إعدادات الاختبار',
  },

  // The status hint above the tabs, for an online exam.
  statusHint: {
    draft: 'الاختبار مسودة: لا يراه الطلاب. اربط أسئلته وحدّد نافذته ومدة المحاولة، ثم جدوِله ليُتاح لهم.',
    scheduled: 'الاختبار متاح: يؤدّيه الطلاب على المنصة بين موعدَي الفتح والإغلاق، وأسئلته مثبّتة.',
    published: 'النتائج منشورة: يرى كل طالب نتيجته، ولا تبدأ محاولات جديدة.',
  },

  // What each status action means for an online exam (the confirmation of the actions menu).
  confirm: {
    schedule:
      'يُتاح الاختبار للطلاب فيؤدّونه على المنصة بين موعدَي الفتح والإغلاق. تُؤخذ عند الإتاحة نسخة ثابتة من أسئلته يُصحَّح منها، فتعديل بنك الأسئلة بعدها لا يغيّر هذا الاختبار.',
    unschedule: 'يعود الاختبار مسودة فلا يراه الطلاب، وتعود أسئلته تتبع بنكها. لا يعود مسودةً اختبارٌ بدأه أحد الطلاب.',
    publish: 'تُنشر النتائج فيرى كل طالب نتيجته، ولا تبدأ بعدها محاولات جديدة. يُشترط أن تكون نافذة الاختبار قد أُغلقت؛ وأي محاولة ما زالت مفتوحة تُغلق وتُصحَّح بما حُفظ منها.',
    unpublish: 'تُخفى النتائج المنشورة ويعود الاختبار مجدولاً. إن كان يُظهر النتيجة فور التسليم بقيت درجة كل طالب ظاهرة له.',
    delete: 'يُحذف الاختبار نهائياً ولا يمكن التراجع. لا يُحذف اختبار إلكتروني بدأه أحد الطلاب.',
    unsavedQuestions: 'في تبويب «الأسئلة» تغييرات لم تُحفظ: الإتاحة تعتمد القائمة المحفوظة، وهذه التغييرات تُفقد. احفظها أولاً إن أردتها.',
  },

  // Refusals of API-115..API-118 for an online exam.
  errors: {
    online_settings_not_allowed: 'هذه الإعدادات تخصّ الاختبار الإلكتروني وحده {{list}}',
    window_invalid: 'موعد الإغلاق يجب أن يكون بعد موعد الفتح.',
    exam_not_online: 'هذا الاختبار ليس إلكترونياً.',
    exam_not_ready: 'لا يُتاح الاختبار بعد: {{list}}.',
    notReadyTitle: 'لا يُتاح الاختبار بعد',
    problemSeparator: '؛ ',
    exam_has_attempts: 'بدأ بعض الطلاب هذا الاختبار (عدد المحاولات: {{attempts}}) فلا يعود مسودة؛ أُعيد تحميله.',
    exam_window_open: 'نافذة الاختبار لم تُغلق بعد: تُنشر النتائج بعد إغلاقها في {{when}}.',
    exam_window_open_undated: 'تُنشر النتائج بعد أن تُغلق نافذة الاختبار.',
    exam_not_deletable: 'بدأ بعض الطلاب هذا الاختبار الإلكتروني (عدد المحاولات: {{attempts}}) فلا يُحذف؛ أُعيد تحميله.',
  },

  // Shared words of the questions tab.
  types: {
    single_choice: 'اختيار من متعدد',
    true_false: 'صح أو خطأ',
  },
  questionStatus: {
    draft: 'مسودة',
    ready: 'جاهز',
    archived: 'مؤرشف',
  },
  answers: {
    true: 'صحيح',
    false: 'خطأ',
  },
  questions: {
    refresh: 'تحديث',
    loadError: 'تعذّر تحميل أسئلة الاختبار.',
    question: 'السؤال {{number}}',
    points: 'النقاط: {{points}}',
    bank: 'البنك: {{name}}',
  },

  // The editor of the ordered question set (a draft, with `exams.manage` and `questions.manage`).
  editor: {
    intro: 'أسئلة الاختبار بترتيب عرضها على الطلاب. تُختار من الأسئلة الجاهزة في بنوك الأسئلة، ولكل سؤال نقاطه في هذا الاختبار.',
    count: 'الأسئلة: {{value}} من {{max}}',
    total: 'مجموع النقاط {{total}} من {{max}}',
    totalMatch: 'يساوي الدرجة القصوى',
    totalMismatch: 'لا يساوي الدرجة القصوى — لا يُتاح الاختبار حتى يتساويا',
    add: 'إضافة أسئلة',
    maxReached: 'بلغ الاختبار الحد الأقصى ({{max}} سؤال)',
    save: 'حفظ الأسئلة',
    saved: 'تم حفظ أسئلة الاختبار',
    discard: 'تراجع عن التغييرات',
    discardConfirm: 'تُفقد تغييرات الأسئلة غير المحفوظة. أتتراجع عنها؟',
    unsaved: 'في القائمة تغييرات غير محفوظة',
    nothingChanged: 'لا تغييرات للحفظ',
    empty: 'لا أسئلة في هذا الاختبار بعد. أضف أسئلة جاهزة من بنك الأسئلة.',
    pointsLabel: 'النقاط',
    pointsOf: 'نقاط السؤال {{number}}',
    moveUp: 'تحريك السؤال {{number}} إلى أعلى',
    moveDown: 'تحريك السؤال {{number}} إلى أسفل',
    remove: 'إزالة السؤال {{number}} من الاختبار',
    newRow: 'لم يُحفظ بعد',
    notReady: 'حالة السؤال في بنكه الآن «{{status}}»: أعده جاهزاً هناك أو أزله من الاختبار؛ فلا تُحفظ القائمة ولا يُتاح الاختبار وهو فيها.',
    serverNotReady: 'بحسب الخادم بعض الأسئلة المرتبطة ليست جاهزة في بنكها: أعدها جاهزة هناك أو أزلها من الاختبار.',
    fixRows: 'صحّح نقاط الأسئلة المعلَّمة قبل الحفظ.',
    pointsRequired: 'أدخل النقاط',
    pointsInvalid: 'من {{min}} إلى {{max}} بمنزلتين عشريتين على الأكثر',
    readOnlyKeys: 'للقراءة فقط: تعديل أسئلة الاختبار يحتاج الصلاحيتين exams.manage وquestions.manage معاً.',
    readOnlyClass: 'الفصل ملغى: أسئلة اختباراته للقراءة فقط.',
    refused: {
      not_found: 'غير موجود أو في بنك لا تراه',
      not_ready: 'ليس جاهزاً',
      duplicate: 'مكرّر',
    },
    errors: {
      exam_questions_invalid: 'لم يُحفظ شيء: تكرّر سؤال في القائمة (عدد المكرّر: {{value}}). عُلِّمت صفوفه.',
      exam_questions_locked: 'لم يعد الاختبار مسودة، فأسئلته مثبّتة ولا تتغيّر. أُعيد تحميله.',
      question_not_found: 'لم يُحفظ شيء: أسئلة لم تعد موجودة أو صارت في بنك لا تراه (عددها {{value}}). عُلِّمت صفوفها — أزلها ثم احفظ.',
      question_not_ready: 'لم يُحفظ شيء: أسئلة ليست جاهزة في بنكها (عددها {{value}}). عُلِّمت صفوفها — أعدها جاهزة هناك أو أزلها ثم احفظ.',
      class_closed: 'أُلغي فصل هذا الاختبار، فلا تُعدَّل أسئلته. أُعيد تحميله.',
      exam_not_online: 'لم يعد هذا الاختبار إلكترونياً، فلا أسئلة له. أُعيد تحميله.',
      too_large: 'الطلب أكبر من الحد المسموح؛ أزل بعض الأسئلة ثم احفظ.',
      too_many: 'أكثر من {{max}} سؤال: أزل ما زاد قبل الحفظ.',
    },
  },

  // The read-only view once the exam is scheduled or published: the frozen copies with their key.
  frozen: {
    note: 'هذه هي النسخ التي تُعرض على الطلاب ويُصحَّح منها. أُخذت عند إتاحة الاختبار، وتعديل بنك الأسئلة بعدها لا يغيّر هذا الاختبار.',
    summary: 'الأسئلة: {{value}} · مجموع النقاط {{total}} من {{max}}',
    correct: 'الإجابة الصحيحة',
    noKey: 'لا مفتاح مسجَّلاً لهذا السؤال',
    explanation: 'التفسير',
    corrections: 'تصحيحات المفتاح',
    correctKey: 'تصحيح المفتاح',
    correctKeyOf: 'تصحيح مفتاح السؤال {{number}}',
    classCancelled: 'الفصل ملغى: لا يُصحَّح مفتاح اختباراته.',
    empty: 'لا أسئلة في هذا الاختبار.',
  },

  // «تصحيح المفتاح» (API-272).
  key: {
    title: 'تصحيح مفتاح السؤال {{number}}',
    answer: 'الإجابة الصحيحة فعلاً',
    current: 'المفتاح الحالي',
    answerRequired: 'اختر الإجابة الصحيحة',
    reason: 'سبب التصحيح',
    reasonHint: 'مطلوب؛ يُحفظ مع السؤال وفي سجل التدقيق',
    reasonRequired: 'اكتب سبب التصحيح',
    reasonMax: 'السبب حتى {{max}} حرف',
    effectTitle: 'ماذا يحدث عند التصحيح؟',
    effect: 'يُعاد تصحيح كل محاولة منتهية بالمفتاح الجديد، وقد تتغيّر درجات الطلاب ونتائجهم، ويُسجَّل السبب مع السؤال وفي سجل التدقيق. السؤال في بنكه لا يتغيّر.',
    submit: 'صحِّح المفتاح وأعد التصحيح',
    done: 'صُحِّح مفتاح السؤال {{number}}: {{attempts}}، و{{changed}}، و{{results}}.',
    unchanged: 'المفتاح لم يتغيّر: الإجابة المختارة هي المسجَّلة أصلاً للسؤال {{number}}.',
    // `count` = finished attempts graded again.
    regraded: 'لا محاولات منتهية يُعاد تصحيحها',
    regraded_one: 'أُعيد تصحيح محاولة واحدة',
    regraded_two: 'أُعيد تصحيح محاولتين',
    regraded_few: 'أُعيد تصحيح {{count}} محاولات',
    regraded_many: 'أُعيد تصحيح {{count}} محاولة',
    regraded_other: 'أُعيد تصحيح {{count}} محاولة',
    // `count` = attempts whose grading changed.
    changedAttempts: 'لم يتغيّر تصحيح أي محاولة',
    changedAttempts_one: 'تغيّر تصحيح محاولة واحدة',
    changedAttempts_two: 'تغيّر تصحيح محاولتين',
    changedAttempts_few: 'تغيّر تصحيح {{count}} محاولات',
    changedAttempts_many: 'تغيّر تصحيح {{count}} محاولة',
    changedAttempts_other: 'تغيّر تصحيح {{count}} محاولة',
    // `count` = students whose counted result changed.
    changedResults: 'لم تتغيّر نتيجة أي طالب',
    changedResults_one: 'تغيّرت نتيجة طالب واحد',
    changedResults_two: 'تغيّرت نتيجة طالبين',
    changedResults_few: 'تغيّرت نتيجة {{count}} طلاب',
    changedResults_many: 'تغيّرت نتيجة {{count}} طالباً',
    changedResults_other: 'تغيّرت نتيجة {{count}} طالب',
    discard: {
      title: 'تجاهل التصحيح الذي لم يُرسَل؟',
      content: 'كتبتَ سبباً أو اخترت إجابة ولم تُرسل التصحيح بعد. إغلاق النافذة يتجاهله.',
      ok: 'تجاهل وإغلاق',
      cancel: 'متابعة التصحيح',
    },
    errors: {
      key_invalid: {
        option_required: 'اختر خياراً من خيارات السؤال ليكون الإجابة الصحيحة.',
        option_unknown: 'الخيار المختار لم يعد من خيارات هذا السؤال. أُعيد تحميل الأسئلة.',
        answer_required: 'اختر «صحيح» أو «خطأ» ليكون الإجابة الصحيحة.',
        not_allowed_for_type: 'المفتاح المرسَل لا يلائم نوع هذا السؤال. أُعيد تحميل الأسئلة.',
        unknown: 'المفتاح المرسَل لا يلائم هذا السؤال.',
      },
      grades_certified: 'في فصل هذا الاختبار شهادات صادرة (عددها {{value}}): ما بُنيت عليه شهادة لا يُعاد تصحيحه. ألغِ الشهادات أولاً إن لزم التصحيح.',
      exam_not_frozen: 'عاد الاختبار مسودة، فلا نسخة مثبّتة يُصحَّح مفتاحها. أُعيد تحميله.',
      exam_not_online: 'لم يعد هذا الاختبار إلكترونياً. أُعيد تحميله.',
      class_closed: 'أُلغي فصل هذا الاختبار، فلا يُصحَّح مفتاحه. أُعيد تحميله.',
      question_not_found: 'هذا السؤال لم يعد من أسئلة الاختبار. أُعيد تحميل الأسئلة.',
    },
  },

  // «معاينة كطالب».
  preview: {
    open: 'معاينة كطالب',
    title: 'معاينة «{{title}}» كما يراه الطالب',
    note: 'معاينة فقط: لا تُسجَّل محاولة ولا إجابة، ولا تظهر فيها الإجابات الصحيحة.',
    saveFirst: 'احفظ الأسئلة أولاً: المعاينة تعرض القائمة المحفوظة.',
    empty: 'لا أسئلة لمعاينتها بعد.',
    question: 'السؤال {{number}} من {{total}}',
    close: 'إغلاق',
  },

  // «إضافة أسئلة» — the picker of ready bank questions.
  picker: {
    title: 'إضافة أسئلة من بنك الأسئلة',
    bank: 'بنك الأسئلة',
    bankPlaceholder: 'ابحث عن بنك بالاسم',
    noBanks: 'لا بنوك مطابقة',
    bankOption: '{{name}} (الجاهز: {{ready}})',
    chooseBank: 'اختر بنكاً لعرض أسئلته الجاهزة.',
    search: 'بحث في نص السؤال',
    onlyReady: 'تُعرض الأسئلة الجاهزة وحدها: المسودة والمؤرشفة لا تُربطان باختبار.',
    empty: 'لا أسئلة جاهزة في هذا البنك',
    emptySearch: 'لا أسئلة جاهزة تطابق البحث',
    added: 'مضاف',
    loadMore: 'تحميل المزيد',
    loadError: 'تعذّر تحميل الأسئلة.',
    retry: 'إعادة المحاولة',
    selected: 'المحدَّد: {{value}}',
    room: 'المتاح للإضافة: {{value}} (الحد الأقصى للاختبار {{max}} سؤال)',
    full: 'بلغ الاختبار مع المحدَّد حدّه الأقصى ({{max}} سؤال)',
    submit: 'إضافة المحدَّد ({{value}})',
  },
}
