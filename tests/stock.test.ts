import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'
import { SYSTEM_UNITS } from '../src/models/units'
import { MISC_SUPPLIER_ID } from '../src/models/party'
import { stockStatus } from '../src/models/stock'
import { createStockService } from '../src/services/inventoryService'
import { sortByName } from '../src/utils/collate'
import { ValidationError } from '../src/utils/errors'
import { expectAppError, Q, setup } from './helpers'

const kg = SYSTEM_UNITS.find((u) => u.name === 'کیلو')!.id

describe('stock status rules', () => {
  it('out <= 0, low when reorder point is set and quantity <= it, otherwise ok', () => {
    assert.equal(stockStatus(0, 0), 'out')
    assert.equal(stockStatus(-5, 10), 'out')
    assert.equal(stockStatus(Q(3), Q(10)), 'low')
    assert.equal(stockStatus(Q(10), Q(10)), 'low', 'reaching the reorder point counts as low')
    assert.equal(stockStatus(Q(11), Q(10)), 'ok')
    assert.equal(stockStatus(Q(1), 0), 'ok', 'no reorder point = no low-stock warning')
  })
})

describe('stock overview and adjustment', () => {
  it('lists totals/per warehouse with statuses, counts, search and the attention filter', async () => {
    const f = await setup()
    const stock = createStockService(f.db)
    const w2 = await f.catalog.warehouses.create({ name: 'فروشگاه ۱' })
    const a = await f.catalog.products.create({ name: 'هدفون', code: 'P-1', groupId: f.groupId, reorderPoint: Q(10) })
    const b = await f.catalog.products.create({ name: 'برنج', groupId: f.groupId, unitId: kg, reorderPoint: Q(2.5) })
    const c = await f.catalog.products.create({ name: 'کابل', groupId: f.groupId })
    await stock.adjust({ productId: a.id, warehouseId: f.warehouseId, quantity: Q(42), kind: 'opening', unitCost: 1000 })
    await stock.adjust({ productId: a.id, warehouseId: w2.id, quantity: Q(3), kind: 'opening', unitCost: 1000 })
    await stock.adjust({ productId: b.id, warehouseId: f.warehouseId, quantity: Q(2.5), kind: 'opening', unitCost: 1000 })

    const all = await stock.overview()
    assert.deepEqual(all.rows.map((r) => [r.product.name, r.quantity, r.status]), [
      ['برنج', 2500, 'low'], ['کابل', 0, 'out'], ['هدفون', 45_000, 'ok'], // ترتیب الفبای فارسی: ک قبل از ه
    ])
    assert.deepEqual(all.counts, { all: 3, low: 1, out: 1, attention: 2 })
    const inW2 = await stock.overview({ warehouseId: w2.id })
    assert.deepEqual(inW2.rows.find((r) => r.product.id === a.id), { ...inW2.rows.find((r) => r.product.id === a.id)!, quantity: 3000, status: 'low' })
    assert.equal(inW2.rows.find((r) => r.product.id === b.id)?.quantity, 0)
    assert.deepEqual((await stock.overview({ only: 'attention' })).rows.map((r) => r.product.id).sort(), [b.id, c.id].sort())
    assert.equal((await stock.overview({ search: 'p-۱' })).rows.length, 1)
    assert.equal((await stock.overview({ search: 'برنج' })).counts.all, 1)
    // کالای غیرفعال در فهرست موجودی نیست
    await f.catalog.products.setActive(c.id, false)
    assert.equal((await stock.overview()).counts.all, 2)
  })

  it('adjust writes ledger movements (opening / count / shortage / waste) with costs and keeps cache + lots consistent', async () => {
    const f = await setup()
    const stock = createStockService(f.db)
    const p = await f.catalog.products.create({ name: 'شکر', groupId: f.groupId, unitId: kg })
    const m1 = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(10), kind: 'opening', unitCost: 50_000, note: ' موجودی اول ' })
    assert.deepEqual([m1.movementType, m1.quantityDelta, m1.note], ['opening', 10_000, 'موجودی اول'])
    assert.equal((await f.repos.costs.getLotByMovement(m1.id))?.totalCost, 500_000)
    // شمارش کمتر = کسری (بهای قدیمی‌ترین لایه)
    const m2 = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(9.25), kind: 'count', note: 'شمارش' })
    assert.deepEqual([m2.movementType, m2.quantityDelta, m2.costs?.fifo], ['shortage', -750, 37_500])
    // ضایعات جدا از کسری
    const m3 = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(0.25), kind: 'waste' })
    assert.deepEqual([m3.movementType, m3.quantityDelta, m3.costs?.fifo], ['waste', -250, 12_500])
    const m4 = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(1), kind: 'shortage' })
    assert.deepEqual([m4.movementType, m4.quantityDelta], ['shortage', -1000])
    // شمارش بیشتر = اضافه با بهای میانگین فعلی
    const m5 = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(9), kind: 'count' })
    assert.deepEqual([m5.movementType, m5.quantityDelta], ['adjustment', 1000])
    assert.equal((await f.repos.costs.getLotByMovement(m5.id))?.totalCost, 50_000)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), 9000)
    assert.deepEqual(await f.inventory.verifyConsistency(), [])
    assert.deepEqual(await f.inventory.verifyCosts(), [])
    assert.deepEqual((await stock.recentMovements(p.id)).map((m) => m.quantityDelta), [1000, -1000, -250, -750, 10_000], 'newest first')
    assert.deepEqual((await stock.levelsForProduct(p.id)).map((l) => l.quantity), [9000])
  })

  it('suggests the last purchase price as opening unit cost', async () => {
    const f = await setup()
    const stock = createStockService(f.db)
    const p = await f.catalog.products.create({ name: 'چای', groupId: f.groupId })
    assert.equal(await stock.suggestedUnitCost(p.id), null)
    await f.repos.purchaseInvoices.create({ partyId: MISC_SUPPLIER_ID, warehouseId: f.warehouseId, invoiceDate: '2026-10-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(2), unitPrice: 70_000 }] })
    assert.equal(await stock.suggestedUnitCost(p.id), 70_000)
  })

  it('rejects unchanged, negative, too-large, fractional-for-whole-unit and inactive cases with Persian messages', async () => {
    const f = await setup()
    const stock = createStockService(f.db)
    const p = await f.catalog.products.create({ name: 'خودکار', groupId: f.groupId })
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(5), kind: 'opening' }), 'validation', 'بهای هر واحد')
    await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(5), kind: 'opening', unitCost: 0 })
    const same = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(5), kind: 'count' }).catch((e: unknown) => e)
    assert.ok(same instanceof ValidationError && same.fieldErrors['quantity']?.includes('تغییری ثبت نشد'))
    const neg = await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: -1, kind: 'count' }).catch((e: unknown) => e)
    assert.ok(neg instanceof ValidationError)
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(2), kind: 'opening', unitCost: 1 }), 'validation', 'فقط موجودی را زیاد')
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(6), kind: 'waste' }), 'validation', 'بیشتر است')
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: 0, kind: 'shortage' }), 'validation', 'بیشتر از صفر')
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(5.5), kind: 'count' }), 'validation', 'عدد صحیح')
    await f.catalog.products.setActive(p.id, false)
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(1), kind: 'count' }), 'validation', 'غیرفعال')
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: f.warehouseId, quantity: Q(1), kind: 'waste' }), 'validation', 'غیرفعال')
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), 5000, 'failed adjustments change nothing')
  })
})

