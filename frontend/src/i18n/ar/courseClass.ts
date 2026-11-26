// The course drawer's class tabs: teachers, students and the rest of the class
// drawer's tabs, working on the course's class (courses/CourseClassTabPane.tsx).
// The admin no longer manages classes, so no text here says «فصل» except the
// selector of a course that still has several (legacy data).
export const courseClass = {
  tabs: {
    teachers: 'المدرسون',
    students: 'الطلاب',
  },
  loadFailed: 'تعذّرت قراءة بيانات المدرسين والطلاب لهذه الدورة.',
  retry: 'إعادة المحاولة',
  rosterHidden: 'لا تملك صلاحية عرض طلاب هذه المجموعة.',
  selector: {
    label: 'المجموعة',
    placeholder: 'اختر مجموعة',
    locked: 'احفظ تغييراتك أو ألغها قبل تغيير المجموعة.',
  },
  empty: {
    unpublished: 'يُسنَد المدرسون ويُسجَّل الطلاب بعد نشر الدورة. انشر الدورة أولًا.',
    noPermission: 'لم تُجهَّز هذه الدورة للمدرسين والطلاب بعد. يجهّزها مدير الأكاديمية.',
    prepare: 'لم تُجهَّز هذه الدورة للمدرسين والطلاب بعد.',
  },
  prepare: {
    action: 'تجهيز الدورة للمدرسين والطلاب',
    hint: 'يتيح إسناد المدرسين وتسجيل الطلاب من هنا. يبقى اشتراك الطلاب بأنفسهم مغلقًا حتى تضغط «فتح الاشتراك» في تبويب التفاصيل.',
    resume: 'لم يكتمل تجهيز هذه الدورة بعد؛ أكمله ليتسنى تسجيل الطلاب.',
    done: 'جُهّزت الدورة للمدرسين والطلاب.',
    codesExhausted: 'تعذّر تجهيز الدورة: كل الرموز المخصصة لها مستخدمة.',
  },
}
