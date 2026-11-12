import { describe, expect, it } from 'vitest'
import { CLASS_COURSE_ID, CLASS_ID, makeClass } from '../test/classes'
import { ENROLLMENT_IDS, STUDENT_IDS } from '../test/enrollments'
import { FEE_PLAN_IDS, makeCoursePlan, makeFeePlan, makeInactivePlan } from '../test/feePlans'
import { makeDraftInvoice, makeInvoice } from '../test/invoices'
import {
  buildCreateInvoiceInput,
  createInvoiceFormHasChanges,
  evenInstallments,
  invoiceEditFormValuesOf,
  invoiceFormHasChanges,
  invoiceFormProblems,
  invoicePreview,
  manualInvoiceInput,
  newCreateInvoiceForm,
  planInvoicePatch,
  planInvoiceProblems,
  plansForClass,
} from './invoices.form'
import { changedInvoiceFields, checkInvoice, nextInvoiceStatus, planFits } from './invoices.rules'

describe('invoice rules — the mirror of checkInvoice()/planFits()/changedInvoiceFields() (backend/src/finance/invoices.calc.ts)', () => {
  const valid = { lines: [{ amount: 1000 }, { amount: 200 }], installments: [{ amount: 600, dueOn: '2026-11-11' }, { amount: 600, dueOn: '2026-12-11' }], discountAmount: 0, discountReason: null }

  it('accepts a valid draft and reports each broken rule in the server’s order', () => {
    expect(checkInvoice(valid)).toEqual([])
    expect(checkInvoice({ lines: [], installments: [], discountAmount: 0, discountReason: 'منحة' })).toEqual(['no_lines', 'discount_reason_without_discount', 'total_zero', 'no_installments'])
    expect(checkInvoice({ ...valid, discountAmount: 1300 })).toEqual(['discount_exceeds_subtotal', 'total_zero', 'installments_sum'])
    expect(checkInvoice({ ...valid, installments: [{ amount: 1200.01, dueOn: '2026-12-11' }, { amount: -0.01, dueOn: '2026-11-11' }] })).toEqual(['due_dates_not_ascending', 'installment_not_positive'])
    // Sums in cents: 0.1 + 0.2 lines against a 0.3 installment is no mismatch.
    expect(checkInvoice({ lines: [{ amount: 0.1 }, { amount: 0.2 }], installments: [{ amount: 0.3, dueOn: '2026-11-11' }], discountAmount: 0, discountReason: null })).toEqual([])
  })

  it('lets a general plan price any class, a course plan the classes of its course, a class plan its class', () => {
    const target = { classId: CLASS_ID, courseId: CLASS_COURSE_ID }
    expect(planFits({ courseId: null, classId: null }, target)).toBe(true)
    expect(planFits({ courseId: CLASS_COURSE_ID, classId: null }, target)).toBe(true)
    expect(planFits({ courseId: 'other', classId: null }, target)).toBe(false)
    expect(planFits({ courseId: null, classId: 'other' }, target)).toBe(false)
  })

  it('offers the active plans that fit the class, or every active plan without one', () => {
    const plans = [makeFeePlan(), makeCoursePlan(), makeInactivePlan(), makeFeePlan({ id: 'general', class: null })]
    expect(plansForClass(plans, makeClass()).map((plan) => plan.id)).toEqual([FEE_PLAN_IDS[0], FEE_PLAN_IDS[1], 'general'])
    expect(plansForClass(plans, makeClass({ id: 'other-class', course: { ...makeClass().course, id: 'other-course' } })).map((plan) => plan.id)).toEqual(['general'])
    expect(plansForClass(plans, null).map((plan) => plan.id)).toEqual([FEE_PLAN_IDS[0], FEE_PLAN_IDS[1], 'general'])
  })

  it('follows D-R61: issue a draft, cancel an issued invoice, nothing from cancelled', () => {
    expect(nextInvoiceStatus('issue', 'draft')).toBe('issued')
    expect(nextInvoiceStatus('cancel', 'issued')).toBe('cancelled')
    expect(nextInvoiceStatus('issue', 'issued')).toBeNull()
    expect(nextInvoiceStatus('cancel', 'draft')).toBeNull()
    expect(nextInvoiceStatus('cancel', 'cancelled')).toBeNull()
  })

  it('compares lines and installments whole, amounts by value', () => {
    const current = { enrollmentId: null, lines: [{ description: { ar: 'أ' }, amount: 10 }], installments: [{ amount: 10, dueOn: '2026-11-11' }], discountAmount: 0, discountReason: null, notes: null }
    expect(changedInvoiceFields(current, { ...current, lines: [{ description: { ar: 'أ' }, amount: 10.0 }] })).toEqual([])
    expect(changedInvoiceFields(current, { ...current, notes: 'x', discountAmount: 0.5 })).toEqual(['discountAmount', 'notes'])
  })
})

