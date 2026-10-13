import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SYSTEM_UNITS } from '../src/models/units'
import { createChequeService } from '../src/services/chequeService'
import { createStockService } from '../src/services/inventoryService'
import { createMoneyService } from '../src/services/moneyService'
import { createPurchaseService } from '../src/services/purchaseService'
import { createReturnService } from '../src/services/returnService'
import { createSaleService } from '../src/services/saleService'
import { ValidationError } from '../src/utils/errors'
import { allocateExact, prepareInvoice, toBaseQuantity, unitPriceFromTotal } from '../src/utils/invoiceMath'
import { expectAppError, Q, setup } from './helpers'

const unit = (n: string) => SYSTEM_UNITS.find((u) => u.name === n)!.id
const each = unit('عدد')
const carton = unit('کارتن')
const pack = unit('بسته')
const kg = unit('کیلو')
const gram = unit('گرم')

async function rejectsField(p: Promise<unknown>, field: RegExp) {
  const e = await p.then(() => null, (x: unknown) => x)
  assert.ok(e instanceof ValidationError, `expected ValidationError, got ${String(e)}`)
  assert.ok(Object.keys(e.fieldErrors).some((k) => field.test(k)), JSON.stringify(e.fieldErrors))
}

describe('stage 2: rounding math', () => {
  it('100,000 / 3: total mode keeps the line total exact; unit price is display-only', () => {
    assert.equal(unitPriceFromTotal(100_000, Q(3)), 33_333)
    assert.equal(unitPriceFromTotal(200_000, Q(3)), 66_667)
    const p = prepareInvoice({ partyId: 's', warehouseId: 'w', items: [{ productId: 'a', quantity: Q(3), unitPrice: 0, priceMode: 'total', lineAmount: 100_000 }] })
    assert.deepEqual([p.lines[0]!.grossAmount, p.lines[0]!.lineTotal, p.lines[0]!.unitPrice, p.total], [100_000, 100_000, 33_333, 100_000])
    // unit mode with the rounded price drifts by 1 — exactly why total mode exists
    const u = prepareInvoice({ partyId: 's', warehouseId: 'w', items: [{ productId: 'a', quantity: Q(3), unitPrice: 33_333 }] })
    assert.equal(u.total, 99_999)
  })
  it('allocateExact sums exactly and is deterministic', () => {
    assert.deepEqual(allocateExact(100, [1, 1, 1]), [34, 33, 33])
    assert.deepEqual(allocateExact(10, [0, 5, 5]), [0, 5, 5])
    assert.deepEqual(allocateExact(1, [3, 7]), [0, 1])
    const s = allocateExact(1_000_001, [333, 333, 334])
    assert.equal(s.reduce((a, b) => a + b, 0), 1_000_001)
  })
  it('toBaseQuantity is exact or null', () => {
    assert.equal(toBaseQuantity(Q(2), 24_000), 48_000)
    assert.equal(toBaseQuantity(Q(1.5), 250), 375)
    assert.equal(toBaseQuantity(1, 1), null) // 0.001 × 0.001 → too many decimals
  })
})

