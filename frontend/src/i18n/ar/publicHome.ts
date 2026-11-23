// PORTAL-04 (#208): the academy's public home page (/home). Generic words around the academy's own name (API-205) — no
// figure, testimonial or contact detail the server does not send, and no claim the product does not keep (the heading
// and its line describe how learning works here: levels and lessons followed step by step, progress in «مدرستي»).
// No self-registration exists yet, so no «أنشئ حسابًا».
export const publicHome = {
  // The page's <meta name="description"> (PublicTitle): the academy's own line, never the product's.
  meta: {
    descriptionNamed: '{{name}} — برامج تعليمية منظّمة في مستويات ودروس، تتابعها خطوة بخطوة وترى تقدّمك فيها في «مدرستي».',
    description: 'برامج تعليمية منظّمة في مستويات ودروس، تتابعها خطوة بخطوة وترى تقدّمك فيها في «مدرستي».',
  },
  hero: {
    welcomeNamed: 'مرحبًا بك في {{name}}',
    welcome: 'مرحبًا بك',
    title: 'تعلّم بخطوات واضحة، وتابع تقدّمك أولًا بأول',
    subtitle: 'برامج تعليمية منظّمة في مستويات ودروس، تتابعها خطوة بخطوة وترى تقدّمك فيها في «مدرستي».',
    browse: 'استعرض البرامج',
    signIn: 'تسجيل الدخول',
    accountsNote: 'الحسابات تُنشأ من إدارة الأكاديمية.',
    mySchool: 'مدرستي',
    dashboard: 'لوحة التحكم',
  },
  programs: {
    title: 'البرامج التعليمية',
    subtitle: 'من برامج الأكاديمية المنشورة: نبذتها ومحتواها ورسومها.',
    all: 'كل البرامج',
    emptyTitle: 'لا توجد برامج بعد',
    empty: 'لا توجد برامج منشورة بعد.',
    loadError: 'تعذّر تحميل البرامج.',
    retry: 'إعادة المحاولة',
    closedVisitor: {
      title: 'البرامج متاحة لأصحاب الحسابات',
      text: 'لا تعرض الأكاديمية برامجها للزوار. سجّل الدخول بحسابك لتتصفّحها.',
    },
    closedLearner: {
      title: 'تصفّح الدورات من حسابك',
      text: 'الأكاديمية لا تعرض برامجها للزوار، وتجد دوراتها المتاحة لك في صفحة الدورات.',
      action: 'صفحة الدورات',
    },
    closedStaff: {
      title: 'التصفح العام مغلق',
      text: 'لا يرى الزوار برامج الأكاديمية لأن تصفّح الدورات للزوار غير مفعّل في الإعدادات.',
      action: 'الإعدادات',
    },
  },
  steps: {
    title: 'كيف تبدأ الدراسة؟',
    subtitle: 'ثلاث خطوات من اختيار البرنامج إلى متابعة دروسك.',
    choose: {
      title: 'اختر برنامجك',
      text: 'تصفّح البرامج واقرأ نبذة كل برنامج ومحتواه ورسومه.',
    },
    signIn: {
      title: 'ادخل بحسابك',
      text: 'الحسابات تُنشأ من إدارة الأكاديمية؛ سجّل الدخول بالحساب الذي تمنحك إياه.',
    },
    learn: {
      title: 'التحق وابدأ التعلّم',
      text: 'التحق بفصل — فورًا في البرامج المجانية، وبعد الدفع وموافقة الأكاديمية في المدفوعة — ثم تابع دروسك في «مدرستي».',
    },
  },
  cta: {
    visitorTitle: 'جاهز للبدء؟',
    visitorText: 'اختر البرنامج الذي يناسبك، ثم ادخل بحسابك لتلتحق به.',
  },
}
