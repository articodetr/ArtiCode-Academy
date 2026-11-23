// MOD-09 phase 2 (roadmap §4r — OEX-T07): taking an online exam — the start/resume controls of «my exams» and the exam page (/take-exam/:attemptId).
// English in ../en/takeExam.ts with the same keys (`Translation = typeof ar`).
// i18next plurals (CH-0297): a counted Arabic string carries the six forms (`_one`, `_two`, `_few`, `_many`, `_other`
// and the plain key for 0), and `count` is always a number.

export const takeExam = {
  title: 'أداء الاختبار',

  // «اختباراتي»: the online side of a row (API-121 `online`). The exam's type, status and released result keep their
  // `exams.*` / `labels.*` / `myExams.*` texts.
  list: {
    onlineTag: 'إلكتروني',
    opensAt: 'يفتح:',
    closesAt: 'يغلق:',
    // `count` = the minutes one attempt may take (1..720).
    attemptMinutes: 'مدة المحاولة غير محددة',
    attemptMinutes_one: 'مدة المحاولة: دقيقة واحدة',
    attemptMinutes_two: 'مدة المحاولة: دقيقتان',
    attemptMinutes_few: 'مدة المحاولة: {{count}} دقائق',
    attemptMinutes_many: 'مدة المحاولة: {{count}} دقيقة',
    attemptMinutes_other: 'مدة المحاولة: {{count}} دقيقة',
    // `count` = the questions of the exam.
    questions: 'بلا أسئلة',
    questions_one: 'سؤال واحد',
    questions_two: 'سؤالان',
    questions_few: '{{count}} أسئلة',
    questions_many: '{{count}} سؤالاً',
    questions_other: '{{count}} سؤال',
    attemptsUsed: 'المحاولات: {{used}} من {{allowed}}',
    start: 'ابدأ الاختبار',
    resume: 'متابعة الاختبار',
    timeLeft: 'الوقت المتبقي:',
    timeOver: 'انتهى وقت هذه المحاولة. نحدّث القائمة…',
    unavailable: 'أداء الاختبار غير متاح الآن.',
    // Why the exam cannot be taken now (`online.blocker`, in the server's order).
    blocked: {
      not_self: 'يؤدّي الطالب هذا الاختبار من حسابه هو.',
      not_permitted: 'حسابك لا يملك صلاحية أداء الاختبارات. راجع إدارة الأكاديمية.',
      results_published: 'نُشرت النتائج، فلم يعد أداء الاختبار متاحاً.',
      not_enrolled: 'أداء الاختبار يتطلب تسجيلاً نشطاً في الفصل.',
      class_closed: 'الفصل ملغى، فلا يُؤدّى هذا الاختبار.',
      not_open_yet: 'لم يفتح الاختبار بعد.',
      not_open_yet_at: 'يفتح الاختبار في {{date}}.',
      closed: 'انتهى موعد الاختبار.',
      closed_at: 'أُغلق الاختبار في {{date}}.',
      attempts_exhausted: 'استنفدت محاولاتك ({{used}} من {{allowed}}).',
    },
    result: {
      afterSubmit: 'تظهر نتيجتك فور تسليم المحاولة',
    },
    attemptsTitle: 'المحاولات',
    attempt: 'المحاولة {{number}}',
    attemptStatus: {
      in_progress: 'جارية',
      submitted: 'سُلّمت',
      timed_out: 'انتهى وقتها',
    },
    viewAttempt: 'عرض المحاولة',
    openAttempt: 'فتح المحاولة',
    // The accessible name of a link names its attempt («عرض المحاولة 2»).
    viewAttemptOf: 'عرض المحاولة {{number}}',
    openAttemptOf: 'فتح المحاولة {{number}}',
  },

  // The confirmation before an attempt starts (API-276).
  start: {
    title: 'بدء الاختبار',
    intro: 'قبل أن تبدأ «{{title}}»، اقرأ ما يلي:',
    rules: {
      // `count` = the minutes one attempt may take (1..720); an exam without a limit reads `durationUnknown`.
      duration: 'يبدأ الوقت فور الضغط على «ابدأ الآن».',
      duration_one: 'لديك دقيقة واحدة، تبدأ فور الضغط على «ابدأ الآن».',
      duration_two: 'لديك دقيقتان، تبدآن فور الضغط على «ابدأ الآن».',
      duration_few: 'لديك {{count}} دقائق، تبدأ فور الضغط على «ابدأ الآن».',
      duration_many: 'لديك {{count}} دقيقة، تبدأ فور الضغط على «ابدأ الآن».',
      duration_other: 'لديك {{count}} دقيقة، تبدأ فور الضغط على «ابدأ الآن».',
      durationUnknown: 'يبدأ الوقت فور الضغط على «ابدأ الآن».',
      closes: 'لا يمتد وقتك بعد موعد إغلاق الاختبار ({{date}})، حتى لو بدأت قبله بقليل.',
      // `count` = the questions of the exam.
      questions: 'لا أسئلة في هذا الاختبار.',
      questions_one: 'في الاختبار سؤال واحد.',
      questions_two: 'في الاختبار سؤالان.',
      questions_few: 'في الاختبار {{count}} أسئلة.',
      questions_many: 'في الاختبار {{count}} سؤالاً.',
      questions_other: 'في الاختبار {{count}} سؤال.',
      clock: 'الوقت يُحسب على الخادم ولا يتوقف: إن أغلقت الصفحة أو انقطع اتصالك استمر العدّ، وتستطيع العودة والمتابعة ما دام الوقت باقياً.',
      autosave: 'إجاباتك تُحفظ تلقائياً أثناء الحل.',
      attempt: 'هذه محاولتك {{number}} من {{allowed}}.',
      lastAttempt: 'هذه محاولتك {{number}} من {{allowed}}، وهي الأخيرة.',
      highestCounts: 'تُحتسب لك أعلى محاولاتك درجة.',
      final: 'التسليم نهائي: لا يمكن تغيير الإجابات بعده.',
    },
    ok: 'ابدأ الآن',
    cancel: 'ليس الآن',
    close: 'إغلاق',
    // After a refusal that no second try can change: the list was read again.
    refreshed: 'حدّثنا القائمة لتظهر حالة الاختبار الحالية.',
    // After a failure a second try may fix: the same attempt number is sent again.
    retryHint: 'يمكنك المحاولة من جديد: لن تُحتسب عليك محاولة ثانية.',
  },

  // Refusals of API-276..API-279 (backend/src/grades/grades.errors.ts) and the guards.
  errors: {
    exam_not_found: 'هذا الاختبار غير متاح لك: ربما أُلغيت جدولته، أو لم تعد مسجَّلاً في فصله.',
    enrollment_required: 'أداء الاختبار يتطلب تسجيلاً نشطاً في الفصل.',
    enrollment_required_status: 'أداء الاختبار يتطلب تسجيلاً نشطاً في الفصل، وتسجيلك الآن «{{status}}».',
    not_open_yet: 'لم يفتح الاختبار بعد.',
    not_open_yet_at: 'لم يفتح الاختبار بعد: يفتح في {{date}}.',
    closed: 'انتهى موعد الاختبار.',
    closed_at: 'انتهى موعد الاختبار: أُغلق في {{date}}.',
    results_published: 'نُشرت نتائج هذا الاختبار، فلم يعد أداؤه متاحاً.',
    attempts_exhausted: 'استنفدت محاولاتك في هذا الاختبار.',
    attempts_exhausted_count: 'استنفدت محاولاتك في هذا الاختبار ({{attempts}} من {{allowed}}).',
    class_closed: 'الفصل ملغى، فلا يُؤدّى هذا الاختبار.',
    permission_denied: 'حسابك لا يملك صلاحية أداء الاختبارات. راجع إدارة الأكاديمية.',
    rate_limited: 'طلبات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مجدداً.',
    attempt_conflict: 'تغيّرت حالة محاولاتك للتوّ: بدأت محاولة أو انتهت أخرى.',
    attempt_not_found: 'هذه المحاولة غير موجودة أو ليست لحسابك.',
    attempt_closed: 'أُغلقت هذه المحاولة ولم تعد تقبل إجابات.',
    answers_invalid: 'لم يقبل الخادم بعض الإجابات لأن الصفحة لم تعد مطابقة لأسئلة الاختبار.',
    origin_forbidden: 'رفض الخادم مصدر الطلب. أعد تحميل الصفحة ثم حاول مجدداً.',
    session: 'انتهت جلستك. سجّل الدخول من جديد لتتابع الاختبار — الوقت مستمر.',
  },

  // The exam page.
  page: {
    back: 'العودة إلى اختباراتي',
    attemptNo: 'المحاولة {{number}}',
    loading: 'جارٍ تحميل الاختبار…',
    loadFailed: 'تعذّر تحميل المحاولة',
    retry: 'إعادة المحاولة',
    notFoundTitle: 'المحاولة غير موجودة',
    notFoundText: 'هذه المحاولة غير موجودة أو ليست لحسابك. عُد إلى اختباراتك وافتحها من هناك.',
    instructions: 'تعليمات الاختبار',
    leaveNote: 'تستطيع مغادرة الصفحة والعودة لاحقاً: إجاباتك المحفوظة تبقى، والمغادرة لا تسلّم الاختبار — لكن الوقت يستمر ولا يتوقف.',
    answersReset: 'لم تعد الصفحة مطابقة لأسئلة الاختبار، فأعدنا تحميلها بإجاباتك المحفوظة. راجع إجاباتك قبل التسليم.',
  },

  timer: {
    label: 'الوقت المتبقي',
    over: 'انتهى الوقت',
    // What a screen reader is told, once a minute; `count` = the minutes left, rounded up (1 and more — zero reads `over`).
    spoken: 'انتهى الوقت',
    spoken_one: 'بقيت دقيقة واحدة',
    spoken_two: 'بقيت دقيقتان',
    spoken_few: 'بقيت {{count}} دقائق',
    spoken_many: 'بقيت {{count}} دقيقة',
    spoken_other: 'بقيت {{count}} دقيقة',
  },

  save: {
    saving: 'يُحفظ…',
    saved: 'حُفظت كل الإجابات',
    retrying: 'تعذّر الحفظ — نعيد المحاولة',
    held: 'تعذّر الحفظ',
    retry: 'إعادة المحاولة',
    // Under a failed save: the answers are still on this page.
    keptHere: 'إجاباتك باقية في هذه الصفحة، ونحفظها فور نجاح الاتصال. لا تغلق الصفحة قبل ذلك.',
    // Told to a screen reader when saving works again.
    recovered: 'عاد الحفظ: حُفظت كل الإجابات',
  },

  question: {
    heading: 'السؤال {{number}} من {{total}}',
    points: 'درجة السؤال: {{points}}',
    trueOption: 'صحيح',
    falseOption: 'خطأ',
    clear: 'مسح الإجابة',
    previous: 'السابق',
    next: 'التالي',
    steps: 'التنقل بين الأسئلة',
    noOptions: 'لا خيارات لهذا السؤال.',
    none: 'لا أسئلة في هذه المحاولة.',
  },

  navigator: {
    title: 'الأسئلة',
    progress: 'الإجابات: {{answered}} من {{total}}',
    // The accessible name of a numbered button.
    answered: 'السؤال {{number}}، مُجاب',
    unanswered: 'السؤال {{number}}، غير مُجاب',
    legendAnswered: 'مُجاب',
    legendUnanswered: 'غير مُجاب',
    legendCurrent: 'السؤال الحالي',
  },

  review: {
    open: 'مراجعة وتسليم',
    title: 'مراجعة قبل التسليم',
    summary: 'أجبت عن {{answered}} من {{total}}.',
    allAnswered: 'أجبت عن كل الأسئلة.',
    // `count` = the questions without an answer (never 0 where this is shown).
    unanswered: 'لا أسئلة بلا إجابة.',
    unanswered_one: 'بقي سؤال واحد بلا إجابة:',
    unanswered_two: 'بقي سؤالان بلا إجابة:',
    unanswered_few: 'بقيت {{count}} أسئلة بلا إجابة:',
    unanswered_many: 'بقي {{count}} سؤالاً بلا إجابة:',
    unanswered_other: 'بقي {{count}} سؤال بلا إجابة:',
    unansweredHint: 'اضغط رقم السؤال للعودة إليه.',
    questionButton: 'السؤال {{number}}',
    back: 'العودة إلى الأسئلة',
    waitingSave: 'ننتظر حفظ آخر إجاباتك…',
    unsavedWarning: 'بعض إجاباتك لم يُحفظ بعد. لن نسلّم الاختبار قبل أن يُحفظ.',
  },

  submit: {
    button: 'تسليم الاختبار',
    submitting: 'جارٍ تسليم الاختبار…',
    confirmTitle: 'تسليم الاختبار؟',
    confirmFinal: 'التسليم نهائي ولا يمكن تغيير الإجابات بعده.',
    // `count` = the questions without an answer (1 and more — with none the dialog reads `review.allAnswered`).
    confirmUnanswered: 'أجبت عن كل الأسئلة.',
    confirmUnanswered_one: 'ما زال سؤال واحد بلا إجابة.',
    confirmUnanswered_two: 'ما زال سؤالان بلا إجابة.',
    confirmUnanswered_few: 'ما زالت {{count}} أسئلة بلا إجابة.',
    confirmUnanswered_many: 'ما زال {{count}} سؤالاً بلا إجابة.',
    confirmUnanswered_other: 'ما زال {{count}} سؤال بلا إجابة.',
    confirmOk: 'نعم، سلّم الآن',
    confirmCancel: 'ليس بعد',
    unsavedBlocked: 'لم نسلّم الاختبار لأن بعض إجاباتك لم يُحفظ بعد. تحقّق من اتصالك، ثم اضغط «تسليم الاختبار» من جديد.',
    failed: 'تعذّر تسليم الاختبار. إجاباتك المحفوظة في أمان — حاول مجدداً.',
  },

  // The time ran out, or the attempt closed, while this page was open.
  timeUp: {
    closing: 'انتهى الوقت. نحفظ آخر إجاباتك ونغلق المحاولة…',
    stalledTitle: 'انتهى الوقت',
    stalledText: 'إجاباتك المحفوظة في أمان. تعذّر الوصول إلى الخادم الآن، وهو يغلق المحاولة تلقائياً خلال دقيقة تقريباً بما حُفظ فيها.',
    closedTitle: 'أُغلقت هذه المحاولة',
    closedText: 'لم تعد المحاولة تقبل إجابات: انتهى وقتها أو سُلّمت من قبل. ما حُفظ قبل ذلك هو المعتمد، لكن تعذّر تحميل حالتها الآن.',
    refresh: 'تحديث',
    refreshFailed: 'ما زال الخادم بعيد المنال. انتظر لحظات ثم اضغط «تحديث» من جديد.',
  },

  finished: {
    submittedTitle: 'سُلّم الاختبار',
    timedOutTitle: 'انتهى الوقت',
    submittedAt: 'سُلّمت في {{date}}',
    timedOut: 'انتهى الوقت — أُغلقت المحاولة بما حُفظ',
    // Notices for an attempt that ended while this page was open.
    endedByClock: 'انتهى الوقت، وأُغلقت المحاولة بإجاباتك المحفوظة.',
    endedElsewhere: 'أُغلقت هذه المحاولة أثناء عملك عليها: انتهى وقتها أو سُلّمت من مكان آخر. ما حُفظ قبل الإغلاق هو المعتمد.',
    lostAnswers: 'لم يصل آخر تعديل لك إلى الخادم قبل الإغلاق في: {{list}}. المعتمد لهذه الأسئلة ما حُفظ قبله.',
    lostSeparator: '، ',
  },

  result: {
    title: 'نتيجتك',
    score: 'الدرجة',
    correct: 'الإجابات الصحيحة',
    passScore: 'درجة النجاح',
    passed: 'بلغت درجة النجاح',
    failed: 'دون درجة النجاح',
    counted: 'هذه المحاولة هي المحتسبة: أعلى محاولاتك درجة.',
    notCounted: 'تُحتسب لك محاولة أخرى أعلى درجة.',
    awaiting: 'نتيجتك تظهر عندما ينشر المعلم النتائج.',
  },

  // The questions of a finished attempt: the learner's own answers always; the key only when the server sent it.
  answers: {
    title: 'إجاباتك',
    reviewTitle: 'مراجعة الإجابات',
    pendingClose: 'تظهر الإجابات الصحيحة وشرحها هنا بعد إغلاق الاختبار.',
    pendingCloseAt: 'تظهر الإجابات الصحيحة وشرحها هنا بعد إغلاق الاختبار ({{date}}).',
    pendingPublish: 'تظهر الإجابات الصحيحة وشرحها هنا بعد إغلاق الاختبار ونشر النتائج.',
    question: 'السؤال {{number}}',
    yourChoice: 'اختيارك',
    notAnswered: 'لم تُجب عن هذا السؤال',
    correctAnswer: 'الإجابة الصحيحة',
    correct: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    pointsAwarded: 'الدرجة المحصّلة:',
    explanation: 'الشرح',
  },

  attempts: {
    title: 'محاولاتك في هذا الاختبار',
    current: 'هذه المحاولة',
  },

  // Leaving the page while some answers have not reached the server (useUnsavedChangesGuard).
  leave: {
    unsaved: {
      title: 'إجابات لم تُحفظ بعد',
      content: 'بعض إجاباتك لم يصل إلى الخادم بعد، وقد يضيع إن غادرت الآن. والوقت يستمر في كل الأحوال.',
      ok: 'مغادرة على أي حال',
      cancel: 'البقاء في الاختبار',
    },
  },
}
