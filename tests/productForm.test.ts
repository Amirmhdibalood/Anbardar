import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SYSTEM_UNITS } from '../src/models/units'
import type { Unit } from '../src/models/catalog'
import { emptyProductForm, formatMoneyTyping, formatQuantityTyping, productToForm, toProductInput } from '../src/services/productForm'
import { setup } from './helpers'

const unit = (name: string): Unit => {
  const u = SYSTEM_UNITS.find((x) => x.name === name)!
  return { id: u.id, name: u.name, allowsFraction: u.allowsFraction, isSystem: true, sortOrder: 0, isActive: true, createdAt: '', updatedAt: '', createdBy: null }
}
const base = emptyProductForm({ groupId: 'g1', unitId: unit('عدد').id })

describe('product form mapper', () => {
  it('formats typing: money with separators/Persian digits, quantity with ٫', () => {
    assert.equal(formatMoneyTyping('1200000'), '۱,۲۰۰,۰۰۰')
    assert.equal(formatMoneyTyping('۱٬۲۳۴ abc'), '۱,۲۳۴')
    assert.equal(formatMoneyTyping('0012'), '۱۲')
    assert.equal(formatMoneyTyping(''), '')
    assert.equal(formatQuantityTyping('1.5'), '۱٫۵')
    assert.equal(formatQuantityTyping('1/5x'), '۱٫۵')
    assert.equal(formatQuantityTyping('1.2.3'), '۱٫۲۳')
  })

  it('maps text to exact numbers (thousandths, integer toman) and trims empty code to auto', () => {
    const r = toProductInput({ ...base, name: ' کتاب ', salePrice: '۱۲۰,۰۰۰', reorderPoint: '۳' }, unit('عدد'))
    assert.ok(r.ok)
    assert.deepEqual([r.input.name, r.input.code, r.input.salePrice, r.input.reorderPoint], [' کتاب ', null, 120000, 3000])
    const kg = toProductInput({ ...base, name: 'برنج', reorderPoint: '۲٫۵' }, unit('کیلو'))
    assert.ok(kg.ok && kg.input.reorderPoint === 2500)
  })

  it('collects every field error at once, in Persian', () => {
    const r = toProductInput({ ...base, name: ' ', groupId: '', salePrice: '12.5', reorderPoint: '1٫5' }, unit('عدد'))
    assert.ok(!r.ok)
    assert.equal(r.errors['name'], 'نام کالا را وارد کنید.')
    assert.equal(r.errors['groupId'], 'گروه کالا را انتخاب کنید.')
    assert.ok(r.errors['salePrice']?.includes('بدون اعشار'))
    assert.ok(r.errors['reorderPoint']?.includes('عدد صحیح'))
    const noUnit = toProductInput({ ...base, name: 'x' }, undefined)
    assert.ok(!noUnit.ok && noUnit.errors['unitId'])
  })

  it('round-trips an existing product into the form', async () => {
    const f = await setup()
    const kg = SYSTEM_UNITS.find((u) => u.name === 'کیلو')!
    const p = await f.catalog.products.create({ name: 'شکر', groupId: f.groupId, unitId: kg.id, reorderPoint: 1500, salePrice: 45000 })
    const form = productToForm(p)
    assert.deepEqual([form.reorderPoint, form.salePrice, form.code], ['۱٫۵', '۴۵,۰۰۰', p.code])
    const back = toProductInput(form, unit('کیلو'))
    assert.ok(back.ok && back.input.reorderPoint === 1500 && back.input.salePrice === 45000)
  })
})

describe('catalog service: product list & groups', () => {
  it('searches name and code with Persian digits / Arabic letters, filters by group, paginates', async () => {
    const f = await setup()
    const g2 = await f.catalog.groups.create({ name: 'صوتی' })
    await f.catalog.products.create({ name: 'هدفون', code: 'P-12', groupId: g2.id })
    await f.catalog.products.create({ name: 'كابل شارژ', groupId: f.groupId }) // «ك» عربی
    for (let i = 0; i < 5; i++) await f.catalog.products.create({ name: `کالا ${i}`, groupId: f.groupId })
    assert.equal((await f.catalog.products.list({ search: 'p-۱۲' })).length, 1)
    assert.equal((await f.catalog.products.list({ search: 'کابل' })).length, 1)
    assert.equal((await f.catalog.products.list({ search: 'ي' })).length, 0)
    assert.equal((await f.catalog.products.list({ groupId: g2.id })).length, 1)
    assert.equal((await f.catalog.products.list({ search: 'کالا', limit: 3 })).length, 3)
    assert.equal((await f.catalog.products.list({ search: 'کالا', limit: 3, offset: 3 })).length, 2)
    const counts = await f.catalog.groups.productCounts()
    assert.deepEqual([counts[g2.id], counts[f.groupId]], [1, 6])
  })

  it('group with products is not deletable (counted message), empty group is', async () => {
    const f = await setup()
    await f.catalog.products.create({ name: 'a', groupId: f.groupId })
    const e = await f.catalog.groups.remove(f.groupId).catch((x: unknown) => x)
    assert.ok(e instanceof Error && e.message.includes('۱ کالا'))
    const g = await f.catalog.groups.create({ name: 'خالی' })
    await f.catalog.groups.remove(g.id)
  })
})