describe('stage 2: sub-units', () => {
  it('defines کارتن = 24 عدد, buys in cartons, sells in each; ledger is in the base unit', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const sales = createSaleService(f.db)
    const p = await f.catalog.products.create({ name: 'نوشابه', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 24_000 }] })
    assert.deepEqual(p.subUnits?.map((u) => [u.unitName, u.factor]), [['کارتن', 24_000]])
    const { items } = await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(2), unitPrice: 480_000 }] })
    assert.deepEqual([items[0]!.quantity, items[0]!.unitQuantity, items[0]!.unitFactor, items[0]!.lineTotal], [48_000, 2_000, 24_000, 960_000])
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(48))
    // last purchase price is per base unit
    assert.equal(await purchases.lastPurchasePrice(p.id), 20_000)
    const sale = await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(5), unitPrice: 25_000 }] })
    assert.equal(sale.items[0]!.costs?.fifo, 100_000)
    const sale2 = await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(1), unitPrice: 550_000 }] })
    assert.deepEqual([sale2.items[0]!.quantity, sale2.items[0]!.costs?.fifo], [24_000, 480_000])
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(19))
  })
  it('rejects bad sub-unit definitions and fractional cartons', async () => {
    const f = await setup()
    await rejectsField(f.catalog.products.create({ name: 'الف', groupId: f.groupId, unitId: each, subUnits: [{ unitId: each, factor: 24_000 }] }), /subUnits/)
    await rejectsField(f.catalog.products.create({ name: 'ب', groupId: f.groupId, unitId: each, subUnits: [{ unitId: pack, factor: 2_500 }] }), /subUnits/)
    await rejectsField(f.catalog.products.create({ name: 'ج', groupId: f.groupId, unitId: each, subUnits: [{ unitId: pack, factor: 0 }] }), /subUnits/)
    const p = await f.catalog.products.create({ name: 'د', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 12_000 }] })
    await rejectsField(createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(1.5), unitPrice: 1 }] }), /quantity/)
    await rejectsField(createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: pack, quantity: Q(1), unitPrice: 1 }] }), /unitId/)
  })
  it('fractional base: گرم under کیلو, 3-decimal limit', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'زعفران', groupId: f.groupId, unitId: kg, subUnits: [{ unitId: gram, factor: 1 }] })
    const { items } = await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: gram, quantity: Q(250), unitPrice: 1_000 }] })
    assert.deepEqual([items[0]!.quantity, items[0]!.lineTotal], [250, 250_000])
    await rejectsField(createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: gram, quantity: Q(0.5), unitPrice: 1 }] }), /quantity/)
  })
  it('factor can change while unused, is locked once used; removed unit is deactivated', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'ه', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 12_000 }] })
    const u1 = await f.catalog.products.update(p.id, { name: 'ه', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 24_000 }] })
    assert.equal(u1.subUnits?.[0]?.factor, 24_000)
    await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(1), unitPrice: 1 }] })
    await rejectsField(f.catalog.products.update(p.id, { name: 'ه', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 6_000 }] }), /subUnits/)
    const u2 = await f.catalog.products.update(p.id, { name: 'ه', groupId: f.groupId, unitId: each, subUnits: [] })
    assert.equal(u2.subUnits?.filter((u) => u.isActive).length, 0)
  })
  it('returns in the line unit convert to base and refund proportionally', async () => {
    const f = await setup()
    const customer = await f.catalog.customers.create({ name: 'مشتری' })
    const p = await f.catalog.products.create({ name: 'و', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 10_000 }] })
    await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(30), unitPrice: 1_000 }] })
    const { invoice, items } = await createSaleService(f.db).create({ customerId: customer.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(2), unitPrice: 15_000 }] })
    const ret = await createReturnService(f.db).createSaleReturn({ salesInvoiceId: invoice.id, lines: [{ sourceItemId: items[0]!.id, unitId: carton, quantity: Q(1) }] })
    assert.equal(ret.totalAmount, 15_000)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(20))
  })
})

describe('stage 2: price mode on purchase and opening stock', () => {
  it('total mode: lot cost equals the entered total exactly (FIFO no drift)', async () => {
    const f = await setup()
    const sales = createSaleService(f.db)
    const p = await f.catalog.products.create({ name: 'ز', groupId: f.groupId, unitId: each })
    await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(3), unitPrice: 0, priceMode: 'total', lineAmount: 100_000 }] })
    const lots = await f.repos.costs.listLots()
    assert.equal(lots[0]!.totalCost, 100_000)
    const s = await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(3), unitPrice: 50_000 }] })
    assert.equal(s.items[0]!.costs?.fifo, 100_000)
  })
  it('total mode works with sub-units; sales reject total mode', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'ح', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 24_000 }] })
    const { items } = await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(3), unitPrice: 0, priceMode: 'total', lineAmount: 1_000_000 }] })
    assert.deepEqual([items[0]!.quantity, items[0]!.grossAmount, items[0]!.unitPrice, items[0]!.priceMode], [72_000, 1_000_000, 333_333, 'total'])
    await rejectsField(createSaleService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 0, priceMode: 'total', lineAmount: 5 }] }), /items/)
  })
  it('opening stock: unit cost per carton and total mode are exact', async () => {
    const f = await setup()
    const stock = createStockService(f.db)
    const p = await f.catalog.products.create({ name: 'ط', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 24_000 }] })
    await stock.adjust({ productId: p.id, warehouseId: f.warehouseId, kind: 'opening', unitId: carton, quantity: Q(2), unitCost: 480_000 })
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(48))
    const q = await f.catalog.products.create({ name: 'ی', groupId: f.groupId, unitId: each })
    await stock.adjust({ productId: q.id, warehouseId: f.warehouseId, kind: 'opening', quantity: Q(3), priceMode: 'total', totalCost: 100_000 })
    const lots = (await f.repos.costs.listLots()).map((l) => [l.productId, l.totalCost])
    assert.deepEqual(lots.sort(), [[p.id, 960_000], [q.id, 100_000]].sort())
  })
})

