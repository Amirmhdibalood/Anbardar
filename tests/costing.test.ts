import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import { seedIfNeeded, SETTING_KEYS } from '../src/database/seed'
import { MemorySnapshotStore } from '../src/database/snapshot'
import { MISC_SUPPLIER_ID } from '../src/models/party'
import { DEFAULT_UNIT_ID } from '../src/models/units'
import { createRepositories } from '../src/repositories'
import { createInventoryService } from '../src/services/inventoryService'
import { createPurchaseService } from '../src/services/purchaseService'
import { newId } from '../src/utils/id'
import { splitDiscount, prepareInvoice } from '../src/utils/invoiceMath'
import { mulDivCeil, mulDivRound } from '../src/utils/money'
import { expectAppError, freshDb, LOT0, Q, rowCount, setup, type Fixture } from './helpers'

const NOW = '2026-10-04T10:00:00.000Z'

async function buy(f: Fixture, productId: string, quantity: number, unitPrice: number, date: string, extra: { discount?: number; lineDiscount?: number; warehouseId?: string } = {}) {
  return createPurchaseService(f.db).create({
    warehouseId: extra.warehouseId ?? f.warehouseId,
    invoiceDate: date,
    discount: extra.discount,
    items: [{ productId, quantity, unitPrice, discount: extra.lineDiscount }],
  })
}

const sell = (f: Fixture, productId: string, quantity: number, warehouseId = f.warehouseId) =>
  f.inventory.applyMovement({ productId, warehouseId, quantityDelta: -quantity, movementType: 'sale' })

