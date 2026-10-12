import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPurchaseService } from '../src/services/purchaseService'
import { createSaleService } from '../src/services/saleService'
import { calcMinSalePrice, suggestSaleUnitPrice } from '../src/services/pricing'
import { DEFAULT_SETTINGS } from '../src/models/settings'
import { expectAppError, Q, setup } from './helpers'

describe('sales invoices', () => {
  it('records sale, consumes FIFO lots, stores three cost methods on lines, and creates a cash payment', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const sales = createSaleService(f.db)
    const p = await f.catalog.products.create({ name: 'هدفون', groupId: f.groupId })
    await purchases.create({ warehouseId: f.warehouseId, invoiceDate: '2026-10-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(3), unitPrice: 100 }] })
    await purchases.create({ warehouseId: f.warehouseId, invoiceDate: '2026-10-02T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(2), unitPrice: 200 }] })
    const res = await sales.create({
      warehouseId: f.warehouseId,
      discount: 50,
      items: [{ productId: p.id, quantity: Q(4), unitPrice: 500 }],
    })
    assert.equal(res.invoice.totalAmount, 2000 - 50)
    assert.equal(res.items[0]?.costs?.fifo, 300 + 200) // 3×100 + 1×200
    assert.equal(res.items[0]?.costs?.average, Math.round(((300 + 400) / 5) * 4))
    assert.equal(res.items[0]?.costs?.last, 200 * 4)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(1))
    assert.equal(await f.repos.payments.totalForSalesInvoice(res.invoice.id), 1950)
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })

  it('cancelling a sale returns stock to the same lots and clears profit on re-sale from oldest', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const sales = createSaleService(f.db)
    const p = await f.catalog.products.create({ name: 'کابل', groupId: f.groupId })
    await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(5), unitPrice: 100 }] })
    const sold = await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(3), unitPrice: 250 }] })
    await sales.cancel(sold.invoice.id, 'اشتباه')
    assert.equal((await f.repos.salesInvoices.getById(sold.invoice.id))?.status, 'cancelled')
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(5))
    const again = await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 250 }] })
    assert.equal(again.items[0]?.costs?.fifo, 100)
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })

  it('rejects overselling and never writes a partial invoice', async () => {
    const f = await setup()
    const sales = createSaleService(f.db)
    const p = await f.catalog.products.create({ name: 'موس', groupId: f.groupId })
    await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(1), movementType: 'opening' }, { kind: 'lot', totalCost: 10 })
    await expectAppError(sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(2), unitPrice: 100 }] }), 'insufficient_stock')
    assert.equal(await f.repos.salesInvoices.list().then((l) => l.length), 0)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(1))
  })

  it('suggestSaleUnitPrice respects settings modes and group markup', async () => {
    const f = await setup()
    const purchases = createPurchaseService(f.db)
    const sales = createSaleService(f.db)
    const group = await f.catalog.groups.create({ name: 'جانبی', markupBp: 2500 }) // ۲۵٪
    const p = await f.catalog.products.create({ name: 'کیبورد', groupId: group.id })
    assert.equal(await suggestSaleUnitPrice(f.db, p, { ...DEFAULT_SETTINGS, salePriceMode: 'manual' }), null)
    assert.equal(await suggestSaleUnitPrice(f.db, p, { ...DEFAULT_SETTINGS, salePriceMode: 'last_sale' }), null)
    await purchases.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(2), unitPrice: 1000 }] })
    assert.equal(await suggestSaleUnitPrice(f.db, p, { ...DEFAULT_SETTINGS, salePriceMode: 'markup', markupBp: 1000 }), 1250) // group 25% wins
    await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1800 }] })
    assert.equal(await suggestSaleUnitPrice(f.db, p, { ...DEFAULT_SETTINGS, salePriceMode: 'last_sale' }), 1800)
  })
})

describe('price calculator', () => {
  it('shows markup on cost and margin on sale, rounded up', () => {
    // ۱۰۰ + ۱۳٪ روی خرید = ۱۱۳؛ ۱۳٪ از فروش ⇒ ۱۰۰/۰٫۸۷ ≈ ۱۱۴٫۹۴ → ۱۱۵
    const r = calcMinSalePrice(100, 0, 1300)
    assert.deepEqual([r.markupPrice, r.marginPrice], [113, 115])
    const withExtra = calcMinSalePrice(100_000, 5_000, 2000)
    assert.equal(withExtra.cost, 105_000)
    assert.equal(withExtra.markupPrice, 126_000)
  })
})