describe('stage 2: landed costs', () => {
  it('allocates by value into lots (not into the supplier payable) and cancels cleanly', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const supplier = await f.catalog.suppliers.create({ name: 'تأمین' })
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    const b = await f.catalog.products.create({ name: 'ب', groupId: f.groupId })
    const { invoice, items } = await purchases.create({
      supplierId: supplier.id,
      paidAmount: 0,
      warehouseId: f.warehouseId,
      items: [
        { productId: a.id, quantity: Q(1), unitPrice: 200_000 },
        { productId: b.id, quantity: Q(2), unitPrice: 50_000 },
      ],
      charges: [{ title: 'حمل', amount: 30_000 }, { title: 'بیمه', amount: 1 }],
    })
    assert.deepEqual([invoice.totalAmount, invoice.landedTotal, invoice.landedMethod], [300_000, 30_001, 'value'])
    assert.deepEqual(items.map((i) => i.landedShare), [20_001, 10_000])
    assert.equal(await createMoneyService(f.db).balanceOf(supplier.id), -300_000)
    const lots = (await f.repos.costs.listLots()).map((l) => [l.productId, l.totalCost]).sort()
    assert.deepEqual(lots, [[a.id, 220_001], [b.id, 110_000]].sort())
    const detail = await purchases.detail(invoice.id)
    assert.deepEqual(detail?.charges.map((c) => [c.title, c.amount]), [['حمل', 30_000], ['بیمه', 1]])
    await purchases.cancel(invoice.id)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, a.id), 0)
    assert.equal(await createMoneyService(f.db).balanceOf(supplier.id), 0)
  })
  it('allocates by quantity (base units) and makes profit correct', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'ک', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 10_000 }] })
    const q = await f.catalog.products.create({ name: 'گ', groupId: f.groupId })
    const { items } = await createPurchaseService(f.db).create({
      warehouseId: f.warehouseId,
      landedMethod: 'quantity',
      items: [
        { productId: p.id, unitId: carton, quantity: Q(3), unitPrice: 100_000 },
        { productId: q.id, quantity: Q(10), unitPrice: 1_000_000 },
      ],
      charges: [{ title: 'حمل', amount: 40_000 }],
    })
    assert.deepEqual(items.map((i) => i.landedShare), [30_000, 10_000])
    const s = await createSaleService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 20_000 }] })
    assert.equal(s.items[0]!.costs?.fifo, 11_000)
  })
  it('validates charges', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'ل', groupId: f.groupId })
    await rejectsField(createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }], charges: [{ title: ' ', amount: 5 }] }), /charges/)
    await rejectsField(createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }], charges: [{ title: 'حمل', amount: 0 }] }), /charges/)
  })
})

