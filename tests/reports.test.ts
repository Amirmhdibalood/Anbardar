import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createExpenseService } from '../src/services/expenseService'
import { createPurchaseService } from '../src/services/purchaseService'
import { createSaleService } from '../src/services/saleService'
import { createReportService } from '../src/services/reportService'
import { fromJalali, toJalali } from '../src/utils/jalali'
import { resolvePeriod } from '../src/utils/period'
import { Q, setup } from './helpers'

describe('report calculations (phase 8)', () => {
  it('separates COGS from operating expenses and cash purchases in P&L / pie', async () => {
    const fx = await setup()
    const product = await fx.catalog.products.create({ name: 'برنج', groupId: fx.groupId })

    await createPurchaseService(fx.db).create({
      warehouseId: fx.warehouseId,
      items: [{ productId: product.id, quantity: Q(100), unitPrice: 90 }],
    })

    await createSaleService(fx.db).create({
      warehouseId: fx.warehouseId,
      items: [{ productId: product.id, quantity: Q(30), unitPrice: 120 }],
    })

    const today = toJalali(new Date())
    await createExpenseService(fx.db).create({
      category: 'salary',
      expenseDate: fromJalali(today, 12, 0).toISOString(),
      amount: 500,
    })

    const period = resolvePeriod({ key: 'today' })
    const range = { from: period.from, to: period.to }
    const reports = createReportService(fx.db)
    const pl = await reports.profitLoss(range, 'fifo')

    assert.equal(pl.revenue, 3600)
    assert.equal(pl.cogs, 2700)
    assert.equal(pl.expenseTotal, 500)
    assert.equal(pl.grossProfit, 900)
    assert.equal(pl.netProfit, 400)

    const cash = await reports.incomeSpending(range)
    assert.equal(cash.income, 3600)
    assert.equal(cash.purchases, 9000) // 100 × 90
    assert.equal(cash.expenseTotal, 500)
    assert.equal(cash.spending, 9500)
    assert.equal(cash.balance, 3600 - 9500)

    const products = await reports.productProfit(range, 'fifo')
    assert.equal(products.length, 1)
    assert.equal(products[0]!.sales, 3600)
    assert.equal(products[0]!.cost, 2700)
    assert.equal(products[0]!.profit, 900)
  })

  it('stock alerts lists out and low products', async () => {
    const fx = await setup()
    const outP = await fx.catalog.products.create({ name: 'ناموجود', groupId: fx.groupId, reorderPoint: Q(5) })
    const lowP = await fx.catalog.products.create({ name: 'کم', groupId: fx.groupId, reorderPoint: Q(20) })
    await fx.inventory.applyMovement(
      { productId: lowP.id, warehouseId: fx.warehouseId, quantityDelta: Q(10), movementType: 'opening' },
      { kind: 'lot', totalCost: 0 },
    )

    const alerts = await createReportService(fx.db).stockAlerts()
    assert.ok(alerts.out.some((a) => a.product.id === outP.id))
    assert.ok(alerts.low.some((a) => a.product.id === lowP.id))
  })
})