describe('warehouses', () => {
  it('keeps at least one active warehouse and protects used ones from deletion', async () => {
    const f = await setup()
    await expectAppError(f.catalog.warehouses.setActive(f.warehouseId, false), 'protected', 'تنها انبار فعال')
    await expectAppError(f.catalog.warehouses.remove(f.warehouseId), 'protected')
    const w2 = await f.catalog.warehouses.create({ name: 'انبار دوم' })
    await f.catalog.warehouses.setActive(f.warehouseId, false)
    assert.deepEqual((await f.catalog.warehouses.list()).map((w) => w.name), ['انبار دوم'])
    await f.catalog.warehouses.setActive(f.warehouseId, true)

    const p = await f.catalog.products.create({ name: 'x', groupId: f.groupId })
    const stock = createStockService(f.db)
    assert.equal(await f.catalog.warehouses.isUsed(w2.id), false)
    await stock.adjust({ productId: p.id, warehouseId: w2.id, quantity: Q(2), kind: 'opening', unitCost: 0 })
    assert.equal(await f.catalog.warehouses.isUsed(w2.id), true)
    assert.equal(await f.catalog.warehouses.stockedProductCount(w2.id), 1)
    await expectAppError(f.catalog.warehouses.remove(w2.id), 'in_use', 'غیرفعال')
    const w3 = await f.catalog.warehouses.create({ name: 'خالی' })
    await f.catalog.warehouses.remove(w3.id)
    // انبار غیرفعال برای حرکت جدید پذیرفته نمی‌شود
    await f.catalog.warehouses.setActive(w2.id, false)
    await expectAppError(stock.adjust({ productId: p.id, warehouseId: w2.id, quantity: Q(1), kind: 'count' }), 'validation', 'غیرفعال')
  })
})

test('compareFa sorts in Persian alphabetical order (not by Unicode code point) and numbers naturally', () => {
  const names = ['یخچال', 'هدفون', 'کابل', 'گوشی', 'پاک‌کن', 'ایران', 'کالا ۱۰', 'کالا ۲']
  const sorted = sortByName(names.map((name) => ({ name }))).map((x) => x.name)
  assert.deepEqual(sorted, ['ایران', 'پاک‌کن', 'کابل', 'کالا ۲', 'کالا ۱۰', 'گوشی', 'هدفون', 'یخچال'])
})

test('Jalali conversion matches Intl (persian calendar) every day for 45 years, both directions', async () => {
  const { gregorianToJalali, jalaliToGregorian, jalaliMonthLength } = await import('../src/utils/jalali')
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  const start = Date.UTC(1995, 0, 1)
  for (let day = 0; day < 365 * 45; day++) {
    const d = new Date(start + day * 86_400_000)
    const parts = fmt.formatToParts(d)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value.replace(/\D/g, ''))
    const expected = { jy: get('year'), jm: get('month'), jd: get('day') }
    const j = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    assert.deepEqual(j, expected, d.toISOString())
    assert.deepEqual(jalaliToGregorian(j.jy, j.jm, j.jd), { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() })
    assert.ok(j.jd <= jalaliMonthLength(j.jy, j.jm))
  }
  assert.deepEqual(gregorianToJalali(2026, 10, 5), { jy: 1405, jm: 7, jd: 13 })
  assert.equal(jalaliMonthLength(1403, 12), 30, '1403 is a leap year')
  assert.equal(jalaliMonthLength(1404, 12), 29)
})
