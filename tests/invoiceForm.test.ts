import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Product } from '../src/models/catalog'
import { draftToInput, type InvoiceDraft } from '../src/services/invoiceForm'
import { toJalali } from '../src/utils/jalali'

const product = { id: 'p1', code: '1', name: 'کالا', groupId: 'g', unitId: 'u', unitName: 'عدد', unitAllowsFraction: false, subUnit: null, conversionRatio: null, reorderPoint: 0, salePrice: 1000, description: null, isActive: true, createdAt: '', updatedAt: '', createdBy: null } as unknown as Product
const draft = (extra: Partial<InvoiceDraft>): InvoiceDraft => ({
  partyId: 'c1',
  warehouseId: 'w1',
  day: toJalali(new Date()),
  reference: '',
  discount: '',
  note: '',
  lines: [{ key: 'k', product, quantity: '2', unitPrice: '50000', discount: '' }],
  ...extra,
})

describe('invoice form paid amount', () => {
  it('full (default) sends no paidAmount so the service pays in full', () => {
    const r = draftToInput(draft({}))
    assert.ok(r.ok && !('paidAmount' in r.input))
    const r2 = draftToInput(draft({ payMode: 'full', paid: '10' }))
    assert.ok(r2.ok && !('paidAmount' in r2.input))
  })
  it('credit: empty = 0, partial value, rejects over total and decimals', () => {
    const empty = draftToInput(draft({ payMode: 'credit', paid: '' }))
    assert.ok(empty.ok && empty.input.paidAmount === 0)
    const part = draftToInput(draft({ payMode: 'credit', paid: '۴۰,۰۰۰' }))
    assert.ok(part.ok && part.input.paidAmount === 40000)
    const over = draftToInput(draft({ payMode: 'credit', paid: '100001' }))
    assert.ok(!over.ok && over.errors['paidAmount'])
    const dec = draftToInput(draft({ payMode: 'credit', paid: '1.5' }))
    assert.ok(!dec.ok && dec.errors['paidAmount'])
  })
})
