import { describe, expect, it } from 'vitest'
import { makeInvoice } from '../test/payments'
import { buildCreateInvoiceInput, checkInvoice, checkInvoiceValues, invoiceFormValues, planInvoicePatch, problemFields, spreadEvenly } from './invoices.form'

describe('draft invoice rules (mirror of invoices.calc.ts)', () => {
  it('accepts a valid draft and reports the broken rules', () => {
    expect(checkInvoice({ lines: [{ amount: 1000 }], installments: [{ amount: 450, dueOn: '2026-12-01' }, { amount: 450, dueOn: '2027-01-01' }], discountAmount: 100, discountReason: 'منحة' })).toEqual([])
    expect(checkInvoice({ lines: [{ amount: 100 }], installments: [{ amount: 50, dueOn: '2026-12-01' }, { amount: 0, dueOn: '2026-11-01' }], discountAmount: 0, discountReason: 'x' })).toEqual([
      'discount_reason_without_discount',
      'installments_sum',
      'due_dates_not_ascending',
      'installment_not_positive',
    ])
    expect(checkInvoice({ lines: [], installments: [], discountAmount: 0, discountReason: null })).toEqual(['no_lines', 'total_zero', 'no_installments'])
  })

  it('checks only the discount against a plan total', () => {
    expect(checkInvoiceValues({ source: 'plan', feePlanId: 'p', discountAmount: 1300 }, 1200)).toEqual(['discount_exceeds_subtotal', 'total_zero'])
    expect(checkInvoiceValues({ source: 'plan', feePlanId: 'p' }, 1200)).toEqual([])
  })

  it('groups problems by field', () => {
    expect(problemFields(['installments_sum', 'discount_exceeds_subtotal', 'due_dates_not_ascending'])).toEqual({
      installments: ['installments_sum', 'due_dates_not_ascending'],
      discountAmount: ['discount_exceeds_subtotal'],
    })
  })

  it('builds the API-146 bodies: by hand or from a plan, never both', () => {
    const lines = [{ descriptionAr: 'رسوم', amount: 600 }]
    expect(buildCreateInvoiceInput({ studentId: 's', source: 'lines', lines, installments: [{ amount: 600, dueOn: '2026-12-01' }], discountAmount: 0, notes: '  ' }, undefined)).toEqual({
      studentId: 's',
      lines: [{ description: { ar: 'رسوم' }, amount: 600 }],
      installments: [{ amount: 600, dueOn: '2026-12-01' }],
    })
    expect(buildCreateInvoiceInput({ studentId: 's', source: 'plan', feePlanId: 'p', lines, discountAmount: 50, discountReason: ' أخوة ' }, 'e')).toEqual({
      studentId: 's',
      enrollmentId: 'e',
      feePlanId: 'p',
      discountAmount: 50,
      discountReason: 'أخوة',
    })
  })

  it('patches a draft with the smallest change', () => {
    const draft = makeInvoice({ status: 'draft', number: null, notes: 'قديمة', discountReason: null })
    const same = invoiceFormValues(draft)
    expect(planInvoicePatch(draft, same)).toEqual({})
    expect(planInvoicePatch(draft, { ...same, notes: '', discountAmount: 100, discountReason: 'منحة' })).toEqual({ discountAmount: 100, discountReason: 'منحة', notes: null })
  })

  it('spreads a total over the installments, the remainder on the last', () => {
    expect(spreadEvenly(100, [{ dueOn: 'a' }, { dueOn: 'b' }, { dueOn: 'c' }])).toEqual([
      { dueOn: 'a', amount: 33.33 },
      { dueOn: 'b', amount: 33.33 },
      { dueOn: 'c', amount: 33.34 },
    ])
  })
})
