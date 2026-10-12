import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MISC_SUPPLIER_ID } from '../src/models/party'
import { SYSTEM_UNITS } from '../src/models/units'
import { createPurchaseService } from '../src/services/purchaseService'
import { ValidationError } from '../src/utils/errors'
import { expectAppError, Q, rowCount, setup } from './helpers'

const kg = SYSTEM_UNITS.find((u) => u.name === 'کیلو')!.id

describe('purchase invoices', () => {
  it('records header, lines, movements (linked to document + line, dated like the invoice) and lots in one go', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const supplier = await f.catalog.suppliers.create({ name: 'پخش البرز', phone: '۰۹۱۲۱۲۳۴۵۶۷' })
    const rice = await f.catalog.products.create({ name: 'برنج', groupId: f.groupId, unitId: kg })
    const tea = await f.catalog.products.create({ name: 'چای', groupId: f.groupId })
    const date = '2026-09-20T09:30:00.000Z'
    const { invoice, items } = await purchases.create({
      supplierId: supplier.id,
      warehouseId: f.warehouseId,
      invoiceDate: date,
      reference: ' ف-۷۷ ',
      discount: 10_000,
      items: [
        { productId: rice.id, quantity: Q(12.5), unitPrice: 80_000, discount: 0 }, // ۱٬۰۰۰٬۰۰۰
        { productId: tea.id, quantity: Q(3), unitPrice: 150_000, discount: 50_000 }, // ۴۰۰٬۰۰۰
      ],
    })
    assert.deepEqual([invoice.invoiceNumber, invoice.supplierId, invoice.reference, invoice.invoiceDate], [1, supplier.id, 'ف-77', date])
    assert.deepEqual([invoice.subtotalAmount, invoice.discount, invoice.totalAmount], [1_400_000, 10_000, 1_390_000])
    assert.deepEqual(items.map((i) => [i.lineTotal, i.invoiceDiscountShare]), [[1_000_000, 7143], [400_000, 2857]])
    assert.equal(await f.inventory.getQuantity(f.warehouseId, rice.id), 12_500)
    const movements = await f.inventory.listMovements({ documentId: invoice.id })
    assert.deepEqual(
      movements.map((m) => [m.movementType, m.documentType, m.documentLineId, m.occurredAt]).sort(),
      items.map((i) => ['purchase', 'purchase_invoice', i.id, date]).sort(),
    )
    const lots = await f.repos.costs.listLots()
    assert.deepEqual(lots.map((l) => [l.productId, l.totalCost, l.lotDate]).sort(), [[rice.id, 992_857, date], [tea.id, 397_143, date]].sort())
    assert.deepEqual(await f.inventory.verifyCosts(), [])
    assert.deepEqual(await f.repos.purchaseInvoices.findTotalMismatches(), [])

    const detail = await purchases.detail(invoice.id)
    assert.deepEqual([detail?.supplier?.name, detail?.warehouse?.name, detail?.items.map((i) => [i.product?.name, i.netAmount])], ['پخش البرز', 'انبار مرکزی', [['برنج', 992_857], ['چای', 397_143]]])
    assert.equal(await purchases.detail('nope'), null)
  })

  it('defaults to the system supplier «متفرقه», numbers invoices in order and remembers the last purchase price', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const p = await f.catalog.products.create({ name: 'شکر', groupId: f.groupId })
    assert.equal(await purchases.lastPurchasePrice(p.id), null)
    const a = await purchases.create({ warehouseId: f.warehouseId, invoiceDate: '2026-10-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(1), unitPrice: 40_000 }] })
    const b = await purchases.create({ supplierId: '', warehouseId: f.warehouseId, invoiceDate: '2026-09-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(1), unitPrice: 30_000 }] })
    assert.deepEqual([a.invoice.supplierId, b.invoice.supplierId, a.invoice.invoiceNumber, b.invoice.invoiceNumber], [MISC_SUPPLIER_ID, MISC_SUPPLIER_ID, 1, 2])
    assert.equal(await purchases.lastPurchasePrice(p.id), 40_000, 'latest by invoice date, not by entry order')
    const c = await purchases.create({ warehouseId: f.warehouseId, invoiceDate: '2026-10-02T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(1), unitPrice: 55_000 }] })
    assert.equal(await purchases.lastPurchasePrice(p.id), 55_000)
    await purchases.cancel(c.invoice.id)
    assert.equal(await purchases.lastPurchasePrice(p.id), 40_000, 'cancelled invoices are ignored')
  })

  it('rejects bad input with Persian field errors and writes nothing', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const p = await f.catalog.products.create({ name: 'خودکار', groupId: f.groupId })
    const before = async () => [await rowCount(f.db, 'purchase_invoices'), await rowCount(f.db, 'stock_movements'), await rowCount(f.db, 'cost_lots')]
    const empty = await purchases.create({ warehouseId: f.warehouseId, items: [] }).catch((e: unknown) => e)
    assert.ok(empty instanceof ValidationError && empty.fieldErrors['items']?.includes('حداقل یک کالا'))
    const dup = await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }, { productId: p.id, quantity: Q(1), unitPrice: 1 }] }).catch((e: unknown) => e)
    assert.ok(dup instanceof ValidationError && dup.fieldErrors['items']?.includes('بیش از یک بار'))
    const tooMuch = await purchases.create({ warehouseId: f.warehouseId, discount: 11, items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }] }).catch((e: unknown) => e)
    assert.ok(tooMuch instanceof ValidationError && tooMuch.fieldErrors['discount'])
    const frac = await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1.5), unitPrice: 10 }] }).catch((e: unknown) => e)
    assert.ok(frac instanceof ValidationError && frac.fieldErrors['items.0.quantity']?.includes('عدد صحیح'))
    const s = await f.catalog.suppliers.create({ name: 'قدیمی' })
    await f.catalog.suppliers.setActive(s.id, false)
    await expectAppError(purchases.create({ supplierId: s.id, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }] }), 'validation')
    await f.catalog.products.setActive(p.id, false)
    const inactive = await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }] }).catch((e: unknown) => e)
    assert.ok(inactive instanceof ValidationError && inactive.fieldErrors['items.0.productId']?.includes('غیرفعال'))
    assert.deepEqual(await before(), [0, 0, 0])
    assert.equal(Number((await f.db.get("SELECT last_value FROM sequences WHERE name = 'purchase_invoice'"))?.['last_value'] ?? 0), 0, 'failed invoices do not burn numbers')
  })

  it('lists newest first with search by number, supplier name or reference, and status filter', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const s = await f.catalog.suppliers.create({ name: 'بازرگانی نور' })
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const q = await f.catalog.products.create({ name: 'کالای دو', groupId: f.groupId })
    const one = await purchases.create({ warehouseId: f.warehouseId, invoiceDate: '2026-10-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }] })
    await purchases.create({ supplierId: s.id, reference: 'AB-55', warehouseId: f.warehouseId, invoiceDate: '2026-10-03T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }, { productId: q.id, quantity: Q(1), unitPrice: 10 }] })
    await purchases.cancel(one.invoice.id)
    const all = await purchases.list()
    assert.deepEqual(all.map((r) => [r.invoice.invoiceNumber, r.supplierName, r.itemCount, r.invoice.status]), [[2, 'بازرگانی نور', 2, 'active'], [1, 'متفرقه', 1, 'cancelled']])
    assert.deepEqual((await purchases.list({ search: '۱' })).map((r) => r.invoice.invoiceNumber), [1])
    assert.deepEqual((await purchases.list({ search: '#2' })).map((r) => r.invoice.invoiceNumber), [2])
    assert.deepEqual((await purchases.list({ search: 'نور' })).map((r) => r.invoice.invoiceNumber), [2])
    assert.deepEqual((await purchases.list({ search: 'ab-5' })).map((r) => r.invoice.invoiceNumber), [2], 'reference match ignores Latin case')
    assert.deepEqual((await purchases.list({ search: 'AB-5' })).map((r) => r.invoice.invoiceNumber), [2])
    assert.deepEqual((await purchases.list({ search: 'AB-۵۵' })).map((r) => r.invoice.invoiceNumber), [2], 'Persian digits in a reference search match')
    assert.deepEqual((await purchases.list({ search: '50%' })).length, 0)
    assert.deepEqual((await purchases.list({ status: 'active' })).map((r) => r.invoice.invoiceNumber), [2])
    assert.deepEqual((await purchases.list({ limit: 1, offset: 1 })).map((r) => r.invoice.invoiceNumber), [1])
  })
})
