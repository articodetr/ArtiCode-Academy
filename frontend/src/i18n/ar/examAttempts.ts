// MOD-09 phase 2 (roadmap §4r — OEX-T07): the «المحاولات» tab of the exam drawer — the teacher’s view of the attempts
// (API-273..API-275) — and what the results sheet says about an online exam (`sheet.*`, `source.*` — API-119/API-120).
// English in ../en/examAttempts.ts with the same keys (`Translation = typeof ar`).
// i18next plurals (CH-0297): a counted Arabic string carries the six forms (`_one`, `_two`, `_few`, `_many`, `_other`
// and the plain key for 0), and `count` is always a number.

export const examAttempts = {
  tab: 'المحاولات',
  refresh: 'تحديث',
  retry: 'إعادة المحاولة',
  // «7.25 من 10»: each number sits in its own <bdi dir="ltr">, this word between them (examAttempts.parts.tsx).
  outOf: 'من',
  draft: 'الاختبار مسودة: لا يراه الطلاب ولا تبدأ محاولاته قبل إتاحته.',
  // `time` = the server clock of the answer (API-274 `serverNow`) in the exam's zone.
  asOf: 'هذه القراءة عند {{time}} بساعة الخادم. لا تتحدّث الصفحة من تلقاء نفسها؛ اضغط «تحديث» لقراءة جديدة.',
  zone: 'الأوقات بتوقيت الاختبار',
  window: {
    title: 'نافذة الاختبار:',
    state: {
      not_open: 'لم تُفتح',
      open: 'مفتوحة',
      closed: 'أُغلقت',
    },
    opensAt: 'الفتح:',
    closesAt: 'الإغلاق:',
    unset: 'لم يُحدَّد',
  },
  stats: {
    title: 'أرقام الاختبار',
    students: 'الطلاب',
    started: 'بدأوا',
    inProgress: 'محاولتهم جارية',
    finished: 'أنهوا',
    notStarted: 'لم يبدؤوا',
    mean: 'متوسط الدرجات',
    highest: 'أعلى درجة',
    lowest: 'أدنى درجة',
    passScore: 'درجة النجاح',
    passed: 'ناجحون',
    failed: 'لم ينجحوا',
    passRate: 'نسبة النجاح',
    noPassScore: 'لم تُحدَّد لهذا الاختبار درجة نجاح، فلا عدد للناجحين ولا نسبة نجاح.',
    countedNote:
      'كل الأرقام من الخادم. المتوسط والأعلى والأدنى والنجاح على الدرجة المحتسَبة لكل طالب أنهى محاولة: أعلى محاولاته المنتهية، والأسبق عند التعادل.',
  },
  questions: {
    title: 'أداء الأسئلة',
    // `count` = the exam's questions (API-274 `questionCount`).
    count: 'لا أسئلة',
    count_one: 'سؤال واحد',
    count_two: 'سؤالان',
    count_few: '{{count}} أسئلة',
    count_many: '{{count}} سؤالاً',
    count_other: '{{count}} سؤال',
    hint: 'على المحاولة المحتسَبة لكل طالب أنهى الاختبار؛ العددان من الخادم كما هما.',
    countedAttempts: 'المحاولات المحتسَبة:',
    number: 'السؤال {{number}}',
    columns: {
      question: 'السؤال',
      points: 'النقاط',
      answered: 'أجابوا عنه',
      correct: 'أجابوا صحيحاً',
    },
    empty: 'لا أسئلة في هذا الاختبار بعد',
  },
  roster: {
    title: 'الطلاب ومحاولاتهم',
    filter: 'تصفية الطلاب',
    filters: {
      all: 'كل الطلاب',
      notStarted: 'لم يبدؤوا',
      inProgress: 'محاولتهم جارية',
      finished: 'أنهوا محاولة',
    },
    filterLocal: 'التصفية على الكشف المحمَّل، ولا تطلب شيئاً من الخادم.',
    shown: 'يُعرض {{shown}} من {{total}}',
    columns: {
      student: 'الطالب',
      result: 'النتيجة المحتسَبة',
      attempts: 'المحاولات',
    },
    noResult: 'لا نتيجة',
    notStarted: 'لم يبدأ',
    attempt: 'المحاولة {{number}}',
    // The accessible name of an attempt's button: «عرض المحاولة 2: سارة الطالبة».
    open: 'عرض المحاولة {{number}}: {{name}}',
    counted: 'المحتسَبة',
    startedAt: 'بدأت:',
    submittedAt: 'سُلّمت:',
    // A `timed_out` attempt: the server closed it at its deadline with what was saved.
    closedAt: 'أُغلقت:',
    deadline: 'موعدها النهائي:',
    timeUp: 'انتهى الوقت — يغلقها الخادم خلال دقيقة',
    nobodyStarted: 'لم يبدأ أحد الاختبار بعد.',
    empty: 'لا طلاب بتسجيل نشط أو مكتمل في هذا الفصل',
    emptyFiltered: 'لا طلاب يطابقون التصفية',
  },
  status: {
    in_progress: 'جارية',
    submitted: 'سُلّمت',
    timed_out: 'انتهى وقتها',
  },
  // Where a result came from (API-119 / API-274 `source`).
  source: {
    online: 'إلكتروني',
    manual: 'يدوي',
  },
  detail: {
    titleOf: 'محاولة {{name}}',
    keyNote: 'في هذه اللوحة مفتاح الإجابات كاملاً؛ لا تعرضها أمام الطلاب.',
    inProgressNote: 'المحاولة جارية: لا يُصحَّح شيء قبل انتهائها. المعلَّم أدناه هو ما حفظه الطالب حتى لحظة هذه القراءة.',
    fields: {
      student: 'الطالب',
      attempt: 'المحاولة',
      status: 'الحالة',
      startedAt: 'بدأت في',
      deadline: 'موعدها النهائي',
      submittedAt: 'سُلّمت في',
      closedAt: 'أُغلقت في',
      score: 'الدرجة',
      correctCount: 'الإجابات الصحيحة',
      counted: 'الاحتساب',
      gradedAt: 'آخر تصحيح',
    },
    attemptNumber: 'رقم {{number}}',
    // Beside the «المحتسَبة» tag (`roster.counted`): what counting means.
    counted: 'درجتها هي نتيجة الطالب',
    notCounted: 'غير محتسَبة: للطالب محاولة أعلى منها، أو أسبق بالدرجة نفسها',
    notCountedYet: 'لا تُحتسب محاولة قبل انتهائها',
    notGraded: 'لم تُصحَّح بعد',
    questionsTitle: 'الأسئلة والإجابات',
    question: 'السؤال {{number}}',
    points: 'النقاط:',
    earned: 'النقاط المحصَّلة:',
    type: {
      single_choice: 'اختيار من متعدد',
      true_false: 'صح أو خطأ',
    },
    trueFalse: {
      true: 'صح',
      false: 'خطأ',
    },
    outcome: {
      correct: 'إجابته صحيحة',
      wrong: 'إجابته خاطئة',
      unanswered: 'لم يُجب',
    },
    key: 'الإجابة الصحيحة',
    chosen: 'إجابة الطالب',
    unanswered: 'لم يُجب الطالب عن هذا السؤال.',
    unansweredYet: 'لم يُجب الطالب عن هذا السؤال بعد.',
    explanation: 'الشرح:',
    noQuestions: 'لا أسئلة في هذه المحاولة',
  },
  regrade: {
    button: 'إعادة التصحيح',
    title: 'إعادة تصحيح المحاولات — {{name}}',
    what: 'تُصحَّح كل محاولة منتهية من جديد من أسئلة الاختبار المثبَّتة كما هي الآن، وتُعاد كتابة النتيجة المحتسَبة لكل طالب تغيّرت درجته.',
    usual: 'التصحيح آلي ولا يختلف من مرة إلى أخرى، فالمعتاد ألا يتغيّر شيء — وعندها لا يُكتب شيء ولا يُسجَّل شيء.',
    stale: 'إن تغيّرت نتيجة طالب بعد تثبيت الدرجات النهائية للفصل ظهرت درجته النهائية «قديمة» إلى أن يُعاد التثبيت.',
    reason: 'سبب إعادة التصحيح',
    reasonHint: 'مطلوب، حتى {{max}} حرف. يُحفظ في سجل التدقيق مع أعداد ما تغيّر.',
    reasonRequired: 'اكتب سبب إعادة التصحيح',
    reasonTooLong: 'السبب حتى {{max}} حرف',
    submit: 'إعادة التصحيح',
    // The «discard?» question of the dialog while a reason is typed (useUnsavedChangesGuard reads these four keys).
    unsaved: {
      title: 'تجاهل السبب المكتوب؟',
      content: 'لم تُرسَل إعادة التصحيح بعد. إغلاق النافذة يتجاهل السبب الذي كتبته.',
      ok: 'تجاهل وإغلاق',
      cancel: 'متابعة الكتابة',
    },
    done: {
      // The server's three counts (API-273), each worded by its own count and joined by `changed` or `unchanged`.
      attempts: 'لم تُفحص أي محاولة',
      attempts_one: 'فُحصت محاولة واحدة',
      attempts_two: 'فُحصت محاولتان',
      attempts_few: 'فُحصت {{count}} محاولات',
      attempts_many: 'فُحصت {{count}} محاولة',
      attempts_other: 'فُحصت {{count}} محاولة',
      changedAttempts: 'لم يتغيّر تصحيح أيٍّ منها',
      changedAttempts_one: 'تغيّر تصحيح واحدة منها',
      changedAttempts_two: 'تغيّر تصحيح اثنتين منها',
      changedAttempts_few: 'تغيّر تصحيح {{count}} منها',
      changedAttempts_many: 'تغيّر تصحيح {{count}} منها',
      changedAttempts_other: 'تغيّر تصحيح {{count}} منها',
      changedResults: 'لم تتغيّر نتيجة أي طالب',
      changedResults_one: 'تغيّرت نتيجة طالب واحد',
      changedResults_two: 'تغيّرت نتيجة طالبين',
      changedResults_few: 'تغيّرت نتيجة {{count}} طلاب',
      changedResults_many: 'تغيّرت نتيجة {{count}} طالباً',
      changedResults_other: 'تغيّرت نتيجة {{count}} طالب',
      changed: '{{attempts}}، و{{changedAttempts}}، و{{changedResults}}.',
      unchanged: '{{attempts}} — لا تغيير.',
      nothing: 'لا محاولات منتهية بعد، فلم يُصحَّح شيء.',
    },
  },
  errors: {
    // `count` = the issued certificates of the class (`grades_certified { certificateCount }`); the plain key when the server names none.
    grades_certified: 'لهذا الفصل شهادات صادرة، وما بُنيت عليه شهادة لا يُعاد تصحيحه ولا تُعاد كتابة نتيجته. تُلغى الشهادات أولاً إن لزمت إعادة التصحيح.',
    grades_certified_one: 'لهذا الفصل شهادة صادرة، وما بُنيت عليه شهادة لا يُعاد تصحيحه ولا تُعاد كتابة نتيجته. تُلغى الشهادة أولاً إن لزمت إعادة التصحيح.',
    grades_certified_two: 'لهذا الفصل شهادتان صادرتان، وما بُنيت عليه شهادة لا يُعاد تصحيحه ولا تُعاد كتابة نتيجته. تُلغى الشهادتان أولاً إن لزمت إعادة التصحيح.',
    grades_certified_few: 'لهذا الفصل {{count}} شهادات صادرة، وما بُنيت عليه شهادة لا يُعاد تصحيحه ولا تُعاد كتابة نتيجته. تُلغى الشهادات أولاً إن لزمت إعادة التصحيح.',
    grades_certified_many: 'لهذا الفصل {{count}} شهادة صادرة، وما بُنيت عليه شهادة لا يُعاد تصحيحه ولا تُعاد كتابة نتيجته. تُلغى الشهادات أولاً إن لزمت إعادة التصحيح.',
    grades_certified_other: 'لهذا الفصل {{count}} شهادة صادرة، وما بُنيت عليه شهادة لا يُعاد تصحيحه ولا تُعاد كتابة نتيجته. تُلغى الشهادات أولاً إن لزمت إعادة التصحيح.',
    exam_not_frozen: 'عاد الاختبار مسودة في مكان آخر: أسئلته غير مثبَّتة ولا محاولات له تُصحَّح. أُعيد تحميله.',
    exam_not_online: 'لم يعد هذا الاختبار إلكترونياً، فلا محاولات له تُصحَّح. أُعيد تحميله.',
    class_closed: 'فصل هذا الاختبار ملغى: لا يُعاد تصحيح محاولاته. أُعيد تحميله.',
    attempt_not_found: 'المحاولة غير موجودة أو ليست في فصل مُسند إليك. أُعيد تحميل الكشف.',
  },
  // The results sheet (ExamResultsTab) of an online exam.
  sheet: {
    note: 'اختبار إلكتروني: نتيجة من أدّاه تأتي من محاولاته ويكتبها الخادم، ولا تُعدَّل هنا. هذا الكشف لمن لا محاولة له: غائب، أو معذور، أو أدّى الاختبار ورقياً.',
    lockedRow: 'له محاولة — نتيجته من محاولاته',
    // In place of «سجّلها {{name}}» for an `online` result: nobody typed it.
    recordedByServer: 'كتبها الخادم',
    errors: {
      result_from_attempt:
        'لم يُحفظ شيء: هؤلاء بدأوا محاولة بعد تحميل الكشف، فنتيجتهم من محاولاتهم ولا تُسجَّل هنا — {{names}}. أُزيلت تغييراتهم وبقيت تغييراتك الأخرى؛ احفظها من جديد.',
      result_from_attempt_unnamed:
        'لم يُحفظ شيء: بدأ بعض الطلاب محاولة بعد تحميل الكشف، فنتيجتهم من محاولاتهم ولا تُسجَّل هنا. أُعيد تحميل الكشف؛ احفظ تغييراتك الأخرى من جديد.',
    },
  },
}