describe('cost engine (FIFO / moving average / last purchase price)', () => {
  it('consumes the oldest lot by invoice date (even if backdated), rounds partial takes and sums each lot exactly', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'هدفون', groupId: f.groupId })
    const later = await buy(f, p.id, Q(2), 500, '2026-10-03T08:00:00.000Z') // لایه B: ۲ عدد، ۱٬۰۰۰
    // فاکتور عقب‌تاریخ‌خورده (بعداً ثبت شده ولی تاریخش قدیمی‌تر است): لایه A: ۳ عدد، ۱٬۰۰۰ → واحد ۳۳۳٫۳۳
    const earlier = await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, invoiceDate: '2026-10-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(3), unitPrice: 334, discount: 2 }] })
    assert.equal(earlier.items[0]?.lineTotal, 1000)
    const s1 = await sell(f, p.id, Q(1))
    const s2 = await sell(f, p.id, Q(1))
    const s3 = await sell(f, p.id, Q(2))
    assert.deepEqual([s1.costs?.fifo, s2.costs?.fifo, s3.costs?.fifo], [333, 333, 334 + 500], 'last take of lot A gets its remaining 334')
    assert.deepEqual([s1.costs?.average, s2.costs?.average, s3.costs?.average], [400, 400, 800], 'moving average 2000/5')
    assert.deepEqual([s1.costs?.last, s2.costs?.last, s3.costs?.last], [500, 500, 1000], 'last purchase = latest invoice date (B)')
    const lots = await f.repos.costs.listLots({ productId: p.id })
    const lotA = lots.find((l) => l.quantity === Q(3))!
    const lotB = lots.find((l) => l.quantity === Q(2))!
    assert.deepEqual([lotA.remaining, lotB.remaining], [0, Q(1)])
    const allocA = await f.repos.costs.allocationsForLot(lotA.id)
    assert.equal(allocA.reduce((s, a) => s + a.costAmount, 0), 1000, 'allocations of a fully used lot sum to its cost exactly')
    assert.deepEqual((await f.repos.costs.allocationsForMovement(s3.id)).map((a) => [a.lotId === lotA.id ? 'A' : 'B', a.quantity, a.costAmount]).sort(), [['A', Q(1), 334], ['B', Q(1), 500]])
    assert.deepEqual(await f.repos.costs.getAverage(p.id), { quantity: Q(1), value: 400 })
    assert.deepEqual(await f.inventory.verifyCosts(), [])
    assert.ok(later.invoice.id)
  })

  it('purchase lot cost = line total − line discount − share of invoice discount (what we actually pay)', async () => {
    const f = await setup()
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    const b = await f.catalog.products.create({ name: 'ب', groupId: f.groupId })
    const res = await createPurchaseService(f.db).create({
      warehouseId: f.warehouseId,
      discount: 1000,
      items: [
        { productId: a.id, quantity: Q(3), unitPrice: 1000, discount: 0 }, // ۳٬۰۰۰
        { productId: b.id, quantity: Q(1), unitPrice: 1500, discount: 500 }, // ۱٬۰۰۰
      ],
    })
    assert.deepEqual([res.invoice.subtotalAmount, res.invoice.discount, res.invoice.totalAmount], [4000, 1000, 3000])
    assert.deepEqual(res.items.map((i) => [i.lineTotal, i.invoiceDiscountShare]), [[3000, 750], [1000, 250]])
    const lots = await f.repos.costs.listLots()
    assert.deepEqual(lots.map((l) => [l.productId, l.totalCost]).sort(), [[a.id, 2250], [b.id, 750]].sort())
    assert.equal((await sell(f, a.id, Q(1))).costs?.fifo, 750)
  })

  it('shortage and waste are distinct movement types; both consume the oldest lots and keep their cost', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'شیر', groupId: f.groupId })
    await buy(f, p.id, Q(4), 100, '2026-10-01T08:00:00.000Z')
    await buy(f, p.id, Q(4), 200, '2026-10-02T08:00:00.000Z')
    const sh = await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: -Q(3), movementType: 'shortage' })
    const ws = await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: -Q(2), movementType: 'waste' })
    assert.deepEqual([sh.movementType, sh.costs?.fifo], ['shortage', 300])
    assert.deepEqual([ws.movementType, ws.costs?.fifo], ['waste', 100 + 200])
    await expectAppError(f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(1), movementType: 'shortage' }), 'validation', 'جهت')
    const types = (await f.inventory.listMovements({ productId: p.id })).map((m) => m.movementType)
    assert.deepEqual(types.filter((t) => t === 'shortage' || t === 'waste'), ['shortage', 'waste'])
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })

  it('last purchase price skips cancelled purchases; falls back to any lot, then 0', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'قند', groupId: f.groupId })
    await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(2), movementType: 'opening' }, { kind: 'lot', totalCost: 600 })
    let m = await sell(f, p.id, Q(1))
    assert.equal(m.costs?.last, 300, 'no purchase yet → last opening lot')
    await buy(f, p.id, Q(1), 900, '2026-10-02T08:00:00.000Z')
    const cancelled = await buy(f, p.id, Q(1), 5000, '2026-10-03T08:00:00.000Z')
    await createPurchaseService(f.db).cancel(cancelled.invoice.id, 'اشتباه')
    m = await sell(f, p.id, Q(1))
    assert.equal(m.costs?.last, 900)
    const q = await f.catalog.products.create({ name: 'بی‌لایه', groupId: f.groupId })
    await f.inventory.applyMovement({ productId: q.id, warehouseId: f.warehouseId, quantityDelta: Q(1), movementType: 'opening' }, LOT0)
    assert.deepEqual((await sell(f, q.id, Q(1))).costs, { fifo: 0, average: 0, last: 0 })
  })

  it('cancelling a purchase: allowed when untouched, blocked (nothing changes) once any of it is sold', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const p = await f.catalog.products.create({ name: 'کتاب', groupId: f.groupId })
    const q = await f.catalog.products.create({ name: 'دفتر', groupId: f.groupId })
    const one = await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(5), unitPrice: 100 }, { productId: q.id, quantity: Q(2), unitPrice: 50 }] })
    await purchases.cancel(one.invoice.id, '  ثبت تکراری ')
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), 0)
    const inv = await f.repos.purchaseInvoices.getById(one.invoice.id)
    assert.deepEqual([inv?.status, inv?.cancelReason], ['cancelled', 'ثبت تکراری'])
    assert.deepEqual(await f.repos.costs.getAverage(p.id), { quantity: 0, value: 0 })
    await expectAppError(purchases.cancel(one.invoice.id), 'immutable', 'قبلاً ابطال')

    const two = await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(5), unitPrice: 100 }, { productId: q.id, quantity: Q(2), unitPrice: 50 }] })
    await sell(f, q.id, Q(1))
    const movementsBefore = await rowCount(f.db, 'stock_movements')
    await expectAppError(purchases.cancel(two.invoice.id), 'in_use', 'برگشت از خرید')
    assert.equal(await rowCount(f.db, 'stock_movements'), movementsBefore, 'the whole cancel rolled back (line 1 too)')
    assert.equal((await f.repos.purchaseInvoices.getById(two.invoice.id))?.status, 'active')
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(5))
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })

  it('cancelling a sale returns its allocations to the same lots, once only', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'برس', groupId: f.groupId })
    await buy(f, p.id, Q(2), 100, '2026-10-01T08:00:00.000Z')
    await buy(f, p.id, Q(2), 300, '2026-10-02T08:00:00.000Z')
    const sale = await sell(f, p.id, Q(3))
    assert.equal(sale.costs?.fifo, 200 + 300)
    const back = await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(3), movementType: 'sale_cancel' }, { kind: 'reverse', originalMovementId: sale.id })
    assert.deepEqual(back.costs, sale.costs)
    const lots = await f.repos.costs.listLots({ productId: p.id })
    assert.deepEqual(lots.map((l) => l.remaining), [Q(2), Q(2)])
    assert.ok((await f.repos.costs.allocationsForMovement(sale.id)).every((a) => a.reversalMovementId === back.id))
    await expectAppError(
      f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(3), movementType: 'sale_cancel' }, { kind: 'reverse', originalMovementId: sale.id }),
      'immutable',
    )
    // پس از ابطال، فروش بعدی دوباره از قدیمی‌ترین لایه است
    assert.equal((await sell(f, p.id, Q(1))).costs?.fifo, 100)
    assert.deepEqual(await f.repos.costs.getAverage(p.id), { quantity: Q(3), value: 600 })
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })

  it('verifyCosts detects corrupted lots, rebuildAverages reproduces the live moving average from raw data', async () => {
    const f = await setup()
    const w2 = await f.catalog.warehouses.create({ name: 'شعبه' })
    const p = await f.catalog.products.create({ name: 'روغن', groupId: f.groupId })
    await buy(f, p.id, Q(3), 1001, '2026-10-01T08:00:00.000Z')
    await buy(f, p.id, Q(7), 777, '2026-10-02T08:00:00.000Z', { warehouseId: w2.id, discount: 9 })
    await sell(f, p.id, Q(2))
    await f.inventory.applyMovement({ productId: p.id, warehouseId: w2.id, quantityDelta: -Q(1), movementType: 'waste' })
    const live = await f.repos.costs.getAverage(p.id)
    await f.repos.costs.setAverage(p.id, { quantity: 1, value: 1 })
    assert.equal((await f.inventory.verifyCosts())[0]?.kind, 'average_quantity')
    await f.inventory.rebuildAverages()
    assert.deepEqual(await f.repos.costs.getAverage(p.id), live)
    assert.deepEqual(await f.inventory.verifyCosts(), [])
    const [lot] = await f.repos.costs.openLots(p.id, f.warehouseId)
    await f.db.run('UPDATE cost_lots SET remaining = remaining - 1 WHERE id = ?', [lot!.id])
    assert.deepEqual((await f.inventory.verifyCosts()).map((i) => i.kind).sort(), ['lot_remaining', 'lots_vs_stock'])
  })
})