describe('stage 2: cheques', () => {
  async function world() {
    const f = await setup()
    const money = createMoneyService(f.db)
    const cheques = createChequeService(f.db)
    const customer = await f.catalog.customers.create({ name: 'مشتری چک' })
    const supplier = await f.catalog.suppliers.create({ name: 'تأمین چک' })
    const p = await f.catalog.products.create({ name: 'م', groupId: f.groupId })
    await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(10), unitPrice: 1_000 }] })
    await createSaleService(f.db).create({ customerId: customer.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 500_000 }] })
    await createPurchaseService(f.db).create({ supplierId: supplier.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 500_000 }] })
    return { f, money, cheques, customer, supplier }
  }
  const cheque = { number: '۱۲۳۴۵۶', bank: 'ملت', dueDate: '2026-10-20T00:00:00.000Z' }

  it('requires cheque details for the cheque method', async () => {
    const { money, customer } = await world()
    await rejectsField(money.create({ kind: 'receipt', partyId: customer.id, amount: 500_000, method: 'cheque' }), /cheque\./)
  })
  it('received → cleared keeps the debt settled', async () => {
    const { money, cheques, customer } = await world()
    const doc = await money.create({ kind: 'receipt', partyId: customer.id, amount: 500_000, method: 'cheque', cheque })
    assert.equal(await money.balanceOf(customer.id), 0)
    const [c] = await cheques.list()
    assert.deepEqual([c!.number, c!.status, c!.direction, c!.amount, c!.documentId], ['123456', 'pending', 'received', 500_000, doc.id])
    assert.equal((await cheques.dueUntil('2026-10-25T00:00:00.000Z')).length, 1)
    assert.equal((await cheques.dueUntil('2026-10-19T00:00:00.000Z')).length, 0)
    await cheques.clear(c!.id)
    assert.equal((await cheques.get(c!.id)).status, 'cleared')
    assert.equal(await money.balanceOf(customer.id), 0)
    await expectAppError(money.cancel(doc.id), 'protected')
    await expectAppError(cheques.bounce(c!.id), 'immutable')
  })
  it('bounced received cheque re-opens the customer debt', async () => {
    const { money, cheques, customer } = await world()
    await money.create({ kind: 'receipt', partyId: customer.id, amount: 500_000, method: 'cheque', cheque })
    const [c] = await cheques.list()
    await cheques.bounce(c!.id)
    assert.equal(await money.balanceOf(customer.id), 500_000)
    assert.equal((await cheques.list({ status: 'bounced' })).length, 1)
  })
  it('issued cheque bounce re-opens our payable', async () => {
    const { money, cheques, supplier } = await world()
    await money.create({ kind: 'payment', partyId: supplier.id, amount: 500_000, method: 'cheque', cheque })
    assert.equal(await money.balanceOf(supplier.id), 0)
    const [c] = await cheques.list({ direction: 'issued' })
    await cheques.bounce(c!.id)
    assert.equal(await money.balanceOf(supplier.id), -500_000)
  })
  it('spend a received cheque to a supplier; bounce reverses both sides', async () => {
    const { money, cheques, customer, supplier } = await world()
    await money.create({ kind: 'receipt', partyId: customer.id, amount: 500_000, method: 'cheque', cheque })
    const [c] = await cheques.list()
    await expectAppError(cheques.spend(c!.id, customer.id), 'validation')
    await cheques.spend(c!.id, supplier.id)
    const spent = await cheques.get(c!.id)
    assert.equal(spent.status, 'spent')
    assert.equal(spent.spentToName, 'تأمین چک')
    assert.equal(await money.balanceOf(supplier.id), 0)
    await expectAppError(money.cancel(spent.spentDocumentId!), 'protected')
    await cheques.bounce(c!.id)
    assert.equal(await money.balanceOf(customer.id), 500_000)
    assert.equal(await money.balanceOf(supplier.id), -500_000)
  })
  it('pending cheque doc can be cancelled; it then drops out of the due list', async () => {
    const { money, cheques, customer } = await world()
    const doc = await money.create({ kind: 'receipt', partyId: customer.id, amount: 100_000, method: 'cheque', cheque })
    await money.cancel(doc.id)
    assert.equal((await cheques.list()).length, 0)
    assert.equal((await cheques.dueUntil('2030-01-01T00:00:00.000Z')).length, 0)
  })
})

