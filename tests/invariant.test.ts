import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SYSTEM_UNITS } from '../src/models/units'
import { createStockService } from '../src/services/inventoryService'
import { createPurchaseService } from '../src/services/purchaseService'
import { AppError } from '../src/utils/errors'
import { setup } from './helpers'

/** مولد عدد شبه‌تصادفی با بذر ثابت (تکرارپذیر) */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KILO = SYSTEM_UNITS.find((u) => u.name === 'کیلو')!.id

/**
 * قاعده ثابت لایه‌ها با ۲۵۰ عملیات تصادفی (خرید چندردیفی با تخفیف و عقب‌تاریخ، موجودی اولیه، شمارش، کسری، ضایعات،
 * فروش، ابطال فروش، ابطال خرید) روی ۲ انبار و ۳ کالا (یکی کیلویی):
 * بعد از هر عملیات: جمع باقی‌مانده لایه‌ها = موجودی هر کالا در هر انبار = جمع دفتر حرکت، و میانگین هماهنگ است.
 */
test('invariant: Σ lot remaining = stock per product per warehouse after 250 random operations', async () => {
  const f = await setup()
  const random = rng(20261005)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  const purchases = createPurchaseService(f.db)
  const stock = createStockService(f.db)
  const w2 = await f.catalog.warehouses.create({ name: 'شعبه دو' })
  const warehouses = [f.warehouseId, w2.id]
  const products = [
    await f.catalog.products.create({ name: 'برنج', groupId: f.groupId, unitId: KILO }),
    await f.catalog.products.create({ name: 'هدفون', groupId: f.groupId }),
    await f.catalog.products.create({ name: 'کابل', groupId: f.groupId }),
  ]
  const qty = (p: (typeof products)[number]) => (p.unitAllowsFraction ? int(1, 20_000) : int(1, 12) * 1000)
  const purchaseIds: string[] = []
  const sales: { id: string; productId: string; warehouseId: string; quantity: number }[] = []
  const counts: Record<string, number> = {}
  const expected = new Set(['insufficient_stock', 'in_use', 'immutable', 'validation'])

  for (let step = 0; step < 250; step++) {
    const op = pick(['buy', 'buy', 'sell', 'sell', 'sell', 'opening', 'count', 'shortage', 'waste', 'cancel_sale', 'cancel_purchase'] as const)
    const w = pick(warehouses)
    const p = pick(products)
    try {
      if (op === 'buy') {
        const lines = [...products].sort(() => random() - 0.5).slice(0, int(1, 3))
        const day = String(int(1, 28)).padStart(2, '0')
        const res = await purchases.create({
          warehouseId: w,
          invoiceDate: `2026-09-${day}T0${int(0, 9)}:00:00.000Z`,
          discount: random() < 0.4 ? int(0, 500) : 0,
          items: lines.map((lp) => ({ productId: lp.id, quantity: qty(lp), unitPrice: int(100, 99_999), discount: random() < 0.3 ? int(0, 50) : 0 })),
        })
        purchaseIds.push(res.invoice.id)
      } else if (op === 'sell') {
        const quantity = qty(p)
        const m = await f.inventory.applyMovement({ productId: p.id, warehouseId: w, quantityDelta: -quantity, movementType: 'sale' })
        sales.push({ id: m.id, productId: p.id, warehouseId: w, quantity })
      } else if (op === 'opening') {
        const current = await f.inventory.getQuantity(w, p.id)
        await stock.adjust({ productId: p.id, warehouseId: w, kind: 'opening', quantity: current + qty(p), unitCost: int(0, 50_000) })
      } else if (op === 'count') {
        const current = await f.inventory.getQuantity(w, p.id)
        const target = Math.max(0, current + (random() < 0.5 ? -1 : 1) * qty(p))
        await stock.adjust({ productId: p.id, warehouseId: w, kind: 'count', quantity: target })
      } else if (op === 'shortage' || op === 'waste') {
        await stock.adjust({ productId: p.id, warehouseId: w, kind: op, quantity: qty(p) })
      } else if (op === 'cancel_sale' && sales.length) {
        const s = sales.splice(int(0, sales.length - 1), 1)[0]!
        await f.inventory.applyMovement({ productId: s.productId, warehouseId: s.warehouseId, quantityDelta: s.quantity, movementType: 'sale_cancel' }, { kind: 'reverse', originalMovementId: s.id })
      } else if (op === 'cancel_purchase' && purchaseIds.length) {
        await purchases.cancel(pick(purchaseIds))
      }
      counts[op] = (counts[op] ?? 0) + 1
    } catch (e) {
      assert.ok(e instanceof AppError && expected.has(e.code), `step ${step} ${op}: unexpected ${String(e)}`)
      counts[`${op}:rejected`] = (counts[`${op}:rejected`] ?? 0) + 1
    }
    assert.deepEqual(await f.inventory.verifyCosts(), [], `cost invariant broken after step ${step} (${op})`)
    assert.deepEqual(await f.inventory.verifyConsistency(), [], `stock cache broken after step ${step} (${op})`)
  }

  // پوشش: همه عملیات واقعاً اجرا شده‌اند (هم موفق، هم ردشده)
  for (const op of ['buy', 'sell', 'opening', 'count', 'shortage', 'waste', 'cancel_sale', 'cancel_purchase']) assert.ok((counts[op] ?? 0) > 0, `${op} never succeeded: ${JSON.stringify(counts)}`)
  assert.ok((counts['sell:rejected'] ?? 0) > 0, 'some sales must hit insufficient stock')

  // لایه‌ای که کامل مصرف شده: جمع بهای برداشت‌های فعالش دقیقاً برابر بهای لایه است
  for (const lot of await f.repos.costs.listLots()) {
    const active = (await f.repos.costs.allocationsForLot(lot.id)).filter((a) => a.reversalMovementId === null)
    const used = active.reduce((s, a) => s + a.costAmount, 0)
    if (lot.remaining === 0) assert.equal(used, lot.totalCost, 'fully consumed lot cost is fully allocated')
    else assert.ok(used <= lot.totalCost)
  }
  // میانگین بازسازی‌شده از داده خام = میانگین زنده
  const live = await Promise.all(products.map((p) => f.repos.costs.getAverage(p.id)))
  await f.inventory.rebuildAverages()
  assert.deepEqual(await Promise.all(products.map((p) => f.repos.costs.getAverage(p.id))), live)
})