describe('database protection for cost data', () => {
  it('lots: only remaining may change; allocations: only one reversal mark; neither can be deleted; shares cannot exceed line totals', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'x', groupId: f.groupId })
    const res = await buy(f, p.id, Q(2), 100, NOW)
    const sale = await sell(f, p.id, Q(1))
    const [lot] = await f.repos.costs.listLots()
    const [alloc] = await f.repos.costs.allocationsForMovement(sale.id)
    await expectAppError(f.db.run('UPDATE cost_lots SET total_cost = 1 WHERE id = ?', [lot!.id]), 'immutable')
    await expectAppError(f.db.run('UPDATE cost_lots SET quantity = 1 WHERE id = ?', [lot!.id]), 'immutable')
    await expectAppError(f.db.run('DELETE FROM cost_lots'), 'immutable')
    await expectAppError(f.db.run('UPDATE lot_allocations SET cost_amount = 0 WHERE id = ?', [alloc!.id]), 'immutable')
    await expectAppError(f.db.run('DELETE FROM lot_allocations'), 'immutable')
    await f.db.run('UPDATE lot_allocations SET reversal_movement_id = ? WHERE id = ?', [sale.id, alloc!.id]) // یک بار مجاز (فقط Trigger)
    await expectAppError(f.db.run('UPDATE lot_allocations SET reversal_movement_id = NULL WHERE id = ?', [alloc!.id]), 'immutable')
    await expectAppError(f.db.run('UPDATE cost_lots SET remaining = 5000 WHERE id = ?', [lot!.id]), 'constraint')
    const prepared = prepareInvoice({ partyId: MISC_SUPPLIER_ID, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }] })
    prepared.lines[0]!.invoiceDiscountShare = 11
    await expectAppError(f.repos.purchaseInvoices.insertPrepared({ partyId: MISC_SUPPLIER_ID, warehouseId: f.warehouseId, items: [] }, prepared), 'validation', 'نمی‌خوانند')
    assert.ok(res.invoice.id)
  })

  it('the system supplier «متفرقه» exists and cannot be deactivated or deleted (renaming is fine)', async () => {
    const f = await setup()
    const misc = await f.catalog.suppliers.getById(MISC_SUPPLIER_ID)
    assert.deepEqual([misc?.name, misc?.isSystem, misc?.isActive], ['متفرقه', true, true])
    await expectAppError(f.catalog.suppliers.setActive(MISC_SUPPLIER_ID, false), 'protected')
    await expectAppError(f.catalog.suppliers.remove(MISC_SUPPLIER_ID), 'protected')
    await f.catalog.suppliers.update(MISC_SUPPLIER_ID, { name: 'متفرقه (بدون نام)' })
    assert.equal((await f.catalog.suppliers.getById(MISC_SUPPLIER_ID))?.name, 'متفرقه (بدون نام)')
  })
})