describe('stage 2: migration 007 on a real populated database', () => {
  it('keeps every invoice line and amount, adds unit columns with base defaults, stays consistent', async () => {
    const { readFileSync } = await import('node:fs')
    const { freshDb } = await import('./helpers')
    const { restoreDump, MemorySnapshotStore } = await import('../src/database/snapshot')
    const { runMigrations } = await import('../src/database/migrations/runner')
    const { MIGRATIONS } = await import('../src/database/migrations')
    const { createRepositories } = await import('../src/repositories')
    const db = await freshDb()
    const dump = JSON.parse(readFileSync(new URL('./fixtures/v5-dump.json', import.meta.url), 'utf8'))
    await restoreDump(db, dump)
    const before = await db.all('SELECT id, quantity, unit_price, discount, line_total FROM sales_items UNION ALL SELECT id, quantity, unit_price, discount, line_total FROM purchase_items ORDER BY id')
    const snapshots = new MemorySnapshotStore()
    const report = await runMigrations(db, MIGRATIONS, snapshots)
    assert.ok(report.snapshot)
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), [])
    const after = await db.all(
      'SELECT id, quantity, unit_price, discount, line_total, unit_id, unit_factor, unit_quantity, price_mode, gross_amount FROM sales_items UNION ALL SELECT id, quantity, unit_price, discount, line_total, unit_id, unit_factor, unit_quantity, price_mode, gross_amount FROM purchase_items ORDER BY id',
    )
    assert.ok(before.length > 0)
    assert.deepEqual(after.map((r) => [r['id'], r['quantity'], r['unit_price'], r['discount'], r['line_total']]), before.map((r) => [r['id'], r['quantity'], r['unit_price'], r['discount'], r['line_total']]))
    for (const r of after) {
      assert.deepEqual([r['unit_id'], r['unit_factor'], r['unit_quantity'], r['price_mode']], [null, 1000, r['quantity'], 'unit'])
      assert.equal(Number(r['gross_amount']) - Number(r['discount']), Number(r['line_total']))
    }
    const repos = createRepositories(db)
    assert.deepEqual(await repos.salesInvoices.findTotalMismatches(), [])
    assert.deepEqual(await repos.purchaseInvoices.findTotalMismatches(), [])
    const triggers = (await db.all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%items%'")).map((r) => String(r['name']))
    for (const t of ['no_update', 'no_delete', 'whole_units', 'unit_valid', 'share_limit', 'only_active']) {
      assert.ok(triggers.includes(`trg_sales_items_${t}`) && triggers.includes(`trg_purchase_items_${t}`), t)
    }
    assert.ok((await db.get("SELECT 1 AS x FROM sqlite_master WHERE name = 'trg_products_unit_locked'"))?.['x'])
  })
})

describe('stage 2: backup round-trip', () => {
  it('dump/restore keeps sub-units, charges and cheques', async () => {
    const { dumpDatabase, restoreDump, validateDump } = await import('../src/database/snapshot')
    const { freshDb } = await import('./helpers')
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'پ', groupId: f.groupId, unitId: each, subUnits: [{ unitId: carton, factor: 24_000 }] })
    const supplier = await f.catalog.suppliers.create({ name: 'ت' })
    await createPurchaseService(f.db).create({ supplierId: supplier.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: p.id, unitId: carton, quantity: Q(1), unitPrice: 0, priceMode: 'total', lineAmount: 100_000 }], charges: [{ title: 'حمل', amount: 5_000 }] })
    await createMoneyService(f.db).create({ kind: 'payment', partyId: supplier.id, amount: 100_000, method: 'cheque', cheque: { number: '1', bank: 'ملی', dueDate: '2026-11-01T00:00:00.000Z' } })
    const dump = await dumpDatabase(f.db, 7, 'test')
    const v = validateDump(JSON.parse(JSON.stringify(dump)))
    assert.ok(v.ok, JSON.stringify(v))
    const db2 = await freshDb()
    await restoreDump(db2, dump)
    for (const t of ['product_units', 'purchase_charges', 'cheques', 'purchase_items']) {
      assert.equal((await db2.all(`SELECT * FROM ${t}`)).length, (await f.db.all(`SELECT * FROM ${t}`)).length, t)
    }
  })
})
