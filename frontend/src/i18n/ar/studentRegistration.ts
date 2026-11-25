// PORTAL-04 (#208), on the registration contract v3 (the password chosen on /register, typed again on the e-mailed
// link): a student creating their own account.
export const studentRegistration = {
  // The ways in, shown only while the server says `selfRegistration: true`.
  entry: {
    createAccount: 'إنشاء حساب',
    noAccount: 'ليس لديك حساب؟',
    createAccountLink: 'أنشئ حسابًا',
    // The sign-in card's way to /register (with «ليس لديك حساب؟» before it).
    createAccountNow: 'أنشئ حسابك الآن',
    // Replaces «الحسابات تُنشأ من إدارة الأكاديمية» while the academy lets a visitor register.
    accountsNote: 'يمكنك إنشاء حساب طالب بنفسك، أو الدخول بحسابك الحالي.',
    courseNote: 'سجّل الدخول أو أنشئ حسابًا لتختار الفصل وتؤكد التسجيل.',
    // On the sign-in page, right after finishing a registration.
    courseAfterRegister: 'بعد الدخول نعيدك إلى الدورة نفسها لتختار فصلها وتؤكد التحاقك.',
  },
  // /register (contract v3: the password is chosen here). The same message after sending whatever the address, so
  // nothing says whether an account exists.
  register: {
    title: 'أنشئ حسابك',
    subtitle: 'إنشاء حساب طالب',
    intro: 'أدخل اسمك وبريدك الإلكتروني واختر كلمة مرور، ثم أكّد بريدك من الرسالة التي سنرسلها إليك.',
    haveAccount: 'لديك حساب بالفعل؟',
    signIn: 'تسجيل الدخول',
    fullName: 'الاسم الكامل',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    passwordHint: 'استخدم {{min}} أحرف على الأقل، واختر كلمة مرور يصعب تخمينها.',
    passwordRequired: 'اختر كلمة مرور لحسابك.',
    confirmRequired: 'أعد كتابة كلمة المرور للتأكيد.',
    mismatch: 'كلمتا المرور غير متطابقتين.',
    // Checked on this page only: the academy has no terms pages yet, so the words link nowhere and nothing is sent.
    terms: 'أوافق على شروط الاستخدام وسياسة الخصوصية',
    termsRequired: 'وافق على شروط الاستخدام وسياسة الخصوصية لإنشاء حسابك.',
    submit: 'إنشاء حساب',
    submitting: 'جارٍ إنشاء الحساب…',
    // Registration by e-mail is closed while a new account may still come through Google (API-205 `googleSignUp`).
    emailClosedTitle: 'إنشاء الحساب بالبريد الإلكتروني غير متاح حاليًا',
    emailClosedText: 'يمكنك إنشاء حسابك عبر Google، أو تسجيل الدخول إن كان لديك حساب.',
    sentTitle: 'تحقّق من بريدك الإلكتروني',
    sentText:
      'أرسلنا رسالة إلى بريدك؛ افتح الرابط فيها وأدخل كلمة مرورك لتفعيل حسابك. قد تتأخر الرسالة قليلًا، فتفقّد أيضًا مجلد الرسائل غير المرغوب فيها.',
    goToSignIn: 'الذهاب إلى تسجيل الدخول',
    anotherAddress: 'إدخال بريد آخر',
  },
  closed: {
    title: 'التسجيل غير متاح حاليًا',
    text: 'إن كان لديك حساب فيمكنك تسجيل الدخول به.',
    signIn: 'تسجيل الدخول',
  },
  // /register/complete/:token: the e-mailed link activates the account once the password chosen on /register is typed.
  complete: {
    title: 'فعّل حسابك',
    subtitle: 'تفعيل الحساب',
    intro: 'بقيت خطوة واحدة لتفعيل حسابك.',
    name: 'الاسم',
    email: 'البريد الإلكتروني',
    password: 'أدخل كلمة المرور التي اخترتها عند التسجيل',
    passwordRequired: 'أدخل كلمة المرور.',
    forgotPassword: 'نسيت كلمة المرور التي اخترتها؟',
    registerWithNewPassword: 'سجّل من جديد بالبريد نفسه',
    submit: 'تفعيل الحساب',
    submitting: 'جارٍ تفعيل الحساب…',
    passwordIncorrect: 'كلمة المرور غير صحيحة. أدخل كلمة المرور التي اخترتها عند التسجيل.',
    passwordIncorrectAttempts: 'كلمة المرور غير صحيحة. بقيت لك {{count}} محاولة.',
    passwordIncorrectAttempts_one: 'كلمة المرور غير صحيحة. بقيت لك محاولة واحدة، وبعدها يتوقف هذا الرابط.',
    passwordIncorrectAttempts_two: 'كلمة المرور غير صحيحة. بقيت لك محاولتان.',
    passwordIncorrectAttempts_few: 'كلمة المرور غير صحيحة. بقيت لك {{count}} محاولات.',
    passwordIncorrectAttempts_many: 'كلمة المرور غير صحيحة. بقيت لك {{count}} محاولة.',
    passwordIncorrectAttempts_other: 'كلمة المرور غير صحيحة. بقيت لك {{count}} محاولة.',
    loadFailed: 'تعذّر فتح الرابط',
    retry: 'إعادة المحاولة',
    linkInvalid: 'هذا الرابط غير صالح أو لم يعد يعمل. إن لم تفعّل حسابك بعد، فسجّل من جديد لتصلك رسالة جديدة.',
    linkExpired: 'انتهت صلاحية هذا الرابط. سجّل من جديد بالبريد نفسه لتصلك رسالة جديدة.',
    linkExhausted:
      'أُدخلت كلمة مرور غير صحيحة مرات كثيرة، فأوقفنا هذا الرابط حمايةً لحسابك. سجّل من جديد بالبريد نفسه لتصلك رسالة جديدة.',
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