describe('the invoice forms', () => {
  it('sends the smallest PATCH of a draft — whole lines or installments, a blank text as null, an untie as enrollmentId null — and nothing when nothing changed', () => {
    const draft = makeDraftInvoice()
    const values = invoiceEditFormValuesOf(draft)
    expect(planInvoicePatch(draft, values)).toBeNull()
    expect(planInvoicePatch(draft, { ...values, notes: '  ', discountReason: '' })).toBeNull()
    expect(planInvoicePatch(draft, { ...values, keepEnrollment: false })).toEqual({ enrollmentId: null })
    expect(planInvoicePatch(draft, { ...values, lines: [{ descriptionAr: 'رسوم التسجيل', descriptionEn: 'Registration fee', amount: 250 }], installments: [{ amount: 250, dueOn: '2026-11-20' }], discountAmount: null })).toEqual({
      lines: [{ description: { ar: 'رسوم التسجيل', en: 'Registration fee' }, amount: 250 }],
      installments: [{ amount: 250, dueOn: '2026-11-20' }],
    })
    expect(planInvoicePatch(makeInvoice({ status: 'draft', notes: 'x', discountAmount: 50, discountReason: 'منحة' }), { ...invoiceEditFormValuesOf(makeInvoice({ notes: 'x', discountAmount: 50, discountReason: 'منحة' })), notes: '', discountAmount: null, discountReason: '' })).toEqual({
      discountAmount: 0,
      discountReason: null,
      notes: null,
    })
  })

  it('counts unsaved work against the draft as loaded: a change changed back holds nothing, an emptied amount holds something', () => {
    const initial = invoiceEditFormValuesOf(makeDraftInvoice())
    expect(invoiceFormHasChanges(initial, { ...initial, notes: '   ' })).toBe(false)
    expect(invoiceFormHasChanges(initial, { ...initial, discountAmount: 0 })).toBe(false)
    expect(invoiceFormHasChanges(initial, { ...initial, lines: [{ ...initial.lines![0]!, amount: null }] })).toBe(true)
    expect(invoiceFormHasChanges(initial, { ...initial, keepEnrollment: false })).toBe(true)
  })

  it('checks the rules only once every field is valid, and previews the typed totals in cents', () => {
    expect(invoiceFormProblems({ lines: [{ descriptionAr: 'أ', amount: 100 }], installments: [{ amount: 60, dueOn: '2026-11-11' }], discountAmount: null })).toEqual(['installments_sum'])
    expect(invoiceFormProblems({ lines: [{ descriptionAr: 'أ', amount: null }], installments: [{ amount: 60, dueOn: '2026-11-11' }] })).toEqual([])
    expect(invoicePreview({ lines: [{ amount: 1000 }, { amount: 200 }], installments: [{ amount: 600 }, { amount: 500 }], discountAmount: 100 })).toEqual({ subtotal: 120000, discount: 10000, total: 110000, installments: 110000 })
    expect(invoicePreview({ lines: [{ amount: 1e-7 }], installments: [{ amount: null }] })).toEqual({ subtotal: null, discount: 0, total: null, installments: null })
    expect(evenInstallments([{ amount: null, dueOn: '2026-11-11' }, { amount: 5, dueOn: '2026-12-11' }, { dueOn: '2027-01-11' }], 110000)).toEqual([
      { amount: 366.66, dueOn: '2026-11-11' },
      { amount: 366.66, dueOn: '2026-12-11' },
      { amount: 366.68, dueOn: '2027-01-11' },
    ])
  })

  it('builds API-146 from a plan (its id, the discount, the note) or by hand (the typed content), never with blank texts', () => {
    const fromPlan = { ...newCreateInvoiceForm('class', '2026-11-12'), feePlanId: FEE_PLAN_IDS[0], discountAmount: 100, discountReason: ' منحة ', notes: '' }
    expect(buildCreateInvoiceInput(fromPlan, { studentId: STUDENT_IDS[0], enrollmentId: ENROLLMENT_IDS[0] })).toEqual({
      studentId: STUDENT_IDS[0],
      enrollmentId: ENROLLMENT_IDS[0],
      feePlanId: FEE_PLAN_IDS[0],
      discountAmount: 100,
      discountReason: 'منحة',
    })
    const manual = { ...fromPlan, source: 'manual' as const, lines: [{ descriptionAr: 'رسوم', amount: 300 }], installments: [{ amount: 200, dueOn: '2026-11-20' }], discountReason: ' منحة ' }
    expect(buildCreateInvoiceInput(manual, { studentId: STUDENT_IDS[1] })).toEqual({
      studentId: STUDENT_IDS[1],
      lines: [{ description: { ar: 'رسوم' }, amount: 300 }],
      installments: [{ amount: 200, dueOn: '2026-11-20' }],
      discountAmount: 100,
      discountReason: 'منحة',
    })
    expect(manualInvoiceInput({ lines: [{ descriptionAr: 'أ', amount: 1 }], installments: [{ amount: 1, dueOn: '2026-11-20' }], discountAmount: null, notes: ' ' })).toEqual({ lines: [{ description: { ar: 'أ' }, amount: 1 }], installments: [{ amount: 1, dueOn: '2026-11-20' }] })
  })

  it('checks the discount of a draft from a plan against the plan’s total', () => {
    expect(planInvoiceProblems(1200, { discountAmount: 100, discountReason: 'منحة' })).toEqual([])
    expect(planInvoiceProblems(1200, { discountAmount: 1300 })).toEqual(['discount_exceeds_subtotal', 'total_zero'])
    expect(planInvoiceProblems(1200, { discountAmount: 1200 })).toEqual(['total_zero'])
    expect(planInvoiceProblems(1200, { discountAmount: null, discountReason: 'منحة' })).toEqual(['discount_reason_without_discount'])
  })

  it('counts a new invoice as unsaved once anything is chosen or typed', () => {
    const initial = newCreateInvoiceForm('class', '2026-11-12')
    expect(createInvoiceFormHasChanges(initial, { ...initial })).toBe(false)
    expect(createInvoiceFormHasChanges(initial, { ...initial, classId: CLASS_ID })).toBe(true)
    expect(createInvoiceFormHasChanges(initial, { ...initial, source: 'manual' })).toBe(true)
    expect(createInvoiceFormHasChanges(initial, { ...initial, notes: 'x' })).toBe(true)
  })
})
