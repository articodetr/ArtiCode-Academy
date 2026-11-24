// PORTAL-04 (#208), on the registration contract of #207: a student creating their own account.
export const studentRegistration = {
  // The ways in, shown only while the server says `selfRegistration: true`.
  entry: {
    createAccount: 'إنشاء حساب',
    noAccount: 'ليس لديك حساب؟',
    createAccountLink: 'أنشئ حسابًا',
    // Replaces «الحسابات تُنشأ من إدارة الأكاديمية» while the academy lets a visitor register.
    accountsNote: 'يمكنك إنشاء حساب طالب بنفسك، أو الدخول بحسابك الحالي.',
    courseNote: 'سجّل الدخول أو أنشئ حسابًا لتختار الفصل وتؤكد التسجيل.',
    // On the sign-in page, right after finishing a registration.
    courseAfterRegister: 'بعد الدخول نعيدك إلى الدورة نفسها لتختار فصلها وتؤكد التحاقك.',
  },
  // /register: the same message whatever the address, so nothing says whether an account exists.
  register: {
    subtitle: 'إنشاء حساب طالب',
    intro: 'أدخل اسمك وبريدك الإلكتروني، وسنرسل إليك رسالة فيها الخطوة التالية.',
    fullName: 'الاسم الكامل',
    email: 'البريد الإلكتروني',
    submit: 'متابعة',
    submitting: 'جارٍ الإرسال…',
    haveAccount: 'لديك حساب؟ سجّل الدخول',
    sentTitle: 'تحقّق من بريدك الإلكتروني',
    sentText: 'إن كان البريد صحيحًا فستصلك رسالة فيها الخطوة التالية. قد تتأخر قليلًا، فتفقّد أيضًا مجلد الرسائل غير المرغوب فيها.',
    goToSignIn: 'الذهاب إلى تسجيل الدخول',
    anotherAddress: 'إدخال بريد آخر',
  },
  closed: {
    title: 'التسجيل غير متاح حاليًا',
    text: 'إن كان لديك حساب فيمكنك تسجيل الدخول به.',
    signIn: 'تسجيل الدخول',
  },
  // /register/complete/:token: the e-mailed link.
  complete: {
    subtitle: 'إكمال إنشاء الحساب',
    intro: 'اختر كلمة مرور لحسابك، ويمكنك تعديل اسمك قبل المتابعة.',
    email: 'البريد الإلكتروني',
    fullName: 'الاسم الكامل',
    submit: 'إنشاء الحساب',
    submitting: 'جارٍ إنشاء الحساب…',
    loadFailed: 'تعذّر فتح الرابط',
    retry: 'إعادة المحاولة',
    linkInvalid: 'هذا الرابط غير صالح أو استُعمل من قبل.',
    linkExpired: 'انتهت صلاحية هذا الرابط. سجّل من جديد بالبريد نفسه لتصلك رسالة جديدة.',
    registerAgain: 'سجّل من جديد',
  },
  // The server's problem codes, under each field (`400 registration_invalid`), and the same rules checked before sending.
  validation: {
    fullName: {
      required: 'أدخل اسمك الكامل.',
      blank: 'أدخل اسمك الكامل.',
      too_short: 'الاسم قصير جدًا: حرفان على الأقل.',
      too_long: 'الاسم طويل جدًا: 200 حرف على الأكثر.',
      invalid_format: 'صيغة الاسم غير صحيحة.',
    },
    email: {
      required: 'أدخل بريدك الإلكتروني.',
      blank: 'أدخل بريدك الإلكتروني.',
      too_short: 'البريد الإلكتروني قصير جدًا.',
      too_long: 'البريد الإلكتروني طويل جدًا: 320 حرفًا على الأكثر.',
      invalid_format: 'صيغة البريد الإلكتروني غير صحيحة.',
    },
  },
  errors: {
    invalid: 'تعذّر قبول البيانات. راجعها ثم حاول مجددًا.',
    rateLimited: 'محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مجددًا.',
    rateLimitedSoon: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد أقل من دقيقة.',
    rateLimitedMinutes: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد {{count}} دقيقة.',
    rateLimitedMinutes_one: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد دقيقة واحدة.',
    rateLimitedMinutes_two: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد دقيقتين.',
    rateLimitedMinutes_few: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد {{count}} دقائق.',
    rateLimitedMinutes_many: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد {{count}} دقيقة.',
    rateLimitedMinutes_other: 'محاولات كثيرة خلال وقت قصير. حاول مجددًا بعد {{count}} دقيقة.',
  },
  notices: {
    accountCreated: 'تم إنشاء حسابك، سجّل الدخول',
  },
}
