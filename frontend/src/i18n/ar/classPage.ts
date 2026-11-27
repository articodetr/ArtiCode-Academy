// Arabic texts of one class's own page (CH-0374): part of the `ar` object, assembled in ../ar.ts.
// Plain, short words: many teachers are not used to websites.

export const classPage = {
  back: 'رجوع إلى الفصول',
  loadError: 'تعذّر التحميل. اضغط «تحديث» للمحاولة مرة أخرى.',
  forClass: 'سيُضاف إلى الفصل: {{name}}',
  tabs: {
    lessons: 'الدروس',
    assignments: 'الواجبات',
    exams: 'الاختبارات',
  },
  lessons: {
    title: 'دروس هذا الفصل',
    empty: 'لا دروس في هذا الفصل بعد.',
    emptyManage: 'لا دروس في هذا الفصل بعد. اضغط «إضافة درس» لإضافة أول درس.',
    // J-F75: the three buttons of a lesson card.
    edit: 'تعديل',
    delete: 'حذف',
    addExam: 'إضافة اختبار',
    editCancelled: 'لا يُعدَّل درس ملغى. افتح الدرس واختر «استعادة» أولاً.',
    deleteCompleted: 'لا يُحذف درس مكتمل.',
    deleteCancelled: 'لا يُحذف درس ملغى.',
    deleteHasAttendance: 'سُجّل حضور هذا الدرس فلا يُحذف. يمكنك إلغاؤه من نافذة الدرس.',
    deleteConfirmTitle: 'حذف الدرس «{{title}}»؟',
    deleteConfirmContent: 'سيُحذف هذا الدرس من الفصل نهائياً، ولا يمكن التراجع عن ذلك.',
  },
  assignments: {
    title: 'واجبات هذا الفصل',
    empty: 'لا واجبات في هذا الفصل بعد.',
    emptyManage: 'لا واجبات في هذا الفصل بعد. اضغط «إضافة واجب» لإضافة أول واجب.',
    due: 'التسليم:',
    submitted: 'سلّم:',
  },
  exams: {
    title: 'اختبارات هذا الفصل',
    empty: 'لا اختبارات في هذا الفصل بعد.',
    emptyManage: 'لا اختبارات في هذا الفصل بعد. اضغط «إضافة اختبار» لإضافة أول اختبار.',
    results: 'النتائج:',
  },
}