describe('migration 002 -> 003 with legacy stock', () => {
  it('turns existing stock into lots at the old purchase price, relabels wrong-sign rows, drops purchase_price, keeps invariants', async () => {
    const db = await freshDb()
    const snapshots = new MemorySnapshotStore()
    await runMigrations(db, MIGRATIONS.slice(0, 2), snapshots)
    await seedIfNeeded(db)
    const r0 = createRepositories(db)
    const wh = (await r0.settings.getValue(SETTING_KEYS.defaultWarehouseId)) as string
    const grp = (await r0.settings.getValue(SETTING_KEYS.defaultProductGroupId)) as string
    const w2 = (await r0.warehouses.create({ name: 'شعبه' })).id
    await r0.settings.setValue('allow_negative_stock', '1')
    const cols = 'created_at, updated_at, is_active'
    const [pA, pB] = [newId(), newId()]
    for (const [id, code, price] of [[pA, 'A', 12_345], [pB, 'B', 99]] as const) {
      await db.run(`INSERT INTO products (id, code, name, group_id, unit_id, purchase_price, sale_price, ${cols}) VALUES (?, ?, ?, ?, ?, ?, 20000, ?, ?, 1)`, [id, code, `کالا ${code}`, grp, DEFAULT_UNIT_ID, price, NOW, NOW])
    }
    const mv = (p: string, w: string, d: number, t: string, at: string) =>
      db.run(`INSERT INTO stock_movements (id, product_id, warehouse_id, quantity_delta, movement_type, occurred_at, ${cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [newId(), p, w, d, t, at, at, at])
    await mv(pA, wh, 10_000, 'opening', '2026-09-01T08:00:00.000Z')
    await mv(pA, wh, -3000, 'sale', '2026-09-02T08:00:00.000Z')
    await mv(pA, wh, -1000, 'adjustment', '2026-09-03T08:00:00.000Z') // اصلاح منفی قدیمی ← «کسری»
    await mv(pA, w2, 4000, 'opening', '2026-09-04T08:00:00.000Z')
    await mv(pB, wh, 2000, 'opening', '2026-09-01T08:00:00.000Z')
    await mv(pB, wh, -2000, 'sale', '2026-09-05T08:00:00.000Z') // موجودی صفر ← بدون لایه
    for (const [p, w, q] of [[pA, wh, 6000], [pA, w2, 4000], [pB, wh, 0]] as const) {
      await db.run(`INSERT INTO warehouse_stock (id, warehouse_id, product_id, quantity, ${cols}) VALUES (?, ?, ?, ?, ?, ?, 1)`, [newId(), w, p, q, NOW, NOW])
    }

    const report = await runMigrations(db, MIGRATIONS, snapshots)
    assert.deepEqual(report.applied, [3, 4, 5])
    assert.ok(report.snapshot)
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), [])
    assert.equal((await db.get<{ integrity_check: string }>('PRAGMA integrity_check'))?.['integrity_check'], 'ok')
    const productCols = (await db.all<{ name: string }>('PRAGMA table_info(products)')).map((c) => c.name)
    assert.ok(!productCols.includes('purchase_price'))

    const r = createRepositories(db)
    const lots = await r.costs.listLots({ productId: pA })
    assert.deepEqual(lots.map((l) => [l.warehouseId, l.quantity, l.remaining, l.totalCost]).sort(), [[wh, 6000, 6000, 74_070], [w2, 4000, 4000, 49_380]].sort())
    assert.deepEqual(await r.costs.listLots({ productId: pB }), [])
    assert.deepEqual(await r.costs.getAverage(pA), { quantity: 10_000, value: 74_070 + 49_380 })
    assert.deepEqual(await r.costs.findInconsistencies(), [])
    assert.deepEqual(await r.stock.findInconsistencies(), [])
    const types = (await r.stock.listMovements({ productId: pA })).map((m) => m.movementType)
    assert.deepEqual(types, ['opening', 'sale', 'shortage', 'opening'])
    assert.equal(await r.settings.getValue('allow_negative_stock'), null)
    const settings = await r.settings.load()
    assert.deepEqual([settings.costMethod, settings.salePriceMode, settings.markupBp], ['fifo', 'last_sale', 0])
    assert.equal((await r.suppliers.getById(MISC_SUPPLIER_ID))?.isSystem, true)
    assert.equal((await r.products.getById(pA))?.salePrice, 20000)

    // بعد از Migration: فروش از لایه قدیمی با بهای قیمت خرید قبلی؛ منفی شدن موجودی ممنوع
    const inv = createInventoryService(db)
    const m = await inv.applyMovement({ productId: pA, warehouseId: wh, quantityDelta: -1000, movementType: 'sale' })
    assert.equal(m.costs?.fifo, 12_345)
    await expectAppError(inv.applyMovement({ productId: pA, warehouseId: wh, quantityDelta: -9000, movementType: 'sale' }), 'insufficient_stock')
    assert.deepEqual((await runMigrations(db, MIGRATIONS, snapshots)).applied, [])
  })
})

test('splitDiscount: proportional, integer, exact sum, never above a line', () => {
  assert.deepEqual(splitDiscount(0, [100, 200]), [0, 0])
  assert.deepEqual(splitDiscount(100, [100, 300]), [25, 75])
  const shares = splitDiscount(100, [333, 333, 334])
  assert.equal(shares.reduce((a, b) => a + b, 0), 100)
  assert.deepEqual(shares, [33, 33, 34])
  assert.deepEqual(splitDiscount(3, [1, 1, 1]), [1, 1, 1])
  assert.deepEqual(splitDiscount(5, [0, 5]), [0, 5])
  assert.throws(() => splitDiscount(11, [5, 5]))
  for (let i = 0; i < 200; i++) {
    const lines = Array.from({ length: 1 + (i % 7) }, (_, k) => ((i * 7919 + k * 104_729) % 100_000) + 1)
    const total = lines.reduce((a, b) => a + b, 0)
    const d = (i * 31_337) % (total + 1)
    const s = splitDiscount(d, lines)
    assert.equal(s.reduce((a, b) => a + b, 0), d)
    s.forEach((x, k) => assert.ok(x >= 0 && x <= lines[k]!))
  }
})

test('mulDivRound / mulDivCeil are exact for huge values', () => {
  assert.equal(mulDivRound(5, 1, 2), 3)
  assert.equal(mulDivRound(1500, 333, 1000), 500)
  assert.equal(mulDivCeil(1001, 1, 1000), 2)
  assert.equal(mulDivRound(9_000_000_000, 999_999_999, 1000), 8_999_999_991_000_000)
})
