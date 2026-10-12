import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPurchaseService } from '../src/services/purchaseService'
import { createSaleService } from '../src/services/saleService'
import { createReturnService, createTransferService } from '../src/services/returnService'
import { Q, expectAppError, setup } from './helpers'

describe('sale/purchase returns and transfers (phase 9)', () => {
  it('sale return restores stock with lot cost from original sale and blocks over-return', async () => {
    const fx = await setup()
    const p = await fx.catalog.products.create({ name: 'گوشی', groupId: fx.groupId })
    await createPurchaseService(fx.db).create({
      warehouseId: fx.warehouseId,
      items: [{ productId: p.id, quantity: Q(10), unitPrice: 100 }],
    })
    const sold = await createSaleService(fx.db).create({
      warehouseId: fx.warehouseId,
      items: [{ productId: p.id, quantity: Q(4), unitPrice: 150 }],
    })
    assert.equal(await fx.inventory.getQuantity(fx.warehouseId, p.id), Q(6))

    const returns = createReturnService(fx.db)
    const item = sold.items[0]!
    const ret = await returns.createSaleReturn({
      salesInvoiceId: sold.invoice.id,
      lines: [{ sourceItemId: item.id, quantity: Q(2) }],
    })
    assert.equal(ret.totalAmount, 300) // 2 × 150
    assert.equal(await fx.inventory.getQuantity(fx.warehouseId, p.id), Q(8))
    assert.deepEqual(await fx.inventory.verifyCosts(), [])

    await expectAppError(
      returns.createSaleReturn({
        salesInvoiceId: sold.invoice.id,
        lines: [{ sourceItemId: item.id, quantity: Q(3) }], // only 2 left returnable
      }),
      'validation',
    )
  })

  it('purchase return prefers original purchase lot (FIFO-correct document link)', async () => {
    const fx = await setup()
    const p = await fx.catalog.products.create({ name: 'کابل', groupId: fx.groupId })
    const buy1 = await createPurchaseService(fx.db).create({
      warehouseId: fx.warehouseId,
      invoiceDate: '2026-10-01T08:00:00.000Z',
      items: [{ productId: p.id, quantity: Q(5), unitPrice: 100 }],
    })
    await createPurchaseService(fx.db).create({
      warehouseId: fx.warehouseId,
      invoiceDate: '2026-10-02T08:00:00.000Z',
      items: [{ productId: p.id, quantity: Q(5), unitPrice: 200 }],
    })
    // return 3 from first purchase → should take from lot @100
    const returns = createReturnService(fx.db)
    const item = buy1.items[0]!
    const ret = await returns.createPurchaseReturn({
      purchaseInvoiceId: buy1.invoice.id,
      lines: [{ sourceItemId: item.id, quantity: Q(3) }],
    })
    assert.equal(ret.totalAmount, 300)
    const detail = await returns.purchaseReturnDetail(ret.id)
    assert.equal(detail!.items[0]!.costs.fifo, 300) // 3×100 not 3×200
    assert.equal(await fx.inventory.getQuantity(fx.warehouseId, p.id), Q(7))
    assert.deepEqual(await fx.inventory.verifyCosts(), [])
  })

  it('transfer moves stock and lot cost between warehouses', async () => {
    const fx = await setup()
    const w2 = await fx.catalog.warehouses.create({ name: 'انبار ۲' })
    const p = await fx.catalog.products.create({ name: 'ماوس', groupId: fx.groupId })
    await createPurchaseService(fx.db).create({
      warehouseId: fx.warehouseId,
      items: [{ productId: p.id, quantity: Q(10), unitPrice: 50 }],
    })
    const transfers = createTransferService(fx.db)
    const t = await transfers.create({
      fromWarehouseId: fx.warehouseId,
      toWarehouseId: w2.id,
      lines: [{ productId: p.id, quantity: Q(4) }],
    })
    assert.ok(t.transferNumber >= 1)
    assert.equal(await fx.inventory.getQuantity(fx.warehouseId, p.id), Q(6))
    assert.equal(await fx.inventory.getQuantity(w2.id, p.id), Q(4))
    assert.deepEqual(await fx.inventory.verifyCosts(), [])
    assert.deepEqual(await fx.inventory.verifyConsistency(), [])

    // sell from destination uses transferred lot cost
    const sale = await createSaleService(fx.db).create({
      warehouseId: w2.id,
      items: [{ productId: p.id, quantity: Q(2), unitPrice: 80 }],
    })
    assert.equal(sale.items[0]!.costs!.fifo, 100) // 2×50
  })

  it('rejects transfer to same warehouse', async () => {
    const fx = await setup()
    const p = await fx.catalog.products.create({ name: 'قلم', groupId: fx.groupId })
    await expectAppError(
      createTransferService(fx.db).create({
        fromWarehouseId: fx.warehouseId,
        toWarehouseId: fx.warehouseId,
        lines: [{ productId: p.id, quantity: Q(1) }],
      }),
      'validation',
    )
  })
})
